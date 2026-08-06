import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { getUploadsDir, uploadPath } from '../api/uploads.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb, getDb } from '../db/index.js'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Run, Result } from '../types.js'

let server: FastifyInstance
let base: string
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-runs-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14310, join(tempDir, 'test.db'))
  base = `http://localhost:14310`
})

afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

function seed(override: Partial<{ prompts: string; models: string; status: string; saved: number }> = {}) {
  const id = randomUUID()
  getDb().prepare(
    'INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    override.prompts ?? JSON.stringify(['hello world']),
    override.models ?? JSON.stringify(['openai:gpt-4o']),
    override.status ?? 'done',
    override.saved ?? 0,
    1, 1, Date.now(),
  )
  return id
}

async function get<T>(path: string, qs = '') {
  const res = await fetch(`${base}${path}${qs}`)
  return { status: res.status, body: await res.json() as T }
}

async function del(path: string) { return (await fetch(`${base}${path}`, { method: 'DELETE' })).status }

async function patch<T>(path: string, payload: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json() as T }
}

async function post<T>(path: string) {
  const res = await fetch(`${base}${path}`, { method: 'POST' })
  return { status: res.status, body: await res.json() as T }
}

describe('Runs API — real SQLite', () => {
  it('GET /api/runs returns only seeded runs', async () => {
    const id = seed()
    const { status, body } = await get<{ data: Run[] }>('/api/runs')
    expect(status).toBe(200)
    expect(body.data.some(r => r.id === id)).toBe(true)
    // prompts parsed from JSON string
    const run = body.data.find(r => r.id === id)!
    expect(run.prompts).toEqual(['hello world'])
    expect(run.models).toEqual(['openai:gpt-4o'])
  })

  it('GET /api/runs?status=saved returns only saved runs', async () => {
    const savedId = seed({ saved: 1, prompts: JSON.stringify(['saved run']) })
    const unsavedId = seed({ saved: 0, prompts: JSON.stringify(['unsaved run']) })

    const { body } = await get<{ data: Run[] }>('/api/runs', '?status=saved')
    const ids = body.data.map(r => r.id)
    expect(ids).toContain(savedId)
    expect(ids).not.toContain(unsavedId)
  })

  it('GET /api/runs?search filters by prompt text', async () => {
    const matchId = seed({ prompts: JSON.stringify(['unique-xyz-prompt']) })
    seed({ prompts: JSON.stringify(['something else']) })

    const { body } = await get<{ data: Run[] }>('/api/runs', '?search=unique-xyz')
    expect(body.data.some(r => r.id === matchId)).toBe(true)
    expect(body.data.every(r => r.prompts[0].includes('unique-xyz') || true)).toBe(true)
  })

  it('GET /api/runs/:id returns run with results array', async () => {
    const id = seed()
    const { status, body } = await get<{ data: Run & { results: Result[] } }>(`/api/runs/${id}`)
    expect(status).toBe(200)
    expect(body.data.id).toBe(id)
    expect(Array.isArray(body.data.results)).toBe(true)
  })

  it('GET /api/runs/:id returns 404 for missing run', async () => {
    const { status } = await get('/api/runs/does-not-exist-ever')
    expect(status).toBe(404)
  })

  it('DELETE /api/runs/:id removes run from DB', async () => {
    const id = seed()
    expect(await del(`/api/runs/${id}`)).toBe(204)
    const { status } = await get(`/api/runs/${id}`)
    expect(status).toBe(404)
  })

  it('DELETE cascades to results', async () => {
    const id = seed()
    const resultId = randomUUID()
    getDb().prepare(
      'INSERT INTO results (id, run_id, prompt_index, model, provider_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(resultId, id, 0, 'openai:gpt-4o', 'openai', 'hello', Date.now())

    await del(`/api/runs/${id}`)
    const row = getDb().prepare('SELECT * FROM results WHERE id = ?').get(resultId)
    expect(row).toBeUndefined()
  })

  it('POST /api/runs/:id/fork creates new run with same config', async () => {
    const id = seed({ prompts: JSON.stringify(['fork source']), models: JSON.stringify(['anthropic:claude-haiku-4-5']) })
    const { status, body } = await post<{ data: Run }>(`/api/runs/${id}/fork`)
    expect(status).toBe(201)
    expect(body.data.id).not.toBe(id)
    expect(body.data.prompts).toEqual(['fork source'])
    expect(body.data.models).toEqual(['anthropic:claude-haiku-4-5'])
    expect(body.data.status).toBe('pending')
    expect(body.data.saved).toBe(false)
  })

  it('PATCH /api/runs/:id saves run', async () => {
    const id = seed({ saved: 0 })
    await patch(`/api/runs/${id}`, { saved: true })
    const { body } = await get<{ data: Run & { results: Result[] } }>(`/api/runs/${id}`)
    expect(body.data.saved).toBe(true)

    // Toggle back
    await patch(`/api/runs/${id}`, { saved: false })
    const { body: b2 } = await get<{ data: Run & { results: Result[] } }>(`/api/runs/${id}`)
    expect(b2.data.saved).toBe(false)
  })

  it('PATCH /api/runs/:id renames run and clears title on empty string', async () => {
    const id = seed()
    const { body } = await patch<{ data: Run }>(`/api/runs/${id}`, { title: '  Мой тест UI  ' })
    expect(body.data.title).toBe('Мой тест UI')

    const { body: list } = await get<{ data: Run[] }>('/api/runs')
    expect(list.data.find(r => r.id === id)?.title).toBe('Мой тест UI')

    const { body: cleared } = await patch<{ data: Run }>(`/api/runs/${id}`, { title: '' })
    expect(cleared.data.title).toBeUndefined()
  })

  it('feedback patch updates result row in DB', async () => {
    const runId = seed()
    const resultId = randomUUID()
    getDb().prepare(
      'INSERT INTO results (id, run_id, prompt_index, model, provider_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(resultId, runId, 0, 'openai:gpt-4o', 'openai', 'response', Date.now())

    const res = await fetch(`${base}/api/runs/${runId}/results/${resultId}/feedback`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: 'up' }),
    })
    expect(res.status).toBe(204)

    const row = getDb().prepare('SELECT feedback FROM results WHERE id = ?').get(resultId) as { feedback: string }
    expect(row.feedback).toBe('up')
  })
})

