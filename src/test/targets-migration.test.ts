import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, getDb, closeDb, backfillTargets } from '../db/index.js'

let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-targets-mig-'))
  process.env.BENCHY_DIR = tempDir
  await initDb(join(tempDir, 'test.db')) // empty config → no seed at init
})

afterAll(() => {
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

describe('targets backfill migration', () => {
  it('derives targets from results + provider models and back-references every row', () => {
    const db = getDb()
    const now = Date.now()
    // Simulate a pre-targets DB: runs/results with NULL target refs.
    db.prepare('INSERT INTO runs (id, prompts, models, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('runA', '[]', JSON.stringify(['openai:gpt-4o', 'openai:gpt-4o-mini']), 'done', now)
    db.prepare('INSERT INTO runs (id, prompts, models, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('runB', '[]', JSON.stringify(['anthropic:claude-3-5-sonnet']), 'done', now)
    const insRes = db.prepare('INSERT INTO results (id, run_id, prompt_index, model, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    insRes.run('r1', 'runA', 0, 'openai:gpt-4o', 'openai', now)
    insRes.run('r2', 'runA', 0, 'openai:gpt-4o-mini', 'openai', now)
    insRes.run('r3', 'runB', 0, 'anthropic:claude-3-5-sonnet', 'anthropic', now)

    // A model the provider offers but that was never run must still get a target.
    backfillTargets(db, ['openai:gpt-4o', 'openai:gpt-4o-mini', 'openai:gpt-4o-new'])

    const ids = (db.prepare('SELECT id FROM targets ORDER BY id').all() as { id: string }[]).map(r => r.id)
    expect(new Set(ids)).toEqual(new Set([
      'openai:gpt-4o', 'openai:gpt-4o-mini', 'anthropic:claude-3-5-sonnet', 'openai:gpt-4o-new',
    ]))

    // Every historical result points at its model-key target.
    for (const [id, model] of [['r1', 'openai:gpt-4o'], ['r2', 'openai:gpt-4o-mini'], ['r3', 'anthropic:claude-3-5-sonnet']]) {
      const row = db.prepare('SELECT target_id FROM results WHERE id = ?').get(id) as { target_id: string }
      expect(row.target_id).toBe(model)
    }
    // Runs' target_ids mirror their models array.
    expect((db.prepare('SELECT target_ids FROM runs WHERE id = ?').get('runA') as { target_ids: string }).target_ids)
      .toBe(JSON.stringify(['openai:gpt-4o', 'openai:gpt-4o-mini']))
    expect((db.prepare('SELECT target_ids FROM runs WHERE id = ?').get('runB') as { target_ids: string }).target_ids)
      .toBe(JSON.stringify(['anthropic:claude-3-5-sonnet']))

    // No rows lost.
    expect((db.prepare('SELECT COUNT(*) AS c FROM results').get() as { c: number }).c).toBe(3)
    expect((db.prepare('SELECT COUNT(*) AS c FROM runs').get() as { c: number }).c).toBe(2)

    // Derived target for a never-run model carries the right config.
    const nt = db.prepare('SELECT config FROM targets WHERE id = ?').get('openai:gpt-4o-new') as { config: string }
    expect(JSON.parse(nt.config)).toEqual({ providerId: 'openai', model: 'gpt-4o-new' })
  })

  it('is idempotent — a second run neither duplicates targets nor changes refs', () => {
    const db = getDb()
    const before = (db.prepare('SELECT COUNT(*) AS c FROM targets').get() as { c: number }).c
    backfillTargets(db, ['openai:gpt-4o'])
    expect((db.prepare('SELECT COUNT(*) AS c FROM targets').get() as { c: number }).c).toBe(before)
  })
})
