import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Provider, ProviderDefaults, CustomTool, Skill, McpServer } from './types.js'

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
  extendedThinking: false,
}

export interface SearchConfig {
  provider: 'brave' | 'tavily'
  apiKey: string
}

interface Config {
  providers: Provider[]
  // Optional: enables the web_search tool. Without a key the tool is not even
  // offered to models, so tool runs never depend on a search key existing.
  search?: SearchConfig
  // Library artifacts — user-authored, same trust model as providers.
  customTools?: CustomTool[]
  skills?: Skill[]
  mcpServers?: McpServer[]
  // Opt-in gate for 'code' datasets: running a code dataset executes the model's
  // solution locally in a subprocess (arbitrary code). Off unless explicitly set.
  codeExecution?: boolean
  // Wall clock one dataset item's solution gets before it is killed.
  codeExecTimeoutMs?: number
  // App-wide generation defaults, layered under every run. Sparse on purpose: an
  // absent key means "not set", which is what keeps an install that never opened
  // Settings sending exactly what it sent before.
  runDefaults?: AppRunDefaults
}

export interface AppRunDefaults {
  temperature?: number
  maxOutputTokens?: number
}

export interface AppSettings {
  codeExecution: boolean
  codeExecTimeoutMs: number
  runDefaults: AppRunDefaults
}

// Matches DEFAULT_TIMEOUT_MS in codeRun.ts, so upgrading an install that never
// set one changes nothing. The ceiling is low because scoreCodeRun is
// deliberately serial: a 50-item dataset at the maximum is already ~100 minutes
// with no way to cancel.
export const CODE_EXEC_TIMEOUT_DEFAULT_MS = 10_000
export const CODE_EXEC_TIMEOUT_MIN_MS = 1_000
export const CODE_EXEC_TIMEOUT_MAX_MS = 120_000

export const APP_TEMPERATURE_MIN = 0
export const APP_TEMPERATURE_MAX = 2
export const APP_MAX_OUTPUT_TOKENS_MIN = 1
export const APP_MAX_OUTPUT_TOKENS_MAX = 200_000

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

// Read-side validation, which rules/api.md would normally reserve for a route
// handler. config.json is hand-editable, so it IS a boundary: a typed
// `"temperature": 99` must not reach a provider just because it never came
// through the API.
function readRunDefaults(raw: AppRunDefaults | undefined): AppRunDefaults {
  const out: AppRunDefaults = {}
  if (typeof raw?.temperature === 'number' && Number.isFinite(raw.temperature)) {
    out.temperature = clamp(raw.temperature, APP_TEMPERATURE_MIN, APP_TEMPERATURE_MAX)
  }
  if (typeof raw?.maxOutputTokens === 'number' && Number.isInteger(raw.maxOutputTokens)) {
    out.maxOutputTokens = clamp(raw.maxOutputTokens, APP_MAX_OUTPUT_TOKENS_MIN, APP_MAX_OUTPUT_TOKENS_MAX)
  }
  return out
}

function readCodeExecTimeout(raw: number | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return CODE_EXEC_TIMEOUT_DEFAULT_MS
  return clamp(Math.round(raw), CODE_EXEC_TIMEOUT_MIN_MS, CODE_EXEC_TIMEOUT_MAX_MS)
}

// One read for the whole blob — the route would otherwise parse config.json
// three times to answer one GET.
export async function getAppSettings(): Promise<AppSettings> {
  const config = await readConfig()
  return {
    codeExecution: config.codeExecution === true,
    codeExecTimeoutMs: readCodeExecTimeout(config.codeExecTimeoutMs),
    runDefaults: readRunDefaults(config.runDefaults),
  }
}

export async function getCodeExecTimeoutMs(): Promise<number> {
  return readCodeExecTimeout((await readConfig()).codeExecTimeoutMs)
}

export async function getAppRunDefaults(): Promise<AppRunDefaults> {
  return readRunDefaults((await readConfig()).runDefaults)
}

export async function setCodeExecTimeoutMs(ms: number): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    config.codeExecTimeoutMs = readCodeExecTimeout(ms)
    await writeConfig(config)
  })
}

// null deletes a key — that is how "inherit" is expressed, and it maps onto
// SliderField's Auto. undefined leaves the key untouched.
export async function setAppRunDefaults(
  patch: { temperature?: number | null; maxOutputTokens?: number | null },
): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    const next: AppRunDefaults = { ...readRunDefaults(config.runDefaults) }
    for (const key of ['temperature', 'maxOutputTokens'] as const) {
      const value = patch[key]
      if (value === undefined) continue
      if (value === null) delete next[key]
      else next[key] = value
    }
    config.runDefaults = readRunDefaults(next)
    await writeConfig(config)
  })
}

