import type { ProviderDefaults } from '../../src/types'

// The factory generation settings — the bottom layer of the run-settings merge,
// under provider defaults, the app defaults from /api/settings, and any per-run
// override.
//
// A copy of DEFAULT_PROVIDER_SETTINGS in src/config.ts, and it has to be one:
// that module imports node:fs, so the frontend can only take its TYPES (see the
// import-type note in api.ts). runDefaults.test.ts asserts the two stay equal.
export const FACTORY_RUN_DEFAULTS: Required<ProviderDefaults> = {
  temperature: 0.7,
  topP: 1.0,
  topK: null,
  maxOutputTokens: 2048,
  contextBudget: null,
  truncation: 'auto',
  timeoutMs: 60000,
  retries: 2,
  streaming: true,
  extendedThinking: false,
}
