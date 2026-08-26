import { getDb } from './db/index.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'api' | 'run' | 'cell' | 'agent' | 'pipeline' | 'system'

export interface LogRow {
  id: number
  ts: number
  level: LogLevel
  category: LogCategory
  message: string
  meta: unknown
}

// Keep the table bounded — logs are a rolling window, trimmed to the newest MAX_LOGS
// every so often (not on every insert, which would double the write cost).
const MAX_LOGS = 50_000
let sinceTrim = 0

// Record one event. MUST NOT throw into the caller — logging is a side channel, a
// broken log write can never break a run or a request.
export function logEvent(level: LogLevel, category: LogCategory, message: string, meta?: unknown): void {
  try {
    const db = getDb()
    db.prepare('INSERT INTO logs (ts, level, category, message, meta) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), level, category, message, meta === undefined ? null : JSON.stringify(meta))
    if (++sinceTrim >= 500) {
      sinceTrim = 0
      db.prepare('DELETE FROM logs WHERE id <= (SELECT MAX(id) - ? FROM logs)').run(MAX_LOGS)
    }
  } catch { /* never let logging break the caller */ }
}

export interface LogQuery {
  since?: number
  until?: number
  level?: LogLevel
  category?: LogCategory
  q?: string
  limit?: number
}

function safeParse(s: string): unknown { try { return JSON.parse(s) } catch { return s } }

// Newest-first, filtered by time range / level / category / free text. `limit` is
// capped so a huge export request can't pull the whole table into memory at once.
export function queryLogs(f: LogQuery): LogRow[] {
  const where: string[] = []
  const args: unknown[] = []
  if (f.since != null) { where.push('ts >= ?'); args.push(f.since) }
  if (f.until != null) { where.push('ts <= ?'); args.push(f.until) }
  if (f.level) { where.push('level = ?'); args.push(f.level) }
  if (f.category) { where.push('category = ?'); args.push(f.category) }
  if (f.q) { where.push('(message LIKE ? OR meta LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  args.push(Math.min(Math.max(1, f.limit ?? 500), 5000))
  const rows = getDb().prepare(
    `SELECT id, ts, level, category, message, meta FROM logs ${clause} ORDER BY ts DESC, id DESC LIMIT ?`,
  ).all(...args) as { id: number; ts: number; level: LogLevel; category: LogCategory; message: string; meta: string | null }[]
  return rows.map(r => ({ id: r.id, ts: r.ts, level: r.level, category: r.category, message: r.message, meta: r.meta ? safeParse(r.meta) : null }))
}

export function countLogs(): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM logs').get() as { c: number }).c
}

export function clearLogs(): void {
  getDb().prepare('DELETE FROM logs').run()
}
