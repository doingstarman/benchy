import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../server.js'
import { getDb, closeDb } from '../db/index.js'
import type { Target, PipelineTargetConfig, AgentTargetConfig } from '../types.js'

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
