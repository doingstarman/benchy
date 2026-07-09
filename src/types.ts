export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openai-compatible'
  | 'local'
  | 'custom'
  | 'http-json'
  | 'script'
  | 'webhook'

export interface ProviderDefaults {
  temperature?: number | null
  topP?: number | null
  topK?: number | null
  maxOutputTokens?: number | null
  contextBudget?: number | null
  truncation?: 'auto' | 'start' | 'middle' | 'end' | null
  timeoutMs?: number | null
  retries?: number | null
  streaming?: boolean | null
}

export type RunSettingsOverrides = Partial<ProviderDefaults>

export interface RunSettings {
  global?: RunSettingsOverrides
  perModel?: Record<string, RunSettingsOverrides>
}

export interface Provider {
  id: string
  name: string
  type: ProviderType
  apiKey?: string
  baseUrl?: string
  models: string[]
  enabled: boolean
  timeout?: number
  retries?: number
  defaults?: ProviderDefaults
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AttachmentMeta {
  id: string
  name: string
  mimeType: string
  size: number
}

export interface Metrics {
  ttfs: number | null
  totalTime: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
}

export type RunStatus = 'pending' | 'running' | 'done' | 'error'

export interface Result {
  id: string
  runId: string
  promptIndex: number
  model: string
  providerId: string
  text: string
  metrics: Metrics
  feedback: 'up' | 'down' | null
  error: string | null
  createdAt: number
}

export interface Run {
  id: string
  prompts: string[]
  models: string[]
  status: RunStatus
  saved: boolean
  totalCalls: number
  completedCalls: number
  createdAt: number
  runSettings?: RunSettings
  title?: string | null
}

export interface BenchmarkRequest {
  prompts?: string[]
  models?: string[]
  pairs?: { prompt: string; model: string }[]
  runSettings?: RunSettings
  // Upload ids attached to the (single) prompt — v1 supports attachments only
  // in single-prompt mode, not pairs/batch
  attachments?: string[]
}
