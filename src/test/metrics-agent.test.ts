import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../server.js'
import { getDb, closeDb } from '../db/index.js'
import { materializeRunMetrics } from '../api/metrics.js'

let server: FastifyInstance
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-magent-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14359, join(tempDir, 'test.db'))
})
afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})
beforeEach(() => {
  const db = getDb()
  for (const t of ['metrics', 'metric_values', 'results', 'runs', 'trace_steps']) db.prepare(`DELETE FROM ${t}`).run()
})

// Seed one run with two agent results (2 and 4 trace steps) plus a model result,
// then aggregate a run-scope custom that applies ONLY to agents.
function seed(): string {
  const db = getDb()
  const now = Date.now()
  db.prepare('INSERT INTO runs (id, prompts, models, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('run1', '[]', '[]', 'done', now)
  const addResult = (id: string, providerId: string) =>
    db.prepare('INSERT INTO results (id, run_id, prompt_index, model, provider_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, 'run1', 0, providerId === 'agent' ? 'agent:x' : 'openai:gpt-4o', providerId, 'answer', now)
  const addSteps = (resultId: string, n: number) => {
    for (let i = 0; i < n; i++) {
      db.prepare('INSERT INTO trace_steps (id, result_id, step_index, kind, is_error, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`${resultId}-${i}`, resultId, i, 'step', 0, now)
    }
  }
  addResult('ag1', 'agent'); addSteps('ag1', 2)
  addResult('ag2', 'agent'); addSteps('ag2', 4)
  addResult('mdl', 'openai') // no trace: steps is null for a model result

  // A run-scope custom over `steps`, applicable to agents only.
  db.prepare(
    `INSERT INTO metrics (key, name, expression, unit, format, direction, scope, aggregate, nullable, enabled, sort_order, applies_to, created_at, updated_at)
     VALUES ('stepavg', 'Step avg', 'steps', NULL, 'raw', 'neutral', 'run', 'mean', 1, 1, 0, '["agent"]', ?, ?)`,
  ).run(now, now)
  return 'run1'
}

describe('appliesTo skips inapplicable targets in per-run aggregation', () => {
  it('averages an agent-only metric over agent results only, not counting the model as 0', async () => {
    const runId = seed()
    await materializeRunMetrics(runId)
    const row = getDb().prepare("SELECT value FROM metric_values WHERE run_id = ? AND metric_key = 'stepavg'").get(runId) as { value: number } | undefined
    expect(row).toBeDefined()
    // mean(2, 4) = 3 — the model result is SKIPPED, not folded in as 0 (which would give 2).
    expect(row?.value).toBe(3)
  })

  it('writes no per-answer value for a target the metric does not apply to', async () => {
    const db = getDb()
    const now = Date.now()
    db.prepare('INSERT INTO runs (id, prompts, models, status, created_at) VALUES (?, ?, ?, ?, ?)').run('run2', '[]', '[]', 'done', now)
    db.prepare('INSERT INTO results (id, run_id, prompt_index, model, provider_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('m2', 'run2', 0, 'openai:gpt-4o', 'openai', 'a', now)
    // An answer-scope agent-only custom over `steps`.
    db.prepare(
      `INSERT INTO metrics (key, name, expression, unit, format, direction, scope, aggregate, nullable, enabled, sort_order, applies_to, created_at, updated_at)
       VALUES ('agsteps', 'Agent steps', 'steps', NULL, 'raw', 'neutral', 'answer', NULL, 1, 1, 0, '["agent"]', ?, ?)`,
    ).run(now, now)
    await materializeRunMetrics('run2')
    const row = db.prepare("SELECT value FROM metric_values WHERE result_id = 'm2' AND metric_key = 'agsteps'").get()
    // Skipped entirely — no row — rather than a misleading null/0 for a model result.
    expect(row).toBeUndefined()
  })
})
