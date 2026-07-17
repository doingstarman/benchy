import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/index.js'
import { deleteAttachmentsForRun, cloneAttachmentsForRun } from './uploads.js'
import type { Run, Result, Metrics, RunSettings, RunKind, ToolActivity } from '../types.js'

interface RunRow {
  id: string
  prompts: string
  models: string
  status: string
  saved: number
  total_calls: number
  completed_calls: number
  created_at: number
  settings_overrides: string | null
  run_settings: string | null
  title: string | null
  kind: RunKind
  tools: string | null
}

interface ResultRow {
  id: string
  run_id: string
  prompt_index: number
  model: string
  provider_id: string
  text: string
  ttfs: number | null
  total_time: number | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  reasoning: string | null
  reasoning_ms: number | null
  tool_calls: string | null
  feedback: string | null
  error: string | null
  created_at: number
}

// Backslash-escape LIKE's own metacharacters so the query means what it says.
// Paired with ESCAPE '\' on the LIKE.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, m => `\\${m}`)
}

function rowToRun(row: RunRow): Run {
  const runSettings = row.run_settings
    ? JSON.parse(row.run_settings) as RunSettings
    : undefined
  return {
    id: row.id,
    prompts: JSON.parse(row.prompts) as string[],
    models: JSON.parse(row.models) as string[],
    status: row.status as Run['status'],
    saved: row.saved === 1,
    totalCalls: row.total_calls,
    completedCalls: row.completed_calls,
    createdAt: row.created_at,
    // Older rows predate the column; the migration defaults them to 'chat'.
    kind: row.kind ?? 'chat',
    ...(runSettings ? { runSettings } : {}),
    ...(row.title != null ? { title: row.title } : {}),
    ...(row.tools ? { tools: parseTools(row.tools) } : {}),
  }
}

function parseTools(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function parseToolCalls(raw: string | null): ToolActivity[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed as ToolActivity[] : []
  } catch {
    return []
  }
}

function rowToResult(row: ResultRow): Result {
  const metrics: Metrics = {
    ttfs: row.ttfs,
    totalTime: row.total_time,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    reasoningMs: row.reasoning_ms,
  }
  return {
    id: row.id,
    runId: row.run_id,
    promptIndex: row.prompt_index,
    model: row.model,
    providerId: row.provider_id,
    text: row.text,
    reasoning: row.reasoning,
    toolCalls: parseToolCalls(row.tool_calls),
    metrics,
    feedback: row.feedback as Result['feedback'],
    error: row.error,
    createdAt: row.created_at,
  }
}

