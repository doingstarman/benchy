-- Canonical schema reference for benchy's SQLite database.
--
-- NOT executed at runtime: `db/index.ts` owns the live schema (a base set of
-- `CREATE TABLE IF NOT EXISTS` plus an idempotent list of `ALTER TABLE ADD
-- COLUMN` migrations for databases created before a column existed). This file
-- is that end state folded into one CREATE per table — the shape a fresh DB
-- ends up with. Regenerate it from `db/index.ts` whenever the schema changes.

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
  -- What prompts[] MEANS: 'chat' = turns of one conversation, 'batch'/'pairs' =
  -- independent prompts that must never be replayed as if they were a dialogue.
  kind TEXT NOT NULL DEFAULT 'chat',
  tools TEXT,                 -- JSON array of enabled tool ids; NULL means none
  system_prompt TEXT,         -- one system prompt sent to every model; NULL none
  skills TEXT,                -- JSON array of selected skill ids; NULL none
  mcp TEXT,                   -- JSON array of selected MCP-server ids; NULL none
  dataset_id TEXT,            -- set when this run scored a dataset
  mode TEXT,                  -- dataset run judging: NULL/'score' = auto, 'arena' = human
  dataset_item_ids TEXT,      -- JSON array of covered item ids, in prompt_index order
  base_prompt TEXT            -- dataset run's base prompt before per-item input was folded in
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
  reasoning TEXT,             -- the model's thinking, kept separate from the answer
  reasoning_ms INTEGER,
  tool_calls TEXT,            -- JSON array of tool calls made on the way to the answer
  feedback TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  score REAL,                 -- dataset run: per-field accuracy for this result
  score_detail TEXT,          -- dataset run: JSON per-key match map
  code_report TEXT,           -- code dataset: per-test error text + execution error
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
  -- Set when the upload backs a dataset item. Such rows are permanent, so the
  -- unbound-upload GC must skip them.
  dataset_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachments_run ON attachments(run_id, prompt_index);

-- A dataset: a collection of items (files or text) plus a variable schema and,
-- per item, ground-truth values. Runs score model output per field against it.
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  type TEXT NOT NULL DEFAULT 'files',   -- 'files' | 'text' | 'tools' | 'code'
  -- 'code' datasets: 'python' | 'javascript' — which interpreter runs the
  -- model's solution against the item's tests. NULL for non-code datasets.
  language TEXT,
  -- JSON: [{ key, type: 'text'|'date'|'number', desc }]
  schema TEXT NOT NULL DEFAULT '[]',
  -- 'providerId:model' of a trusted model, excluded from comparison runs so it
  -- never competes against itself. NULL means none.
  trusted_model TEXT,
  -- Per-dataset "same thing" leniency rules: variable types scored by core
  -- value, ignoring surrounding noise. JSON array of DatasetVarType.
  norm_rules TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_items (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  -- Files-type datasets use attachment_id (an unbound attachment: run_id NULL,
  -- dataset_id set); text-type datasets use input.
  attachment_id TEXT,
  input TEXT,
  -- 'code' datasets: the hidden test source (ground truth). The model's solution
  -- is run against it; the score is the fraction of tests that pass.
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
-- optionally, worst), or the item was skipped. Elo/win-loss standings are
-- DERIVED from these rows on read, so nothing else is persisted.
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
