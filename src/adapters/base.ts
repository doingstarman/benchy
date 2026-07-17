export interface Usage {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
}

// One tool invocation the model asked for. `args` is whatever JSON the model
// produced — validated when the tool runs, not here.
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

// The result benchy hands back for one tool call.
export interface ToolResult {
  id: string
  name: string
  content: string
  isError?: boolean
}

export type Chunk =
  | { type: 'token'; text: string }
  // The model's own thinking, not part of the answer. Kept separate all the way
  // to the UI: TTFS must stay "time to first answer token", or every thinking
  // model's TTFS collapses and no longer compares against past runs.
  | { type: 'reasoning'; text: string }
  // The model wants to call a tool. The adapter emits this once it has the whole
  // call assembled (over chat/completions the arguments arrive as fragments).
  // benchy's loop, not the adapter, runs the tool and streams again.
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; usage: Usage }
  | { type: 'error'; message: string }

export interface ToolSpec {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export interface AdapterConfig {
  apiKey?: string
  baseUrl?: string
  model: string
  settings?: import('../types.js').ProviderDefaults
  // The tools this call may use, already resolved. Absent/empty ⇒ the request
  // goes out with no tools at all, byte-for-byte as before tool support existed.
  tools?: ToolSpec[]
}

export interface MessageAttachment {
  mimeType: string
  data: string // base64
  name: string
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  attachments?: MessageAttachment[]
  // Set on an assistant message that asked for tools; the adapter serializes
  // these back into its own format so the model sees its own prior calls.
  toolCalls?: ToolCall[]
  // Set on a 'tool' message carrying results back to the model.
  toolResults?: ToolResult[]
}

export interface Adapter {
  stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk>
}
