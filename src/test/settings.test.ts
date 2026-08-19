import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb } from '../db/index.js'
import type { FastifyInstance } from 'fastify'
import type { AppSettings } from '../config.js'
import type { Provider } from '../types.js'

// /api/settings grew from one boolean to three keys, two of which reach a
// provider or a subprocess. Everything here is about the two ways that goes
// wrong: a value that should never have been stored, and a partial write.

let server: FastifyInstance
let base: string
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-settings-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14395, join(tempDir, 'test.db'))
  base = 'http://localhost:14395'
})

afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

const configPath = () => join(tempDir, 'config.json')

beforeEach(() => {
  rmSync(configPath(), { force: true })
})

interface ApiResult {
  status: number
  body: { data?: unknown; error?: string }
}

async function req(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: await res.json() as { data?: unknown; error?: string } }
}

const settings = (r: ApiResult) => r.body.data as AppSettings

async function get(): Promise<AppSettings> {
  return settings(await req('GET', '/api/settings'))
}

describe('GET /api/settings', () => {
  it('answers with the defaults on a fresh install, and writes nothing to do it', async () => {
    expect(await get()).toEqual({ codeExecution: false, codeExecTimeoutMs: 10_000, runDefaults: {}, disabledMetrics: ['reasoning_ms'] })
    // A read that creates config.json would turn "never configured" into
    // "configured with today's defaults", freezing them for that install.
    expect(existsSync(configPath())).toBe(false)
  })
})

describe('PUT /api/settings — patch semantics', () => {
  it('leaves the keys it was not given alone, and echoes the whole blob', async () => {
    await req('PUT', '/api/settings', { codeExecTimeoutMs: 30_000 })
    const after = settings(await req('PUT', '/api/settings', { codeExecution: true }))
    expect(after).toEqual({ codeExecution: true, codeExecTimeoutMs: 30_000, runDefaults: {}, disabledMetrics: ['reasoning_ms'] })
  })

  it('stores run defaults and hands them back', async () => {
    const after = settings(await req('PUT', '/api/settings', {
      runDefaults: { temperature: 0.2, maxOutputTokens: 8000 },
    }))
    expect(after.runDefaults).toEqual({ temperature: 0.2, maxOutputTokens: 8000 })
  })

  // Auto in the UI means "inherit", which has to be storable as the ABSENCE of
  // the key — a stored 0.7 that happens to equal the factory default is not the
  // same thing, because it would keep overriding the provider's own value.
  it('unsets a run default when it is sent as null', async () => {
    await req('PUT', '/api/settings', { runDefaults: { temperature: 0.2, maxOutputTokens: 8000 } })
    const after = settings(await req('PUT', '/api/settings', { runDefaults: { temperature: null } }))
    expect(after.runDefaults).toEqual({ maxOutputTokens: 8000 })
    expect('temperature' in after.runDefaults).toBe(false)
  })
})

describe('PUT /api/settings — rejection', () => {
  const cases: [string, unknown][] = [
    ['codeExecution as a string', { codeExecution: 'yes' }],
    ['a timeout that is not a number', { codeExecTimeoutMs: '10s' }],
    ['a timeout below the floor', { codeExecTimeoutMs: 0 }],
    ['a timeout past the ceiling', { codeExecTimeoutMs: 999_999 }],
    ['runDefaults as an array', { runDefaults: [] }],
    ['a temperature out of range', { runDefaults: { temperature: 5 } }],
    ['a fractional token count', { runDefaults: { maxOutputTokens: 1.5 } }],
    ['a token count below the floor', { runDefaults: { maxOutputTokens: 0 } }],
  ]

  for (const [what, body] of cases) {
    it(`refuses ${what} and writes nothing`, async () => {
      const res = await req('PUT', '/api/settings', body)
      expect(res.status).toBe(400)
      expect(existsSync(configPath())).toBe(false)
    })
  }

  // With a single setting the handler could not half-apply. With three it can:
  // writing codeExecution before discovering the timeout is bad would leave
  // code execution enabled by a request the caller was told had failed.
  it('applies nothing when any key in the request is invalid', async () => {
    const res = await req('PUT', '/api/settings', { codeExecution: true, codeExecTimeoutMs: -1 })
    expect(res.status).toBe(400)
    expect((await get()).codeExecution).toBe(false)
  })

  it('refuses a cross-site Origin for the new keys too', async () => {
    const res = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ codeExecTimeoutMs: 60_000, runDefaults: { temperature: 1.5 } }),
    })
    expect(res.status).toBe(403)
    expect(await get()).toEqual({ codeExecution: false, codeExecTimeoutMs: 10_000, runDefaults: {}, disabledMetrics: ['reasoning_ms'] })
  })
})

describe('PUT /api/settings — concurrency', () => {
  // Every setter does read → modify → write. Twenty concurrent saves used to
  // leave one provider and drop nineteen; a new setter that forgets to go
  // through the write queue reintroduces exactly that, on the file holding
  // every API key.
  it('applies twenty interleaved writes without dropping a provider', async () => {
    const { writeConfig } = await import('../config.js')
    const providers: Provider[] = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, type: 'openai', apiKey: `k${i}`, models: ['A'], enabled: true,
    }))
    await writeConfig({ providers })

    await Promise.all(Array.from({ length: 20 }, (_, i) => req('PUT', '/api/settings', i % 3 === 0
      ? { codeExecution: i % 2 === 0 }
      : i % 3 === 1
        ? { codeExecTimeoutMs: 1_000 + i * 100 }
        : { runDefaults: { temperature: i / 20 } })))

    const onDisk = JSON.parse(readFileSync(configPath(), 'utf8')) as { providers: Provider[] }
    expect(onDisk.providers.map(p => p.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])

    // And the blob still round-trips — a torn write would fail the read here.
    const after = await get()
    expect(after.codeExecTimeoutMs).toBeGreaterThanOrEqual(1_000)
    expect(after.runDefaults.temperature).toBeGreaterThanOrEqual(0)
  })
})

describe('config.json is a boundary too', () => {
  // The file is meant to be hand-editable, so a typed value has to be clamped
  // on the way OUT as well — it never passed through the route that validates.
  it('clamps a hand-edited value instead of handing it to a provider', async () => {
    const { writeConfig } = await import('../config.js')
    await writeConfig({
      providers: [],
      codeExecTimeoutMs: 9_999_999,
      runDefaults: { temperature: 99, maxOutputTokens: -4 },
    })
    const after = await get()
    expect(after.codeExecTimeoutMs).toBe(120_000)
    expect(after.runDefaults).toEqual({ temperature: 2, maxOutputTokens: 1 })
  })

  it('ignores a hand-edited value of the wrong type rather than failing the read', async () => {
    const { writeConfig } = await import('../config.js')
    await writeConfig({
      providers: [],
      codeExecTimeoutMs: Number.NaN,
      runDefaults: { temperature: Number.NaN },
    })
    expect(await get()).toEqual({ codeExecution: false, codeExecTimeoutMs: 10_000, runDefaults: {}, disabledMetrics: ['reasoning_ms'] })
  })
})
