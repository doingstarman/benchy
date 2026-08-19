import type { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { modelTargetId, parseTargetId, variantSlug } from '../targets.js'
import type { Target, TargetKind, ModelTargetConfig } from '../types.js'

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

function rowToTarget(row: TargetRow): Target {
  return {
    id: row.id,
    kind: row.kind as TargetKind,
    name: row.name,
    config: (() => {
      try { return JSON.parse(row.config) as ModelTargetConfig } catch { return { providerId: '', model: '' } }
    })(),
    tags: (() => {
      try { const t = JSON.parse(row.tags); return Array.isArray(t) ? (t as string[]) : [] } catch { return [] }
    })(),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
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
    const body = (req.body ?? {}) as Partial<{ kind: string; name: string; config: ModelTargetConfig; tags: string[]; enabled: boolean }>
    const kind = body.kind ?? 'model'
    if (!KINDS.includes(kind as TargetKind)) return reply.code(400).send({ error: 'invalid kind' })
    if (kind !== 'model') return reply.code(400).send({ error: 'only kind=model is supported' })
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return reply.code(400).send({ error: 'name is required' })
    const config = body.config
    if (!config || typeof config.providerId !== 'string' || !config.providerId ||
        typeof config.model !== 'string' || !config.model) {
      return reply.code(400).send({ error: 'config.providerId and config.model are required' })
    }

    const base = modelTargetId(config.providerId, config.model)
    const id = uniqueId(base, variantSlug(name))
    const cfg: ModelTargetConfig = {
      providerId: config.providerId,
      model: config.model,
      ...(config.defaults ? { defaults: config.defaults } : {}),
      ...(config.pricing ? { pricing: config.pricing } : {}),
    }
    const tags = Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string') : []
    const now = Date.now()
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
    const body = (req.body ?? {}) as Partial<{ name: string; tags: string[]; enabled: boolean; config: ModelTargetConfig }>
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
      const c = body.config
      if (!c || typeof c.providerId !== 'string' || !c.providerId || typeof c.model !== 'string' || !c.model) {
        return reply.code(400).send({ error: 'config.providerId and config.model are required' })
      }
      db.prepare('UPDATE targets SET config = ? WHERE id = ?').run(JSON.stringify(c), id)
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
    const parsed = parseTargetId(id)
    const base = modelTargetId(parsed.providerId, parsed.model)
    const name = `${src.name} copy`
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
}
