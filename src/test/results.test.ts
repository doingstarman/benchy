import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb, getDb } from '../db/index.js'
import { toCsv } from '../api/results.js'
import type { FastifyInstance } from 'fastify'

// Per-model deterministic output: the 'good' model returns the correct value, the
// 'bad' one returns garbage — so the score winner is unambiguously p:good.
vi.mock('../adapters/openai.js', () => ({
  openaiAdapter: {
    async *stream(_messages: unknown, config: { model: string }) {
      const good = config.model.includes('good')
      yield { type: 'token', text: good ? '{"x":"v"}' : '{"x":"WRONG"}' }
      yield { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } }
    },
  },
}))

let server: FastifyInstance
let base: string
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-results-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14390, join(tempDir, 'test.db'))
  base = 'http://localhost:14390'
})

afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

beforeEach(async () => {
  const { writeConfig } = await import('../config.js')
  await writeConfig({ providers: [{ id: 'p', name: 'P', type: 'openai', apiKey: 'k', models: ['good', 'bad'], enabled: true }] })
  const db = getDb()
  for (const t of ['datasets', 'dataset_items', 'dataset_run_verdicts', 'runs', 'results', 'attachments']) db.prepare(`DELETE FROM ${t}`).run()
})

interface ApiResult { status: number; body: { data?: unknown; error?: string } }
async function req(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as ApiResult['body'] }
}
const data = <T>(r: ApiResult): T => r.body.data as T

async function waitForRun(runId: string): Promise<{ status: string }> {
  for (let i = 0; i < 200; i++) {
    const r = await req('GET', `/api/runs/${runId}`)
    const d = r.body.data as { status: string } | undefined
    if (d && d.status !== 'running') return d
    await new Promise(res => setTimeout(res, 20))
  }
  throw new Error('run did not finish')
}

// Create a labeled dataset + one item, run it in `mode`, return the runId.
async function runDataset(mode: 'score' | 'arena'): Promise<string> {
  const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'R', schema: [{ key: 'x', type: 'text' }] }))
  await req('POST', `/api/datasets/${ds.id}/items`, { groundTruth: { x: 'v' } })
  const run = await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:good', 'p:bad'], prompt: 'go', mode })
  const runId = data<{ runId: string }>(run).runId
  await waitForRun(runId)
  return runId
}

interface Row { runId: string; datasetName: string; mode: string; winner: string | null; tokens: number; itemCount: number; modelCount: number }

describe('GET /api/results', () => {
  it('lists dataset tests with a computed winner, excluding non-dataset runs', async () => {
    const runId = await runDataset('score')

    // A plain benchmark run must NOT appear in the results database.
    const bench = await req('POST', '/api/benchmark', { prompts: ['hi'], models: ['p:good'] })
    await waitForRun(data<{ runId: string }>(bench).runId)

    const rows = data<Row[]>(await req('GET', '/api/results'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ runId, datasetName: 'R', mode: 'score', winner: 'p:good', modelCount: 2, itemCount: 1 })
    expect(rows[0].tokens).toBeGreaterThan(0)
  })
})

describe('GET /api/results/:runId', () => {
  it('score run: winner is the most accurate model, matrix ranked', async () => {
    const runId = await runDataset('score')
    const s = data<{ mode: string; winner: string; matrix: { model: string; overall: number }[] }>(await req('GET', `/api/results/${runId}`))
    expect(s.mode).toBe('score')
    expect(s.winner).toBe('p:good')
    expect(s.matrix[0].model).toBe('p:good')
    expect(s.matrix[0].overall).toBe(1)
  })

  it('arena winner is null when every judged item was only skipped', async () => {
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'S', schema: [] }))
    await req('POST', `/api/datasets/${ds.id}/items`, {})
    const run = await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:good', 'p:bad'], prompt: 'go', mode: 'arena' })
    const runId = data<{ runId: string }>(run).runId
    await waitForRun(runId)

    // A skip writes a real verdict row but carries no judgment — no winner.
    await req('PUT', `/api/datasets/${ds.id}/runs/${runId}/verdicts/0`, { skipped: true })

    expect(data<Row[]>(await req('GET', '/api/results'))[0].winner).toBeNull()
    const s = data<{ winner: string | null; skipped: number }>(await req('GET', `/api/results/${runId}`))
    expect(s.winner).toBeNull()
    expect(s.skipped).toBe(1)
  })

  it('arena run: winner reflects the human verdict', async () => {
    // Reconstruct the dataset id from the run to PUT a verdict.
    const ds = data<{ id: string }>(await req('POST', '/api/datasets', { name: 'A', schema: [] }))
    await req('POST', `/api/datasets/${ds.id}/items`, {})
    const run = await req('POST', `/api/datasets/${ds.id}/run`, { models: ['p:good', 'p:bad'], prompt: 'go', mode: 'arena' })
    const runId = data<{ runId: string }>(run).runId
    await waitForRun(runId)

    // Human picks the 'bad' model as best for item 0 → it must win the arena.
    await req('PUT', `/api/datasets/${ds.id}/runs/${runId}/verdicts/0`, { bestModel: 'p:bad' })

    const s = data<{ mode: string; winner: string; standings: { model: string }[] }>(await req('GET', `/api/results/${runId}`))
    expect(s.mode).toBe('arena')
    expect(s.winner).toBe('p:bad')
    expect(s.standings[0].model).toBe('p:bad')
  })
})

describe('GET /api/results/:runId/export', () => {
  it('csv is a downloadable attachment with a row per item×model', async () => {
    const runId = await runDataset('score')
    const res = await fetch(`${base}/api/results/${runId}/export?format=csv`)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const text = await res.text()
    const lines = text.trim().split('\n')
    expect(lines[0]).toContain('model')
    expect(lines).toHaveLength(1 + 2) // header + 1 item × 2 models
  })

  it('json export is a valid array', async () => {
    const runId = await runDataset('score')
    const res = await fetch(`${base}/api/results/${runId}/export?format=json`)
    expect(res.headers.get('content-type')).toContain('application/json')
    const arr = await res.json() as unknown[]
    expect(Array.isArray(arr)).toBe(true)
    expect(arr).toHaveLength(2)
  })
})

describe('toCsv', () => {
  it('escapes commas, quotes, and newlines', () => {
    const out = toCsv([{ a: 'plain', b: 'has,comma', c: 'has"quote', d: 'has\nnewline' }])
    expect(out).toBe('a,b,c,d\nplain,"has,comma","has""quote","has\nnewline"\n')
  })

  it('neutralizes spreadsheet formula-leading cells', () => {
    // =/+/-/@ would execute in Excel; prefixing with ' keeps them as text.
    const out = toCsv([{ a: '=SUM(1)', b: '+1', c: '-2', d: '@cmd' }])
    expect(out).toBe("a,b,c,d\n'=SUM(1),'+1,'-2,'@cmd\n")
  })
})
