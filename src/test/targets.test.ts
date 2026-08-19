import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
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
async function req(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as ApiResult['body'] }
}
const data = <T>(r: ApiResult): T => r.body.data as T

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-targets-'))
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

beforeEach(() => {
  const db = getDb()
  db.prepare('DELETE FROM targets').run()
  db.prepare('DELETE FROM results').run()
  db.prepare('DELETE FROM runs').run()
})

const modelBody = (over: Record<string, unknown> = {}) => ({
  name: 'gpt-4o baseline', config: { providerId: 'openai', model: 'gpt-4o' }, ...over,
})

describe('targets CRUD', () => {
  it('creates a model target with id = providerId:model and lists it', async () => {
    const created = await req('POST', '/api/targets', modelBody())
    expect(created.status).toBe(201)
    const t = data<Target>(created)
    expect(t.id).toBe('openai:gpt-4o')
    expect(t.kind).toBe('model')
    expect(t.config.providerId).toBe('openai')
    expect(t.enabled).toBe(true)

    const list = await req('GET', '/api/targets?kind=model')
    expect(list.status).toBe(200)
    expect(data<Target[]>(list)).toHaveLength(1)
  })

  it('a second target for the same base model becomes a #variant', async () => {
    await req('POST', '/api/targets', modelBody())
    const second = await req('POST', '/api/targets', modelBody({ name: 'creative' }))
    expect(second.status).toBe(201)
    expect(data<Target>(second).id).toBe('openai:gpt-4o#creative')
  })

  it('GET/:id returns 404 for an unknown target', async () => {
    expect((await req('GET', '/api/targets/nope:x')).status).toBe(404)
  })

  it('patches name, tags, enabled and config', async () => {
    const t = data<Target>(await req('POST', '/api/targets', modelBody()))
    const patched = await req('PATCH', `/api/targets/${encodeURIComponent(t.id)}`, {
      name: 'renamed', tags: ['fast', 'json'], enabled: false,
      config: { providerId: 'openai', model: 'gpt-4o', defaults: { temperature: 0.2 } },
    })
    expect(patched.status).toBe(200)
    const u = data<Target>(patched)
    expect(u.name).toBe('renamed')
    expect(u.tags).toEqual(['fast', 'json'])
    expect(u.enabled).toBe(false)
    expect(u.config.defaults?.temperature).toBe(0.2)
  })

  it('duplicates a target into a distinct variant, returning the new one', async () => {
    const t = data<Target>(await req('POST', '/api/targets', modelBody({ name: 'baseline', config: { providerId: 'openai', model: 'gpt-4o', defaults: { temperature: 0.9 } } })))
    const dup = await req('POST', `/api/targets/${encodeURIComponent(t.id)}/duplicate`)
    expect(dup.status).toBe(201)
    const d = data<Target>(dup)
    expect(d.id).not.toBe(t.id)
    expect(d.id.startsWith('openai:gpt-4o#')).toBe(true)
    expect(d.config.defaults?.temperature).toBe(0.9)
    expect(data<Target[]>(await req('GET', '/api/targets')).length).toBe(2)
  })
})

describe('targets validation', () => {
  it('rejects missing name, missing config, non-model kind, invalid kind', async () => {
    expect((await req('POST', '/api/targets', { config: { providerId: 'openai', model: 'gpt-4o' } })).status).toBe(400)
    expect((await req('POST', '/api/targets', { name: 'x' })).status).toBe(400)
    expect((await req('POST', '/api/targets', modelBody({ kind: 'agent' }))).status).toBe(400)
    expect((await req('POST', '/api/targets', modelBody({ kind: 'bogus' }))).status).toBe(400)
    expect((await req('POST', '/api/targets', { name: 'x', config: { providerId: 'openai' } })).status).toBe(400)
  })

  it('a body-less POST is a 400, not a 500 (release-gate finding)', async () => {
    const res = await fetch(`${base}/api/targets`, { method: 'POST' })
    expect(res.status).toBe(400)
    expect((await res.json() as { error?: string }).error).toBeTruthy()
  })
})

describe('targets delete leaves results orphaned (no cascade)', () => {
  it('keeps target_id on historical results after the target is deleted', async () => {
    const t = data<Target>(await req('POST', '/api/targets', modelBody()))
    const db = getDb()
    const now = Date.now()
    db.prepare('INSERT INTO runs (id, prompts, models, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('run1', '[]', JSON.stringify(['openai:gpt-4o']), 'done', now)
    db.prepare('INSERT INTO results (id, run_id, prompt_index, model, provider_id, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('res1', 'run1', 0, 'openai:gpt-4o', 'openai', t.id, now)

    expect((await req('DELETE', `/api/targets/${encodeURIComponent(t.id)}`)).status).toBe(204)
    expect((await req('GET', `/api/targets/${encodeURIComponent(t.id)}`)).status).toBe(404)

    const row = db.prepare('SELECT target_id FROM results WHERE id = ?').get('res1') as { target_id: string }
    expect(row.target_id).toBe('openai:gpt-4o')
  })
})
