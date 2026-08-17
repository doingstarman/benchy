import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { getDb } from '../db/index.js'
import { getProviders, DEFAULT_PROVIDER_SETTINGS, getCodeExecutionEnabled, getAppRunDefaults, getCodeExecTimeoutMs } from '../config.js'
import { runCell, finalizeRun, getAdapter } from './benchmark.js'
import { runTests, interpreterCommand, type CodeLanguage } from '../codeRun.js'
import { isLocalRequest } from './csrf.js'
import {
  getAttachmentRow, bindAttachmentToDataset, cloneAttachmentOnto,
  deleteAttachment, deleteAttachmentsForDataset, uploadPath,
} from './uploads.js'
import { scoreResult, parseModelOutput } from '../scoring.js'
import { computeStandings } from '../arena.js'
import { parseCsv } from '../csv.js'
import type { Message } from '../adapters/base.js'
import type { AttachmentMeta, ArenaVerdict, Dataset, DatasetItem, DatasetVar, DatasetVarType } from '../types.js'

interface DatasetRow {
  id: string
  name: string
  note: string | null
  type: string
  language: string | null
  schema: string
  trusted_model: string | null
  created_at: number
  updated_at: number
}

interface ItemRow {
  id: string
  dataset_id: string
  idx: number
  attachment_id: string | null
  input: string | null
  tests: string | null
  ground_truth: string
  ai_suggested: string
  created_at: number
}

const VAR_TYPES: DatasetVarType[] = ['text', 'date', 'number']
const KEY_RE = /^[a-z0-9_]+$/

function parseSchema(raw: string): DatasetVar[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(v => {
      if (!v || typeof v !== 'object') return []
      const o = v as Record<string, unknown>
      if (typeof o.key !== 'string' || !VAR_TYPES.includes(o.type as DatasetVarType)) return []
      return [{ key: o.key, type: o.type as DatasetVarType, ...(typeof o.desc === 'string' ? { desc: o.desc } : {}) }]
    })
  } catch {
    return []
  }
}

// Validate a schema from the request boundary. Keys are the JSON keys the model
// must return, so they carry the same shape as tool/function argument names.
function validateSchema(input: unknown): DatasetVar[] {
  if (!Array.isArray(input)) throw badRequest('schema must be an array')
  const seen = new Set<string>()
  return input.map(v => {
    if (!v || typeof v !== 'object') throw badRequest('each schema variable must be an object')
    const o = v as Record<string, unknown>
    if (typeof o.key !== 'string' || !KEY_RE.test(o.key)) {
      throw badRequest(`variable key "${String(o.key)}" must match ^[a-z0-9_]+$`)
    }
    if (seen.has(o.key)) throw badRequest(`duplicate variable key "${o.key}"`)
    seen.add(o.key)
    if (!VAR_TYPES.includes(o.type as DatasetVarType)) {
      throw badRequest(`variable "${o.key}" has invalid type — use one of ${VAR_TYPES.join(', ')}`)
    }
    return { key: o.key, type: o.type as DatasetVarType, ...(typeof o.desc === 'string' && o.desc.trim() ? { desc: o.desc.trim() } : {}) }
  })
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 })
}

// An attachment is 1:1 with a dataset item. Reject binding one that another item
// already owns — otherwise deleting that item unlinks a file this item still
// points at (a shared attachment_id yanks the file out from under its sibling).
function attachmentTaken(datasetId: string, attachmentId: string, exceptItemId?: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM dataset_items WHERE dataset_id = ? AND attachment_id = ? AND id != ?'
  ).get(datasetId, attachmentId, exceptItemId ?? '')
  return row !== undefined
}

function toGroundTruth(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v != null) out[k] = String(v)
  }
  return out
}

function attachmentMeta(id: string): AttachmentMeta | null {
  const row = getAttachmentRow(id)
  return row ? { id: row.id, name: row.name, mimeType: row.mime_type, size: row.size } : null
}

function rowToItem(row: ItemRow): DatasetItem {
  return {
    id: row.id,
    idx: row.idx,
    attachmentId: row.attachment_id,
    attachment: row.attachment_id ? attachmentMeta(row.attachment_id) : null,
    input: row.input,
    tests: row.tests,
    groundTruth: (() => { try { return toGroundTruth(JSON.parse(row.ground_truth)) } catch { return {} } })(),
    aiSuggested: (() => { try { return toGroundTruth(JSON.parse(row.ai_suggested)) } catch { return {} } })(),
    createdAt: row.created_at,
  }
}

function loadItems(datasetId: string): DatasetItem[] {
  const rows = getDb().prepare('SELECT * FROM dataset_items WHERE dataset_id = ? ORDER BY idx, created_at')
    .all(datasetId) as ItemRow[]
  return rows.map(rowToItem)
}

// A dataset item is "labeled" when every schema variable has a non-empty ground
// truth — that's the 46/50 the list shows. A code item has no schema; it is
// labeled once it carries a test suite (the ground truth for code).
function isLabeled(item: DatasetItem, schema: DatasetVar[], type: string): boolean {
  if (type === 'code') return (item.tests ?? '').trim() !== ''
  return schema.length > 0 && schema.every(v => {
    const t = item.groundTruth[v.key]
    return t != null && String(t).trim() !== ''
  })
}

