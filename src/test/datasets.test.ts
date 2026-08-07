import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from '../server.js'
import { closeDb, getDb } from '../db/index.js'
import { gcUnboundUploads, getUploadsDir, uploadPath } from '../api/uploads.js'
import type { FastifyInstance } from 'fastify'

// The model's answer is deterministic and set per test, so scoring is exact.
let mockOutput = '{}'
vi.mock('../adapters/openai.js', () => ({
  openaiAdapter: {
    async *stream() {
      yield { type: 'token', text: mockOutput }
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1 } }
    },
  },
}))

let server: FastifyInstance
let base: string
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-datasets-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14385, join(tempDir, 'test.db'))
  base = 'http://localhost:14385'
})

afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

beforeEach(async () => {
  const { writeConfig } = await import('../config.js')
  await writeConfig({
    providers: [{ id: 'p', name: 'P', type: 'openai', apiKey: 'k', models: ['A', 'B'], enabled: true }],
  })
  const db = getDb()
  db.prepare('DELETE FROM datasets').run()
  db.prepare('DELETE FROM runs').run()
  db.prepare('DELETE FROM attachments').run()
})

interface ApiResult {
  status: number
  body: { data?: unknown; error?: string }
}

async function req(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as ApiResult['body'] }
}

const data = <T>(r: ApiResult): T => r.body.data as T

interface RunDetail {
  status: string
  models: string[]
  results: { model: string; score: number | null; scoreDetail: Record<string, 'match' | 'miss'> | null }[]
}

async function waitForRun(runId: string): Promise<RunDetail> {
  for (let i = 0; i < 200; i++) {
    const r = await req('GET', `/api/runs/${runId}`)
    const d = r.body.data as RunDetail | undefined
    if (d && d.status !== 'running') return d
    await new Promise(res => setTimeout(res, 20))
  }
  throw new Error('run did not finish')
}

describe('datasets CRUD', () => {
  it('creates, lists, edits an item, and cascades on delete', async () => {
    const created = await req('POST', '/api/datasets', {
      name: 'Receipts',
      schema: [{ key: 'total', type: 'number' }, { key: 'merchant', type: 'text' }],
    })
    expect(created.status).toBe(201)
    const id = data<{ id: string }>(created).id

    const list = await req('GET', '/api/datasets')
    expect(data<unknown[]>(list)).toHaveLength(1)
    expect(data<{ schema: unknown[] }[]>(list)[0].schema).toHaveLength(2)

    const item = await req('POST', `/api/datasets/${id}/items`, { groundTruth: { total: '10', merchant: 'X' } })
    expect(item.status).toBe(201)
    const itemId = data<{ id: string }>(item).id

    const patched = await req('PATCH', `/api/datasets/${id}/items/${itemId}`, { groundTruth: { total: '11', merchant: 'Y' } })
    expect(data<{ groundTruth: Record<string, string> }>(patched).groundTruth).toEqual({ total: '11', merchant: 'Y' })

    const detail = await req('GET', `/api/datasets/${id}`)
    expect(data<{ itemCount: number; labeledCount: number }>(detail)).toMatchObject({ itemCount: 1, labeledCount: 1 })

    const del = await req('DELETE', `/api/datasets/${id}`)
    expect(del.status).toBe(204)
    // The item cascaded with the dataset.
    expect((getDb().prepare('SELECT COUNT(*) n FROM dataset_items').get() as { n: number }).n).toBe(0)
    expect(data<unknown[]>(await req('GET', '/api/datasets'))).toHaveLength(0)
  })

  it('rejects an invalid schema variable key at the boundary', async () => {
    const bad = await req('POST', '/api/datasets', { name: 'X', schema: [{ key: 'Has Space', type: 'text' }] })
    expect(bad.status).toBe(400)
  })
})

