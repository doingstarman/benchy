import type { Chunk, TraceStep, TraceStepKind, TraceErrorScope } from './base.js'
import type { ModelPricing } from '../pricing.js'
import { resolvePricing, computeCost } from '../pricing.js'

// The agent trace protocol, as a pure line parser shared by every transport
// (local stdout = JSONL, HTTP body = NDJSON). It turns one text line into zero or
// more Chunks and never throws: a line that is not JSON with a KNOWN `type` is an
// output token, exactly as bare stdout lines were before agents existed. This is
// the one file that owns the protocol's rules, so the adapters stay thin.
//
// See docs/agent-protocol.md for the wire format.

const KNOWN_TYPES = new Set(['step', 'tool', 'model', 'token', 'reasoning', 'error', 'done'])
const MAX_DEPTH = 3
const DEFAULT_PAYLOAD_CAP = 8 * 1024

// Fields the parser reads directly; everything else on a line is folded into the
// stored payload so an agent can attach arbitrary context without losing it.
const RESERVED = new Set([
  'type', 'id', 'parent', 'parentId', 'kind', 'name', 'ms', 'usage', 'cost',
  'scope', 'isError', 'is_error',
])

export interface TraceParserOptions {
  payloadCapBytes?: number
  // For the cost fallback: usage + this model name → price table → cost.
  model?: string
  pricingOverrides?: Record<string, ModelPricing>
}

export interface TraceParser {
  push(line: string): Chunk[]
  readonly warnings: string[]
}

interface RawLine {
  type?: unknown
  id?: unknown
  parent?: unknown
  parentId?: unknown
  kind?: unknown
  name?: unknown
  ms?: unknown
  usage?: { inputTokens?: unknown; outputTokens?: unknown } | unknown
  cost?: unknown
  scope?: unknown
  text?: unknown
  isError?: unknown
  is_error?: unknown
  [k: string]: unknown
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function usageTokens(u: unknown): { input: number | null; output: number | null } {
  if (!u || typeof u !== 'object') return { input: null, output: null }
  const o = u as { inputTokens?: unknown; outputTokens?: unknown; input_tokens?: unknown; output_tokens?: unknown }
  return {
    input: num(o.inputTokens) ?? num(o.input_tokens),
    output: num(o.outputTokens) ?? num(o.output_tokens),
  }
}

function stepKind(type: string, rawKind: unknown): TraceStepKind {
  if (type === 'tool') return 'tool'
  if (type === 'model') return 'model'
  const k = str(rawKind)
  const allowed: TraceStepKind[] = ['step', 'think', 'plan', 'tool', 'model', 'retry', 'error', 'answer']
  return (k && (allowed as string[]).includes(k) ? k : 'step') as TraceStepKind
}

// The step's payload is every non-reserved field on the line (args, result,
// output, …), JSON-encoded, capped at the byte limit with the truncation flagged
// rather than silently cut.
function buildPayload(raw: RawLine, capBytes: number): { payload: string | null; truncated: boolean } {
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!RESERVED.has(k) && v !== undefined) extra[k] = v
  }
  if (Object.keys(extra).length === 0) return { payload: null, truncated: false }
  let json: string
  try { json = JSON.stringify(extra) } catch { return { payload: null, truncated: false } }
  const bytes = Buffer.byteLength(json, 'utf-8')
  if (bytes <= capBytes) return { payload: json, truncated: false }
  // Cut on a character boundary at or under the cap, then flag it.
  let cut = json.slice(0, capBytes)
  while (Buffer.byteLength(cut, 'utf-8') > capBytes) cut = cut.slice(0, -1)
  return { payload: cut, truncated: true }
}

