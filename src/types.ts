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

// What the API hands back for a provider. `apiKey` is absent by construction,
// not by convention: the key stays on the backend and only its mask travels, so
// a frontend that tries to read one stops compiling rather than shipping it.
// The mask is a ready-to-render string; null means no key is stored.
export type ProviderView = Omit<Provider, 'apiKey'> & { apiKeyMask: string | null }

export function toProviderView({ apiKey, ...rest }: Provider): ProviderView {
  return { ...rest, apiKeyMask: maskApiKey(apiKey) }
}

// Last four characters only. Enough to tell two keys apart when you have a
// couple of them; useless to anyone who obtains it.
function maskApiKey(key: string | undefined): string | null {
  if (!key) return null
  return key.length <= 4 ? '•'.repeat(key.length) : '•'.repeat(16) + key.slice(-4)
}

// ─── Library artifacts (user-authored, stored in config.json) ────────────────

// JSON-Schema object for a tool's arguments. Kept loose — providers forward it
// near-verbatim and each has its own strictness.
export interface ToolParams {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

// A user-defined tool that POSTs its arguments to an HTTP endpoint and hands the
// response back to the model. The URL is author-configured (not model-chosen),
// so it may point at localhost — same trust model as a provider baseUrl.
export interface CustomTool {
  id: string
  name: string          // the function name models call — ^[a-z0-9_]+$
  description: string
  parameters: ToolParams
  url: string           // POST endpoint (localhost allowed)
  apiKey?: string       // optional Bearer
  enabled: boolean
}

// Instruction + the tools it turns on. Selecting a skill for a run merges its
// instruction into the system prompt and its toolIds into the run's tool set.
export interface Skill {
  id: string
  name: string
  instruction: string
  toolIds: string[]     // built-in and custom tool ids this skill enables
  enabled: boolean
}

// ─── Datasets ────────────────────────────────────────────────────────────────

// One variable of a dataset's schema. `type` drives how the model's answer is
// normalized before it's compared to ground truth (dates/numbers are format-
// tolerant so a correct answer in another format isn't penalized).
export type DatasetVarType = 'text' | 'date' | 'number'

export interface DatasetVar {
  key: string           // ^[a-z0-9_]+$ — also the JSON key the model must return
  type: DatasetVarType
  desc?: string         // shown to the human; steers the model in the prompt
}

// One dataset item: a file plus its per-variable ground-truth values. In stage 1
// the item is always a file (image/PDF); ground truth is entered by hand.
export interface DatasetItem {
  id: string
  idx: number
  attachmentId: string | null
  attachment?: AttachmentMeta | null
  // The item's text input, for text-type datasets (null for file items).
  input: string | null
  // For 'code' items: the hidden test source (ground truth). The model's
  // solution is run against it; the score is the fraction of tests that pass.
  tests: string | null
  groundTruth: Record<string, string>
  // Values the trusted model proposed, awaiting human confirmation. A key here
  // that isn't yet in groundTruth renders as an AI suggestion (✦).
  aiSuggested: Record<string, string>
  createdAt: number
}

// A dataset: files + a variable schema + ground truth, scored per field against
// model output. `trustedModel` (providerId:model) is excluded from comparison
// runs so it never competes against itself.
export interface Dataset {
  id: string
  name: string
  note: string | null
  // 'files' = each item is an uploaded file; 'text'/'tools' = each item carries a
  // text `input` (a task / a tool-calling request) instead of a file; 'code' =
  // each item is a coding task whose model solution is run against hidden tests.
  type: 'files' | 'text' | 'tools' | 'code'
  // For 'code' datasets: which interpreter runs the solution. NULL otherwise.
  language: 'python' | 'javascript' | null
  schema: DatasetVar[]
  trustedModel: string | null
  createdAt: number
  updatedAt: number
  itemCount?: number
  labeledCount?: number
  items?: DatasetItem[]
}

// One human verdict for an item of an arena run: which model answered best and,
// optionally, worst — or the item was skipped. Elo/W-L standings are derived
// from these, never stored.
export interface ArenaVerdict {
  promptIndex: number
  bestModel: string | null
  worstModel: string | null
  skipped: boolean
}

export interface ArenaStanding {
  model: string
  elo: number
  wins: number   // times picked best
  losses: number // times picked worst
}

// A registered MCP server. Selected on a run, benchy connects for the run's
// duration, lists its tools, and disconnects when the run finishes.
export interface McpServer {
  id: string
  name: string
  transport: 'stdio' | 'sse' | 'http'
  url?: string          // sse/http
  command?: string      // stdio
  apiKey?: string
  enabled: boolean
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

// One tool the model invoked, with what it got back. Stored per result so a
// reopened dialog shows the same trace the live run did.
export interface ToolActivity {
  name: string
  args: unknown
  result: string
  isError: boolean
  ms: number
}

export interface Result {
  id: string
  runId: string
  promptIndex: number
  model: string
  providerId: string
  text: string
  // The model's thinking, kept out of `text` so the answer stays the answer.
  reasoning: string | null
  toolCalls: ToolActivity[]
  metrics: Metrics
  feedback: 'up' | 'down' | null
  error: string | null
  createdAt: number
  // Set only for results of a dataset run: per-field accuracy (matched/scored)
  // and the per-key match map. NULL/absent for ordinary runs.
  score?: number | null
  scoreDetail?: Record<string, 'match' | 'miss'> | null
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
  tools?: string[]
  systemPrompt?: string | null
  skills?: string[]
  mcp?: string[]
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
  // Tool ids the run may use (calc, fetch_url, web_search). Absent/empty ⇒ the
  // provider request goes out with no tools, exactly as before tools existed.
  // Deliberately its own field, not part of RunSettings, which is Partial<
  // ProviderDefaults> — a tool set is not a generation parameter.
  tools?: string[]
  // One system prompt prepended for every model in the run, so the comparison
  // holds the instructions constant. Absent/empty ⇒ no system message is sent.
  systemPrompt?: string
  // Selected skill ids (fold into tools + system at dispatch) and MCP-server ids
  // (registry-only for now — stored, not yet executed).
  skills?: string[]
  mcp?: string[]
}
