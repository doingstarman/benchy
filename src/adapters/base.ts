export interface Usage {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
}

export type Chunk =
  | { type: 'token'; text: string }
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
