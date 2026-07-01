import { readFile, writeFile, mkdir } from 'node:fs/promises'
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

export async function readConfig(): Promise<Config> {
  try {
    const raw = await readFile(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as Config
  } catch {
    return { providers: [] }
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await mkdir(getBenchyDir(), { recursive: true })
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export async function getProviders(): Promise<Provider[]> {
  const config = await readConfig()
  return config.providers
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