function rowToDataset(row: DatasetRow, opts: { items?: DatasetItem[]; withItems?: boolean } = {}): Dataset {
  const schema = parseSchema(row.schema)
  const items = opts.items ?? loadItems(row.id)
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    type: row.type === 'text' ? 'text' : row.type === 'tools' ? 'tools' : row.type === 'code' ? 'code' : 'files',
    language: row.language === 'javascript' ? 'javascript' : row.language === 'python' ? 'python' : null,
    schema,
    trustedModel: row.trusted_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount: items.length,
    labeledCount: items.filter(i => isLabeled(i, schema, row.type)).length,
    ...(opts.withItems ? { items } : {}),
  }
}

function getDatasetRow(id: string): DatasetRow | undefined {
  return getDb().prepare('SELECT * FROM datasets WHERE id = ?').get(id) as DatasetRow | undefined
}

// The prompt sent for every item. For file datasets the item IS the file, so the
// prompt is constant; we append the schema keys so the model returns a JSON
// object the scorer can read.
function buildRunPrompt(prompt: string, schema: DatasetVar[]): string {
  const keys = schema.map(v => v.key)
  if (!keys.length) return prompt.trim()
  return `${prompt.trim()}\n\nReturn a JSON object with exactly these keys: ${keys.join(', ')}. Use null when a value is absent.`
}

// Score every result of a finished dataset run against the item snapshot taken
// when the run started (prompt_index === item position). Writes score columns so
// the results endpoint carries them.
function scoreDatasetRun(runId: string, schema: DatasetVar[], items: (DatasetItem | undefined)[]): void {
  const db = getDb()
  const results = db.prepare('SELECT id, prompt_index, text FROM results WHERE run_id = ?')
    .all(runId) as { id: string; prompt_index: number; text: string }[]
  const upd = db.prepare('UPDATE results SET score = ?, score_detail = ? WHERE id = ?')
  for (const r of results) {
    const item = items[r.prompt_index]
    if (!item) continue
    const { score, detail } = scoreResult(schema, item.groundTruth, r.text)
    upd.run(score, JSON.stringify(detail), r.id)
  }
}

// Score a code run by executing each answer against its item's tests. score is
// the fraction of tests that pass (null when the item declares none); score_detail
// maps each test name to match/miss so it reads like the per-field detail. Runs
// one subprocess at a time — code execution is deliberately never fanned out.
async function scoreCodeRun(runId: string, language: CodeLanguage, items: DatasetItem[]): Promise<void> {
  const db = getDb()
  // Read once: the whole run shares one budget, and re-reading config per item
  // would let a mid-run Settings change apply to half the dataset.
  const timeoutMs = await getCodeExecTimeoutMs()
  const results = db.prepare('SELECT id, prompt_index, text FROM results WHERE run_id = ?')
    .all(runId) as { id: string; prompt_index: number; text: string }[]
  const upd = db.prepare('UPDATE results SET score = ?, score_detail = ?, code_report = ? WHERE id = ?')
  for (const r of results) {
    const item = items[r.prompt_index]
    if (!item || !item.tests || !item.tests.trim()) continue
    const res = await runTests(language, r.text, item.tests, { timeoutMs })
    const score = res.total > 0 ? res.passed / res.total : null
    const detail: Record<string, 'match' | 'miss'> = {}
    for (const c of res.cases) detail[c.name] = c.ok ? 'match' : 'miss'
    // The full per-test report — case errors and the execution error (compile /
    // timeout) — so the UI can show why a test failed and tell "didn't run" from
    // "test failed", which the match/miss map alone can't.
    const report = JSON.stringify({ cases: res.cases, error: res.error })
    upd.run(score, JSON.stringify(detail), report, r.id)
  }
}

// Pick the items an actual run covers. `first` takes the head, `random` a
// shuffled sample kept in original order (so prompt_index reads stably). Anything
// malformed, non-positive, or >= the full size runs everything — the safe default.
function selectRunItems(all: DatasetItem[], raw: unknown): DatasetItem[] {
  if (!raw || typeof raw !== 'object') return all
  const s = raw as { strategy?: unknown; n?: unknown }
  const n = typeof s.n === 'number' && Number.isInteger(s.n) ? s.n : NaN
  if (!Number.isFinite(n) || n <= 0 || n >= all.length) return all
  if (s.strategy === 'first') return all.slice(0, n)
  if (s.strategy === 'random') {
    const idx = all.map((_, i) => i)
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    return idx.slice(0, n).sort((a, b) => a - b).map(i => all[i])
  }
  return all
}

