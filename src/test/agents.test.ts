import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../server.js'
import { getDb, closeDb } from '../db/index.js'
import type { Target, AgentTargetConfig, TraceStepRow } from '../types.js'

let server: FastifyInstance
let base: string
let tempDir: string

interface ApiResult { status: number; body: { data?: unknown; error?: string } }
async function req(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}
function data<T>(r: ApiResult): T { return r.body.data as T }

// Send a request with an explicit cross-site Origin, to exercise the CSRF guard.
async function reqOrigin(method: string, path: string, origin: string, body?: unknown): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.status
}

function script(name: string, body: string): string {
  const p = join(tempDir, name)
  writeFileSync(p, body)
  return p
}

// Emits the full protocol: a think step, a nested tool it already ran, a model
// call with usage+cost, then the answer token and done.
const FULL = `
process.stdin.resume()
const w = o => process.stdout.write(JSON.stringify(o) + '\\n')
w({ type: 'step', id: 'a', kind: 'think', name: 'planning', ms: 10 })
w({ type: 'tool', id: 'b', parent: 'a', name: 'search', ms: 20, args: { q: 'x' }, result: 'ok' })
w({ type: 'model', id: 'c', name: 'gpt-4o', usage: { inputTokens: 5, outputTokens: 7 }, cost: 0.001 })
w({ type: 'token', text: '4' })
w({ type: 'done', usage: { inputTokens: 5, outputTokens: 7 } })
`
// Ran fine but emitted no structured events — degraded, still a valid participant.
const DEGRADED = `process.stdout.write('4')`
// Process death.
const CRASH = `process.stderr.write('boom'); process.exit(1)`
// Echoes an injected secret, to prove env injection works (and that the API never
// returns the value).
const ECHO_SECRET = `process.stdout.write(JSON.stringify({ type: 'token', text: process.env.MY_SECRET || 'none' }) + '\\n')`

function agentBody(command: string, extra: Partial<AgentTargetConfig> & { secrets?: Record<string, string> } = {}) {
  return {
    kind: 'agent',
    name: extra.command ? 'a' : `agent-${Math.random().toString(36).slice(2, 7)}`,
    config: { transport: 'command', command, timeoutMs: 8000, maxSteps: 40, retries: 0, ...extra },
  }
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-agents-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14360, join(tempDir, 'test.db'))
  base = 'http://localhost:14360'
})

afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

beforeEach(() => {
  getDb().prepare('DELETE FROM targets').run()
  getDb().prepare('DELETE FROM results').run()
  getDb().prepare('DELETE FROM runs').run()
  getDb().prepare('DELETE FROM trace_steps').run()
})

describe('agent target CRUD', () => {
  it('creates a command agent with an agent: id and lists it', async () => {
    const created = await req('POST', '/api/targets', agentBody(`node ${script('full.mjs', FULL)}`))
    expect(created.status).toBe(201)
    const t = data<Target>(created)
    expect(t.kind).toBe('agent')
    expect(t.id.startsWith('agent:')).toBe(true)
    const cfg = t.config as AgentTargetConfig
    expect(cfg.transport).toBe('command')
    expect(cfg.maxSteps).toBe(40)

    const list = data<Target[]>(await req('GET', '/api/targets?kind=agent'))
    expect(list).toHaveLength(1)
  })

  it('rejects a command agent with no command and an http agent with no url', async () => {
    expect((await req('POST', '/api/targets', { kind: 'agent', name: 'x', config: { transport: 'command' } })).status).toBe(400)
    expect((await req('POST', '/api/targets', { kind: 'agent', name: 'x', config: { transport: 'http' } })).status).toBe(400)
  })
})

