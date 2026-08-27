import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../server.js'
import { getDb, closeDb } from '../db/index.js'
import type { Target } from '../types.js'

let server: FastifyInstance
let base: string
let tempDir: string

interface ApiResult { status: number; body: { data?: unknown; error?: string } }
async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}
function data<T>(r: ApiResult): T { return r.body.data as T }

// Emits one token, then sleeps far longer than the test waits — so a run that
// finishes quickly proves the stop actually killed it, not that it ended on its own.
const SLOW = `
const w = o => process.stdout.write(JSON.stringify(o) + '\\n')
w({ type: 'token', text: 'partial' })
setTimeout(() => { w({ type: 'done', usage: { inputTokens: 1, outputTokens: 1 } }) }, 8000)
`

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-stop-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14366, join(tempDir, 'test.db'))
  base = 'http://localhost:14366'
})
afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})
beforeEach(() => {
  getDb().prepare('DELETE FROM targets').run()
  getDb().prepare('DELETE FROM runs').run()
  getDb().prepare('DELETE FROM results').run()
})

describe('stop in-flight generation', () => {
  it('refuses a cross-site stop', async () => {
    const r = await req('POST', '/api/benchmark/whatever/stop', {}, { Origin: 'https://evil.example' })
    expect(r.status).toBe(403)
  })

  it('reports zero stopped for a run with nothing in flight', async () => {
    const r = data<{ stopped: number }>(await req('POST', '/api/benchmark/none/stop', {}))
    expect(r.stopped).toBe(0)
  })

  it('stops a running participant: the run settles fast and the partial answer survives without error', async () => {
    const p = join(tempDir, 'slow.mjs')
    writeFileSync(p, SLOW)
    const agent = data<Target>(await req('POST', '/api/targets', {
      kind: 'agent', name: 'slow', config: { transport: 'command', command: `node ${p}`, timeoutMs: 30000, maxSteps: 40, retries: 0 },
    }))
    const { runId } = data<{ runId: string }>(await req('POST', '/api/benchmark', { prompts: ['hi'], models: [agent.id] }))

    // Wait for the cell to actually start streaming (a result row exists).
    for (let i = 0; i < 100; i++) {
      const run = data<{ results: { id: string }[] }>(await req('GET', `/api/runs/${runId}`))
      if (run.results.length > 0) break
      await new Promise(r => setTimeout(r, 30))
    }
    const stopped = data<{ stopped: number }>(await req('POST', `/api/benchmark/${encodeURIComponent(runId)}/stop`, {}))
    expect(stopped.stopped).toBeGreaterThanOrEqual(1)

    // The run must settle well before the agent's 8s sleep would have ended it.
    const t0 = Date.now()
    let status = 'running'
    for (let i = 0; i < 150; i++) {
      const run = data<{ status: string }>(await req('GET', `/api/runs/${runId}`))
      status = run.status
      if (status === 'done' || status === 'error') break
      await new Promise(r => setTimeout(r, 30))
    }
    expect(status).toBe('done')
    expect(Date.now() - t0).toBeLessThan(5000)

    const run = data<{ results: { text: string; error: string | null }[] }>(await req('GET', `/api/runs/${runId}`))
    expect(run.results[0].error).toBeNull()
    expect(run.results[0].text).toContain('partial')
  }, 20_000)
})
