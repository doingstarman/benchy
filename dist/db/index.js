import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  tools TEXT
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
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_run ON attachments(run_id, prompt_index);
`;
let db = null;
export function getBenchyDir() {
    return process.env.BENCHY_DIR ?? join(homedir(), '.benchy');
}
function getDbPath() {
    return join(getBenchyDir(), 'benchy.db');
}
export function getDb() {
    if (!db)
        throw new Error('Database not initialized — call initDb() first');
    return db;
}
export async function initDb(path) {
    if (!path)
        await mkdir(getBenchyDir(), { recursive: true });
    db = new Database(path ?? getDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
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
    ]) {
        try {
            db.exec(sql);
        }
        catch { /* column already exists */ }
    }
}
export function closeDb() {
    db?.close();
    db = null;
}