describe('agent secrets are stored by name and never returned', () => {
  it('keeps the value out of every API response, exposing only the ref name', async () => {
    const created = await req('POST', '/api/targets', {
      kind: 'agent', name: 'secret-agent',
      config: { transport: 'command', command: 'node x.mjs', timeoutMs: 8000, maxSteps: 40, retries: 0, secrets: { MY_SECRET: 'topsecret-value' } },
    })
    expect(created.status).toBe(201)
    const t = data<Target>(created)
    const cfg = t.config as AgentTargetConfig
    expect(cfg.secretRefs).toContain('MY_SECRET')
    // The value appears nowhere in the create response…
    expect(JSON.stringify(created.body)).not.toContain('topsecret-value')
    // …nor in a fresh GET / list.
    const got = await req('GET', `/api/targets/${encodeURIComponent(t.id)}`)
    expect(JSON.stringify(got.body)).not.toContain('topsecret-value')
    const listed = await req('GET', '/api/targets?kind=agent')
    expect(JSON.stringify(listed.body)).not.toContain('topsecret-value')
  })

  it('injects the resolved secret into the child env at spawn', async () => {
    const created = await req('POST', '/api/targets', {
      kind: 'agent', name: 'echo-secret',
      config: { transport: 'command', command: `node ${script('echo.mjs', ECHO_SECRET)}`, timeoutMs: 8000, maxSteps: 40, retries: 0, secrets: { MY_SECRET: 'injected-42' } },
    })
    const t = data<Target>(created)
    const hs = data<{ output: string }>(await req('POST', `/api/targets/${encodeURIComponent(t.id)}/handshake`, {}))
    expect(hs.output).toContain('injected-42')
  })
})

describe('handshake distinguishes three outcomes', () => {
  it('full trace: ok + spokeProtocol + step count', async () => {
    const t = data<Target>(await req('POST', '/api/targets', agentBody(`node ${script('full2.mjs', FULL)}`)))
    const hs = data<{ ok: boolean; spokeProtocol: boolean; steps: number; output: string }>(
      await req('POST', `/api/targets/${encodeURIComponent(t.id)}/handshake`, {}))
    expect(hs.ok).toBe(true)
    expect(hs.spokeProtocol).toBe(true)
    expect(hs.steps).toBe(3)
    expect(hs.output).toBe('4')
  })

  it('degraded: ran but no structure — ok true, spokeProtocol false', async () => {
    const t = data<Target>(await req('POST', '/api/targets', agentBody(`node ${script('deg.mjs', DEGRADED)}`)))
    const hs = data<{ ok: boolean; spokeProtocol: boolean; steps: number }>(
      await req('POST', `/api/targets/${encodeURIComponent(t.id)}/handshake`, {}))
    expect(hs.ok).toBe(true)
    expect(hs.spokeProtocol).toBe(false)
    expect(hs.steps).toBe(0)
  })

  it('crashed: process died — ok false with the error', async () => {
    const t = data<Target>(await req('POST', '/api/targets', agentBody(`node ${script('crash.mjs', CRASH)}`)))
    const hs = data<{ ok: boolean; error: string | null }>(
      await req('POST', `/api/targets/${encodeURIComponent(t.id)}/handshake`, {}))
    expect(hs.ok).toBe(false)
    expect(hs.error).toContain('boom')
  })
})

