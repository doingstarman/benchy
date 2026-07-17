export interface Usage {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
}

export type Chunk =
  | { type: 'token'; text: string }
  // The model's own thinking, not part of the answer. Kept separate all the way
  // to the UI: TTFS must stay "time to first answer token", or every thinking
  // model's TTFS collapses and no longer compares against past runs.
  | { type: 'reasoning'; text: string }
  | { type: 'done'; usage: Usage }
  | { type: 'error'; message: string }

export interface AdapterConfig {
  apiKey?: string
  baseUrl?: string
  model: string
  settings?: import('../types.js').ProviderDefaults
}

export interface MessageAttachment {
  mimeType: string
  data: string // base64
  name: string
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: MessageAttachment[]
}

export interface Adapter {
  stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk>
}
