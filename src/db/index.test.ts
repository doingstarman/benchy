import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from './index.js'

let tempDir: string | null = null

function useTempBenchyDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-db-'))
  process.env.BENCHY_DIR = tempDir
  return tempDir
}

afterEach(() => {
  closeDb()
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
  delete process.env.BENCHY_DIR
})

describe('database initialization', () => {
  it('honors BENCHY_DIR when default db path is used', async () => {
    const dir = useTempBenchyDir()

    await initDb()

    expect(existsSync(join(dir, 'benchy.db'))).toBe(true)
  })

  it('enables foreign keys for cascade deletes', async () => {
    useTempBenchyDir()
    await initDb()
    const db = getDb()

    db.prepare(
      'INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('run-1', JSON.stringify(['prompt']), JSON.stringify(['p:m']), 'done', 0, 1, 1, Date.now())
    db.prepare(
      'INSERT INTO results (id, run_id, prompt_index, model, provider_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('result-1', 'run-1', 0, 'p:m', 'p', 'text', Date.now())

    db.prepare('DELETE FROM runs WHERE id = ?').run('run-1')

    expect(db.prepare('SELECT id FROM results WHERE id = ?').get('result-1')).toBeUndefined()
  })
})