describe('dataset run + scoring', () => {
  it('scores each result per field against ground truth', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', {
      name: 'R',
      schema: [{ key: 'total', type: 'number' }, { key: 'merchant', type: 'text' }],
    }))
    await req('POST', `/api/datasets/${ds.id}/items`, { groundTruth: { total: '1 105,90', merchant: 'Магнит' } })

    // total matches after number normalization; merchant is a real miss ⇒ 0.5.
    mockOutput = '{"total": 1105.90, "merchant": "Пятёрочка"}'
    const run = await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'read it' })
    expect(run.status).toBe(202)

    const done = await waitForRun(data<{ runId: string }>(run).runId)
    expect(done.results).toHaveLength(1)
    expect(done.results[0].score).toBe(0.5)
    expect(done.results[0].scoreDetail).toEqual({ total: 'match', merchant: 'miss' })
  })

  it('subsamples the run — only n items are covered; an out-of-range n runs all', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'S', type: 'text', schema: [{ key: 'a', type: 'text' }] }))
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push(data<{ id: string }>(await req('POST', `/api/datasets/${ds.id}/items`, { input: `item ${i}`, groundTruth: { a: String(i) } })).id)
    mockOutput = '{"a":"x"}'

    const firstRunId = data<{ runId: string }>(await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'go', sample: { strategy: 'first', n: 2 } })).runId
    const first = await waitForRun(firstRunId)
    expect(first.results).toHaveLength(2)
    // The run records the exact items it covered, in order — so per-item views map right.
    expect(data<{ datasetItemIds: string[] }>(await req('GET', `/api/runs/${firstRunId}`)).datasetItemIds).toEqual(ids.slice(0, 2))

    const rand = await waitForRun(data<{ runId: string }>(await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'go', sample: { strategy: 'random', n: 3 } })).runId)
    expect(rand.results).toHaveLength(3)

    // n >= size (or malformed) falls back to the whole dataset.
    const all = await waitForRun(data<{ runId: string }>(await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'go', sample: { strategy: 'first', n: 99 } })).runId)
    expect(all.results).toHaveLength(4)
  })

  it('rescore re-grades a run against the edited ground truth with no model calls', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', {
      name: 'R2', schema: [{ key: 'total', type: 'number' }],
    }))
    const itemId = data<{ id: string }>(await req('POST', `/api/datasets/${ds.id}/items`, { groundTruth: { total: '99' } })).id

    // The model returns 100; the truth says 99 ⇒ a miss.
    mockOutput = '{"total": 100}'
    const runId = data<{ runId: string }>(await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'read' })).runId
    const done = await waitForRun(runId)
    expect(done.results[0].score).toBe(0)

    // Adopt the model's value as truth, then rescore — the same answer now matches.
    await req('PATCH', `/api/datasets/${ds.id}/items/${itemId}`, { groundTruth: { total: '100' } })
    mockOutput = 'THIS MUST NOT BE USED — rescore never re-calls the model'
    expect((await req('POST', `/api/datasets/${ds.id}/runs/${runId}/rescore`)).status).toBe(200)

    const after = data<{ results: { score: number | null }[] }>(await req('GET', `/api/runs/${runId}`))
    expect(after.results[0].score).toBe(1)
  })
})

describe('trusted model', () => {
  it('is excluded from a comparison run so it never grades itself', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'T', schema: [{ key: 'x', type: 'text' }] }))
    await req('PATCH', `/api/datasets/${ds.id}`, { trustedModel: 'p:A' })
    await req('POST', `/api/datasets/${ds.id}/items`, { groundTruth: { x: 'v' } })

    mockOutput = '{"x": "v"}'
    const run = await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A', 'p:B'], prompt: 'go' })
    const done = await waitForRun(data<{ runId: string }>(run).runId)

    // Only the challenger B ran; the trusted A never appears in the results.
    expect(done.models).toEqual(['p:B'])
    expect(done.results.map(r => r.model)).toEqual(['p:B'])
  })

  it('rejects a run whose only model is the trusted one', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'T2', schema: [{ key: 'x', type: 'text' }] }))
    await req('PATCH', `/api/datasets/${ds.id}`, { trustedModel: 'p:A' })
    await req('POST', `/api/datasets/${ds.id}/items`, { groundTruth: { x: 'v' } })

    const run = await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'go' })
    expect(run.status).toBe(400)
  })

  it('excludes the trusted model even when it arrives padded with whitespace', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'T3', schema: [{ key: 'x', type: 'text' }] }))
    await req('PATCH', `/api/datasets/${ds.id}`, { trustedModel: 'p:A' })
    await req('POST', `/api/datasets/${ds.id}/items`, { groundTruth: { x: 'v' } })

    // Trailing space must not slip 'p:A' past the exclusion into a self-grading run.
    const run = await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A '], prompt: 'go' })
    expect(run.status).toBe(400)
  })
})

