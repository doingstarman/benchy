import type { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { computeStandings } from '../arena.js'
import type { ArenaVerdict, DatasetVar, DatasetVarType } from '../types.js'

// ─── row shapes ──────────────────────────────────────────────────────────────

interface RunRow {
  id: string
  dataset_id: string
  dataset_name: string
  prompts: string
  models: string
  mode: string | null
  status: string
  created_at: number
  avg_score: number | null
  tokens: number
  duration_ms: number | null
}

interface ResRow {
  model: string
  prompt_index: number
  score: number | null
  score_detail: string | null
  total_time: number | null
  input_tokens: number | null
  output_tokens: number | null
}

interface ItemRow {
  idx: number
  attachment_id: string | null
  ground_truth: string
}

// ─── pure helpers (unit-testable) ────────────────────────────────────────────

const VAR_TYPES: DatasetVarType[] = ['text', 'date', 'number']

function parseSchema(raw: string): DatasetVar[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(v => {
      if (!v || typeof v !== 'object') return []
      const o = v as Record<string, unknown>
      return typeof o.key === 'string' && VAR_TYPES.includes(o.type as DatasetVarType)
        ? [{ key: o.key, type: o.type as DatasetVarType }]
        : []
    })
  } catch { return [] }
}

function parseDetail(raw: string | null): Record<string, 'match' | 'miss'> {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, 'match' | 'miss'> = {}
    for (const [k, v] of Object.entries(p)) if (v === 'match' || v === 'miss') out[k] = v
    return out
  } catch { return {} }
}

export interface MatrixRow {
  model: string
  overall: number | null
  perVar: Record<string, number | null>
}

// Per-model × per-variable accuracy from stored score_detail — the same shape the
// dataset detail's buildMatrix produces, computed here so the winner and the
// analytics agree and are testable server-side.
export function scoreMatrix(schema: DatasetVar[], results: ResRow[]): MatrixRow[] {
  const byModel = new Map<string, ResRow[]>()
  for (const r of results) {
    const arr = byModel.get(r.model) ?? []
    arr.push(r)
    byModel.set(r.model, arr)
  }
  return [...byModel.entries()].map(([model, rows]) => {
    const perVar: Record<string, number | null> = {}
    for (const v of schema) {
      let scored = 0, matched = 0
      for (const r of rows) {
        const d = parseDetail(r.score_detail)[v.key]
        if (d === 'match' || d === 'miss') { scored++; if (d === 'match') matched++ }
      }
      perVar[v.key] = scored === 0 ? null : matched / scored
    }
    const scoredRows = rows.filter(r => r.score != null)
    const overall = scoredRows.length === 0 ? null : scoredRows.reduce((s, r) => s + (r.score ?? 0), 0) / scoredRows.length
    return { model, overall, perVar }
  }).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1))
}

function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  // Neutralize spreadsheet formula injection: a cell that opens with =,+,-,@ (or a
  // control char) runs as a formula in Excel/Sheets. Prefix with an apostrophe so
  // it's read as text. Model output is untrusted even on a single-user tool.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const head = cols.map(csvCell).join(',')
  const body = rows.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n')
  return `${head}\n${body}\n`
}

// ─── DB access ───────────────────────────────────────────────────────────────

function loadVerdicts(runId: string): ArenaVerdict[] {
  const rows = getDb().prepare(
    'SELECT prompt_index, best_model, worst_model, skipped FROM dataset_run_verdicts WHERE run_id = ? ORDER BY prompt_index'
  ).all(runId) as { prompt_index: number; best_model: string | null; worst_model: string | null; skipped: number }[]
  return rows.map(r => ({ promptIndex: r.prompt_index, bestModel: r.best_model, worstModel: r.worst_model, skipped: r.skipped === 1 }))
}

// No `text` — winner and analytics never read the answer body; only the export
// path needs it, and queries for it separately. Keeps the list endpoint from
// materializing every run's full output just to pick a winner.
function loadResults(runId: string): ResRow[] {
  return getDb().prepare(
    'SELECT model, prompt_index, score, score_detail, total_time, input_tokens, output_tokens FROM results WHERE run_id = ? ORDER BY prompt_index, model'
  ).all(runId) as ResRow[]
}

