import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../server.js'
import { closeDb } from '../db/index.js'

let server: FastifyInstance
let base: string
let tempDir: string

const ATTACKER = 'https://attacker.example'
const SAME_ORIGIN = 'http://localhost:5173'   // the dev server on another localhost port

async function send(method: string, path: string, origin?: string, body?: unknown): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.status
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-csrf-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14368, join(tempDir, 'test.db'))
  base = 'http://localhost:14368'
})
afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

// Every mutating API route must refuse a cross-site Origin — otherwise a page the user
// visits can script the local API, and a command agent + benchmark is code execution.
const MUTATING: [string, string, unknown][] = [
  ['POST', '/api/targets', { kind: 'agent', name: 'x', config: { transport: 'command', command: 'node evil.js', timeoutMs: 8000, maxSteps: 40, retries: 0 } }],
  ['POST', '/api/benchmark', { prompts: ['hi'], models: ['openai:gpt-4o'] }],
  ['POST', '/api/datasets', { name: 'd', type: 'files' }],
  ['POST', '/api/metrics/validate', { expression: 'ttfs', scope: 'answer' }],
  ['POST', '/api/metrics/preview', { expression: 'ttfs', scope: 'answer' }],
  ['DELETE', '/api/logs', undefined],
  ['POST', '/api/uploads', undefined],
]

describe('CSRF: mutating API refuses a cross-site Origin', () => {
  for (const [method, path, body] of MUTATING) {
    it(`${method} ${path} → 403 from ${ATTACKER}`, async () => {
      expect(await send(method, path, ATTACKER, body)).toBe(403)
    })
  }

  it('the two confirmed P0s specifically: targets create + benchmark start are 403 cross-site', async () => {
    expect(await send('POST', '/api/targets', ATTACKER, { kind: 'agent', name: 'a', config: { transport: 'command', command: 'calc', timeoutMs: 8000, maxSteps: 40, retries: 0 } })).toBe(403)
    expect(await send('POST', '/api/benchmark', ATTACKER, { prompts: ['x'], models: ['openai:gpt-4o'] })).toBe(403)
  })

  it('a same-origin (localhost dev-server) request is NOT refused as cross-site', async () => {
    // May be 201/400/etc. depending on the body — the point is it is never 403.
    expect(await send('POST', '/api/metrics/validate', SAME_ORIGIN, { expression: 'ttfs', scope: 'answer' })).not.toBe(403)
  })

  it('an Origin-less request (benchy UI / server-to-server) is allowed through', async () => {
    expect(await send('POST', '/api/metrics/validate', undefined, { expression: 'ttfs', scope: 'answer' })).not.toBe(403)
  })

  it('a legitimate (Origin-less) read still works — the guard only touches mutations', async () => {
    expect(await send('GET', '/api/providers', undefined)).toBe(200)
  })

  it('a cross-site read is also refused — by the CORS layer, before the handler', async () => {
    // Not this guard (it exempts GET), but the localhost-only CORS origin: the two
    // together mean nothing cross-site reaches a handler.
    expect(await send('GET', '/api/providers', ATTACKER)).toBe(403)
  })
})