export function createTraceParser(opts: TraceParserOptions = {}): TraceParser {
  const cap = opts.payloadCapBytes ?? DEFAULT_PAYLOAD_CAP
  const warnings: string[] = []
  const seen = new Set<string>()
  const depthById = new Map<string, number>()
  const parentById = new Map<string, string | null>()
  let order = 0

  const asToken = (line: string): Chunk[] => [{ type: 'token', text: line + '\n' }]

  const resolveCost = (explicit: number | null, input: number | null, output: number | null): number | null => {
    if (explicit != null) return explicit
    if (opts.model && input != null && output != null) {
      return computeCost(resolvePricing(opts.model, opts.pricingOverrides), input, output)
    }
    return null
  }

  // Assign a unique id, then resolve the parent to an EARLIER id — a forward or
  // unknown ref is dropped to null with a warning, never fatal. Nesting past
  // MAX_DEPTH is flattened by reparenting onto the nearest allowed ancestor.
  const place = (rawId: unknown, rawParent: unknown): { id: string; parentId: string | null } => {
    let id = str(rawId) ?? `s${order}`
    if (seen.has(id)) {
      warnings.push(`duplicate step id "${id}" — reassigned`)
      let n = 2
      while (seen.has(`${id}#${n}`)) n++
      id = `${id}#${n}`
    }
    seen.add(id)

    let parent = rawParent == null ? null : str(rawParent)
    if (parent != null && !depthById.has(parent)) {
      warnings.push(`step "${id}" references unknown/forward parent "${parent}" — dropped`)
      parent = null
    }
    let depth = parent == null ? 0 : (depthById.get(parent) ?? 0) + 1
    while (depth > MAX_DEPTH && parent != null) {
      parent = parentById.get(parent) ?? null
      depth = parent == null ? 0 : (depthById.get(parent) ?? 0) + 1
    }
    if (depth > MAX_DEPTH) depth = MAX_DEPTH
    depthById.set(id, depth)
    parentById.set(id, parent)
    return { id, parentId: parent }
  }

  const push = (line: string): Chunk[] => {
    if (line.length === 0) return []

    let raw: RawLine
    try {
      const parsed: unknown = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return asToken(line)
      raw = parsed as RawLine
    } catch {
      return asToken(line)
    }

    const type = str(raw.type)
    if (!type || !KNOWN_TYPES.has(type)) return asToken(line)
    order++

    if (type === 'token') return [{ type: 'token', text: str(raw.text) ?? '' }]
    if (type === 'reasoning') return [{ type: 'reasoning', text: str(raw.text) ?? '' }]
    if (type === 'done') {
      const u = usageTokens(raw.usage)
      return [{ type: 'done', usage: { inputTokens: u.input ?? 0, outputTokens: u.output ?? 0 } }]
    }

    if (type === 'error') {
      const scope = (str(raw.scope) as TraceErrorScope | null) ?? 'agent'
      const message = str(raw.name) ?? str(raw.text) ?? 'agent reported an error'
      // A tool-scope error is recoverable: it becomes a trace step, not a fatal
      // chunk, so the run keeps going and the trajectory records the failure.
      if (scope === 'tool') {
        const { id, parentId } = place(raw.id, raw.parent ?? raw.parentId)
        const { payload, truncated } = buildPayload(raw, cap)
        const step: TraceStep = {
          id, parentId, kind: 'error', name: message, ms: num(raw.ms),
          inputTokens: null, outputTokens: null, cost: null,
          payload, payloadTruncated: truncated, isError: true,
        }
        return [{ type: 'step', step }]
      }
      return [{ type: 'error', message, scope }]
    }

    // step | tool | model → a stored trajectory node.
    const { id, parentId } = place(raw.id, raw.parent ?? raw.parentId)
    const u = usageTokens(raw.usage)
    const { payload, truncated } = buildPayload(raw, cap)
    const isError = raw.isError === true || raw.is_error === true
    const step: TraceStep = {
      id,
      parentId,
      kind: stepKind(type, raw.kind),
      name: str(raw.name),
      ms: num(raw.ms),
      inputTokens: u.input,
      outputTokens: u.output,
      cost: resolveCost(num(raw.cost), u.input, u.output),
      payload,
      payloadTruncated: truncated,
      isError,
    }
    return [{ type: 'step', step }]
  }

  return { push, get warnings() { return warnings } }
}

// Feed a growing text buffer and get back complete-line chunks, keeping the
// trailing partial line for the next call. `flush()` drains whatever remains once
// the stream ends. Mirrors the remainder-buffer idiom in http-json.ts.
export interface LineStreamer {
  feed(text: string): Chunk[]
  flush(): Chunk[]
}

// True when a response body is a trace stream (NDJSON), as opposed to a one-shot
// JSON/text reply the HTTP adapters already handle.
export function isNdjson(contentType: string): boolean {
  return contentType.includes('application/x-ndjson') || contentType.includes('application/jsonl')
}

// Drive the parser over an HTTP response body, yielding chunks as lines complete.
// Synthesizes a terminal `done` if the agent never sent one, matching the local
// script path.
export async function* streamNdjson(body: ReadableStream<Uint8Array>, opts: TraceParserOptions = {}): AsyncGenerator<Chunk> {
  const streamer = createLineStreamer(createTraceParser(opts))
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let sawDone = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    for (const c of streamer.feed(decoder.decode(value, { stream: true }))) {
      if (c.type === 'done') sawDone = true
      yield c
    }
  }
  for (const c of streamer.flush()) {
    if (c.type === 'done') sawDone = true
    yield c
  }
  if (!sawDone) yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }
}

export function createLineStreamer(parser: TraceParser): LineStreamer {
  let buffer = ''
  return {
    feed(text: string): Chunk[] {
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      const out: Chunk[] = []
      for (const line of lines) out.push(...parser.push(line.replace(/\r$/, '')))
      return out
    },
    flush(): Chunk[] {
      if (buffer.length === 0) return []
      const rest = buffer.replace(/\r$/, '')
      buffer = ''
      return parser.push(rest)
    },
  }
}
