import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../server.js'
import { getDb, closeDb } from '../db/index.js'
import { materializeRunMetrics } from '../api/metrics.js'
import type { MetricDef } from '../types.js'

let server: FastifyInstance
let base: string
let tempDir: string

interface ApiResult { status: number; body: { data?: unknown; error?: string } }
async function req(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as ApiResult['body'] }
}
const data = <T>(r: ApiResult): T => r.body.data as T
const metric = (over: Record<string, unknown> = {}) => ({ key: 'tokens_per_sec', name: 'Tokens / second', expression: 'output_tokens / total_time * 1000', unit: 'tok/s', direction: 'higher', scope: 'answer', ...over })

function seedRunWithResults() {
  const db = getDb()
  const now = Date.now()
  db.prepare('INSERT INTO runs (id, prompts, models, status, created_at) VALUES (?, ?, ?, ?, ?)').run('run1', '[]', JSON.stringify(['openai:gpt-4o']), 'done', now)
  const ins = db.prepare('INSERT INTO results (id, run_id, prompt_index, model, provider_id, text, ttfs, total_time, input_tokens, output_tokens, reasoning_tokens, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  ins.run('r1', 'run1', 0, 'openai:gpt-4o', 'openai', 'answer one', 400, 2000, 100, 800, null, 0.8, now)
  ins.run('r2', 'run1', 1, 'openai:gpt-4o', 'openai', 'answer two', 600, 3000, 120, null, null, 0.0, now) // output null → tokens_per_sec null
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-metrics-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14395, join(tempDir, 'test.db'))
  base = 'http://localhost:14395'
})
afterAll(async () => {
  await server.close(); closeDb(); rmSync(tempDir, { recursive: true, force: true }); delete process.env.BENCHY_DIR
})
beforeEach(async () => {
  const { writeConfig } = await import('../config.js')
  await writeConfig({ providers: [{ id: 'openai', name: 'OpenAI', type: 'openai', apiKey: 'k', models: ['gpt-4o'], enabled: true }] })
  const db = getDb()
  for (const t of ['metrics', 'metric_values', 'results', 'runs']) db.prepare(`DELETE FROM ${t}`).run()
})

describe('metrics registry', () => {
  it('lists 9 built-ins (reasoning_ms off by default) plus customs', async () => {
    const defs = data<MetricDef[]>(await req('GET', '/api/metrics'))
    const builtins = defs.filter(d => d.kind === 'builtin')
    expect(builtins.map(d => d.key).sort()).toEqual(['cost', 'elo', 'input_tokens', 'output_tokens', 'reasoning_ms', 'reasoning_tokens', 'score', 'total_time', 'ttfs'])
    expect(builtins.find(d => d.key === 'reasoning_ms')?.enabled).toBe(false)
    expect(builtins.find(d => d.key === 'ttfs')?.enabled).toBe(true)
  })

  it('creates a custom metric and lists it', async () => {
    expect((await req('POST', '/api/metrics', metric())).status).toBe(201)
    const defs = data<MetricDef[]>(await req('GET', '/api/metrics?kind=custom'))
    expect(defs).toHaveLength(1)
    expect(defs[0].key).toBe('tokens_per_sec')
  })
})

describe('metrics validation', () => {
  it('rejects bad slug, built-in shadow, duplicate, unknown key, bad enum', async () => {
    expect((await req('POST', '/api/metrics', metric({ key: 'Bad Key' }))).status).toBe(400)
    expect((await req('POST', '/api/metrics', metric({ key: 'ttfs' }))).status).toBe(400)
    await req('POST', '/api/metrics', metric())
    expect((await req('POST', '/api/metrics', metric())).status).toBe(400) // duplicate key
    expect((await req('POST', '/api/metrics', metric({ key: 'k2', expression: 'output_tokens / latency_ms' }))).status).toBe(400)
    expect((await req('POST', '/api/metrics', metric({ key: 'k3', direction: 'sideways' }))).status).toBe(400)
  })

  it('rejects a reference cycle across two customs', async () => {
    expect((await req('POST', '/api/metrics', { key: 'a', name: 'A', expression: 'ttfs + 1' })).status).toBe(201)
    expect((await req('POST', '/api/metrics', { key: 'b', name: 'B', expression: 'a + 1' })).status).toBe(201)
    expect((await req('PATCH', '/api/metrics/a', { expression: 'b + 1' })).status).toBe(400)
  })

  it('rejects a reference to elo or another per-run custom (would materialize null)', async () => {
    expect((await req('POST', '/api/metrics', metric({ key: 'uses_elo', name: 'E', expression: 'elo + 1' }))).status).toBe(400)
    expect((await req('POST', '/api/metrics', { key: 'cs', name: 'CS', expression: 'cost / score', scope: 'run', aggregate: 'sum' })).status).toBe(201)
    expect((await req('POST', '/api/metrics', { key: 'ref_run', name: 'RR', expression: 'cs + 1', scope: 'run', aggregate: 'mean' })).status).toBe(400)
  })

  it('a too-deeply-nested expression is 400, not 500', async () => {
    const deep = '('.repeat(5000) + 'ttfs' + ')'.repeat(5000)
    expect(data<{ ok: boolean }>(await req('POST', '/api/metrics/validate', { expression: deep, scope: 'answer' })).ok).toBe(false)
    expect((await req('POST', '/api/metrics', metric({ key: 'deep', expression: deep }))).status).toBe(400)
  })
})

