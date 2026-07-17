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
    seenPaths.length = 0
    const res = await post<{ data: string[] }>('/api/providers/models', {
      type: 'openai-compatible', apiKey: 'k', baseUrl: `${UPSTREAM}/`,
    })
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

  it('answers honestly when there is no model to test', async () => {
    const res = await post<{ error: string }>('/api/providers/test', { type: 'openai-compatible', baseUrl: UPSTREAM })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/No models configured/)
  })
})

describe('probing a draft', () => {
  it('lists and tests what the form holds, without saving it', async () => {
    const before = await get<{ data: Provider[] }>('/api/providers')

    const listed = await post<{ data: string[] }>('/api/providers/models', {
      type: 'openai-compatible', apiKey: 'sk-draft', baseUrl: UPSTREAM,
    })
    expect(listed.body.data).toEqual(['model-a', 'model-b'])

    const tested = await post<{ data: { ok: boolean; error?: string } }>('/api/providers/test', {
      type: 'openai-compatible', apiKey: 'sk-draft', baseUrl: 'http://127.0.0.1:1/v1', model: 'model-a',
    })
    expect(tested.body.data.ok).toBe(false)

    // Both used to upsert first: probing a draft stored it, and Cancel could no
    // longer take it back.
    const after = await get<{ data: Provider[] }>('/api/providers')
    expect(after.body.data.map(p => p.id).sort()).toEqual(before.body.data.map(p => p.id).sort())
  })

  it('keeps the real auth error when the anonymous retry also fails', async () => {
    // The retry overwrote the keyed response, so a revoked key was reported as
    // "missing bearer authentication" — blaming a header we deliberately left
    // out, and burying the one thing the user needed to know.
    const srv = createHttpServer((req, res) => {
      if (req.url !== '/v1/models') { res.writeHead(404); res.end(); return }
      if (req.headers.authorization) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Your API key was revoked. Rotate it in the dashboard.' } }))
      } else {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Missing bearer authentication in header' } }))
      }
    })
    await new Promise<void>(r => srv.listen(14303, '127.0.0.1', r))
    try {
      const res = await post<{ error: string }>('/api/providers/models', {
        type: 'openai-compatible', apiKey: 'sk-revoked', baseUrl: 'http://127.0.0.1:14303/v1',
      })
      expect(res.status).toBe(502)
      expect(res.body.error).toMatch(/revoked/)
      expect(res.body.error).not.toMatch(/Missing bearer/)
    } finally {
      await new Promise<void>(r => srv.close(() => r()))
    }
  })

  it('says something actionable when the endpoint answers 200 with HTML', async () => {
    // A captive portal or proxy. A raw JSON parser error is not a thing a user
    // can do anything about.
    const srv = createHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body>Sign in to the network</body></html>')
    })
    await new Promise<void>(r => srv.listen(14304, '127.0.0.1', r))
    try {
      const res = await post<{ error: string }>('/api/providers/models', {
        type: 'openai-compatible', baseUrl: 'http://127.0.0.1:14304/v1',
      })
      expect(res.status).toBe(502)
      expect(res.body.error).toMatch(/without a model list/)
      expect(res.body.error).not.toMatch(/Unexpected token/)
    } finally {
      await new Promise<void>(r => srv.close(() => r()))
    }
  })

  it('refuses an unknown type instead of quietly shipping the key to OpenAI', async () => {
    // getAdapter's fallback is the OpenAI adapter, so an unrecognised type sent
    // the user's key to api.openai.com — nowhere near where they pointed it.
    for (const path of ['/api/providers/test', '/api/providers/models']) {
      const res = await post<{ error: string }>(path, { type: 'nope', apiKey: 'sk-leak', model: 'x' })
      expect(res.status, path).toBe(400)
      expect(res.body.error, path).toMatch(/type/i)
    }
    const saved = await post<{ error: string }>('/api/providers', { name: 'X', type: 'nope', models: [] })
    expect(saved.status).toBe(400)
  })

  it('falls back to an anonymous catalogue request when the key is refused', async () => {
    // OpenRouter's /models is public and 403s a restricted key — the very key
    // that streams completions fine. Refusing the key must not cost the list.
    const guarded = createHttpServer((req, res) => {
      if (req.url !== '/v1/models') { res.writeHead(404); res.end(); return }
      if (req.headers.authorization) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'this key lacks permission' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'public-1' }, { id: 'public-2' }] }))
    })
    await new Promise<void>(r => guarded.listen(14302, '127.0.0.1', r))
    try {
      const res = await post<{ data: string[] }>('/api/providers/models', {
        type: 'openai-compatible', apiKey: 'sk-restricted', baseUrl: 'http://127.0.0.1:14302/v1',
      })
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual(['public-1', 'public-2'])
    } finally {
      await new Promise<void>(r => guarded.close(() => r()))
    }
  })
})
