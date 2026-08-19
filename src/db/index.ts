import Database from 'better-sqlite3'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getProviders } from '../config.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  prompts TEXT NOT NULL,
  models TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  saved INTEGER NOT NULL DEFAULT 0,
  total_calls INTEGER NOT NULL DEFAULT 0,
  completed_calls INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  settings_overrides TEXT,
  run_settings TEXT,
  title TEXT,
  -- What prompts[] MEANS for this run: 'chat' = turns of one conversation,
  -- 'batch'/'pairs' = independent prompts that must never be replayed to the
  -- model as if they were a dialogue.
  kind TEXT NOT NULL DEFAULT 'chat',
  -- JSON array of tool ids this run enabled; NULL means none.
  tools TEXT,
  -- One system prompt sent to every model in the run; NULL means none.
  system_prompt TEXT,
  -- JSON arrays of selected skill ids / MCP-server ids; NULL means none.
  skills TEXT,
  mcp TEXT
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  prompt_index INTEGER NOT NULL,
  model TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  ttfs INTEGER,
  total_time INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  reasoning TEXT,
  reasoning_ms INTEGER,
  tool_calls TEXT,
  feedback TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_results_run_id ON results(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  prompt_index INTEGER,
  mime_type TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  -- Set when the upload belongs to a dataset item. Such rows are permanent
  -- (they back the dataset's files), so the unbound-upload GC must skip them.
  dataset_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachments_run ON attachments(run_id, prompt_index);

-- A dataset: a collection of items (files) plus a variable schema and, per item,
-- ground-truth values. Runs score model output per field against that truth.
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  type TEXT NOT NULL DEFAULT 'files',
  -- For 'code' datasets: 'python' | 'javascript' — which interpreter runs the
  -- model's solution against the item's tests. NULL for non-code datasets.
  language TEXT,
  -- JSON: [{ key, type: 'text'|'date'|'number', desc }]
  schema TEXT NOT NULL DEFAULT '[]',
  -- 'providerId:model' of a trusted model, excluded from comparison runs so it
  -- never competes against itself. NULL means none.
  trusted_model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_items (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  -- The item's file, an attachment row (unbound: run_id NULL, dataset_id set).
  -- Files-type datasets use attachment_id; text-type datasets use input.
  attachment_id TEXT,
  -- The item's text input, for text-type datasets (NULL for file items).
  input TEXT,
  -- For 'code' datasets: the hidden test source (ground truth). The model's
  -- solution is run against it; the score is the fraction of tests that pass.
  tests TEXT,
  -- JSON { key: value } — the human-confirmed ground truth for this item.
  ground_truth TEXT NOT NULL DEFAULT '{}',
  -- JSON { key: value } — values proposed by the trusted model, awaiting human
  -- confirmation. Confirming a key moves it into ground_truth; rejecting clears it.
  ai_suggested TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset ON dataset_items(dataset_id, idx);

-- One human verdict per item of an arena run: which model answered best (and,
-- optionally, worst) for that item, or the item was skipped. Elo/win-loss
-- standings are DERIVED from these rows on read, so nothing else is persisted.
CREATE TABLE IF NOT EXISTS dataset_run_verdicts (
  run_id TEXT NOT NULL,
  prompt_index INTEGER NOT NULL,
  best_model TEXT,
  worst_model TEXT,
  skipped INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, prompt_index),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- A benchmark participant: a named, configurable entity a run is executed against.
-- kind='model' now (config = { providerId, model, defaults?, pricing? }); 'agent'
-- and 'pipeline' are future kinds with their own config shapes. Not linked by FK to
-- results on purpose — results keep their target_id string even after the target is
-- deleted, so history stays intact and the UI can show it as an orphan.
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_targets_kind ON targets(kind, enabled);
`

let db: Database.Database | null = null

export function getBenchyDir(): string {
  return process.env.BENCHY_DIR ?? join(homedir(), '.benchy')
}

function getDbPath(): string {
  return join(getBenchyDir(), 'benchy.db')
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDb() first')
  return db
}

export async function initDb(path?: string): Promise<void> {
  if (!path) await mkdir(getBenchyDir(), { recursive: true })
  db = new Database(path ?? getDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)

  // Migrations for existing databases
  for (const sql of [
    'ALTER TABLE runs ADD COLUMN settings_overrides TEXT',
    'ALTER TABLE runs ADD COLUMN run_settings TEXT',
    'ALTER TABLE runs ADD COLUMN title TEXT',
    // Existing runs predate the distinction; 'chat' preserves their behaviour.
    "ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'",
    // Reasoning text was thrown away before chat 2.0. Old rows stay NULL, which
    // reads as "this model never showed its thinking" — true, as it happens.
    'ALTER TABLE results ADD COLUMN reasoning TEXT',
    'ALTER TABLE results ADD COLUMN reasoning_ms INTEGER',
    // The tool calls a model made on the way to its answer, as a JSON array.
    'ALTER TABLE results ADD COLUMN tool_calls TEXT',
    // Which tools a run had enabled — NULL/absent for every run before this.
    'ALTER TABLE runs ADD COLUMN tools TEXT',
    'ALTER TABLE runs ADD COLUMN system_prompt TEXT',
    // Selected skill ids and MCP-server ids for the run (JSON arrays; NULL none).
    'ALTER TABLE runs ADD COLUMN skills TEXT',
    'ALTER TABLE runs ADD COLUMN mcp TEXT',
    // Datasets: dataset files are permanent attachments, so they carry a
    // dataset_id that exempts them from the unbound-upload GC.
    'ALTER TABLE attachments ADD COLUMN dataset_id TEXT',
    // A run produced by scoring a dataset links back to it; each result gets a
    // per-field accuracy (score) and a per-key match map (score_detail).
    'ALTER TABLE runs ADD COLUMN dataset_id TEXT',
    'ALTER TABLE results ADD COLUMN score REAL',
    'ALTER TABLE results ADD COLUMN score_detail TEXT',
    // A dataset run's judging mode: NULL/'score' = auto per-field scoring,
    // 'arena' = human pairwise judging with Elo standings.
    'ALTER TABLE runs ADD COLUMN mode TEXT',
    // Trusted-model suggestions awaiting human confirmation, per item.
    "ALTER TABLE dataset_items ADD COLUMN ai_suggested TEXT NOT NULL DEFAULT '{}'",
    // Text-type dataset items carry their input here instead of an attachment.
    'ALTER TABLE dataset_items ADD COLUMN input TEXT',
    // Code datasets: the interpreter, and per-item hidden test source.
    'ALTER TABLE datasets ADD COLUMN language TEXT',
    'ALTER TABLE dataset_items ADD COLUMN tests TEXT',
    // Which dataset items a run actually covered (JSON array of ids, in
    // prompt_index order). Subsampling means prompt_index no longer maps to the
    // full item list, so per-item views must resolve items through these ids.
    'ALTER TABLE runs ADD COLUMN dataset_item_ids TEXT',
    // The dataset run's base prompt (before each item's input was folded in), so a
    // subsampled run can be relaunched over the full dataset without guessing it.
    'ALTER TABLE runs ADD COLUMN base_prompt TEXT',
    // Per-dataset "это то же самое" rules: variable types scored leniently (by
    // core value, ignoring surrounding noise). JSON array of DatasetVarType.
    'ALTER TABLE datasets ADD COLUMN norm_rules TEXT',
    // Code runs: the per-test detail beyond match/miss — each case's error text
    // and the execution error (compile/timeout) that score_detail can't express.
    'ALTER TABLE results ADD COLUMN code_report TEXT',
    // Targets registry: which target produced a result / a run ran against. The
    // model key stays in results.model too, so nothing reading it today breaks.
    'ALTER TABLE results ADD COLUMN target_id TEXT',
    'ALTER TABLE runs ADD COLUMN target_ids TEXT',
  ]) {
    try { db.exec(sql) } catch { /* column already exists */ }
  }

  // One-time backfill: derive a 'model' target per historical result and per
  // configured provider model, and point every existing result/run at its
  // target(s). Best-effort on config — a corrupt config still lets the server
  // start, seeding from results alone.
  let providerKeys: string[] = []
  try {
    const providers = await getProviders()
    providerKeys = providers.flatMap(p => p.models.map(m => `${p.id}:${m}`))
  } catch { /* unreadable config — seed targets from results only */ }
  backfillTargets(db, providerKeys)
}

// Idempotent: seeds the targets table only when empty, then fills the
// denormalized back-references on any result/run that lacks them. Exported so the
// migration test can drive it directly. `providerKeys` are `providerId:model`.
export function backfillTargets(db: Database.Database, providerKeys: string[]): void {
  const seeded = (db.prepare('SELECT COUNT(*) AS c FROM targets').get() as { c: number }).c
  if (seeded === 0) {
    const keys = new Set<string>()
    for (const row of db.prepare('SELECT DISTINCT model FROM results').all() as { model: string }[]) {
      if (row.model) keys.add(row.model)
    }
    for (const key of providerKeys) if (key) keys.add(key)
    const now = Date.now()
    const insert = db.prepare(
      'INSERT INTO targets (id, kind, name, config, tags, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    db.transaction(() => {
      for (const key of keys) {
        const colon = key.indexOf(':')
        const providerId = colon >= 0 ? key.slice(0, colon) : ''
        const model = colon >= 0 ? key.slice(colon + 1) : key
        insert.run(key, 'model', model, JSON.stringify({ providerId, model }), '[]', 1, now, now)
      }
    })()
  }
  db.prepare('UPDATE results SET target_id = model WHERE target_id IS NULL').run()
  db.prepare('UPDATE runs SET target_ids = models WHERE target_ids IS NULL').run()
}

export function closeDb(): void {
  db?.close()
  db = null
}