export async function registerRunsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { status?: string; model?: string; date?: string; search?: string; page?: string }
  }>('/api/runs', async req => {
    const db = getDb()
    const { status, model, date, search, page = '1' } = req.query
    const limit = 50
    // A non-numeric page used to reach SQLite as NaN and 500 with "datatype
    // mismatch"; a zero/negative one silently meant page 1 anyway.
    const parsedPage = parseInt(page, 10)
    const offset = (Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1) - 1) * limit

    let query = 'SELECT * FROM runs WHERE 1=1'
    const params: (string | number)[] = []

    if (status === 'saved') { query += ' AND saved = 1'; }
    else if (status === 'unsaved') { query += ' AND saved = 0'; }

    // models is a JSON array, so a LIKE substring matched a filter for
    // "…:gpt-4o" against a run that only ever used "…:gpt-4o-mini". Compare
    // each element instead.
    if (model) {
      query += ' AND EXISTS (SELECT 1 FROM json_each(runs.models) WHERE json_each.value = ?)'
      params.push(model)
    }

    if (date === 'today') {
      const start = new Date(); start.setHours(0, 0, 0, 0)
      query += ' AND created_at >= ?'; params.push(start.getTime())
    } else if (date === 'week') {
      query += ' AND created_at >= ?'; params.push(Date.now() - 7 * 24 * 60 * 60 * 1000)
    }

    // The search box is a search box, not a pattern language: % and _ are what
    // the user typed, not wildcards that quietly match everything.
    if (search) {
      query += " AND prompts LIKE ? ESCAPE '\\'"
      params.push(`%${escapeLike(search)}%`)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(query).all(...params) as RunRow[]
    return { data: rows.map(rowToRun) }
  })

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const db = getDb()
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as RunRow | undefined
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    const results = db.prepare('SELECT * FROM results WHERE run_id = ? ORDER BY prompt_index, model')
      .all(req.params.id) as ResultRow[]

    const attachmentRows = db.prepare(
      'SELECT id, prompt_index, mime_type, name, size FROM attachments WHERE run_id = ? ORDER BY created_at'
    ).all(req.params.id) as { id: string; prompt_index: number; mime_type: string; name: string; size: number }[]
    const attachments = attachmentRows.map(a => ({
      id: a.id, promptIndex: a.prompt_index, mimeType: a.mime_type, name: a.name, size: a.size,
    }))

    return { data: { ...rowToRun(run), results: results.map(rowToResult), attachments } }
  })

  app.delete<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const db = getDb()
    // results cascade via FK; attachments have no FK (they exist before the
    // run when unbound) so their files + rows are removed explicitly.
    await deleteAttachmentsForRun(req.params.id)
    db.prepare('DELETE FROM runs WHERE id = ?').run(req.params.id)
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>('/api/runs/:id/fork', async (req, reply) => {
    const db = getDb()
    const original = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as RunRow | undefined
    if (!original) return reply.code(404).send({ error: 'Run not found' })

    const newId = randomUUID()
    db.prepare(
      'INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(newId, original.prompts, original.models, 'pending', 0, 0, 0, Date.now(), original.kind ?? 'chat')
    // Note: fork intentionally omits settings_overrides — forked runs use provider defaults
    // Attachments are copied (own files + rows) so the fork re-runs with the
    // same media instead of silently dropping it.
    await cloneAttachmentsForRun(req.params.id, newId)

    const newRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(newId) as RunRow
    return reply.code(201).send({ data: rowToRun(newRun) })
  })

  app.patch<{ Params: { id: string }; Body: { saved?: boolean; title?: string | null; models?: string[] } }>('/api/runs/:id', async (req, reply) => {
    const db = getDb()
    const { saved, title, models } = req.body

    // Dropping a model from the comparison. Only ever a narrowing: `models` is
    // also the historical record of what this run asked, so adding to it would
    // invent results that never happened.
    if (models !== undefined) {
      const current = db.prepare('SELECT models, kind FROM runs WHERE id = ?').get(req.params.id) as
        { models: string; kind: string | null } | undefined
      if (!current) return reply.code(404).send({ error: 'Run not found' })

      // In a pairs run `models` is aligned index-for-index with `prompts` — it
      // is not a set, and removing an entry silently re-pairs every prompt after
      // it with the wrong model.
      if ((current.kind ?? 'chat') === 'pairs') {
        return reply.code(400).send({ error: 'Cannot change the model set of a pairs run — its models are paired to its prompts' })
      }

      const existing = new Set(JSON.parse(current.models) as string[])
      if (!Array.isArray(models) || models.length === 0) {
        return reply.code(400).send({ error: 'models must be a non-empty array' })
      }
      const unknown = models.filter(m => !existing.has(m))
      if (unknown.length > 0) {
        return reply.code(400).send({ error: `Cannot add models to an existing run: ${unknown.join(', ')}` })
      }
      db.prepare('UPDATE runs SET models = ? WHERE id = ?').run(JSON.stringify(models), req.params.id)
    }

    if (saved !== undefined) {
      db.prepare('UPDATE runs SET saved = ? WHERE id = ?').run(saved ? 1 : 0, req.params.id)
    }
    if (title !== undefined) {
      const trimmed = typeof title === 'string' ? title.trim() : null
      db.prepare('UPDATE runs SET title = ? WHERE id = ?').run(trimmed || null, req.params.id)
    }
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as RunRow | undefined
    if (!run) return reply.code(404).send({ error: 'Run not found' })
    return { data: rowToRun(run) }
  })

  app.patch<{ Params: { id: string; resultId: string }; Body: { feedback: 'up' | 'down' | null } }>(
    '/api/runs/:id/results/:resultId/feedback',
    async (req, reply) => {
      const db = getDb()
      db.prepare('UPDATE results SET feedback = ? WHERE id = ? AND run_id = ?')
        .run(req.body.feedback, req.params.resultId, req.params.id)
      return reply.code(204).send()
    }
  )
}
