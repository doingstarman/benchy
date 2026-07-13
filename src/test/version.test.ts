import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb } from '../db/index.js'
import { isNewer, type BuildVersion } from '../version.js'
import type { FastifyInstance } from 'fastify'

let server: FastifyInstance
let base: string
let tempDir: string

const build = (builtAt: string | null): BuildVersion => ({ sha: 'abc1234', commitDate: null, builtAt })

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-version-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14360, join(tempDir, 'test.db'))
  base = 'http://localhost:14360'
})

afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

describe('update comparison', () => {
  it('flags an update only when the upstream build is strictly newer', () => {
    const mine = build('2026-07-01T10:00:00.000Z')
    expect(isNewer(build('2026-07-02T10:00:00.000Z'), mine)).toBe(true)
    expect(isNewer(build('2026-07-01T10:00:00.000Z'), mine)).toBe(false) // same build
    expect(isNewer(build('2026-06-30T10:00:00.000Z'), mine)).toBe(false) // older upstream
  })

  it('never nags a dev build, and never nags when upstream is unknown', () => {
    // Dev builds carry no stamp — offering an "update" there is meaningless.
    expect(isNewer(build('2026-07-02T10:00:00.000Z'), build(null))).toBe(false)
    // Upstream unreachable / not published yet.
    expect(isNewer(null, build('2026-07-01T10:00:00.000Z'))).toBe(false)
    expect(isNewer(build(null), build('2026-07-01T10:00:00.000Z'))).toBe(false)
  })

  it('refuses to compare a malformed upstream stamp instead of pinning a phantom banner', () => {
    const mine = build('2026-07-01T10:00:00.000Z')
    // A lexically-large garbage string would beat any real ISO date and stick a
    // banner that updating can never clear. Every one of these must be inert.
    const hostile: unknown[] = [
      'unknown', 'z', '9999', 'tomorrow', '2026-07-02', '2026-07-02T10:00:00+03:00',
      1783931731633, true, null, undefined, {}, [], { builtAt: {} },
    ]
    for (const builtAt of hostile) {
      const latest = { sha: 'x', commitDate: null, builtAt } as unknown as BuildVersion
      expect(isNewer(latest, mine), `builtAt=${JSON.stringify(builtAt)}`).toBe(false)
    }
    // …while a well-formed one still works, so the guard isn't just "always false".
    expect(isNewer(build('2026-07-02T10:00:00.000Z'), mine)).toBe(true)
  })
})

describe('GET /api/version', () => {
  it('reports this install: build identity, real runtime paths, and repo URL', async () => {
    const res = await fetch(`${base}/api/version`)
    expect(res.status).toBe(200)
    const { data } = await res.json() as {
      data: {
        current: BuildVersion
        hasUpdate: boolean
        repoUrl: string
        checkError: string | null
        runtime: { port: number | null; configPath: string; dbPath: string }
      }
    }

    // Running from source in tests → a dev build, which must never claim an update.
    expect(data.current.sha).toBe('dev')
    expect(data.hasUpdate).toBe(false)

    expect(data.repoUrl).toBe('https://github.com/doingstarman/benchy')
    // The Settings screen renders these — they must reflect THIS install, not
    // a hardcoded dev guess.
    expect(data.runtime.port).toBe(14360)
    expect(data.runtime.configPath).toBe(join(tempDir, 'config.json'))
    expect(data.runtime.dbPath).toBe(join(tempDir, 'benchy.db'))

    // 'network' means we couldn't reach GitHub. It must not be reported when we
    // could — that message tells the user to fix a connection that isn't broken.
    expect(data.checkError === null || data.checkError === 'missing' || data.checkError === 'network').toBe(true)
  })
})