describe('attachment ownership', () => {
  // Insert a bare attachment row owned by `datasetId` (no multipart needed).
  function seedAttachment(datasetId: string): string {
    const attId = randomUUID()
    getDb().prepare('INSERT INTO attachments (id, mime_type, name, size, created_at, dataset_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(attId, 'image/png', 'f.png', 1, Date.now(), datasetId)
    return attId
  }

  it('refuses to rebind an attachment that belongs to another dataset', async () => {
    const a = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'A', schema: [] }))
    const b = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'B', schema: [] }))
    const attOfA = seedAttachment(a.id)
    const bItem = data<{ id: string }>(await req('POST', `/api/datasets/${b.id}/items`, {}))

    // Without the PATCH guard this stole A's file into B and a later delete of B
    // would unlink it, breaking A.
    const stolen = await req('PATCH', `/api/datasets/${b.id}/items/${bItem.id}`, { attachmentId: attOfA })
    expect(stolen.status).toBe(400)
  })

  it('refuses to bind an attachment already used by a sibling item', async () => {
    const d = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'D', schema: [] }))
    const att = seedAttachment(d.id)
    const item1 = data<{ id: string }>(await req('POST', `/api/datasets/${d.id}/items`, { attachmentId: att }))
    const item2 = data<{ id: string }>(await req('POST', `/api/datasets/${d.id}/items`, {}))
    expect(item1.id).toBeTruthy()

    const dup = await req('PATCH', `/api/datasets/${d.id}/items/${item2.id}`, { attachmentId: att })
    expect(dup.status).toBe(400)
  })
})

