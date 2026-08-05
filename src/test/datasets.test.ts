import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from '../server.js'
import { closeDb, getDb } from '../db/index.js'
import { gcUnboundUploads } from '../api/uploads.js'
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
})
