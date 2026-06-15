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
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface Adapter {
  stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk>
}
