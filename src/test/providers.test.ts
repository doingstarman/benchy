import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb } from '../db/index.js'
import type { FastifyInstance } from 'fastify'
import type { Provider } from '../types.js'

let server: FastifyInstance
let base: string
let tempDir: string
let port: number

beforeAll(async () => {
  port = 14300
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-providers-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(port, join(tempDir, 'test.db'))
  base = `http://localhost:${port}`
})

afterAll(async () => {
  await server.close()
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
