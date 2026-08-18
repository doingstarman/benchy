import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer as createHttpServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb } from '../db/index.js'
import type { FastifyInstance } from 'fastify'
import type { Provider, ProviderView } from '../types.js'

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
// Which Authorization the upstream actually received — the only way to tell
// whose key the backend chose when both a stored one and a typed one exist.
const seenAuth: (string | undefined)[] = []
function lastAuth(): string | undefined {
  return seenAuth[seenAuth.length - 1]
}

beforeAll(async () => {
  port = 14300
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-providers-'))
  process.env.BENCHY_DIR = tempDir

  upstream = createHttpServer((req, res) => {
    seenPaths.push(req.url ?? '')
    seenAuth.push(req.headers.authorization)
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
  seenAuth.length = 0
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

    const { body } = await get<{ data: ProviderView[] }>('/api/providers')
    expect(body.data).toHaveLength(1)
    expect(body.data[0].models).toHaveLength(2)
    // The API answers with a mask; the key itself is checked on disk below.
    expect(body.data[0].apiKeyMask).toBe('•'.repeat(16) + '-key')
    const { readConfig } = await import('../config.js')
    expect((await readConfig()).providers[0].apiKey).toBe('new-key')
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

describe('per-model price override', () => {
  it('round-trips valid prices and drops malformed / negative entries', async () => {
    const { status, body } = await post<{ data: Provider }>('/api/providers', {
      name: 'Priced', type: 'openai-compatible', baseUrl: UPSTREAM, models: ['a', 'b', 'c'],
      pricing: {
        a: { inputPer1M: 3, outputPer1M: 12 },   // kept
        b: { inputPer1M: -1, outputPer1M: 5 },    // dropped: negative
        c: { inputPer1M: 'x', outputPer1M: 2 },   // dropped: not a number
      },
    })
    expect(status).toBe(201)
    expect(body.data.pricing).toEqual({ a: { inputPer1M: 3, outputPer1M: 12 } })

    // Persists and comes back through the masked view (pricing is not a secret).
    const listed = await get<{ data: Provider[] }>('/api/providers')
    expect(listed.body.data[0].pricing).toEqual({ a: { inputPer1M: 3, outputPer1M: 12 } })
  })

  it('stores nothing when no entry is valid', async () => {
    const { body } = await post<{ data: Provider }>('/api/providers', {
      name: 'NoPrice', type: 'openai-compatible', baseUrl: UPSTREAM, models: ['a'],
      pricing: { a: { inputPer1M: 'nope' } },
    })
    expect(body.data.pricing).toBeUndefined()
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

// benchy is unauthenticated on localhost, so while it runs, any page the user
// has open can script requests to it. Every route in this file reads or writes
// API keys, so every one of them has to refuse a cross-site Origin — GET most
// of all, because that is the one that hands the keys back.
describe('Providers API — cross-site requests', () => {
  const EVIL = 'https://evil.example.com'

  async function asEvil(path: string, init: RequestInit = {}) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Origin: EVIL, ...(init.headers ?? {}) },
    })
    return { status: res.status, text: await res.text(), headers: res.headers }
  }

  async function seedKeyedProvider() {
    await post('/api/providers', {
      name: 'Secret', type: 'openai', apiKey: 'sk-SUPER-SECRET-KEY-123', models: ['gpt-4o'],
    })
  }

  it('refuses to hand a foreign page the provider list', async () => {
    await seedKeyedProvider()
    const { status, text } = await asEvil('/api/providers')

    expect(status).toBe(403)
    // The exploit was worth having because the body carried the key itself.
    expect(text).not.toContain('sk-')
  })

  it('does not tell the browser a foreign page may read the response', async () => {
    // Belt and braces: even a route that answered would be unreadable, because
    // the reflected Access-Control-Allow-Origin is what made this exploitable
    // from a browser rather than just from curl.
    const { headers } = await asEvil('/api/providers')
    expect(headers.get('access-control-allow-origin')).not.toBe(EVIL)
  })

  it('refuses cross-site writes, probes and deletes too', async () => {
    await seedKeyedProvider()
    const { body } = await get<{ data: Provider[] }>('/api/providers')
    const id = body.data[0].id

    for (const [path, init] of [
      ['/api/providers', { method: 'POST', body: JSON.stringify({ name: 'x', type: 'openai', models: [] }) }],
      ['/api/providers/models', { method: 'POST', body: JSON.stringify({ type: 'openai' }) }],
      ['/api/providers/test', { method: 'POST', body: JSON.stringify({ type: 'openai', model: 'gpt-4o' }) }],
      [`/api/providers/${id}`, { method: 'DELETE' }],
    ] as [string, RequestInit][]) {
      expect((await asEvil(path, init)).status, `${init.method} ${path}`).toBe(403)
    }

    // The delete really was refused, not merely reported as refused.
    const after = await get<{ data: Provider[] }>('/api/providers')
    expect(after.body.data).toHaveLength(1)
  })

  it('still serves benchy itself — no Origin, and the dev server on another port', async () => {
    await seedKeyedProvider()

    // The app's own fetches are same-origin and send no Origin at all.
    expect((await get<{ data: Provider[] }>('/api/providers')).status).toBe(200)

    // `npm run dev` is Vite on 5173 talking to the backend on 4243. If this
    // breaks, the fix is unshippable however secure it is.
    const res = await fetch(`${base}/api/providers`, { headers: { Origin: 'http://localhost:5173' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })
})

// The CORS fix stops a browser reading the key. This is the other half: the key
// is not in the response to begin with, so it never reaches page memory, an
// error report, or whatever a devtools screenshot ends up in.
describe('Providers API — the key stays on the backend', () => {
  async function seed(apiKey: string) {
    const { body } = await post<{ data: ProviderView }>('/api/providers', {
      name: 'Secret', type: 'openai', apiKey, models: ['gpt-4o'], enabled: true,
    })
    return body.data.id
  }

  async function storedKey(id: string) {
    const { readConfig } = await import('../config.js')
    return (await readConfig()).providers.find(p => p.id === id)?.apiKey
  }

  it('never puts the key in a response, on read or on write', async () => {
    const { body: created } = await post<{ data: ProviderView }>('/api/providers', {
      name: 'Secret', type: 'openai', apiKey: 'sk-SUPER-SECRET-KEY-123', models: ['gpt-4o'], enabled: true,
    })
    const list = await get<{ data: ProviderView[] }>('/api/providers')

    for (const payload of [created, list.body]) {
      expect(JSON.stringify(payload)).not.toContain('sk-SUPER-SECRET-KEY-123')
      expect(JSON.stringify(payload)).not.toContain('"apiKey"')
    }
    // What the UI renders instead: enough to tell two keys apart, useless alone.
    expect(list.body.data[0].apiKeyMask).toBe('•'.repeat(16) + '-123')
  })

  it('reports no key as null rather than as a row of dots', async () => {
    await post('/api/providers', {
      name: 'Local', type: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', models: ['m'], enabled: true,
    })
    const { body } = await get<{ data: ProviderView[] }>('/api/providers')
    // isProviderActive keys off this, so "" and null must not be confusable.
    expect(body.data[0].apiKeyMask).toBeNull()
  })

  // The client cannot echo a key it was never given, so an edit that does not
  // mention apiKey has to mean "leave it alone". Getting this wrong wipes the
  // key on every rename — the most ordinary edit there is.
  it('keeps the stored key when a save omits apiKey', async () => {
    const id = await seed('sk-keep-me-1234')

    await post('/api/providers', {
      id, name: 'Renamed', type: 'openai', models: ['gpt-4o', 'gpt-4o-mini'], enabled: true,
    })

    expect(await storedKey(id)).toBe('sk-keep-me-1234')
    const { body } = await get<{ data: ProviderView[] }>('/api/providers')
    expect(body.data[0].name).toBe('Renamed')
    expect(body.data[0].apiKeyMask).toBe('•'.repeat(16) + '1234')
  })

  it('erases the key on an explicit empty string', async () => {
    const id = await seed('sk-drop-me-9999')

    await post('/api/providers', {
      id, name: 'Secret', type: 'openai', apiKey: '', models: ['gpt-4o'], enabled: true,
    })

    expect(await storedKey(id)).toBeUndefined()
    const { body } = await get<{ data: ProviderView[] }>('/api/providers')
    expect(body.data[0].apiKeyMask).toBeNull()
  })

  it('probes a saved provider by id, so the UI need not hold the key', async () => {
    const id = await seed('sk-stored-key')

    // /models against the local upstream: it 404s an unauthorised request, so a
    // 200 with the model list is proof the backend supplied the stored key.
    const { status, body } = await post<{ data: string[] }>('/api/providers/models', {
      type: 'openai-compatible', baseUrl: UPSTREAM, providerId: id,
    })

    expect(status).toBe(200)
    expect(body.data).toEqual(['model-a', 'model-b'])
  })

  it('prefers a key typed into the form over the stored one', async () => {
    // Replacing a key must be testable before it is saved, or "Test connection"
    // would be checking the key you are about to discard.
    const id = await seed('sk-stored-key')
    await post('/api/providers/models', {
      type: 'openai-compatible', baseUrl: UPSTREAM, providerId: id, apiKey: 'sk-typed-in-form',
    })
    expect(lastAuth()).toBe('Bearer sk-typed-in-form')
  })

  it('sends no key at all for an unknown providerId', async () => {
    await post('/api/providers/models', {
      type: 'openai-compatible', baseUrl: UPSTREAM, providerId: 'no-such-provider',
    })
    expect(lastAuth()).toBeUndefined()
  })
})