export async function registerDatasetsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/datasets', async () => {
    const rows = getDb().prepare('SELECT * FROM datasets ORDER BY updated_at DESC').all() as DatasetRow[]
    return { data: rows.map(row => rowToDataset(row)) }
  })

  app.get<{ Params: { id: string } }>('/api/datasets/:id', async (req, reply) => {
    const row = getDatasetRow(req.params.id)
    if (!row) return reply.code(404).send({ error: 'Dataset not found' })
    return { data: rowToDataset(row, { withItems: true }) }
  })

  app.post<{ Body: { name?: string; note?: string; schema?: unknown; type?: string; language?: string } }>('/api/datasets', async (req, reply) => {
    const name = req.body.name?.trim()
    if (!name) return reply.code(400).send({ error: 'name is required' })
    const schema = req.body.schema === undefined ? [] : validateSchema(req.body.schema)
    const type = req.body.type === 'text' ? 'text' : req.body.type === 'tools' ? 'tools' : req.body.type === 'code' ? 'code' : 'files'
    // Language only means anything for code datasets; default to Python there.
    const language = type === 'code' ? (req.body.language === 'javascript' ? 'javascript' : 'python') : null

    const id = randomUUID()
    const now = Date.now()
    getDb().prepare(
      'INSERT INTO datasets (id, name, note, type, language, schema, trusted_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name, req.body.note?.trim() || null, type, language, JSON.stringify(schema), null, now, now)

    return reply.code(201).send({ data: rowToDataset(getDatasetRow(id)!, { withItems: true }) })
  })

  app.patch<{ Params: { id: string }; Body: { name?: string; note?: string | null; schema?: unknown; trustedModel?: string | null } }>(
    '/api/datasets/:id',
    async (req, reply) => {
      const db = getDb()
      const row = getDatasetRow(req.params.id)
      if (!row) return reply.code(404).send({ error: 'Dataset not found' })

      const { name, note, schema, trustedModel } = req.body
      if (name !== undefined) {
        const trimmed = name.trim()
        if (!trimmed) return reply.code(400).send({ error: 'name cannot be empty' })
        db.prepare('UPDATE datasets SET name = ? WHERE id = ?').run(trimmed, req.params.id)
      }
      if (note !== undefined) {
        db.prepare('UPDATE datasets SET note = ? WHERE id = ?').run(typeof note === 'string' && note.trim() ? note.trim() : null, req.params.id)
      }
      if (schema !== undefined) {
        db.prepare('UPDATE datasets SET schema = ? WHERE id = ?').run(JSON.stringify(validateSchema(schema)), req.params.id)
      }
      if (trustedModel !== undefined) {
        const tm = typeof trustedModel === 'string' && trustedModel.trim() ? trustedModel.trim() : null
        db.prepare('UPDATE datasets SET trusted_model = ? WHERE id = ?').run(tm, req.params.id)
      }
      db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id)
      return { data: rowToDataset(getDatasetRow(req.params.id)!, { withItems: true }) }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/datasets/:id', async (req, reply) => {
    const db = getDb()
    // Item rows cascade via FK; their files/attachment rows have no FK, so remove
    // them explicitly before the dataset row is gone.
    await deleteAttachmentsForDataset(req.params.id)
    db.prepare('DELETE FROM datasets WHERE id = ?').run(req.params.id)
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string }; Body: { attachmentId?: string; groundTruth?: unknown; input?: string; tests?: string } }>(
    '/api/datasets/:id/items',
    async (req, reply) => {
      const db = getDb()
      const dataset = getDatasetRow(req.params.id)
      if (!dataset) return reply.code(404).send({ error: 'Dataset not found' })

      const input = typeof req.body.input === 'string' ? req.body.input : null
      const tests = typeof req.body.tests === 'string' ? req.body.tests : null
      const { attachmentId } = req.body
      // Keep item shape consistent with the dataset type: text items take input,
      // file items take a file — never both (the run would feed the model both).
      if (dataset.type !== 'files' && attachmentId != null) return reply.code(400).send({ error: 'an input-based dataset item takes input, not a file' })
      if (dataset.type === 'files' && input) return reply.code(400).send({ error: 'a files dataset item takes a file, not input' })
      // Tests are the code dataset's ground truth; no other type has a place for them.
      if (dataset.type !== 'code' && tests != null) return reply.code(400).send({ error: 'only a code dataset item takes tests' })
      if (attachmentId !== undefined) {
        const att = getAttachmentRow(attachmentId)
        if (!att) return reply.code(400).send({ error: 'attachmentId does not exist' })
        if (att.run_id) return reply.code(400).send({ error: 'attachment is already bound to a run' })
        if (att.dataset_id && att.dataset_id !== req.params.id) {
          return reply.code(400).send({ error: 'attachment already belongs to another dataset' })
        }
        if (attachmentTaken(req.params.id, attachmentId)) {
          return reply.code(400).send({ error: 'attachment is already used by another item' })
        }
        bindAttachmentToDataset(attachmentId, req.params.id)
      }

      const nextIdx = (db.prepare('SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM dataset_items WHERE dataset_id = ?')
        .get(req.params.id) as { n: number }).n
      const id = randomUUID()
      db.prepare(
        'INSERT INTO dataset_items (id, dataset_id, idx, attachment_id, input, tests, ground_truth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, req.params.id, nextIdx, attachmentId ?? null, input, tests, JSON.stringify(toGroundTruth(req.body.groundTruth)), Date.now())
      db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id)

      const itemRow = db.prepare('SELECT * FROM dataset_items WHERE id = ?').get(id) as ItemRow
      return reply.code(201).send({ data: rowToItem(itemRow) })
    },
  )

  app.patch<{ Params: { id: string; itemId: string }; Body: { attachmentId?: string; groundTruth?: unknown; aiSuggested?: unknown; input?: string; tests?: string } }>(
    '/api/datasets/:id/items/:itemId',
    async (req, reply) => {
      const db = getDb()
      const item = db.prepare('SELECT * FROM dataset_items WHERE id = ? AND dataset_id = ?')
        .get(req.params.itemId, req.params.id) as ItemRow | undefined
      if (!item) return reply.code(404).send({ error: 'Dataset item not found' })

      const dsRow = getDatasetRow(req.params.id)
      if (dsRow && dsRow.type !== 'files' && req.body.attachmentId != null) return reply.code(400).send({ error: 'an input-based dataset item takes input, not a file' })
      if (dsRow?.type === 'files' && typeof req.body.input === 'string' && req.body.input) return reply.code(400).send({ error: 'a files dataset item takes a file, not input' })
      if (dsRow && dsRow.type !== 'code' && typeof req.body.tests === 'string' && req.body.tests) return reply.code(400).send({ error: 'only a code dataset item takes tests' })

      if (req.body.attachmentId !== undefined) {
        const next = req.body.attachmentId
        const att = getAttachmentRow(next)
        if (!att) return reply.code(400).send({ error: 'attachmentId does not exist' })
        if (att.run_id) return reply.code(400).send({ error: 'attachment is already bound to a run' })
        // Same guards as POST /items — a PATCH must not adopt another dataset's
        // file (deleting that dataset would then destroy this item's file) nor a
        // sibling item's file.
        if (att.dataset_id && att.dataset_id !== req.params.id) {
          return reply.code(400).send({ error: 'attachment already belongs to another dataset' })
        }
        if (attachmentTaken(req.params.id, next, req.params.itemId)) {
          return reply.code(400).send({ error: 'attachment is already used by another item' })
        }
        bindAttachmentToDataset(next, req.params.id)
        if (item.attachment_id && item.attachment_id !== next) await deleteAttachment(item.attachment_id)
        db.prepare('UPDATE dataset_items SET attachment_id = ? WHERE id = ?').run(next, req.params.itemId)
      }
      if (req.body.groundTruth !== undefined) {
        db.prepare('UPDATE dataset_items SET ground_truth = ? WHERE id = ?')
          .run(JSON.stringify(toGroundTruth(req.body.groundTruth)), req.params.itemId)
      }
      // Accept/reject an AI suggestion is just a rewrite of ai_suggested (the
      // frontend moves a confirmed value into groundTruth in the same PATCH).
      if (req.body.aiSuggested !== undefined) {
        db.prepare('UPDATE dataset_items SET ai_suggested = ? WHERE id = ?')
          .run(JSON.stringify(toGroundTruth(req.body.aiSuggested)), req.params.itemId)
      }
      if (req.body.input !== undefined) {
        db.prepare('UPDATE dataset_items SET input = ? WHERE id = ?')
          .run(typeof req.body.input === 'string' ? req.body.input : null, req.params.itemId)
      }
      if (req.body.tests !== undefined) {
        db.prepare('UPDATE dataset_items SET tests = ? WHERE id = ?')
          .run(typeof req.body.tests === 'string' ? req.body.tests : null, req.params.itemId)
      }
      db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id)

      const updated = db.prepare('SELECT * FROM dataset_items WHERE id = ?').get(req.params.itemId) as ItemRow
      return { data: rowToItem(updated) }
    },
  )

  // Bulk-import text items from a CSV: header maps an `input` column (or the first
  // column) to the item's input, and columns matching schema keys to ground truth.
  app.post<{ Params: { id: string }; Body: { csv?: string } }>('/api/datasets/:id/import-csv', async (req, reply) => {
    const db = getDb()
    const row = getDatasetRow(req.params.id)
    if (!row) return reply.code(404).send({ error: 'Dataset not found' })
    const dataset = rowToDataset(row)
    if (dataset.type === 'files' || dataset.type === 'code') return reply.code(400).send({ error: 'CSV import is only for text/tools datasets' })

    const rows = parseCsv(typeof req.body.csv === 'string' ? req.body.csv : '')
    if (rows.length < 2) return reply.code(400).send({ error: 'CSV needs a header row and at least one data row' })

    const header = rows[0].map(h => h.trim())
    const inputCol = header.findIndex(h => h.toLowerCase() === 'input')
    const effInputCol = inputCol >= 0 ? inputCol : 0
    // The input column is NEVER also mapped to ground truth — otherwise a label
    // column reused as the fallback input would leak its answer into the prompt.
    const keyCols = dataset.schema.map(v => ({ key: v.key, idx: header.indexOf(v.key) }))
      .filter(kc => kc.idx >= 0 && kc.idx !== effInputCol)
    const insert = db.prepare('INSERT INTO dataset_items (id, dataset_id, idx, attachment_id, input, ground_truth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    let nextIdx = (db.prepare('SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM dataset_items WHERE dataset_id = ?').get(req.params.id) as { n: number }).n

    // One transaction: a mid-import failure rolls back rather than leaving a partial set.
    const importAll = db.transaction(() => {
      let n = 0
      for (const r of rows.slice(1)) {
        const gt: Record<string, string> = {}
        for (const { key, idx } of keyCols) if ((r[idx] ?? '').trim() !== '') gt[key] = r[idx]
        insert.run(randomUUID(), req.params.id, nextIdx++, null, r[effInputCol] ?? '', JSON.stringify(gt), Date.now())
        n++
      }
      return n
    })
    const imported = importAll()
    db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id)
    return { data: { imported } }
  })

  app.delete<{ Params: { id: string; itemId: string } }>('/api/datasets/:id/items/:itemId', async (req, reply) => {
    const db = getDb()
    const item = db.prepare('SELECT * FROM dataset_items WHERE id = ? AND dataset_id = ?')
      .get(req.params.itemId, req.params.id) as ItemRow | undefined
    if (!item) return reply.code(404).send({ error: 'Dataset item not found' })
    if (item.attachment_id) await deleteAttachment(item.attachment_id)
    db.prepare('DELETE FROM dataset_items WHERE id = ?').run(req.params.itemId)
    db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id)
    return reply.code(204).send()
  })

  // Fill ground-truth suggestions with the dataset's trusted model. Each in-scope
  // item's file is sent to the model; its JSON answer becomes ai_suggested,
  // awaiting per-field human confirmation. Never writes ground_truth directly.
  app.post<{ Params: { id: string }; Body: { scope?: string; instruction?: string; itemIds?: string[] } }>(
    '/api/datasets/:id/ai-fill',
    async (req, reply) => {
      const db = getDb()
      const row = getDatasetRow(req.params.id)
      if (!row) return reply.code(404).send({ error: 'Dataset not found' })
      const dataset = rowToDataset(row, { withItems: true })
      if (!dataset.trustedModel) return reply.code(400).send({ error: 'set a trusted model on the dataset first' })
      if (!dataset.schema.length) return reply.code(400).send({ error: 'define the schema first' })

      const [providerId, ...mp] = dataset.trustedModel.split(':')
      const model = mp.join(':')
      const provider = (await getProviders()).find(p => p.id === providerId)
      if (!provider) return reply.code(400).send({ error: 'the trusted model\'s provider is not configured' })
      const adapter = getAdapter(provider.type)

      const scope = req.body.scope === 'all' ? 'all' : 'empty'
      const onlyIds = Array.isArray(req.body.itemIds) ? new Set(req.body.itemIds) : null
      const keys = dataset.schema.map(v => v.key)
      const instruction = typeof req.body.instruction === 'string' && req.body.instruction.trim()
        ? req.body.instruction.trim()
        : 'Extract the schema fields from the file.'
      const promptText = `${instruction}\n\nReturn a JSON object with exactly these keys: ${keys.join(', ')}. Use null when a value is absent.`

      // 'empty' scope skips items whose fields are already all human-confirmed or
      // already suggested — don't re-spend on what's done.
      const targets = (dataset.items ?? []).filter(it => {
        if (onlyIds && !onlyIds.has(it.id)) return false
        if (!it.attachmentId && !it.input) return false
        if (scope === 'all') return true
        return keys.some(k => !(it.groundTruth[k] ?? '').trim() && !(it.aiSuggested[k] ?? '').trim())
      })

      const settings = { ...DEFAULT_PROVIDER_SETTINGS, ...provider.defaults, ...(await getAppRunDefaults()) }
      const parseObj = (raw: string): Record<string, string> => { try { return toGroundTruth(JSON.parse(raw)) } catch { return {} } }

      const fillOne = async (it: DatasetItem): Promise<'filled' | 'skipped' | 'errored'> => {
        // Text item → input in the message; file item → image attachment.
        let convo: Message[]
        if (it.input) {
          convo = [{ role: 'user', content: `${promptText}\n\n${it.input}` }]
        } else {
          const att = it.attachmentId ? getAttachmentRow(it.attachmentId) : null
          if (!att) return 'skipped'
          let attachments
          try {
            const buf = await readFile(uploadPath(att.id, att.mime_type))
            attachments = [{ mimeType: att.mime_type, data: buf.toString('base64'), name: att.name }]
          } catch { return 'errored' }
          convo = [{ role: 'user', content: promptText, attachments }]
        }
        let text = ''
        try {
          for await (const chunk of adapter.stream(convo, { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model, settings })) {
            if (chunk.type === 'token') text += chunk.text
            else if (chunk.type === 'error') throw new Error(chunk.message)
          }
        } catch { return 'errored' }
        const parsed = parseModelOutput(text)
        if (!parsed) return 'errored'
        // Re-read fresh, right before writing: the human may have confirmed a
        // field during a long fill (TOCTOU) — don't clobber that.
        const cur = db.prepare('SELECT ground_truth, ai_suggested FROM dataset_items WHERE id = ?').get(it.id) as
          { ground_truth: string; ai_suggested: string } | undefined
        if (!cur) return 'skipped'
        const gt = parseObj(cur.ground_truth)
        const merged = parseObj(cur.ai_suggested)
        let any = false
        for (const k of keys) {
          if ((gt[k] ?? '').trim()) continue                              // never touch a confirmed value
          if (scope === 'empty' && (merged[k] ?? '').trim()) continue     // don't overwrite an unreviewed suggestion
          const v = parsed[k]
          if (v == null || typeof v === 'object') continue                // skip null / object / array garbage
          const sv = String(v)
          if (sv.trim() !== '') { merged[k] = sv; any = true }
        }
        if (!any) return 'skipped'
        db.prepare('UPDATE dataset_items SET ai_suggested = ? WHERE id = ?').run(JSON.stringify(merged), it.id)
        return 'filled'
      }

      // Bounded concurrency: a large dataset must not open one provider stream +
      // one base64 image per item all at once (memory spike + rate-limit storm).
      const CONCURRENCY = 5
      let filled = 0, skipped = 0, errored = 0
      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        for (const outcome of await Promise.all(targets.slice(i, i + CONCURRENCY).map(fillOne))) {
          if (outcome === 'filled') filled++
          else if (outcome === 'errored') errored++
          else skipped++
        }
      }
      db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id)
      return { data: { filled, skipped, errored } }
    },
  )

  // Recent runs for this dataset, newest first — makes the results view survive a
  // reload (the run id isn't only held in the client).
  app.get<{ Params: { id: string } }>('/api/datasets/:id/runs', async (req, reply) => {
    const db = getDb()
    if (!getDatasetRow(req.params.id)) return reply.code(404).send({ error: 'Dataset not found' })
    const rows = db.prepare(
      `SELECT r.id, r.status, r.models, r.total_calls, r.completed_calls, r.created_at, r.mode,
              (SELECT AVG(score) FROM results WHERE run_id = r.id AND score IS NOT NULL) AS avg_score,
              (SELECT COUNT(*) FROM dataset_run_verdicts WHERE run_id = r.id) AS judged_count
       FROM runs r WHERE r.dataset_id = ? ORDER BY r.created_at DESC LIMIT 20`,
    ).all(req.params.id) as {
      id: string; status: string; models: string; total_calls: number; completed_calls: number; created_at: number
      mode: string | null; avg_score: number | null; judged_count: number
    }[]
    return {
      data: rows.map(r => ({
        id: r.id, status: r.status, models: JSON.parse(r.models) as string[],
        totalCalls: r.total_calls, completedCalls: r.completed_calls, createdAt: r.created_at,
        avgScore: r.avg_score, mode: r.mode ?? 'score', judgedCount: r.judged_count,
      })),
    }
  })

  app.post<{ Params: { id: string }; Body: { models?: string[]; prompt?: string; systemPrompt?: string; mode?: string; sample?: { strategy?: string; n?: number } } }>(
    '/api/datasets/:id/run',
    async (req, reply) => {
      const db = getDb()
      const row = getDatasetRow(req.params.id)
      if (!row) return reply.code(404).send({ error: 'Dataset not found' })

      const dataset = rowToDataset(row, { withItems: true })
      const allItems = dataset.items ?? []
      if (!allItems.length) return reply.code(400).send({ error: 'dataset has no items to run' })
      // Subsample: run only a subset (first N / random N) so a quick pass need not
      // spend the whole dataset. prompt_index then indexes this subset, and scoring
      // reads the same subset — everything below derives from `items`.
      const items = selectRunItems(allItems, req.body.sample)

      const prompt = req.body.prompt?.trim()
      if (!prompt) return reply.code(400).send({ error: 'prompt is required' })

      // A code dataset executes the model's solution locally. That is gated: it
      // needs the opt-in toggle AND an interpreter on PATH, both checked before
      // any model call so a misconfigured run fails fast instead of scoring 0.
      const isCode = dataset.type === 'code'
      const codeLanguage: CodeLanguage = dataset.language === 'javascript' ? 'javascript' : 'python'
      if (isCode) {
        // Running a code dataset executes code locally — never at a cross-site
        // page's request, even if the toggle is somehow on.
        if (!isLocalRequest(req)) return reply.code(403).send({ error: 'cross-site request refused' })
        if (!(await getCodeExecutionEnabled())) {
          return reply.code(400).send({ error: 'code execution is disabled — enable it in Settings before running a code dataset' })
        }
        if (!interpreterCommand(codeLanguage)) {
          return reply.code(400).send({ error: `no ${codeLanguage === 'python' ? 'Python' : 'Node'} interpreter found on PATH to run this code dataset` })
        }
      }

      // Trim + dedupe first: otherwise "p:A " (trailing space) slips past the
      // trusted-model exclusion below and lets the ground-truth author grade its
      // own work. trustedModel is stored trimmed (PATCH trims it).
      const requested = [...new Set(
        (Array.isArray(req.body.models) ? req.body.models : [])
          .filter((m): m is string => typeof m === 'string')
          .map(m => m.trim())
          .filter(m => m !== ''),
      )]
      // The trusted model is excluded — it labeled (or will label) the ground
      // truth, so pitting it against the field would let it grade its own work.
      const models = requested.filter(m => m !== dataset.trustedModel)
      if (!models.length) {
        return reply.code(400).send({
          error: dataset.trustedModel && requested.includes(dataset.trustedModel)
            ? 'no models to compare — the only model selected is the dataset\'s trusted model'
            : 'select at least one model',
        })
      }

      // Arena mode is judged by a human, not against ground truth — so no JSON
      // keys hint on the prompt and no auto-scoring pass. Code is always auto-
      // scored against its tests, so an arena request on a code dataset is score.
      const mode = req.body.mode === 'arena' && !isCode ? 'arena' : 'score'
      const systemPrompt = typeof req.body.systemPrompt === 'string' && req.body.systemPrompt.trim()
        ? req.body.systemPrompt.trim() : undefined

      // Per-item prompt: a text item folds its input into the prompt; a file item
      // shares the same prompt and rides its image at its own prompt_index. Arena
      // and code get the raw task — no JSON-keys hint (the model returns code, not
      // a scored object).
      const itemPrompts = items.map(it => {
        const base = it.input ? `${prompt}\n\n${it.input}` : prompt
        return mode === 'arena' || isCode ? base.trim() : buildRunPrompt(base, dataset.schema)
      })

      const runId = randomUUID()
      const now = Date.now()
      db.prepare(
        'INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at, kind, system_prompt, dataset_id, mode, dataset_item_ids, base_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        runId, JSON.stringify(itemPrompts), JSON.stringify(models),
        'running', 0, items.length * models.length, 0, now, 'batch', systemPrompt ?? null, req.params.id, mode, JSON.stringify(items.map(it => it.id)), prompt,
      )

      // File items ride their image at their own prompt_index (runCell's vision
      // path loads it); text items carry no attachment.
      for (let pi = 0; pi < items.length; pi++) {
        const att = items[pi].attachmentId
        if (att) await cloneAttachmentOnto(att, runId, pi)
      }

      const providers = await getProviders()
      const tasks = items.flatMap((_, pi) =>
        models.map(m => runCell(runId, pi, itemPrompts[pi], m, providers, undefined, [], new Map(), [], systemPrompt)))

      if (mode === 'arena') {
        // No scoring — the human judges post-hoc; just finalize when cells settle.
        finalizeRun(runId, [Promise.allSettled(tasks).then(() => {})])
      } else if (isCode) {
        // Code is scored by running each answer against its item's tests in a
        // subprocess — async, so it awaits inside the finalize barrier just like
        // per-field scoring does, keeping run_done after the scores land.
        const scored = Promise.allSettled(tasks).then(async () => {
          try { await scoreCodeRun(runId, codeLanguage, items) } catch { /* leave rows unscored */ }
        })
        finalizeRun(runId, [scored])
      } else {
        // run_done must not fire until scores are written, or the client refetches
        // results before they carry a score. Fold scoring into the finalize barrier.
        const scored = Promise.allSettled(tasks).then(() => {
          try { scoreDatasetRun(runId, dataset.schema, items) } catch { /* leave rows unscored */ }
        })
        finalizeRun(runId, [scored])
      }

      return reply.code(202).send({ data: { runId } })
    },
  )

  // Re-score a finished field-scored run against the CURRENT ground truth — no
  // model calls. Used after the disagreements review edits a truth value: the fix
  // recomputes accuracy from the answers already on disk. Items are resolved
  // through the run's covered ids (prompt_index order) so subsampling stays right.
  app.post<{ Params: { id: string; runId: string } }>(
    '/api/datasets/:id/runs/:runId/rescore',
    async (req, reply) => {
      const db = getDb()
      const row = getDatasetRow(req.params.id)
      if (!row) return reply.code(404).send({ error: 'Dataset not found' })
      const dataset = rowToDataset(row, { withItems: true })
      if (dataset.type === 'code') return reply.code(400).send({ error: 'rescore applies to field-scored datasets, not code' })

      const runRow = db.prepare('SELECT dataset_id, dataset_item_ids, mode FROM runs WHERE id = ?').get(req.params.runId) as
        { dataset_id: string | null; dataset_item_ids: string | null; mode: string | null } | undefined
      if (!runRow || runRow.dataset_id !== req.params.id) return reply.code(404).send({ error: 'Run not found for this dataset' })
      // An arena run is human-judged, never field-scored — rescoring it would stamp
      // score=0 on every free-text answer and poison its average.
      if (runRow.mode === 'arena') return reply.code(400).send({ error: 'an arena run has no field scores to recompute' })

      const all = dataset.items ?? []
      const byId = new Map(all.map(it => [it.id, it]))
      let itemIds: string[] | null = null
      try { itemIds = runRow.dataset_item_ids ? JSON.parse(runRow.dataset_item_ids) as string[] : null } catch { /* keep null */ }
      // With the id map, a deleted item becomes an undefined slot that keeps
      // prompt_index aligned and scoreDatasetRun skips it. A legacy run (no ids)
      // falls back to positional over CURRENT items — correct unless one was
      // deleted since, which there's no mapping to recover.
      const covered = itemIds ? itemIds.map(id => byId.get(id)) : all

      scoreDatasetRun(req.params.runId, dataset.schema, covered)
      return reply.code(200).send({ data: { rescored: true } })
    },
  )

  // ── Arena judging (mode='arena' runs) ──────────────────────────────────────

  interface VerdictRow { prompt_index: number; best_model: string | null; worst_model: string | null; skipped: number }

  function loadVerdicts(runId: string): ArenaVerdict[] {
    const rows = getDb().prepare(
      'SELECT prompt_index, best_model, worst_model, skipped FROM dataset_run_verdicts WHERE run_id = ? ORDER BY prompt_index'
    ).all(runId) as VerdictRow[]
    return rows.map(r => ({ promptIndex: r.prompt_index, bestModel: r.best_model, worstModel: r.worst_model, skipped: r.skipped === 1 }))
  }

  // The lowest item index (0..itemCount-1) with no verdict yet, or -1 if every
  // item has been judged/skipped — the arena's "where do I resume".
  function nextUnjudged(verdicts: ArenaVerdict[], itemCount: number): number {
    const seen = new Set(verdicts.map(v => v.promptIndex))
    for (let i = 0; i < itemCount; i++) if (!seen.has(i)) return i
    return -1
  }

  // Load an arena run + its dataset's item count, or reply 404. Shared by the
  // GET and the verdict PUT so both agree on what a valid arena run is.
  function loadArenaRun(datasetId: string, runId: string): { models: string[]; itemCount: number } | null {
    const run = getDb().prepare('SELECT models, prompts, dataset_id, mode FROM runs WHERE id = ?').get(runId) as
      { models: string; prompts: string; dataset_id: string | null; mode: string | null } | undefined
    if (!run || run.dataset_id !== datasetId || run.mode !== 'arena') return null
    // The run's item set is FROZEN at creation (one prompt per item that ran).
    // Deriving itemCount from the live dataset_items lets a later add/remove admit
    // verdicts for indices the run never produced (poisoning Elo) or truncate the
    // resume range. Read it from the snapshot instead.
    const itemCount = (JSON.parse(run.prompts) as string[]).length
    return { models: JSON.parse(run.models) as string[], itemCount }
  }

  app.get<{ Params: { id: string; runId: string } }>('/api/datasets/:id/runs/:runId/arena', async (req, reply) => {
    const arena = loadArenaRun(req.params.id, req.params.runId)
    if (!arena) return reply.code(404).send({ error: 'Arena run not found' })
    const verdicts = loadVerdicts(req.params.runId)
    return {
      data: {
        itemCount: arena.itemCount,
        verdicts,
        standings: computeStandings(arena.models, verdicts),
        nextIndex: nextUnjudged(verdicts, arena.itemCount),
      },
    }
  })

  app.put<{ Params: { id: string; runId: string; promptIndex: string }; Body: { bestModel?: string; worstModel?: string; skipped?: boolean } }>(
    '/api/datasets/:id/runs/:runId/verdicts/:promptIndex',
    async (req, reply) => {
      const arena = loadArenaRun(req.params.id, req.params.runId)
      if (!arena) return reply.code(404).send({ error: 'Arena run not found' })

      const promptIndex = Number(req.params.promptIndex)
      if (!Number.isInteger(promptIndex) || promptIndex < 0 || promptIndex >= arena.itemCount) {
        return reply.code(400).send({ error: 'promptIndex out of range' })
      }

      const skipped = req.body.skipped === true
      const best = skipped ? null : (req.body.bestModel ?? null)
      const worst = skipped ? null : (req.body.worstModel ?? null)
      if (!skipped) {
        if (!best) return reply.code(400).send({ error: 'bestModel is required unless the item is skipped' })
        if (!arena.models.includes(best)) return reply.code(400).send({ error: 'bestModel is not one of the run\'s models' })
        if (worst && !arena.models.includes(worst)) return reply.code(400).send({ error: 'worstModel is not one of the run\'s models' })
        if (worst && worst === best) return reply.code(400).send({ error: 'bestModel and worstModel cannot be the same' })
      }

      getDb().prepare(
        `INSERT INTO dataset_run_verdicts (run_id, prompt_index, best_model, worst_model, skipped, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, prompt_index) DO UPDATE SET best_model = excluded.best_model, worst_model = excluded.worst_model, skipped = excluded.skipped`
      ).run(req.params.runId, promptIndex, best, worst, skipped ? 1 : 0, Date.now())

      const verdicts = loadVerdicts(req.params.runId)
      return {
        data: {
          standings: computeStandings(arena.models, verdicts),
          nextIndex: nextUnjudged(verdicts, arena.itemCount),
        },
      }
    },
  )
}
