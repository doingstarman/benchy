import { describe, it, expect, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb, getDb, closeDb } from '../db/index.js'

// db/index.ts owns the live schema; db/schema.sql is a hand-maintained canonical
// mirror. They drift silently unless something compares them — so build both and
// assert that every table exposes exactly the same columns.
const schemaSqlPath = fileURLToPath(new URL('../db/schema.sql', import.meta.url))

type ColMap = Record<string, Set<string>>

function columnsOf(db: Database.Database): ColMap {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  ).all() as { name: string }[]
  const out: ColMap = {}
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]
    out[name] = new Set(cols.map(c => c.name))
  }
  return out
}

const tmp = mkdtempSync(join(tmpdir(), 'benchy-schema-'))

afterAll(() => {
  closeDb()
  rmSync(tmp, { recursive: true, force: true })
})

describe('db/schema.sql mirrors the live schema in db/index.ts', () => {
  it('declares the same tables and columns as initDb builds', async () => {
    await initDb(join(tmp, 'live.db'))
    const live = columnsOf(getDb())

    const mirror = new Database(':memory:')
    mirror.exec(readFileSync(schemaSqlPath, 'utf8'))
    const declared = columnsOf(mirror)
    mirror.close()

    expect(Object.keys(declared).sort()).toEqual(Object.keys(live).sort())
    for (const table of Object.keys(live)) {
      expect([...(declared[table] ?? [])].sort(), `columns of ${table}`)
        .toEqual([...live[table]].sort())
    }
  })
})