describe('a run persists the trace and reads it back in order', () => {
  it('stores each trajectory node and returns them by emission order', async () => {
    const t = data<Target>(await req('POST', '/api/targets', agentBody(`node ${script('full3.mjs', FULL)}`)))
    const { runId } = data<{ runId: string }>(await req('POST', '/api/benchmark', { prompts: ['hi'], models: [t.id] }))

    let resultId = ''
    for (let i = 0; i < 200; i++) {
      const run = data<{ status: string; results: { id: string; model: string }[] }>(await req('GET', `/api/runs/${runId}`))
      if (run.status === 'done' || run.status === 'error') { resultId = run.results[0]?.id ?? ''; break }
      await new Promise(r => setTimeout(r, 30))
    }
    expect(resultId).not.toBe('')

    const trace = data<TraceStepRow[]>(await req('GET', `/api/results/${resultId}/trace`))
    expect(trace.map(s => s.kind)).toEqual(['think', 'tool', 'model'])
    // Stored ids are namespaced by result (agents reuse ids across runs), but the
    // parent chain still resolves and depth is derived from it.
    const b = trace[1]
    expect(b.parentId).toBe(trace[0].id)
    expect(b.depth).toBe(1)
    expect(trace[2].cost).toBeCloseTo(0.001, 6)
  })

  it('persists two results whose step ids collide (fixed ids reused across a run)', async () => {
    // The same agent emits the SAME step ids ('a','b','c') for every prompt; two
    // results in one run must not violate the global trace_steps.id PK.
    const t = data<Target>(await req('POST', '/api/targets', agentBody(`node ${script('full4.mjs', FULL)}`)))
    const { runId } = data<{ runId: string }>(await req('POST', '/api/benchmark', { prompts: ['one', 'two'], models: [t.id] }))

    let results: { id: string; error: string | null }[] = []
    for (let i = 0; i < 200; i++) {
      const run = data<{ status: string; results: { id: string; error: string | null }[] }>(await req('GET', `/api/runs/${runId}`))
      if (run.status === 'done' || run.status === 'error') { results = run.results; break }
      await new Promise(r => setTimeout(r, 30))
    }
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.error).toBeNull()
      const trace = data<TraceStepRow[]>(await req('GET', `/api/results/${r.id}/trace`))
      expect(trace.map(s => s.kind)).toEqual(['think', 'tool', 'model'])
    }
  })
})

describe('agent endpoints refuse cross-site and handle bad targets', () => {
  it('handshake is refused from a cross-site origin (executes a user command — must be local)', async () => {
    const t = data<Target>(await req('POST', '/api/targets', agentBody(`node ${script('full5.mjs', FULL)}`)))
    // A page on another origin must never trigger command execution.
    expect(await reqOrigin('POST', `/api/targets/${encodeURIComponent(t.id)}/handshake`, 'http://evil.example', {})).toBe(403)
    // A localhost origin (how the real UI calls it) is allowed.
    expect(await reqOrigin('POST', `/api/targets/${encodeURIComponent(t.id)}/handshake`, 'http://localhost:5173', {})).toBe(200)
  })

  it('handshake rejects a model target and a missing target', async () => {
    const m = data<Target>(await req('POST', '/api/targets', { kind: 'model', name: 'm', config: { providerId: 'openai', model: 'gpt-4o' } }))
    expect((await req('POST', `/api/targets/${encodeURIComponent(m.id)}/handshake`, {})).status).toBe(400)
    expect((await req('POST', '/api/targets/agent:ghost/handshake', {})).status).toBe(404)
  })

  it('trace of an unknown or non-agent result is an empty array, not a 500', async () => {
    const res = await req('GET', '/api/results/does-not-exist/trace')
    expect(res.status).toBe(200)
    expect(data<TraceStepRow[]>(res)).toEqual([])
  })

  it('a saved agent keeps its secret across an edit that does not resend the value', async () => {
    const created = data<Target>(await req('POST', '/api/targets', {
      kind: 'agent', name: 'keep-secret',
      config: { transport: 'command', command: `node ${script('echo2.mjs', ECHO_SECRET)}`, timeoutMs: 8000, maxSteps: 40, retries: 0, secrets: { MY_SECRET: 'persist-me' } },
    }))
    // First run injects the secret.
    expect(data<{ output: string }>(await req('POST', `/api/targets/${encodeURIComponent(created.id)}/handshake`, {})).output).toContain('persist-me')
    // An edit that keeps the ref but sends NO new value must not wipe the stored one.
    await req('PATCH', `/api/targets/${encodeURIComponent(created.id)}`, {
      config: { transport: 'command', command: `node ${script('echo2.mjs', ECHO_SECRET)}`, timeoutMs: 9000, maxSteps: 40, retries: 0, secretRefs: ['MY_SECRET'] },
    })
    expect(data<{ output: string }>(await req('POST', `/api/targets/${encodeURIComponent(created.id)}/handshake`, {})).output).toContain('persist-me')
  })
})