describe('AI-assisted markup', () => {
  // An on-disk attachment bound to an item, so ai-fill's vision read succeeds.
  function seedItemWithFile(datasetId: string): Promise<string> {
    const attId = randomUUID()
    getDb().prepare('INSERT INTO attachments (id, mime_type, name, size, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(attId, 'image/png', 'scan.png', 8, Date.now())
    mkdirSync(getUploadsDir(), { recursive: true })
    writeFileSync(uploadPath(attId, 'image/png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return req('POST', `/api/datasets/${datasetId}/items`, { attachmentId: attId }).then(r => data<{ id: string }>(r).id)
  }

  it('trusted model proposes values into aiSuggested, not groundTruth', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'AI', schema: [{ key: 'x', type: 'text' }] }))
    await req('PATCH', `/api/datasets/${ds.id}`, { trustedModel: 'p:A' })
    const itemId = await seedItemWithFile(ds.id)

    mockOutput = '{"x": "proposed"}'
    const r = await req('POST', `/api/datasets/${ds.id}/ai-fill`, {})
    expect(data<{ filled: number }>(r).filled).toBe(1)

    const detail = data<{ items: { id: string; groundTruth: Record<string, string>; aiSuggested: Record<string, string> }[] }>(await req('GET', `/api/datasets/${ds.id}`))
    const item = detail.items.find(i => i.id === itemId)!
    expect(item.aiSuggested).toEqual({ x: 'proposed' }) // awaiting confirmation
    expect(item.groundTruth.x ?? '').toBe('')            // NOT auto-confirmed
  })

  it('rejects ai-fill when no trusted model is set', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'AI2', schema: [{ key: 'x', type: 'text' }] }))
    await seedItemWithFile(ds.id)
    expect((await req('POST', `/api/datasets/${ds.id}/ai-fill`, {})).status).toBe(400)
  })

  it('confirming a suggestion moves it into groundTruth (PATCH)', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'AI3', schema: [{ key: 'x', type: 'text' }] }))
    const itemId = data<{ id: string }>(await req('POST', `/api/datasets/${ds.id}/items`, { groundTruth: {} })).id
    // Human accepts: value moves to groundTruth, cleared from aiSuggested.
    const upd = data<{ groundTruth: Record<string, string>; aiSuggested: Record<string, string> }>(
      await req('PATCH', `/api/datasets/${ds.id}/items/${itemId}`, { groundTruth: { x: 'confirmed' }, aiSuggested: {} }))
    expect(upd.groundTruth).toEqual({ x: 'confirmed' })
    expect(upd.aiSuggested).toEqual({})
  })

  it('empty scope fills a missing field without overwriting an already-suggested one', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'AI4', schema: [{ key: 'a', type: 'text' }, { key: 'b', type: 'text' }] }))
    await req('PATCH', `/api/datasets/${ds.id}`, { trustedModel: 'p:A' })
    await seedItemWithFile(ds.id)

    mockOutput = '{"a": "first"}' // suggests a only; b stays empty
    expect(data<{ filled: number }>(await req('POST', `/api/datasets/${ds.id}/ai-fill`, {})).filled).toBe(1)
    // Second empty-scope fill: item re-entered for the still-empty b, but a's
    // unreviewed suggestion must NOT be overwritten.
    mockOutput = '{"a": "second", "b": "bee"}'
    expect(data<{ filled: number }>(await req('POST', `/api/datasets/${ds.id}/ai-fill`, {})).filled).toBe(1)
    const item = data<{ items: { aiSuggested: Record<string, string> }[] }>(await req('GET', `/api/datasets/${ds.id}`)).items[0]
    expect(item.aiSuggested).toEqual({ a: 'first', b: 'bee' })
  })

  it('skips a non-primitive model value instead of storing "[object Object]"', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'AI5', schema: [{ key: 'x', type: 'text' }] }))
    await req('PATCH', `/api/datasets/${ds.id}`, { trustedModel: 'p:A' })
    await seedItemWithFile(ds.id)

    mockOutput = '{"x": {"nested": 1}}'
    expect(data<{ filled: number }>(await req('POST', `/api/datasets/${ds.id}/ai-fill`, {})).filled).toBe(0)
    const item = data<{ items: { aiSuggested: Record<string, string> }[] }>(await req('GET', `/api/datasets/${ds.id}`)).items[0]
    expect(item.aiSuggested).toEqual({})
  })
})

