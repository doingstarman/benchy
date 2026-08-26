import type { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { modelTargetId, parseTargetId, variantSlug } from '../targets.js'
import { isLocalRequest } from './csrf.js'
import { setSecret } from '../config.js'
import { handshakeAgent } from '../agentRun.js'
import { handshakePipeline } from './benchmark.js'
import { logEvent } from '../logStore.js'
import type { Target, TargetKind, TargetConfig, ModelTargetConfig, AgentTargetConfig, PipelineTargetConfig, PipelineNode, PipelineEdge } from '../types.js'

interface TargetRow {
  id: string
  kind: string
  name: string
  config: string
  tags: string
  enabled: number
  created_at: number
  updated_at: number
}

const KINDS: TargetKind[] = ['model', 'agent', 'pipeline']

// SECURITY: the stored agent config carries only secret NAMES (secretRefs), never
// values, so returning it verbatim leaks nothing. This is the single choke point
// that hands target config to clients — keep it value-free.
function rowToTarget(row: TargetRow): Target {
  return {
    id: row.id,
    kind: row.kind as TargetKind,
    name: row.name,
    config: (() => {
      try { return JSON.parse(row.config) as TargetConfig } catch { return { providerId: '', model: '' } }
    })(),
    tags: (() => {
      try { const t = JSON.parse(row.tags); return Array.isArray(t) ? (t as string[]) : [] } catch { return [] }
    })(),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface AgentConfigInput {
  transport?: string
  command?: string
  cwd?: string
  url?: string
  authHeader?: string
  env?: Record<string, string>
  secretRefs?: string[]
  // Write-only: name→value pairs to store as named secrets, stripped before the
  // config is persisted. A value never rides back out to the client.
  secrets?: Record<string, string>
  timeoutMs?: number
  maxSteps?: number
  maxCostUsd?: number
  retries?: number
}

// Validate an agent config, persist any provided secret values under their names,
// and return the value-free config to store on the target row.
async function buildAgentConfig(input: AgentConfigInput): Promise<{ error: string } | { config: AgentTargetConfig }> {
  const transport = input.transport === 'http' ? 'http' : input.transport === 'command' ? 'command' : null
  if (!transport) return { error: 'config.transport must be "command" or "http"' }
  if (transport === 'command' && !(typeof input.command === 'string' && input.command.trim())) {
    return { error: 'config.command is required for a command agent' }
  }
  if (transport === 'http' && !(typeof input.url === 'string' && input.url.trim())) {
    return { error: 'config.url is required for an http agent' }
  }
  const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : dflt)

  // Persist secret values under their names; collect the names into secretRefs.
  const refs = new Set<string>(Array.isArray(input.secretRefs) ? input.secretRefs.filter(s => typeof s === 'string') : [])
  if (input.secrets && typeof input.secrets === 'object') {
    for (const [name, value] of Object.entries(input.secrets)) {
      if (typeof name !== 'string' || !name) continue
      if (typeof value === 'string' && value) { await setSecret(name, value); refs.add(name) }
    }
  }

  const env: Record<string, string> = {}
  if (input.env && typeof input.env === 'object') {
    for (const [k, v] of Object.entries(input.env)) if (typeof k === 'string' && typeof v === 'string') env[k] = v
  }

  const config: AgentTargetConfig = {
    transport,
    ...(transport === 'command' ? { command: (input.command as string).trim() } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(transport === 'http' ? { url: (input.url as string).trim() } : {}),
    ...(input.authHeader ? { authHeader: input.authHeader } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(refs.size ? { secretRefs: [...refs] } : {}),
    timeoutMs: num(input.timeoutMs, 120_000),
    maxSteps: num(input.maxSteps, 40),
    ...(input.maxCostUsd != null ? { maxCostUsd: num(input.maxCostUsd, 0) } : {}),
    retries: num(input.retries, 0),
  }
  return { config }
}

interface PipelineConfigInput {
  mode?: string
  nodes?: unknown
  edges?: unknown
  transport?: string; command?: string; cwd?: string; url?: string; authHeader?: string
  env?: Record<string, string>; secretRefs?: string[]; secrets?: Record<string, string>
  maxDepth?: number; maxNodes?: number; timeoutMs?: number; maxCostUsd?: number
}

type Db = ReturnType<typeof getDb>

// The first cycle in a node→node adjacency, as a path (for the error message), or null.
function firstCycle(adj: Map<string, string[]>): string[] | null {
  const color = new Map<string, 1 | 2>()  // 1 = on the current stack, 2 = fully explored
  const stack: string[] = []
  const visit = (u: string): string[] | null => {
    color.set(u, 1); stack.push(u)
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === 1) return [...stack.slice(stack.indexOf(v)), v]
      if (!color.get(v)) { const r = visit(v); if (r) return r }
    }
    color.set(u, 2); stack.pop()
    return null
  }
  for (const u of adj.keys()) if (!color.get(u)) { const r = visit(u); if (r) return r }
  return null
}

// Nesting must be acyclic (a pipeline may never contain itself, directly or transitively)
// and no deeper than maxDepth. A direct nested pipeline is depth 1. Returns an error
// message or null. `selfId` is the pipeline being validated (absent on create — a brand
// new id can't be referenced yet, so no self-cycle is possible).
function validateNesting(refs: string[], selfId: string | undefined, maxDepth: number, db: Db): string | null {
  const walk = (targetId: string, depth: number, path: string[]): string | null => {
    if (selfId && targetId === selfId) return `pipeline nesting cycle: ${[...path, targetId].join(' → ')}`
    const row = db.prepare('SELECT kind, config FROM targets WHERE id = ?').get(targetId) as { kind: string; config: string } | undefined
    if (!row || row.kind !== 'pipeline') return null   // a model/agent leaf ends the chain
    if (depth > maxDepth) return `pipeline nesting deeper than maxDepth ${maxDepth} at ${targetId}`
    let cfg: PipelineTargetConfig
    try { cfg = JSON.parse(row.config) as PipelineTargetConfig } catch { return null }
    for (const n of cfg.nodes ?? []) {
      const r = walk(n.ref, depth + 1, [...path, targetId])
      if (r) return r
    }
    return null
  }
  for (const ref of refs) { const r = walk(ref, 1, selfId ? [selfId] : []); if (r) return r }
  return null
}

// Validate a pipeline config — the DAG (internal) or the observed program (external) —
// and return the config to store. No execution here (Stage-4 phase 1 is the data model).
async function buildPipelineConfig(input: PipelineConfigInput, selfId?: string): Promise<{ error: string } | { config: PipelineTargetConfig }> {
  const mode = input.mode === 'external' ? 'external' : input.mode === 'internal' ? 'internal' : null
  if (!mode) return { error: 'config.mode must be "internal" or "external"' }
  const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : dflt)
  const maxDepth = num(input.maxDepth, 3)
  const maxNodes = num(input.maxNodes, 32)
  const base = {
    maxDepth, maxNodes,
    timeoutMs: num(input.timeoutMs, 120_000),
    ...(input.maxCostUsd != null ? { maxCostUsd: num(input.maxCostUsd, 0) } : {}),
  }

  if (mode === 'external') {
    // An external pipeline is observed exactly like an agent — reuse its transport
    // validation and secret persistence, then re-tag the config as a pipeline.
    const built = await buildAgentConfig(input as AgentConfigInput)
    if ('error' in built) return { error: built.error }
    const a = built.config
    return { config: {
      mode, transport: a.transport,
      ...(a.command ? { command: a.command } : {}), ...(a.cwd ? { cwd: a.cwd } : {}),
      ...(a.url ? { url: a.url } : {}), ...(a.authHeader ? { authHeader: a.authHeader } : {}),
      ...(a.env ? { env: a.env } : {}), ...(a.secretRefs ? { secretRefs: a.secretRefs } : {}),
      ...base,
    } }
  }

  // internal — validate the DAG.
  const nodesIn = Array.isArray(input.nodes) ? input.nodes as PipelineNode[] : null
  if (!nodesIn || nodesIn.length === 0) return { error: 'an internal pipeline needs at least one node' }
  if (nodesIn.length > maxNodes) return { error: `too many nodes (${nodesIn.length} > maxNodes ${maxNodes})` }
  const nodes: PipelineNode[] = []
  const ids = new Set<string>()
  for (const n of nodesIn) {
    if (!n || typeof n.id !== 'string' || !n.id.trim()) return { error: 'each node needs a non-empty id' }
    if (typeof n.ref !== 'string' || !n.ref.trim()) return { error: `node "${n.id}" needs a ref (a target id)` }
    if (ids.has(n.id)) return { error: `duplicate node id "${n.id}"` }
    ids.add(n.id)
    nodes.push({ id: n.id, ref: n.ref, ...(typeof n.label === 'string' ? { label: n.label } : {}) })
  }
  const edgesIn = Array.isArray(input.edges) ? input.edges as PipelineEdge[] : []
  const edges: PipelineEdge[] = []
  const okEnd = (v: string) => v === '' || ids.has(v)
  for (const e of edgesIn) {
    if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') return { error: 'each edge needs string from/to' }
    if (!okEnd(e.from) || !okEnd(e.to)) return { error: `edge "${e.from}"→"${e.to}" references an unknown node` }
    edges.push({ from: e.from, to: e.to, ...(typeof e.when === 'string' ? { when: e.when } : {}) })
  }

  const db = getDb()
  for (const n of nodes) {
    if (!db.prepare('SELECT 1 FROM targets WHERE id = ?').get(n.ref)) {
      return { error: `node "${n.id}" references a target that does not exist: ${n.ref}` }
    }
  }

  const adj = new Map<string, string[]>()
  for (const id of ids) adj.set(id, [])
  for (const e of edges) if (e.from !== '' && e.to !== '') adj.get(e.from)!.push(e.to)
  const cycle = firstCycle(adj)
  if (cycle) return { error: `the pipeline graph has a cycle: ${cycle.join(' → ')}` }

  const nestErr = validateNesting(nodes.map(n => n.ref), selfId, maxDepth, db)
  if (nestErr) return { error: nestErr }

  return { config: { mode, nodes, edges, ...base } }
}

// Find a free id: the plain base first, then `base#slug`, then `base#slug-2`, …
function uniqueId(base: string, slug: string): string {
  const db = getDb()
  const taken = (id: string) => db.prepare('SELECT 1 FROM targets WHERE id = ?').get(id) !== undefined
  if (!taken(base)) return base
  const stem = `${base}#${slug}`
  if (!taken(stem)) return stem
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}`
    if (!taken(candidate)) return candidate
  }
}

export async function registerTargetsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/targets', async req => {
    const { kind } = req.query as { kind?: string }
    const rows = (kind
      ? getDb().prepare('SELECT * FROM targets WHERE kind = ? ORDER BY created_at').all(kind)
      : getDb().prepare('SELECT * FROM targets ORDER BY created_at').all()) as TargetRow[]
    return { data: rows.map(rowToTarget) }
  })

  app.get('/api/targets/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = getDb().prepare('SELECT * FROM targets WHERE id = ?').get(id) as TargetRow | undefined
    if (!row) return reply.code(404).send({ error: 'Target not found' })
    return { data: rowToTarget(row) }
  })

  app.post('/api/targets', async (req, reply) => {
    const body = (req.body ?? {}) as Partial<{ kind: string; name: string; config: unknown; tags: string[]; enabled: boolean }>
    const kind = body.kind ?? 'model'
    if (!KINDS.includes(kind as TargetKind)) return reply.code(400).send({ error: 'invalid kind' })
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return reply.code(400).send({ error: 'name is required' })
    const tags = Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string') : []
    const now = Date.now()

    let id: string
    let cfg: TargetConfig
    if (kind === 'agent') {
      const built = await buildAgentConfig((body.config ?? {}) as AgentConfigInput)
      if ('error' in built) return reply.code(400).send({ error: built.error })
      cfg = built.config
      id = uniqueId(`agent:${variantSlug(name)}`, variantSlug(name))
    } else if (kind === 'pipeline') {
      const built = await buildPipelineConfig((body.config ?? {}) as PipelineConfigInput)
      if ('error' in built) return reply.code(400).send({ error: built.error })
      cfg = built.config
      id = uniqueId(`pipeline:${variantSlug(name)}`, variantSlug(name))
    } else {
      const config = body.config as ModelTargetConfig | undefined
      if (!config || typeof config.providerId !== 'string' || !config.providerId ||
          typeof config.model !== 'string' || !config.model) {
        return reply.code(400).send({ error: 'config.providerId and config.model are required' })
      }
      cfg = {
        providerId: config.providerId,
        model: config.model,
        ...(config.defaults ? { defaults: config.defaults } : {}),
        ...(config.pricing ? { pricing: config.pricing } : {}),
      }
      id = uniqueId(modelTargetId(config.providerId, config.model), variantSlug(name))
    }

    getDb().prepare(
      'INSERT INTO targets (id, kind, name, config, tags, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, kind, name, JSON.stringify(cfg), JSON.stringify(tags), body.enabled === false ? 0 : 1, now, now)
    const row = getDb().prepare('SELECT * FROM targets WHERE id = ?').get(id) as TargetRow
    return reply.code(201).send({ data: rowToTarget(row) })
  })

  app.patch('/api/targets/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM targets WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'Target not found' })
    }
    const kind = (db.prepare('SELECT kind FROM targets WHERE id = ?').get(id) as { kind: string }).kind
    const body = (req.body ?? {}) as Partial<{ name: string; tags: string[]; enabled: boolean; config: unknown }>
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) return reply.code(400).send({ error: 'name must be a non-empty string' })
      db.prepare('UPDATE targets SET name = ? WHERE id = ?').run(body.name.trim(), id)
    }
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) return reply.code(400).send({ error: 'tags must be an array' })
      db.prepare('UPDATE targets SET tags = ? WHERE id = ?').run(JSON.stringify(body.tags.filter(t => typeof t === 'string')), id)
    }
    if (body.enabled !== undefined) {
      db.prepare('UPDATE targets SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, id)
    }
    if (body.config !== undefined) {
      if (kind === 'agent') {
        const built = await buildAgentConfig((body.config ?? {}) as AgentConfigInput)
        if ('error' in built) return reply.code(400).send({ error: built.error })
        db.prepare('UPDATE targets SET config = ? WHERE id = ?').run(JSON.stringify(built.config), id)
      } else if (kind === 'pipeline') {
        const built = await buildPipelineConfig((body.config ?? {}) as PipelineConfigInput, id)
        if ('error' in built) return reply.code(400).send({ error: built.error })
        db.prepare('UPDATE targets SET config = ? WHERE id = ?').run(JSON.stringify(built.config), id)
      } else {
        const c = body.config as ModelTargetConfig
        if (!c || typeof c.providerId !== 'string' || !c.providerId || typeof c.model !== 'string' || !c.model) {
          return reply.code(400).send({ error: 'config.providerId and config.model are required' })
        }
        db.prepare('UPDATE targets SET config = ? WHERE id = ?').run(JSON.stringify(c), id)
      }
    }
    db.prepare('UPDATE targets SET updated_at = ? WHERE id = ?').run(Date.now(), id)
    const row = db.prepare('SELECT * FROM targets WHERE id = ?').get(id) as TargetRow
    return { data: rowToTarget(row) }
  })

  app.post('/api/targets/:id/duplicate', async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    const src = db.prepare('SELECT * FROM targets WHERE id = ?').get(id) as TargetRow | undefined
    if (!src) return reply.code(404).send({ error: 'Target not found' })
    const name = `${src.name} copy`
    const base = src.kind === 'agent'
      ? `agent:${variantSlug(name)}`
      : (() => { const p = parseTargetId(id); return modelTargetId(p.providerId, p.model) })()
    const newId = uniqueId(base, variantSlug(name))
    const now = Date.now()
    db.prepare(
      'INSERT INTO targets (id, kind, name, config, tags, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(newId, src.kind, name, src.config, src.tags, src.enabled, now, now)
    const row = db.prepare('SELECT * FROM targets WHERE id = ?').get(newId) as TargetRow
    return reply.code(201).send({ data: rowToTarget(row) })
  })

  app.delete('/api/targets/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM targets WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'Target not found' })
    }
    // Deliberately NO cascade into results: a deleted target leaves its id string on
    // historical results, which the UI surfaces as an orphan. History is never
    // rewritten — the opposite of the ON DELETE CASCADE used for run-owned rows.
    db.prepare('DELETE FROM targets WHERE id = ?').run(id)
    return reply.code(204).send()
  })

  // Run an agent once on a trivial prompt and report on two axes: process (ran,
  // exit, wall) and structure (how many step events). Behind isLocalRequest — it
  // executes a user-specified command, so a cross-site page must never trigger it.
  app.post('/api/targets/:id/handshake', async (req, reply) => {
    if (!isLocalRequest(req)) return reply.code(403).send({ error: 'cross-site request refused' })
    const { id } = req.params as { id: string }
    const row = getDb().prepare('SELECT * FROM targets WHERE id = ?').get(id) as TargetRow | undefined
    if (!row) return reply.code(404).send({ error: 'Target not found' })
    if (row.kind !== 'agent' && row.kind !== 'pipeline') return reply.code(400).send({ error: 'handshake is only for agent and pipeline targets' })
    const body = (req.body ?? {}) as { prompt?: string }
    const cfg = JSON.parse(row.config) as AgentTargetConfig | PipelineTargetConfig
    const result = row.kind === 'pipeline'
      ? await handshakePipeline(cfg as PipelineTargetConfig, id, body.prompt)
      : await handshakeAgent(cfg as AgentTargetConfig, id, body.prompt)
    // Persist the outcome on the (value-free) config so the list shows a health dot
    // without re-running. Diagnostic only — never disables the participant.
    const nextConfig = {
      ...cfg,
      lastHandshake: { ok: result.ok, spokeProtocol: result.spokeProtocol, steps: result.steps, error: result.error, at: Date.now() },
    }
    getDb().prepare('UPDATE targets SET config = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(nextConfig), Date.now(), id)
    logEvent(result.ok ? 'info' : 'warn', row.kind === 'pipeline' ? 'pipeline' : 'agent', `verify ${result.ok ? 'ok' : 'failed'}: ${id}`, { steps: result.steps, error: result.error })
    return { data: result }
  })
}
