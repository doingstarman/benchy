import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../server.js'
import { getDb, closeDb } from '../db/index.js'
import { logEvent, type LogRow } from '../logStore.js'

let server: FastifyInstance
let base: string
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-logs-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14364, join(tempDir, 'test.db'))
  base = 'http://localhost:14364'
})
afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})
beforeEach(() => { getDb().prepare('DELETE FROM logs').run() })

async function logs(qs = ''): Promise<{ rows: LogRow[]; total: number }> {
  const res = await fetch(`${base}/api/logs${qs}`)
  return ((await res.json()) as { data: { rows: LogRow[]; total: number } }).data
}

describe('logs store + api', () => {
  it('records API access automatically and returns it newest-first', async () => {
    await fetch(`${base}/api/providers`)   // the onResponse hook logs this
    const { rows, total } = await logs('?category=api')
    expect(total).toBeGreaterThanOrEqual(1)
    expect(rows.some(r => r.category === 'api' && r.message.includes('/api/providers'))).toBe(true)
  })

  it('does not log the log viewer polling itself (no self-amplification)', async () => {
    await logs()                            // GET /api/logs — must not be logged
    await logs()
    const { rows } = await logs('?category=api&q=/api/logs')
    expect(rows).toHaveLength(0)
  })

  it('filters by level, category and free text', async () => {
    logEvent('error', 'run', 'boom happened', { runId: 'r1' })
    logEvent('info', 'cell', 'openai:gpt-4o answered', { runId: 'r1' })
    expect((await logs('?level=error')).rows.every(r => r.level === 'error')).toBe(true)
    expect((await logs('?category=cell')).rows.every(r => r.category === 'cell')).toBe(true)
    const q = await logs('?q=boom')
    expect(q.rows).toHaveLength(1)
    expect(q.rows[0].message).toContain('boom')
    // meta round-trips as parsed JSON
    expect((q.rows[0].meta as { runId: string }).runId).toBe('r1')
  })

  it('exports the current filter as json / csv / txt / ndjson with a download header', async () => {
    logEvent('warn', 'agent', 'verify failed: agent:x', { steps: 0 })
    for (const [fmt, type, needle] of [['json', 'application/json', 'verify failed: agent:x'], ['csv', 'text/csv', 'ts,level,category'], ['txt', 'text/plain', 'WARN'], ['ndjson', 'application/x-ndjson', '{"id"']] as const) {
      const res = await fetch(`${base}/api/logs/export?category=agent&format=${fmt}`)
      expect(res.headers.get('content-type')).toContain(type)
      expect(res.headers.get('content-disposition')).toContain('attachment')
      expect(await res.text()).toContain(needle)
    }
  })

  it('clears all logs on DELETE', async () => {
    logEvent('info', 'system', 'seed')
    expect((await logs()).total).toBeGreaterThanOrEqual(1)
    const del = await fetch(`${base}/api/logs`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    expect((await logs()).total).toBe(0)
  })

  it('refuses a cross-site clear', async () => {
    const res = await fetch(`${base}/api/logs`, { method: 'DELETE', headers: { Origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
  })
})
