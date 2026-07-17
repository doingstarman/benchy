import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Provider, ProviderDefaults } from './types.js'

export const DEFAULT_PROVIDER_SETTINGS: Required<ProviderDefaults> = {
  temperature: 0.7,
  topP: 1.0,
  topK: null,
  maxOutputTokens: 2048,
  contextBudget: null,
  truncation: 'auto',
  timeoutMs: 60000,
  retries: 2,
  streaming: true,
}

interface Config {
  providers: Provider[]
}

function getBenchyDir(): string {
  return process.env.BENCHY_DIR ?? join(homedir(), '.benchy')
}

function getConfigPath(): string {
  return join(getBenchyDir(), 'config.json')
}

function isDevEnvironment(): boolean {
  return getBenchyDir().endsWith('.benchy-dev')
}

export async function readConfig(): Promise<Config> {
  const path = getConfigPath()

  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return { providers: [] } // no config yet — a first run is legitimately empty
  }

  // A file that EXISTS but can't be understood must never be reported as "no
  // providers": upsert would then write a config containing only the new entry
  // and take every other provider's API key with it. Refuse instead — the file
  // stays on disk untouched, so the user can fix or restore it.
  const bail = (why: string): never => {
    throw new Error(`Config at ${path} ${why} — refusing to overwrite it. Fix or move the file, then restart benchy.`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return bail('is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object') return bail('is not a JSON object')
  if (!Array.isArray((parsed as Config).providers)) return bail('has no providers array')

  return parsed as Config
}

export async function writeConfig(config: Config): Promise<void> {
  await mkdir(getBenchyDir(), { recursive: true })
  const path = getConfigPath()
  // Write-then-rename: rename is atomic, so a crash or a full disk leaves the
  // previous config intact instead of a half-written file that reads as empty.
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8')
  await rename(tmp, path)
}

export async function getProviders(): Promise<Provider[]> {
  const config = await readConfig()
  if (isDevEnvironment()) return config.providers
  return config.providers.filter(p => !p.id.startsWith('mock-'))
}

export async function upsertProvider(provider: Provider): Promise<void> {
  const config = await readConfig()
  const idx = config.providers.findIndex(p => p.id === provider.id)
  if (idx >= 0) {
    config.providers[idx] = provider
  } else {
    config.providers.push(provider)
  }
  await writeConfig(config)
}

export async function removeProvider(id: string): Promise<void> {
  const config = await readConfig()
  config.providers = config.providers.filter(p => p.id !== id)
  await writeConfig(config)
}
