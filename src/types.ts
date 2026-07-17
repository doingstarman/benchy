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
  // Anthropic and Google only think when asked to, and asking changes the
  // measurement (slower, more tokens). Off by default so an ordinary run stays
  // byte-for-byte what it was. OpenAI-compatible providers ignore this: their
  // reasoning already rides along in the stream for free.
  extendedThinking?: boolean | null
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
  // How long the model spent thinking before its first answer token.
  reasoningMs: number | null
}

export type RunStatus = 'pending' | 'running' | 'done' | 'error'

export interface Result {
  id: string
  runId: string
  promptIndex: number
  model: string
  providerId: string
  text: string
  // The model's thinking, kept out of `text` so the answer stays the answer.
  reasoning: string | null
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
  kind: RunKind
}

// What a run's prompts[] means. 'chat' = successive turns of one conversation
// (each prompt sees the previous answers). 'batch' = independent prompts fanned
// out to every model; 'pairs' = one prompt per model. For the latter two the
// prompts were never a dialogue and must not be replayed as one.
export type RunKind = 'chat' | 'batch' | 'pairs'

export interface BenchmarkRequest {
  prompts?: string[]
  models?: string[]
  pairs?: { prompt: string; model: string }[]
  runSettings?: RunSettings
  // Upload ids attached to the (single) prompt — v1 supports attachments only
  // in single-prompt mode, not pairs/batch
  attachments?: string[]
  // Regenerate: re-run a cell on a throwaway run that copies another turn's
  // attachments (single-prompt only), so a vision re-run keeps its image.
  cloneAttachmentsFrom?: { runId: string; promptIndex: number }
}