describe('text datasets', () => {
  it('creates a text dataset and a text item carrying an input', async () => {
    const ds = data<{ id: string; type: string }>(await req('POST', '/api/datasets', { name: 'T', type: 'text', schema: [{ key: 'x', type: 'text' }] }))
    expect(ds.type).toBe('text')
    const item = data<{ input: string | null }>(await req('POST', `/api/datasets/${ds.id}/items`, { input: '2+2?', groundTruth: { x: '4' } }))
    expect(item.input).toBe('2+2?')
  })

  it('runs and scores a text dataset (input folded into the prompt, no attachment)', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'T2', type: 'text', schema: [{ key: 'x', type: 'text' }] }))
    await req('POST', `/api/datasets/${ds.id}/items`, { input: 'q', groundTruth: { x: 'v' } })
    mockOutput = '{"x":"v"}'
    const done = await waitForRun(data<{ runId: string }>(await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'answer' })).runId)
    expect(done.results).toHaveLength(1)
    expect(done.results[0].score).toBe(1)
  })

  it('imports text items from CSV, mapping input + schema columns', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'CSV', type: 'text', schema: [{ key: 'a', type: 'text' }, { key: 'b', type: 'text' }] }))
    const csv = 'input,a,b\nq1,va,vb\nq2,wa,wb'
    expect(data<{ imported: number }>(await req('POST', `/api/datasets/${ds.id}/import-csv`, { csv })).imported).toBe(2)
    const items = data<{ items: { input: string | null; groundTruth: Record<string, string> }[] }>(await req('GET', `/api/datasets/${ds.id}`)).items
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ input: 'q1', groundTruth: { a: 'va', b: 'vb' } })
    expect(items[1]).toMatchObject({ input: 'q2', groundTruth: { a: 'wa', b: 'wb' } })
  })

  it('rejects CSV import on a files dataset', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'F', type: 'files', schema: [] }))
    expect((await req('POST', `/api/datasets/${ds.id}/import-csv`, { csv: 'input\nq' })).status).toBe(400)
  })

  it('CSV import never reuses the input column as ground truth', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'CSV2', type: 'text', schema: [{ key: 'sentiment', type: 'text' }, { key: 'answer', type: 'text' }] }))
    // No explicit "input" column → column 0 (sentiment) is the input; its value must
    // NOT also become the sentiment ground truth (that would leak the label).
    expect(data<{ imported: number }>(await req('POST', `/api/datasets/${ds.id}/import-csv`, { csv: 'sentiment,answer\nhappy,yes' })).imported).toBe(1)
    const item = data<{ items: { input: string | null; groundTruth: Record<string, string> }[] }>(await req('GET', `/api/datasets/${ds.id}`)).items[0]
    expect(item.input).toBe('happy')
    expect(item.groundTruth).toEqual({ answer: 'yes' })
  })

  it('rejects a cross-type item (file on a text dataset, input on a files dataset)', async () => {
    const text = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'TX', type: 'text', schema: [] }))
    expect((await req('POST', `/api/datasets/${text.id}/items`, { attachmentId: 'anything' })).status).toBe(400)
    const files = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'FL', type: 'files', schema: [] }))
    expect((await req('POST', `/api/datasets/${files.id}/items`, { input: 'hi' })).status).toBe(400)
  })

  it('tools datasets are input-based: create, no-files guard, CSV import, run scores', async () => {
    const ds = data<{ id: string; type: string }>(await req('POST', '/api/datasets', { name: 'TL', type: 'tools', schema: [{ key: 'tool_name', type: 'text' }, { key: 'arg', type: 'text' }] }))
    expect(ds.type).toBe('tools')
    // input-based → rejects a file, allows CSV import
    expect((await req('POST', `/api/datasets/${ds.id}/items`, { attachmentId: 'x' })).status).toBe(400)
    expect(data<{ imported: number }>(await req('POST', `/api/datasets/${ds.id}/import-csv`, { csv: 'input,tool_name,arg\nrefund it,refund_order,last' })).imported).toBe(1)

    mockOutput = '{"tool_name":"refund_order","arg":"last"}'
    const done = await waitForRun(data<{ runId: string }>(await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'pick a tool' })).runId)
    expect(done.results[0].score).toBe(1)
  })

  it('code datasets run the model solution against tests — score is the fraction passed', async () => {
    await req('PUT', '/api/settings', { codeExecution: true })
    const ds = data<{ id: string; type: string; language: string | null }>(await req('POST', '/api/datasets', { name: 'C', type: 'code', language: 'javascript' }))
    expect(ds.type).toBe('code')
    expect(ds.language).toBe('javascript')
    // input-based → rejects a file; tests carry the ground truth
    expect((await req('POST', `/api/datasets/${ds.id}/items`, { attachmentId: 'x' })).status).toBe(400)
    const item = data<{ tests: string | null }>(await req('POST', `/api/datasets/${ds.id}/items`, {
      input: 'Write add(a, b) returning the sum.',
      tests: "test('a', () => assert(add(1, 2) === 3)); test('b', () => assert(add(5, 5) === 10))",
    }))
    expect(item.tests).toContain('add(1, 2)')

    // A half-right solution: add(1,2)===3 passes, add(5,5)===10 fails → 0.5.
    mockOutput = '```js\nfunction add(a, b) { return a === 1 ? a + b : 0 }\n```'
    const done = await waitForRun(data<{ runId: string }>(await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'solve it' })).runId)
    expect(done.results[0].score).toBe(0.5)
    expect(done.results[0].scoreDetail).toMatchObject({ a: 'match', b: 'miss' })
  }, 20000)

  it('a code run is refused unless code execution is enabled', async () => {
    // beforeEach rewrote config without the toggle, so execution is off here.
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'C2', type: 'code', language: 'javascript' }))
    await req('POST', `/api/datasets/${ds.id}/items`, { input: 't', tests: "test('a', () => assert(true))" })
    const res = await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:A'], prompt: 'solve' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/code execution is disabled/)
  })

  it('tests are only accepted on a code dataset', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'T', type: 'text' }))
    expect((await req('POST', `/api/datasets/${ds.id}/items`, { input: 'q', tests: 'x' })).status).toBe(400)
  })

  it('a cross-site Origin cannot enable code execution or start a code run', async () => {
    // A browser can never forge Origin to localhost, so a cross-site Origin is a
    // CSRF attempt — both the enable-toggle and the code run must refuse it.
    const evil = { 'Content-Type': 'application/json', Origin: 'http://evil.example' }
    const putEvil = await fetch(`${base}/api/settings`, { method: 'PUT', headers: evil, body: JSON.stringify({ codeExecution: true }) })
    expect(putEvil.status).toBe(403)

    // Same-origin (no Origin header) is allowed to enable it and create the run.
    await req('PUT', '/api/settings', { codeExecution: true })
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'C3', type: 'code', language: 'javascript' }))
    await req('POST', `/api/datasets/${ds.id}/items`, { input: 't', tests: "test('a', () => assert(true))" })
    const runEvil = await fetch(`${base}/api/datasets/${ds.id}/run`, { method: 'POST', headers: evil, body: JSON.stringify({ models: ['p:A'], prompt: 'x' }) })
    expect(runEvil.status).toBe(403)
  })

  it('ai-fill labels a text item with no file (text branch)', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'T3', type: 'text', schema: [{ key: 'x', type: 'text' }] }))
    await req('PATCH', `/api/datasets/${ds.id}`, { trustedModel: 'p:A' })
    await req('POST', `/api/datasets/${ds.id}/items`, { input: 'q' })
    mockOutput = '{"x":"proposed"}'
    expect(data<{ filled: number }>(await req('POST', `/api/datasets/${ds.id}/ai-fill`, {})).filled).toBe(1)
    const item = data<{ items: { aiSuggested: Record<string, string> }[] }>(await req('GET', `/api/datasets/${ds.id}`)).items[0]
    expect(item.aiSuggested).toEqual({ x: 'proposed' })
  })
})

