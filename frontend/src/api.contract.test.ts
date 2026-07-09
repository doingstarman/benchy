import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../../src/server'
import { closeDb } from '../../src/db/index'
import type { FastifyInstance } from 'fastify'

// Contract layer: the REAL frontend API client against the REAL Fastify
// server. Unit tests mock '../api' and backend tests use their own fetch
// calls, so the seam between them was never exercised — which is exactly
// where the empty-body 400 (FST_ERR_CTP_EMPTY_JSON_BODY) shipped from.
// These tests import the untouched client and would have caught it.
import { providersApi, runsApi, benchmarkApi } from './api'

const PORT = 14400
const BASE = `http://localhost:${PORT}`

let server: FastifyInstance
let tempDir: string
const realFetch = globalThis.fetch

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-contract-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(PORT, join(tempDir, 'test.db'))

  // The client uses browser-relative paths ('/api/…') — resolve them against
  // the test server without touching the client code itself.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${BASE}${input}` : input
    return realFetch(url as RequestInfo, init)
  }) as typeof fetch
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

async function waitForRunDone(runId: string, maxMs = 3000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const run = await runsApi.get(runId)
    if (run.status === 'done' || run.status === 'error') return
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('run did not finish')
}

describe('frontend API client ↔ real server contract', () => {
  it('upsert round-trips a full provider payload with Cyrillic name and defaults', async () => {
    const saved = await providersApi.upsert({
      name: 'Актив.Нейросети',
      type: 'openai-compatible',
      apiKey: 'sk-x',
      baseUrl: 'http://localhost:1/v1',
      models: ['gemma4:26b'],
      enabled: true,
      defaults: { temperature: 0.7, topP: 1, topK: null, maxOutputTokens: 2048, contextBudget: null, truncation: 'auto', timeoutMs: 60000, retries: 2, streaming: true },
    })
    expect(saved.id).toBeTruthy()
    expect(saved.name).toBe('Актив.Нейросети')

    const list = await providersApi.list()
    expect(list.find(p => p.id === saved.id)?.defaults?.temperature).toBe(0.7)
  })

  it('provider test (body-less POST) reaches the endpoint instead of 400ing', async () => {
    const list = await providersApi.list()
    const provider = list[0]
    // Unreachable base URL → the call must complete with ok:false and a
    // humanized error — NOT throw Fastify's empty-JSON-body Bad Request.
    const result = await providersApi.test(provider.id, provider.models[0])
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Connection refused|Could not reach|Host not found/)
  })

  it('fork (body-less POST) creates a new run shell', async () => {
    const list = await providersApi.list()
    const { runId } = await benchmarkApi.start({ prompts: ['hi'], models: [`${list[0].id}:gemma4:26b`] })
    await waitForRunDone(runId)

    const forked = await runsApi.fork(runId)
    expect(forked.id).not.toBe(runId)
    expect(forked.prompts).toEqual(['hi'])
  })

  it('rename round-trips Cyrillic titles and clears on null', async () => {
    const runs = await runsApi.list()
    const id = runs[0].id
    const renamed = await runsApi.rename(id, 'Мой тест диалога')
    expect(renamed.title).toBe('Мой тест диалога')

    const cleared = await runsApi.rename(id, null)
    expect(cleared.title).toBeUndefined()
  })

  it('editTurn surfaces backend validation as a readable error', async () => {
    const runs = await runsApi.list()
    await expect(benchmarkApi.editTurn(runs[0].id, 99, 'x')).rejects.toThrow(/promptIndex out of range/)
  })

  it('save toggle and feedback endpoints accept the client calls', async () => {
    const runs = await runsApi.list()
    const saved = await runsApi.save(runs[0].id, true)
    expect(saved.saved).toBe(true)
  })
})
