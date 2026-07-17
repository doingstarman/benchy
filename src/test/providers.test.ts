import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer as createHttpServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb } from '../db/index.js'
import type { FastifyInstance } from 'fastify'
import type { Provider } from '../types.js'

let server: FastifyInstance
let upstream: Server
let base: string
let tempDir: string
let port: number

// A well-behaved OpenAI-compatible endpoint: it serves /v1/models and nothing
// else, so a double slash is a different path and 404s — exactly like the real
// ones do.
const UPSTREAM = 'http://127.0.0.1:14301/v1'
const seenPaths: string[] = []

beforeAll(async () => {
  port = 14300
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-providers-'))
  process.env.BENCHY_DIR = tempDir

  upstream = createHttpServer((req, res) => {
    seenPaths.push(req.url ?? '')
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }))
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise<void>(r => upstream.listen(14301, '127.0.0.1', r))

  server = await createServer(port, join(tempDir, 'test.db'))
  base = `http://localhost:${port}`
})

afterAll(async () => {
  await server.close()
  await new Promise<void>(r => upstream.close(() => r()))
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

// Wipe config between tests
beforeEach(async () => {
  const { writeConfig } = await import('../config.js')
  await writeConfig({ providers: [] })
})

async function get<T>(path: string) {
  const res = await fetch(`${base}${path}`)
  return { status: res.status, body: await res.json() as T }
}

async function post<T>(path: string, payload: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json() as T }
}

async function del(path: string) {
  const res = await fetch(`${base}${path}`, { method: 'DELETE' })
  return res.status
}

describe('Providers API — real HTTP + real config file', () => {
  it('GET /api/providers returns empty array initially', async () => {
    const { status, body } = await get<{ data: Provider[] }>('/api/providers')
    expect(status).toBe(200)
    expect(body.data).toEqual([])
  })

  it('POST /api/providers creates provider and persists to config.json', async () => {
    const { status, body } = await post<{ data: Provider }>('/api/providers', {
      name: 'OpenAI', type: 'openai', apiKey: 'sk-real', models: ['gpt-4o', 'gpt-4o-mini'], enabled: true,
    })
    expect(status).toBe(201)
    expect(body.data.name).toBe('OpenAI')
    expect(body.data.id).toBeTruthy()

    // Verify it was actually written to disk
    const { readConfig } = await import('../config.js')
    const config = await readConfig()
    expect(config.providers).toHaveLength(1)
    expect(config.providers[0].apiKey).toBe('sk-real')
  })

  it('GET /api/providers returns created provider', async () => {
    await post('/api/providers', { name: 'Groq', type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile'], enabled: true })
    const { body } = await get<{ data: Provider[] }>('/api/providers')
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Groq')
  })

  it('POST /api/providers with same id updates existing provider', async () => {
    const { body: created } = await post<{ data: Provider }>('/api/providers', {
      name: 'Anthropic', type: 'anthropic', apiKey: 'old-key', models: ['claude-haiku-4-5'], enabled: true,
    })
    const id = created.data.id

    await post('/api/providers', { id, name: 'Anthropic', type: 'anthropic', apiKey: 'new-key', models: ['claude-haiku-4-5', 'claude-opus-4-5'], enabled: true })

    const { body } = await get<{ data: Provider[] }>('/api/providers')
    expect(body.data).toHaveLength(1)
    expect(body.data[0].apiKey).toBe('new-key')
    expect(body.data[0].models).toHaveLength(2)
  })

  it('DELETE /api/providers/:id removes provider', async () => {
    const { body: created } = await post<{ data: Provider }>('/api/providers', {
      name: 'ToDelete', type: 'custom', models: [], enabled: true,
    })
    const id = created.data.id

    const status = await del(`/api/providers/${id}`)
    expect(status).toBe(204)

    const { body } = await get<{ data: Provider[] }>('/api/providers')
    expect(body.data.find(p => p.id === id)).toBeUndefined()
  })

  it('multiple providers coexist independently', async () => {
    await post('/api/providers', { name: 'A', type: 'openai', apiKey: 'a', models: ['m1'], enabled: true })
    await post('/api/providers', { name: 'B', type: 'anthropic', apiKey: 'b', models: ['m2'], enabled: true })
    await post('/api/providers', { name: 'C', type: 'google', apiKey: 'c', models: ['m3'], enabled: true })

    const { body } = await get<{ data: Provider[] }>('/api/providers')
    expect(body.data).toHaveLength(3)
    expect(body.data.map(p => p.name).sort()).toEqual(['A', 'B', 'C'])
  })
})

describe('a trailing slash in baseUrl', () => {
  it('does not make a working provider look broken', async () => {
    // "…/v1/" + "/models" was "…/v1//models" → 404, so Fetch models and Test
    // connection called a provider that ran benchmarks fine unreachable.
    const { body } = await post<{ data: Provider }>('/api/providers', {
      name: 'Slashy', type: 'openai-compatible', apiKey: 'k',
      baseUrl: `${UPSTREAM}/`, models: ['model-a'], enabled: true,
    })

    seenPaths.length = 0
    const res = await get<{ data: string[] }>(`/api/providers/${body.data.id}/models`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(['model-a', 'model-b'])
    expect(seenPaths).toEqual(['/v1/models'])
  })

  it('is normalized away on save, so it cannot bite the next caller', async () => {
    const { body } = await post<{ data: Provider }>('/api/providers', {
      name: 'Slashy2', type: 'openai-compatible',
      baseUrl: `${UPSTREAM}///`, models: ['model-a'], enabled: true,
    })
    expect(body.data.baseUrl).toBe(UPSTREAM)
  })
})

describe('provider validation at the boundary', () => {
  it('refuses a provider with no models array instead of storing a landmine', async () => {
    // It used to be stored with models: undefined, and the next read of
    // models[0] answered with a 500 leaking "Cannot read properties of
    // undefined (reading '0')".
    const missing = await post<{ error: string }>('/api/providers', {
      name: 'NoModels', type: 'openai-compatible', baseUrl: UPSTREAM,
    })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toMatch(/models/)

    const wrongType = await post<{ error: string }>('/api/providers', {
      name: 'BadModels', type: 'openai-compatible', models: 'not-an-array',
    })
    expect(wrongType.status).toBe(400)
  })

  it('refuses a nameless or typeless provider', async () => {
    expect((await post('/api/providers', { type: 'openai-compatible', models: [] })).status).toBe(400)
    expect((await post('/api/providers', { name: '   ', type: 'openai-compatible', models: [] })).status).toBe(400)
    expect((await post('/api/providers', { name: 'X', models: [] })).status).toBe(400)
  })

  it('answers honestly when a provider genuinely has no models to test', async () => {
    const { body } = await post<{ data: Provider }>('/api/providers', {
      name: 'Empty', type: 'openai-compatible', baseUrl: UPSTREAM, models: [], enabled: true,
    })
    // Body-less POST with no Content-Type — exactly how the UI calls this.
    const res = await fetch(`${base}/api/providers/${body.data.id}/test`, { method: 'POST' })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toMatch(/No models configured/)
  })
})