describe('gcUnboundUploads', () => {
  it('sweeps abandoned uploads but keeps dataset-bound files', async () => {
    const db = getDb()
    const abandoned = randomUUID()
    const kept = randomUUID()
    // Both old enough to sweep; only `kept` carries a dataset_id.
    db.prepare('INSERT INTO attachments (id, mime_type, name, size, created_at, dataset_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(abandoned, 'image/png', 'a.png', 1, 0, null)
    db.prepare('INSERT INTO attachments (id, mime_type, name, size, created_at, dataset_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kept, 'image/png', 'k.png', 1, 0, 'some-dataset')

    await gcUnboundUploads(1000)

    const ids = (db.prepare('SELECT id FROM attachments').all() as { id: string }[]).map(r => r.id)
    expect(ids).toContain(kept)
    expect(ids).not.toContain(abandoned)
  })
})

describe('arena mode', () => {
  interface Standing { model: string; elo: number; wins: number; losses: number }
  interface ArenaState { itemCount: number; verdicts: unknown[]; standings: Standing[]; nextIndex: number }

  async function arenaDataset(items = 2): Promise<string> {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'Arena', schema: [] }))
    for (let i = 0; i < items; i++) await req('POST', `/api/datasets/${ds.id}/items`, {})
    return ds.id
  }

  it('runs without auto-scoring and judges via verdicts, advancing the resume point', async () => {
    const id = await arenaDataset(2)
    mockOutput = 'some answer'
    const run = await req('POST', `/api/datasets/${id}/run`, { models: ['p:A', 'p:B'], prompt: 'go', mode: 'arena' })
    expect(run.status).toBe(202)
    const runId = data<{ runId: string }>(run).runId
    const done = await waitForRun(runId)

    // Arena is human-judged — no auto per-field score is written.
    expect(done.results.every(r => r.score == null)).toBe(true)

    // Fresh arena: nobody judged yet, everyone at 1000, resume at item 0.
    const a0 = data<ArenaState>(await req('GET', `/api/datasets/${id}/runs/${runId}/arena`))
    expect(a0).toMatchObject({ itemCount: 2, nextIndex: 0 })
    expect(a0.standings.every(s => s.elo === 1000)).toBe(true)

    // Judge item 0: A best → A leads, resume advances to item 1.
    const j0 = data<{ standings: Standing[]; nextIndex: number }>(
      await req('PUT', `/api/datasets/${id}/runs/${runId}/verdicts/0`, { bestModel: 'p:A' }))
    expect(j0.nextIndex).toBe(1)
    expect(j0.standings[0]).toMatchObject({ model: 'p:A', wins: 1 })
    expect(j0.standings.find(s => s.model === 'p:A')!.elo).toBeGreaterThan(j0.standings.find(s => s.model === 'p:B')!.elo)

    // Judge the last item → nothing left to judge (resume = -1).
    const j1 = data<{ nextIndex: number }>(
      await req('PUT', `/api/datasets/${id}/runs/${runId}/verdicts/1`, { bestModel: 'p:A', worstModel: 'p:B' }))
    expect(j1.nextIndex).toBe(-1)

    // The dataset's run list now reflects the arena mode + judged count.
    const runs = data<{ id: string; mode: string; judgedCount: number }[]>(await req('GET', `/api/datasets/${id}/runs`))
    expect(runs[0]).toMatchObject({ id: runId, mode: 'arena', judgedCount: 2 })
  })

  it('rejects a verdict whose bestModel is not one of the run models', async () => {
    const id = await arenaDataset(1)
    mockOutput = 'x'
    const runId = data<{ runId: string }>(await req('POST', `/api/datasets/${id}/run`, { models: ['p:A', 'p:B'], prompt: 'go', mode: 'arena' })).runId
    await waitForRun(runId)
    const bad = await req('PUT', `/api/datasets/${id}/runs/${runId}/verdicts/0`, { bestModel: 'p:Z' })
    expect(bad.status).toBe(400)
  })

  it('re-judging an item overwrites the earlier verdict (no duplicate row)', async () => {
    const id = await arenaDataset(1)
    mockOutput = 'x'
    const runId = data<{ runId: string }>(await req('POST', `/api/datasets/${id}/run`, { models: ['p:A', 'p:B'], prompt: 'go', mode: 'arena' })).runId
    await waitForRun(runId)
    await req('PUT', `/api/datasets/${id}/runs/${runId}/verdicts/0`, { bestModel: 'p:A' })
    const redo = data<{ standings: Standing[] }>(await req('PUT', `/api/datasets/${id}/runs/${runId}/verdicts/0`, { bestModel: 'p:B' }))
    // The flip counts once for B, not once each for A and B.
    expect(redo.standings.find(s => s.model === 'p:B')!.wins).toBe(1)
    expect(redo.standings.find(s => s.model === 'p:A')!.wins).toBe(0)
  })

  it('freezes the item range to the run snapshot — a verdict for an item added after the run is rejected', async () => {
    const id = await arenaDataset(1) // the run will include exactly 1 item
    mockOutput = 'x'
    const runId = data<{ runId: string }>(await req('POST', `/api/datasets/${id}/run`, { models: ['p:A', 'p:B'], prompt: 'go', mode: 'arena' })).runId
    await waitForRun(runId)

    // Dataset grows after the run — the arena's frozen item set must not grow.
    await req('POST', `/api/datasets/${id}/items`, {})
    // Index 1 exists in the dataset now, but the run never produced it → rejected
    // (a live-count range check would have poisoned the standings with it).
    expect((await req('PUT', `/api/datasets/${id}/runs/${runId}/verdicts/1`, { bestModel: 'p:A' })).status).toBe(400)
    expect((await req('PUT', `/api/datasets/${id}/runs/${runId}/verdicts/0`, { bestModel: 'p:A' })).status).toBe(200)

    const a = data<ArenaState>(await req('GET', `/api/datasets/${id}/runs/${runId}/arena`))
    expect(a.itemCount).toBe(1)
    expect(a.nextIndex).toBe(-1)
  })
})
