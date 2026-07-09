// @vitest-environment node
// Upload contract tests run in node (not jsdom like the rest of frontend/):
// jsdom's FormData/File don't interoperate with Node's fetch — serialization
// hangs. Node's own FormData/File exercise the same client code path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../../src/server'
import { closeDb } from '../../src/db/index'
import type { FastifyInstance } from 'fastify'
import { providersApi, runsApi, benchmarkApi, uploadsApi } from './api'

const PORT = 14401
const BASE = `http://localhost:${PORT}`

let server: FastifyInstance
let tempDir: string
const realFetch = globalThis.fetch

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-uploads-contract-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(PORT, join(tempDir, 'test.db'))

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

describe('uploads client ↔ real server contract', () => {
  it('multipart upload goes through the real client and binds to a run', async () => {
    // Multipart is exactly the seam unit tests never touch: the client must
    // NOT set a JSON Content-Type or the boundary is lost.
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], 'shot.png', { type: 'image/png' })
    const meta = await uploadsApi.upload(png)
    expect(meta.id).toBeTruthy()
    expect(meta.name).toBe('shot.png')
    expect(meta.mimeType).toBe('image/png')

    const res = await fetch(uploadsApi.url(meta.id))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')

    const saved = await providersApi.upsert({
      name: 'Мок для вложений',
      type: 'openai-compatible',
      apiKey: 'sk-x',
      baseUrl: 'http://localhost:1/v1',
      models: ['gemma4:26b'],
      enabled: true,
    })
    const { runId } = await benchmarkApi.start({
      prompts: ['что на картинке?'],
      models: [`${saved.id}:gemma4:26b`],
      attachments: [meta.id],
    })
    await waitForRunDone(runId)

    const run = await runsApi.get(runId)
    expect(run.attachments).toEqual([expect.objectContaining({ id: meta.id, promptIndex: 0, name: 'shot.png' })])
  })

  it('upload of an unsupported type surfaces the backend allowlist error', async () => {
    const txt = new File(['hello'], 'x.txt', { type: 'text/plain' })
    await expect(uploadsApi.upload(txt)).rejects.toThrow(/text\/plain/)
  })
})