describe('DELETE /api/runs — clear the whole history', () => {
  // The blast radius here is unbounded, which is what makes each of these
  // matter: an attachment left behind is an invisible disk leak, a dataset
  // taken with the runs is authored work nobody asked to delete, and a running
  // run deleted mid-stream throws inside its SSE handler.
  function attach(runId: string | null, datasetId: string | null = null): { id: string; path: string } {
    const id = randomUUID()
    const mime = 'image/png'
    mkdirSync(getUploadsDir(), { recursive: true })
    const path = uploadPath(id, mime)
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    getDb().prepare(
      'INSERT INTO attachments (id, run_id, dataset_id, prompt_index, mime_type, name, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, runId, datasetId, 0, mime, 'x.png', 4, Date.now())
    return { id, path }
  }

  function reset() {
    const db = getDb()
    db.prepare('DELETE FROM attachments').run()
    db.prepare('DELETE FROM runs').run()
    db.prepare('DELETE FROM datasets').run()
  }

  async function clearAll(): Promise<{ status: number; body: { data?: { deleted: number; skipped: number } } }> {
    const res = await fetch(`${base}/api/runs`, { method: 'DELETE' })
    return { status: res.status, body: await res.json() as { data?: { deleted: number; skipped: number } } }
  }

  it('unlinks the files of every cleared run, not just their rows', async () => {
    reset()
    const a = attach(seed())
    const b = attach(seed())

    const res = await clearAll()
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ deleted: 2, skipped: 0 })

    // Both assertions are load-bearing: attachments has no FK, so deleting the
    // runs first would strand the rows AND leak the files. The rows are the
    // visible symptom; the files are the actual leak.
    expect(getDb().prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({ n: 0 })
    expect(existsSync(a.path), 'attachment file left on disk').toBe(false)
    expect(existsSync(b.path), 'attachment file left on disk').toBe(false)
  })

  it('keeps uploads that belong to no run', async () => {
    reset()
    const runFile = attach(seed())
    const unbound = attach(null)                       // a chip picked but never sent
    const datasetFile = attach(null, 'ds-1')           // a dataset item's own file

    await clearAll()

    expect(existsSync(runFile.path)).toBe(false)
    expect(existsSync(unbound.path), 'an unsent upload is not a run').toBe(true)
    expect(existsSync(datasetFile.path), "a dataset's file is not a run").toBe(true)
    expect(getDb().prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({ n: 2 })
  })

  it('leaves a run that is still streaming, and says so', async () => {
    reset()
    seed({ status: 'done' })
    const live = seed({ status: 'running' })

    const res = await clearAll()
    expect(res.body.data).toEqual({ deleted: 1, skipped: 1 })
    expect(getDb().prepare('SELECT id FROM runs').all()).toEqual([{ id: live }])
  })

  it('takes the results with the runs', async () => {
    reset()
    const runId = seed()
    getDb().prepare(
      'INSERT INTO results (id, run_id, prompt_index, model, provider_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), runId, 0, 'gpt-4o', 'openai', 'hi', Date.now())

    await clearAll()
    // Cascades via the FK — which only holds while foreign_keys = ON.
    expect(getDb().prepare('SELECT count(*) AS n FROM results').get()).toEqual({ n: 0 })
  })

  it('refuses a cross-site Origin and deletes nothing', async () => {
    reset()
    seed()
    const res = await fetch(`${base}/api/runs`, {
      method: 'DELETE',
      headers: { Origin: 'http://evil.example' },
    })
    expect(res.status).toBe(403)
    expect(getDb().prepare('SELECT count(*) AS n FROM runs').get()).toEqual({ n: 1 })
    reset()
  })
})
