import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb } from '../db/index.js'
import type { FastifyInstance } from 'fastify'

// A non-streaming POST is the cheapest probe: when the mock adapter is
// registered it answers with its own signature error; when it isn't, the
// request falls through (SPA fallback / 404) and that string is nowhere in the
// body. So we assert on the signature, not the status code.
const MOCK_SIGNATURE = /mock adapter requires/
async function probeMock(base: string): Promise<string> {
  const res = await fetch(`${base}/api/mock/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
  })
  return res.text()
}

let server: FastifyInstance | null = null
let dir: string | null = null

afterEach(async () => {
  if (server) { await server.close(); server = null }
  closeDb()
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null }
  delete process.env.BENCHY_DIR
})

describe('mock adapter is dev-only', () => {
  it('registers /api/mock under ~/.benchy-dev', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'benchy-mock-'))
    dir = parent
    const devDir = join(parent, '.benchy-dev')
    mkdirSync(devDir)
    process.env.BENCHY_DIR = devDir
    server = await createServer(14360, join(devDir, 'test.db'))
    expect(await probeMock('http://localhost:14360')).toMatch(MOCK_SIGNATURE)
  })

  it('does not register /api/mock in a production install', async () => {
    dir = mkdtempSync(join(tmpdir(), 'benchy-prod-'))
    process.env.BENCHY_DIR = dir
    server = await createServer(14361, join(dir, 'test.db'))
    expect(await probeMock('http://localhost:14361')).not.toMatch(MOCK_SIGNATURE)
  })
})
