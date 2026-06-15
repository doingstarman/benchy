export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openai-compatible'
  | 'local'
  | 'custom'

export interface Provider {
  id: string
  name: string
  type: ProviderType
  apiKey?: string
  baseUrl?: string
  models: string[]
  enabled: boolean
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
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
}

export interface BenchmarkRequest {
  prompts: string[]
  models: string[]
}