export async function getSearchConfig(): Promise<SearchConfig | undefined> {
  const config = await readConfig()
  const s = config.search
  if (!s || !s.apiKey || (s.provider !== 'brave' && s.provider !== 'tavily')) return undefined
  return s
}

export async function getCustomTools(): Promise<CustomTool[]> {
  return (await readConfig()).customTools ?? []
}
export async function getSkills(): Promise<Skill[]> {
  return (await readConfig()).skills ?? []
}
export async function getMcpServers(): Promise<McpServer[]> {
  return (await readConfig()).mcpServers ?? []
}

// Whether 'code' datasets may execute a model's solution locally. Defaults to
// false: absent config, an unparseable value, anything but an explicit `true`
// keeps execution off, so a code run never fires by accident.
export async function getCodeExecutionEnabled(): Promise<boolean> {
  return (await readConfig()).codeExecution === true
}
export async function setCodeExecutionEnabled(enabled: boolean): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    config.codeExecution = enabled
    await writeConfig(config)
  })
}

function getBenchyDir(): string {
  return process.env.BENCHY_DIR ?? join(homedir(), '.benchy')
}

function getConfigPath(): string {
  return join(getBenchyDir(), 'config.json')
}

export function isDevEnvironment(): boolean {
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function writeConfig(config: Config): Promise<void> {
  await mkdir(getBenchyDir(), { recursive: true })
  const path = getConfigPath()
  // Write-then-rename: rename is atomic, so a crash or a full disk leaves the
  // previous config intact instead of a half-written file that reads as empty.
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8')
    // On Windows a rename onto an existing file loses to any transient lock — an
    // antivirus or the search indexer reading config.json is enough for EPERM.
    // Give it a few tries before admitting defeat.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, path)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (attempt >= 4 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw err
        await sleep(20 * (attempt + 1))
      }
    }
  } finally {
    // The temp file holds every API key in cleartext. If the rename never
    // happened, it must not be left lying on disk.
    await unlink(tmp).catch(() => { /* already renamed into place */ })
  }
}

// Every writer does read → modify → write, which is only safe one at a time:
// twenty concurrent saves used to leave one provider and drop nineteen. The
// rename is atomic, but atomicity is not isolation.
let writeQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn)
  writeQueue = run.catch(() => { /* a failed write must not poison the queue */ })
  return run
}

export async function getProviders(): Promise<Provider[]> {
  const config = await readConfig()
  if (isDevEnvironment()) return config.providers
  return config.providers.filter(p => !p.id.startsWith('mock-'))
}

export async function upsertProvider(provider: Provider): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    const idx = config.providers.findIndex(p => p.id === provider.id)
    if (idx >= 0) {
      config.providers[idx] = provider
    } else {
      config.providers.push(provider)
    }
    await writeConfig(config)
  })
}

export async function removeProvider(id: string): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    config.providers = config.providers.filter(p => p.id !== id)
    await writeConfig(config)
  })
}

export async function upsertCustomTool(tool: CustomTool): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    const list = config.customTools ?? []
    const idx = list.findIndex(t => t.id === tool.id)
    if (idx >= 0) list[idx] = tool; else list.push(tool)
    config.customTools = list
    await writeConfig(config)
  })
}
export async function removeCustomTool(id: string): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    config.customTools = (config.customTools ?? []).filter(t => t.id !== id)
    await writeConfig(config)
  })
}

export async function upsertSkill(skill: Skill): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    const list = config.skills ?? []
    const idx = list.findIndex(s => s.id === skill.id)
    if (idx >= 0) list[idx] = skill; else list.push(skill)
    config.skills = list
    await writeConfig(config)
  })
}
export async function removeSkill(id: string): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    config.skills = (config.skills ?? []).filter(s => s.id !== id)
    await writeConfig(config)
  })
}

export async function upsertMcpServer(server: McpServer): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    const list = config.mcpServers ?? []
    const idx = list.findIndex(m => m.id === server.id)
    if (idx >= 0) list[idx] = server; else list.push(server)
    config.mcpServers = list
    await writeConfig(config)
  })
}
export async function removeMcpServer(id: string): Promise<void> {
  return serialize(async () => {
    const config = await readConfig()
    config.mcpServers = (config.mcpServers ?? []).filter(m => m.id !== id)
    await writeConfig(config)
  })
}