// The winning model of a test: top Elo for arena (null until at least one item is
// judged), top average field-accuracy for score runs (null if nothing scored).
function computeWinner(runId: string, models: string[], mode: string, results: ResRow[]): string | null {
  if (mode === 'arena') {
    const verdicts = loadVerdicts(runId)
    // Skipped verdicts are real rows but carry no judgment — a skip-only run has
    // no winner (every model stays at the starting Elo, and standings[0] would
    // just be the first model in the list).
    if (!verdicts.some(v => !v.skipped && (v.bestModel || v.worstModel))) return null
    return computeStandings(models, verdicts)[0]?.model ?? null
  }
  const matrix = scoreMatrix([], results) // overall only needs scores, not schema
  const top = matrix.find(m => m.overall != null)
  return top?.model ?? null
}

// ─── routes ──────────────────────────────────────────────────────────────────

export async function registerResultsRoutes(app: FastifyInstance): Promise<void> {
  const db = () => getDb()

  // The run database: every dataset test across every dataset, newest first.
  app.get('/api/results', async () => {
    const rows = db().prepare(
      `SELECT r.id, r.dataset_id, d.name AS dataset_name, r.prompts, r.models, r.mode, r.status, r.created_at,
              (SELECT AVG(score) FROM results WHERE run_id = r.id AND score IS NOT NULL) AS avg_score,
              (SELECT COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) FROM results WHERE run_id = r.id) AS tokens,
              (SELECT MAX(total_time) FROM results WHERE run_id = r.id) AS duration_ms
       FROM runs r JOIN datasets d ON d.id = r.dataset_id
       ORDER BY r.created_at DESC LIMIT 500`,
    ).all() as RunRow[]

    return {
      data: rows.map(r => {
        const models = JSON.parse(r.models) as string[]
        const mode = r.mode ?? 'score'
        const winner = computeWinner(r.id, models, mode, loadResults(r.id))
        return {
          runId: r.id, datasetId: r.dataset_id, datasetName: r.dataset_name,
          itemCount: (JSON.parse(r.prompts) as string[]).length, modelCount: models.length,
          mode, status: r.status, createdAt: r.created_at,
          avgScore: r.avg_score, tokens: r.tokens, durationMs: r.duration_ms, winner,
        }
      }),
    }
  })

  // Per-test analytics summary (3c). Everything derived on read.
  app.get<{ Params: { runId: string } }>('/api/results/:runId', async (req, reply) => {
    const run = db().prepare(
      `SELECT r.id, r.dataset_id, d.name AS dataset_name, r.prompts, r.models, r.mode
       FROM runs r JOIN datasets d ON d.id = r.dataset_id WHERE r.id = ?`,
    ).get(req.params.runId) as (Pick<RunRow, 'id' | 'dataset_id' | 'dataset_name' | 'prompts' | 'models' | 'mode'>) | undefined
    if (!run) return reply.code(404).send({ error: 'Not a dataset test run' })

    const models = JSON.parse(run.models) as string[]
    const mode = run.mode ?? 'score'
    const itemCount = (JSON.parse(run.prompts) as string[]).length
    const results = loadResults(req.params.runId)
    const schema = parseSchema((db().prepare('SELECT schema FROM datasets WHERE id = ?').get(run.dataset_id) as { schema: string }).schema)
    const items = db().prepare('SELECT idx, attachment_id, ground_truth FROM dataset_items WHERE dataset_id = ? ORDER BY idx')
      .all(run.dataset_id) as ItemRow[]
    const fileNames = itemFileNames(items)

    const tokens = results.reduce((s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0)
    const durationMs = results.reduce((m, r) => Math.max(m, r.total_time ?? 0), 0)
    const perModelLatency = models.map(model => {
      const rows = results.filter(r => r.model === model && r.total_time != null)
      return { model, ms: rows.length ? Math.round(rows.reduce((s, r) => s + (r.total_time ?? 0), 0) / rows.length) : null }
    })

    if (mode === 'arena') {
      const verdicts = loadVerdicts(req.params.runId)
      const standings = computeStandings(models, verdicts)
      const judged = verdicts.some(v => !v.skipped && (v.bestModel || v.worstModel))
      const winner = judged ? standings[0]?.model ?? null : null
      const skipped = verdicts.filter(v => v.skipped).length
      // Items where the winner wasn't the human's pick — where it still loses.
      const weak = verdicts
        .filter(v => !v.skipped && v.bestModel && v.bestModel !== winner)
        .slice(0, 6)
        .map(v => ({ file: fileNames[v.promptIndex] ?? `#${v.promptIndex + 1}`, why: `best: ${v.bestModel}` }))
      return {
        data: {
          mode, datasetName: run.dataset_name, itemCount, modelCount: models.length,
          winner, tokens, durationMs, coverage: verdicts.length, skipped,
          standings, matrix: null, agreement: null, perModelLatency, weak,
        },
      }
    }

    // score mode
    const matrix = scoreMatrix(schema, results)
    const winner = matrix.find(m => m.overall != null)?.model ?? null
    const scoredItems = new Set(results.filter(r => r.score != null).map(r => r.prompt_index)).size
    const weak = winner
      ? results
          .filter(r => r.model === winner)
          .map(r => ({ pi: r.prompt_index, misses: Object.entries(parseDetail(r.score_detail)).filter(([, s]) => s === 'miss').map(([k]) => k) }))
          .filter(w => w.misses.length)
          .slice(0, 6)
          .map(w => ({ file: fileNames[w.pi] ?? `#${w.pi + 1}`, why: w.misses.join(', ') }))
      : []
    return {
      data: {
        mode, datasetName: run.dataset_name, itemCount, modelCount: models.length,
        winner, tokens, durationMs, coverage: scoredItems, skipped: 0,
        standings: null, matrix, agreement: null, perModelLatency, weak,
      },
    }
  })

  // Per-item × per-model rows as CSV or JSON. attachment=download.
  app.get<{ Params: { runId: string }; Querystring: { format?: string } }>('/api/results/:runId/export', async (req, reply) => {
    const run = db().prepare(
      `SELECT r.dataset_id, d.name AS dataset_name, r.mode FROM runs r JOIN datasets d ON d.id = r.dataset_id WHERE r.id = ?`,
    ).get(req.params.runId) as { dataset_id: string; dataset_name: string; mode: string | null } | undefined
    if (!run) return reply.code(404).send({ error: 'Not a dataset test run' })

    // Export is the one path that needs the answer body, so it queries text here
    // (loadResults deliberately omits it).
    const results = db().prepare(
      'SELECT model, prompt_index, text, score, total_time, input_tokens, output_tokens FROM results WHERE run_id = ? ORDER BY prompt_index, model'
    ).all(req.params.runId) as {
      model: string; prompt_index: number; text: string; score: number | null
      total_time: number | null; input_tokens: number | null; output_tokens: number | null
    }[]
    const verdicts = new Map(loadVerdicts(req.params.runId).map(v => [v.promptIndex, v]))
    const items = db().prepare('SELECT idx, attachment_id, ground_truth FROM dataset_items WHERE dataset_id = ? ORDER BY idx')
      .all(run.dataset_id) as ItemRow[]
    const fileNames = itemFileNames(items)

    const rows = results.map(r => {
      const v = verdicts.get(r.prompt_index)
      return {
        dataset: run.dataset_name,
        item: r.prompt_index + 1,
        file: fileNames[r.prompt_index] ?? '',
        model: r.model,
        score: r.score == null ? '' : r.score,
        best: v?.bestModel === r.model ? 1 : '',
        worst: v?.worstModel === r.model ? 1 : '',
        input_tokens: r.input_tokens ?? '',
        output_tokens: r.output_tokens ?? '',
        time_ms: r.total_time ?? '',
        answer: r.text,
      }
    })

    const format = req.query.format === 'json' ? 'json' : 'csv'
    const base = `test-${req.params.runId.slice(0, 8)}`
    if (format === 'json') {
      reply.header('Content-Type', 'application/json')
      reply.header('Content-Disposition', `attachment; filename="${base}.json"`)
      return reply.send(JSON.stringify(rows, null, 2))
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${base}.csv"`)
    return reply.send(toCsv(rows))
  })
}

// prompt_index → attachment file name (or empty). Built from the item snapshot,
// whose array position is the prompt_index a dataset run dispatched with.
function itemFileNames(items: ItemRow[]): (string | undefined)[] {
  const ids = items.map(i => i.attachment_id).filter((x): x is string => !!x)
  const names = new Map<string, string>()
  if (ids.length) {
    const rows = getDb().prepare(
      `SELECT id, name FROM attachments WHERE id IN (${ids.map(() => '?').join(',')})`,
    ).all(...ids) as { id: string; name: string }[]
    for (const r of rows) names.set(r.id, r.name)
  }
  return items.map(i => (i.attachment_id ? names.get(i.attachment_id) : undefined))
}
