import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer as createHttpServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb } from '../db/index.js'
import type { FastifyInstance } from 'fastify'

// NOTE: no adapter mocks here on purpose — these tests exercise the REAL
// http-json and script adapters. They exist because a grep for "attachment"
// finds nothing in those files, which reads like a silent drop; in fact they
// serialize the whole Message[], so attachments ride along. That is a contract,
// not an accident, and a future refactor that maps/strips messages would break
// custom integrations invisibly. Pin it.

let server: FastifyInstance
let echo: Server
let base: string
let echoUrl: string
let tempDir: string
interface EchoBody {
  messages?: Array<{ role: string; content: string; attachments?: Array<{ mimeType: string; data: string; name: string }> }>
}
let lastBody: EchoBody | null = null
// Reset through a function: a direct `lastBody = null` in the test would let
// control-flow analysis narrow it to `never`, since it can't see the echo
// server's callback writing to it.
const resetEcho = () => { lastBody = null }

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-custom-'))
  process.env.BENCHY_DIR = tempDir

  echo = createHttpServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += String(c) })
    req.on('end', () => {
      lastBody = JSON.parse(raw) as typeof lastBody
      const n = lastBody?.messages?.at(-1)?.attachments?.length ?? 0
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ text: `received ${n} attachment(s)` }))
    })
  })
  await new Promise<void>(r => echo.listen(14371, '127.0.0.1', r))
  echoUrl = 'http://127.0.0.1:14371'

  server = await createServer(14370, join(tempDir, 'test.db'))
  base = 'http://localhost:14370'
})

afterAll(async () => {
  await server.close()
  await new Promise<void>(r => echo.close(() => r()))
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, init)
  const json = await res.json() as { data: T; error?: string }
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json.data
}

async function uploadPng(name: string): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([PNG], { type: 'image/png' }), name)
  const { id } = await api<{ id: string }>('/api/uploads', { method: 'POST', body: form })
  return id
}

async function runWith(model: string, attachmentId: string): Promise<{ text: string; error: string | null }> {
  const { runId } = await api<{ runId: string }>('/api/benchmark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompts: ['what is in this image?'], models: [model], attachments: [attachmentId] }),
  })
  for (let i = 0; i < 100; i++) {
    const run = await api<{ status: string; results: Array<{ text: string; error: string | null }> }>(`/api/runs/${runId}`)
    if (run.status === 'done' || run.status === 'error') return run.results[0]
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('run did not finish')
}

describe('custom integrations carry attachments', () => {
  it('http-json posts the attachment (base64 + mime + name) to the endpoint', async () => {
    const provider = await api<{ id: string }>('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Echo', type: 'http-json', baseUrl: echoUrl, models: ['echo-1'], enabled: true }),
    })

    resetEcho()
    const id = await uploadPng('pic.png')
    const result = await runWith(`${provider.id}:echo-1`, id)

    expect(result.error).toBeNull()
    // The endpoint saw it — not a silent drop.
    expect(result.text).toContain('received 1 attachment')

    const sent = lastBody?.messages?.at(-1)
    expect(sent?.attachments).toHaveLength(1)
    expect(sent!.attachments![0].mimeType).toBe('image/png')
    expect(sent!.attachments![0].name).toBe('pic.png')
    // The bytes actually arrive, not just the metadata.
    expect(Buffer.from(sent!.attachments![0].data, 'base64').equals(PNG)).toBe(true)
  })

  it('script receives the attachment on stdin', async () => {
    const scriptPath = join(tempDir, 'echo-script.mjs')
    writeFileSync(scriptPath, `
      let raw = ''
      process.stdin.on('data', c => { raw += c })
      process.stdin.on('end', () => {
        const { messages } = JSON.parse(raw)
        const att = messages.at(-1).attachments ?? []
        const first = att[0]
        process.stdout.write(first ? \`got \${att.length} \${first.mimeType} \${first.name} bytes=\${Buffer.from(first.data, 'base64').length}\` : 'got none')
      })
    `)

    const provider = await api<{ id: string }>('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Script', type: 'script', baseUrl: `node ${scriptPath}`, models: ['s1'], enabled: true }),
    })

    const id = await uploadPng('shot.png')
    const result = await runWith(`${provider.id}:s1`, id)

    expect(result.error).toBeNull()
    expect(result.text).toContain(`got 1 image/png shot.png bytes=${PNG.length}`)
  })
})