describe('materialization concurrency', () => {
  it('does not duplicate metric_values rows under concurrent calls', async () => {
    await req('POST', '/api/metrics', metric())
    seedRunWithResults()
    await Promise.all([materializeRunMetrics('run1'), materializeRunMetrics('run1'), materializeRunMetrics('run1')])
    const c = (getDb().prepare("SELECT COUNT(*) AS c FROM metric_values WHERE metric_key = 'tokens_per_sec'").get() as { c: number }).c
    expect(c).toBe(2) // 2 results, one row each — not 6
  })
})

describe('built-in immutability', () => {
  it('toggles enabled but refuses edits and deletes', async () => {
    expect((await req('PATCH', '/api/metrics/cost', { name: 'Renamed' })).status).toBe(400)
    expect((await req('DELETE', '/api/metrics/ttfs')).status).toBe(400)
    expect((await req('PATCH', '/api/metrics/cost', { enabled: false })).status).toBe(200)
    const defs = data<MetricDef[]>(await req('GET', '/api/metrics'))
    expect(defs.find(d => d.key === 'cost')?.enabled).toBe(false)
  })
})

describe('custom delete', () => {
  it('deletes the metric and its materialized values', async () => {
    await req('POST', '/api/metrics', metric())
    seedRunWithResults()
    await materializeRunMetrics('run1')
    expect((getDb().prepare("SELECT COUNT(*) AS c FROM metric_values WHERE metric_key = 'tokens_per_sec'").get() as { c: number }).c).toBeGreaterThan(0)
    expect((await req('DELETE', '/api/metrics/tokens_per_sec')).status).toBe(204)
    expect((getDb().prepare("SELECT COUNT(*) AS c FROM metric_values WHERE metric_key = 'tokens_per_sec'").get() as { c: number }).c).toBe(0)
  })
})

describe('validate + preview endpoints', () => {
  it('validates an expression', async () => {
    expect(data<{ ok: boolean }>(await req('POST', '/api/metrics/validate', { expression: 'output_tokens / total_time', scope: 'answer' })).ok).toBe(true)
    expect(data<{ ok: boolean }>(await req('POST', '/api/metrics/validate', { expression: 'output_tokens / nope', scope: 'answer' })).ok).toBe(false)
  })
  it('previews over recent results, null ≠ 0', async () => {
    seedRunWithResults()
    const p = data<{ ok: boolean; rows: { value: number | null }[]; coverage: { have: number; total: number } }>(
      await req('POST', '/api/metrics/preview', { expression: 'output_tokens / total_time * 1000', scope: 'answer' }))
    expect(p.ok).toBe(true)
    expect(p.rows).toHaveLength(2)
    expect(p.coverage.have).toBe(1) // r2 has null output_tokens → null value
    expect(p.rows.some(r => r.value == null)).toBe(true)
  })
})

describe('materialization writes only custom values', () => {
  it('stores per-answer custom values, null where an input is null, none for built-ins', async () => {
    await req('POST', '/api/metrics', metric())
    seedRunWithResults()
    await materializeRunMetrics('run1')
    const db = getDb()
    const rows = db.prepare("SELECT result_id, value FROM metric_values WHERE metric_key = 'tokens_per_sec' ORDER BY result_id").all() as { result_id: string; value: number | null }[]
    expect(rows).toHaveLength(2)
    expect(rows[0].value).toBeCloseTo(400, 0) // 800/2000*1000
    expect(rows[1].value).toBeNull()          // output_tokens null
    // built-ins are never materialized
    expect((db.prepare("SELECT COUNT(*) AS c FROM metric_values WHERE metric_key IN ('ttfs','cost','score')").get() as { c: number }).c).toBe(0)
  })
})
