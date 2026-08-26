import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../server.js'
import { getDb, closeDb } from '../db/index.js'
import type { Target, PipelineTargetConfig, AgentTargetConfig, TraceStepRow } from '../types.js'

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

// A model target to reference from pipeline nodes (no provider existence check).
async function model(name: string, m = 'gpt-4o'): Promise<string> {
  const r = await req('POST', '/api/targets', { kind: 'model', name, config: { providerId: 'openai', model: m } })
  return data<Target>(r).id
}
function pipeline(name: string, config: Record<string, unknown>) {
  return { kind: 'pipeline', name, config }
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-pipelines-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14362, join(tempDir, 'test.db'))
  base = 'http://localhost:14362'
})
afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})
beforeEach(() => {
  getDb().prepare('DELETE FROM targets').run()
})

describe('pipeline target CRUD (stage 4 phase 1 — data model)', () => {
  it('creates a valid internal DAG pipeline with a pipeline: id and round-trips the config', async () => {
    const a = await model('a'), b = await model('b')
    const created = await req('POST', '/api/targets', pipeline('chain', {
      mode: 'internal',
      nodes: [{ id: 'n1', ref: a }, { id: 'n2', ref: b }],
      edges: [{ from: '', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: '' }],
    }))
    expect(created.status).toBe(201)
    const t = data<Target>(created)
    expect(t.kind).toBe('pipeline')
    expect(t.id.startsWith('pipeline:')).toBe(true)
    const cfg = t.config as PipelineTargetConfig
    expect(cfg.mode).toBe('internal')
    expect(cfg.nodes).toHaveLength(2)
    expect(cfg.maxDepth).toBe(3)      // default
    expect(cfg.maxNodes).toBe(32)     // default
  })

  it('creates an external pipeline via the agent transport, never leaking its secret', async () => {
    const created = await req('POST', '/api/targets', pipeline('ext', {
      mode: 'external', transport: 'command', command: 'node run.mjs', secrets: { TOK: 'do-not-leak' },
    }))
    expect(created.status).toBe(201)
    const cfg = data<Target>(created).config as PipelineTargetConfig
    expect(cfg.mode).toBe('external')
    expect(cfg.transport).toBe('command')
    expect(JSON.stringify(created.body)).not.toContain('do-not-leak')
    expect(cfg.secretRefs).toContain('TOK')
  })

  it('rejects a missing/invalid mode', async () => {
    expect((await req('POST', '/api/targets', pipeline('x', {}))).status).toBe(400)
    expect((await req('POST', '/api/targets', pipeline('x', { mode: 'sideways' }))).status).toBe(400)
  })

  it('rejects an internal pipeline with no nodes', async () => {
    expect((await req('POST', '/api/targets', pipeline('x', { mode: 'internal', nodes: [] }))).status).toBe(400)
  })

  it('rejects duplicate node ids', async () => {
    const a = await model('a')
    const r = await req('POST', '/api/targets', pipeline('x', {
      mode: 'internal', nodes: [{ id: 'n', ref: a }, { id: 'n', ref: a }], edges: [],
    }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('duplicate node id')
  })

  it('rejects a node whose ref target does not exist', async () => {
    const r = await req('POST', '/api/targets', pipeline('x', {
      mode: 'internal', nodes: [{ id: 'n', ref: 'openai:ghost' }], edges: [],
    }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('does not exist')
  })

  it('rejects an edge that references an unknown node', async () => {
    const a = await model('a')
    const r = await req('POST', '/api/targets', pipeline('x', {
      mode: 'internal', nodes: [{ id: 'n1', ref: a }], edges: [{ from: 'n1', to: 'nope' }],
    }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('unknown node')
  })

  it('rejects a cyclic graph', async () => {
    const a = await model('a'), b = await model('b')
    const r = await req('POST', '/api/targets', pipeline('x', {
      mode: 'internal',
      nodes: [{ id: 'n1', ref: a }, { id: 'n2', ref: b }],
      edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n1' }],
    }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('cycle')
  })

  it('rejects more nodes than maxNodes', async () => {
    const a = await model('a')
    const r = await req('POST', '/api/targets', pipeline('x', {
      mode: 'internal', maxNodes: 1,
      nodes: [{ id: 'n1', ref: a }, { id: 'n2', ref: a }], edges: [],
    }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('too many nodes')
  })

  it('allows nesting one pipeline inside another, but rejects a self-cycle on update', async () => {
    const a = await model('a')
    const leaf = data<Target>(await req('POST', '/api/targets', pipeline('leaf', {
      mode: 'internal', nodes: [{ id: 'n', ref: a }], edges: [],
    })))
    // A second pipeline nesting the first is valid…
    const top = await req('POST', '/api/targets', pipeline('top', {
      mode: 'internal', nodes: [{ id: 'n', ref: leaf.id }], edges: [],
    }))
    expect(top.status).toBe(201)
    // …but pointing a pipeline at itself is a nesting cycle.
    const selfCycle = await req('PATCH', `/api/targets/${encodeURIComponent(leaf.id)}`, {
      config: { mode: 'internal', nodes: [{ id: 'n', ref: leaf.id }], edges: [] },
    })
    expect(selfCycle.status).toBe(400)
    expect(selfCycle.body.error).toContain('nesting cycle')
  })

  it('rejects nesting deeper than maxDepth', async () => {
    const a = await model('a')
    const leaf = data<Target>(await req('POST', '/api/targets', pipeline('leaf', { mode: 'internal', nodes: [{ id: 'n', ref: a }], edges: [] })))
    const mid = data<Target>(await req('POST', '/api/targets', pipeline('mid', { mode: 'internal', nodes: [{ id: 'n', ref: leaf.id }], edges: [] })))
    // maxDepth 1 allows one nested pipeline (mid), but mid nests leaf → depth 2 → reject.
    const top = await req('POST', '/api/targets', pipeline('top', {
      mode: 'internal', maxDepth: 1, nodes: [{ id: 'n', ref: mid.id }], edges: [],
    }))
    expect(top.status).toBe(400)
    expect(top.body.error).toContain('maxDepth')
  })

  it('the isAgentConfig / isPipelineConfig guards do not confuse an external pipeline for an agent', async () => {
    const p = data<Target>(await req('POST', '/api/targets', pipeline('ext2', { mode: 'external', transport: 'command', command: 'node x.mjs' })))
    const cfg = p.config as AgentTargetConfig & PipelineTargetConfig
    // It has a transport (like an agent) but also a mode (only pipelines do).
    expect(cfg.transport).toBe('command')
    expect(cfg.mode).toBe('external')
  })
})

// A script agent that reads its input (last user message) off stdin and answers
// "ECHO:<input>" — so a chain's threading is visible in the final output. Emits one
// model step with a cost, so the pipeline's rolled-up cost is checkable.
const ECHO = `
let buf = ''
process.stdin.on('data', d => buf += d)
process.stdin.on('end', () => {
  let input = ''
  try { const { messages } = JSON.parse(buf); const m = messages[messages.length - 1]; input = typeof m.content === 'string' ? m.content : '' } catch {}
  const w = o => process.stdout.write(JSON.stringify(o) + '\\n')
  w({ type: 'step', id: 's', kind: 'model', name: 'echo', cost: 0.001 })
  w({ type: 'token', text: 'ECHO:' + input })
  w({ type: 'done', usage: { inputTokens: 1, outputTokens: 1 } })
})
`
const CRASH = `process.stderr.write('boom'); process.exit(1)`

async function agent(name: string, body: string): Promise<string> {
  const p = join(tempDir, name)
  writeFileSync(p, body)
  const r = await req('POST', '/api/targets', { kind: 'agent', name, config: { transport: 'command', command: `node ${p}`, timeoutMs: 8000, maxSteps: 40, retries: 0 } })
  return data<Target>(r).id
}

interface RunResult { id: string; text: string; error: string | null; providerId?: string }
async function runOnce(participantId: string): Promise<{ result: RunResult; trace: TraceStepRow[] }> {
  const { runId } = data<{ runId: string }>(await req('POST', '/api/benchmark', { prompts: ['hi'], models: [participantId] }))
  let result: RunResult | undefined
  for (let i = 0; i < 300; i++) {
    const run = data<{ status: string; results: RunResult[] }>(await req('GET', `/api/runs/${runId}`))
    if (run.status === 'done' || run.status === 'error') { result = run.results[0]; break }
    await new Promise(r => setTimeout(r, 30))
  }
  if (!result) throw new Error('run did not finish')
  const trace = data<TraceStepRow[]>(await req('GET', `/api/results/${result.id}/trace`))
  return { result, trace }
}

describe('internal pipeline orchestration (stage 4 phase 2)', () => {
  it('runs a 2-node chain, threading each stage output into the next', async () => {
    const e1 = await agent('e1.mjs', ECHO), e2 = await agent('e2.mjs', ECHO)
    const pid = data<Target>(await req('POST', '/api/targets', pipeline('chain2', {
      mode: 'internal',
      nodes: [{ id: 'n1', ref: e1 }, { id: 'n2', ref: e2 }],
      edges: [{ from: '', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: '' }],
    }))).id
    const { result, trace } = await runOnce(pid)
    expect(result.error).toBeFalsy()
    expect(result.text).toBe('ECHO:ECHO:hi')          // n2 saw n1's output
    // one step per node, and the result is a pipeline participant
    expect(trace.map(s => s.kind)).toEqual(['tool', 'tool'])
    const providerId = (getDb().prepare('SELECT provider_id AS p FROM results WHERE id = ?').get(result.id) as { p: string }).p
    expect(providerId).toBe('pipeline')
  })

  it('rolls each stage cost up into the pipeline trace', async () => {
    const e1 = await agent('c1.mjs', ECHO), e2 = await agent('c2.mjs', ECHO)
    const pid = data<Target>(await req('POST', '/api/targets', pipeline('cost', {
      mode: 'internal',
      nodes: [{ id: 'n1', ref: e1 }, { id: 'n2', ref: e2 }],
      edges: [{ from: 'n1', to: 'n2' }],
    }))).id
    const { trace } = await runOnce(pid)
    const total = trace.reduce((a, s) => a + (s.cost ?? 0), 0)
    expect(total).toBeCloseTo(0.002, 6)               // 0.001 per stage
  })

  it('runs a nested pipeline as a single rolled-up stage', async () => {
    const leaf = await agent('nl.mjs', ECHO)
    const inner = data<Target>(await req('POST', '/api/targets', pipeline('inner', {
      mode: 'internal', nodes: [{ id: 'n', ref: leaf }], edges: [],
    }))).id
    const outer = data<Target>(await req('POST', '/api/targets', pipeline('outer', {
      mode: 'internal', nodes: [{ id: 'n', ref: inner }], edges: [],
    }))).id
    const { result, trace } = await runOnce(outer)
    expect(result.error).toBeFalsy()
    expect(result.text).toBe('ECHO:hi')               // outer → inner → echo
    expect(trace).toHaveLength(1)                      // nested pipeline = one step
    expect(trace[0].kind).toBe('tool')
  })

  it('a crashing stage aborts the pipeline and surfaces the error on the result', async () => {
    const boom = await agent('boom.mjs', CRASH)
    const pid = data<Target>(await req('POST', '/api/targets', pipeline('bad', {
      mode: 'internal', nodes: [{ id: 'n', ref: boom }], edges: [],
    }))).id
    const { result } = await runOnce(pid)
    expect(result.error).toBeTruthy()
  })
})

describe('conditional edge routing (stage 4)', () => {
  it('takes an edge only when the source output matches its condition; skips the rest', async () => {
    const e1 = await agent('r1.mjs', ECHO), e2 = await agent('r2.mjs', ECHO), e3 = await agent('r3.mjs', ECHO)
    const pid = data<Target>(await req('POST', '/api/targets', pipeline('route', {
      mode: 'internal',
      nodes: [{ id: 'n1', ref: e1 }, { id: 'n2', ref: e2 }, { id: 'n3', ref: e3 }],
      edges: [
        { from: '', to: 'n1' },
        { from: 'n1', to: 'n2', when: 'ECHO' },   // n1 output "ECHO:hi" contains "ECHO" → taken
        { from: 'n1', to: 'n3', when: 'NOPE' },    // does not match → n3 is skipped
        { from: 'n2', to: '' },
      ],
    }))).id
    const { result, trace } = await runOnce(pid)
    expect(result.error).toBeFalsy()
    expect(result.text).toBe('ECHO:ECHO:hi')        // routed through n2 only
    expect(trace).toHaveLength(2)                    // n1 + n2 ran; n3 was routed around
  })
})

// An external pipeline program: benchy runs no stages, it just reads the emitted trace.
const PROG = `
const w = o => process.stdout.write(JSON.stringify(o) + '\\n')
w({ type: 'step', id: 'a', kind: 'think', name: 'plan', ms: 5 })
w({ type: 'step', id: 'b', kind: 'model', name: 'call', cost: 0.002 })
w({ type: 'token', text: 'external-answer' })
w({ type: 'done', usage: { inputTokens: 2, outputTokens: 3 } })
`

describe('external pipeline observation (stage 4 phase 3)', () => {
  it('observes an external program trace instead of running any stages', async () => {
    const p = join(tempDir, 'prog.mjs')
    writeFileSync(p, PROG)
    const pid = data<Target>(await req('POST', '/api/targets', pipeline('extrun', {
      mode: 'external', transport: 'command', command: `node ${p}`, timeoutMs: 8000,
    }))).id
    const { result, trace } = await runOnce(pid)
    expect(result.error).toBeFalsy()
    expect(result.text).toBe('external-answer')
    expect(trace.map(s => s.kind)).toEqual(['think', 'model'])   // the program's own steps
    const providerId = (getDb().prepare('SELECT provider_id AS p FROM results WHERE id = ?').get(result.id) as { p: string }).p
    expect(providerId).toBe('pipeline')
  })
})

describe('pipeline verify / health (stage 4)', () => {
  const health = (t: Target) => (t.config as PipelineTargetConfig).lastHandshake

  it('verifies an internal pipeline and persists health (ok + steps) for the dot', async () => {
    const e = await agent('vok.mjs', ECHO)
    const p = data<Target>(await req('POST', '/api/targets', pipeline('vok', { mode: 'internal', nodes: [{ id: 'n', ref: e }], edges: [] })))
    const hs = data<{ ok: boolean; spokeProtocol: boolean; steps: number }>(await req('POST', `/api/targets/${encodeURIComponent(p.id)}/handshake`, {}))
    expect(hs.ok).toBe(true)
    expect(hs.spokeProtocol).toBe(true)
    expect(hs.steps).toBe(1)
    const after = health(data<Target>(await req('GET', `/api/targets/${encodeURIComponent(p.id)}`)))
    expect(after?.ok).toBe(true)
    expect(typeof after?.at).toBe('number')
  })

  it('a crashing pipeline verifies as not ok', async () => {
    const boom = await agent('vcrash.mjs', CRASH)
    const p = data<Target>(await req('POST', '/api/targets', pipeline('vbad', { mode: 'internal', nodes: [{ id: 'n', ref: boom }], edges: [] })))
    await req('POST', `/api/targets/${encodeURIComponent(p.id)}/handshake`, {})
    expect(health(data<Target>(await req('GET', `/api/targets/${encodeURIComponent(p.id)}`)))?.ok).toBe(false)
  })

  it('verifies an external pipeline by observing its program', async () => {
    const prog = join(tempDir, 'vprog.mjs')
    writeFileSync(prog, PROG)
    const p = data<Target>(await req('POST', '/api/targets', pipeline('vext', { mode: 'external', transport: 'command', command: `node ${prog}`, timeoutMs: 8000 })))
    const hs = data<{ ok: boolean; steps: number }>(await req('POST', `/api/targets/${encodeURIComponent(p.id)}/handshake`, {}))
    expect(hs.ok).toBe(true)
    expect(hs.steps).toBe(2)
  })

  it('handshake still refuses a model target', async () => {
    const m = await model('mh')
    expect((await req('POST', `/api/targets/${encodeURIComponent(m)}/handshake`, {})).status).toBe(400)
  })
})

describe('pipeline metric rollup (stage 4 phase 4)', () => {
  it('the trajectory metrics apply to pipelines; model-only metrics do not', async () => {
    const defs = data<{ key: string; appliesTo: string[] }[]>(await req('GET', '/api/metrics'))
    const at = (k: string) => defs.find(d => d.key === k)?.appliesTo ?? []
    for (const k of ['steps', 'tool_calls', 'agent_cost', 'wall_clock']) {
      expect(at(k), k).toContain('pipeline')
    }
    expect(at('total_time')).toContain('pipeline')   // every kind reports total time
    expect(at('ttfs')).not.toContain('pipeline')      // model-only stays model-only
    expect(at('cost')).not.toContain('pipeline')
  })
})
