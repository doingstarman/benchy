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

// The stored shape of one node in an agent's trajectory. Distinct from ToolCall/
// ToolResult: those are the model→benchy tool protocol (benchy RUNS the tool). A
// trace step is the reverse — the agent ALREADY ran it and is only reporting it,
// so benchy records it and never executes anything.
export type TraceStepKind = 'step' | 'think' | 'plan' | 'tool' | 'model' | 'retry' | 'error' | 'answer'
// Three outcomes an `error` must keep apart: the process died (agent), a tool call
// failed but the agent can recover (tool), or the agent reached the end and
// declared failure (task). Collapsing these loses the most interesting distinction.
export type TraceErrorScope = 'agent' | 'tool' | 'task'

export interface TraceStep {
  id: string
  parentId: string | null
  kind: TraceStepKind
  name: string | null
  ms: number | null
  inputTokens: number | null
  outputTokens: number | null
  cost: number | null
  payload: string | null
  payloadTruncated: boolean
  isError: boolean
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
  // An agent reporting a trajectory node it already executed. benchy stores it as
  // a trace step and does NOT act on it — never confuse this with `tool_call`.
  | { type: 'step'; step: TraceStep }
  | { type: 'done'; usage: Usage }
  // `scope` distinguishes a fatal process death (agent) from a task-level declared
  // failure (task); absent for ordinary model errors.
  | { type: 'error'; message: string; scope?: TraceErrorScope }

export interface ToolSpec {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

// Extra knobs an agent target passes to the process/HTTP transports. Absent for
// ordinary model calls, so those paths behave byte-for-byte as before.
export interface AgentAdapterOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  // The task aborts on the first limit reached; absent ⇒ that limit is off.
  maxSteps?: number
  maxCostUsd?: number
  payloadCapBytes?: number
  pricingOverrides?: Record<string, import('../pricing.js').ModelPricing>
}

export interface AdapterConfig {
  apiKey?: string
  baseUrl?: string
  model: string
  settings?: import('../types.js').ProviderDefaults
  // The tools this call may use, already resolved. Absent/empty ⇒ the request
  // goes out with no tools at all, byte-for-byte as before tool support existed.
  tools?: ToolSpec[]
  agent?: AgentAdapterOptions
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
