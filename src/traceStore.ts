import { getDb } from './db/index.js'
import type { TraceStep } from './adapters/base.js'
import type { TraceStepRow } from './types.js'

// Persist a result's full trajectory. Called once with the ordered steps captured
// live from the trace stream, mirroring how tool_calls is written on the result.
//
// A step's `id` is unique only WITHIN a run — agents legitimately reuse the same
// ids across runs (a fixed script prints "plan"/"calc" every time). trace_steps.id
// is a global PK, so we namespace the stored id (and parent ref) by result_id to
// keep them globally unique while the parent chain still resolves per result.
export function insertTraceSteps(resultId: string, steps: TraceStep[]): void {
  if (steps.length === 0) return
  const db = getDb()
  const now = Date.now()
  const gid = (id: string) => `${resultId}:${id}`
  const stmt = db.prepare(
    `INSERT INTO trace_steps
      (id, result_id, step_index, parent_id, kind, name, ms, input_tokens, output_tokens, cost, payload, payload_truncated, is_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  db.transaction(() => {
    steps.forEach((s, i) => {
      stmt.run(
        gid(s.id), resultId, i, s.parentId != null ? gid(s.parentId) : null,
        s.kind, s.name, s.ms,
        s.inputTokens, s.outputTokens, s.cost, s.payload,
        s.payloadTruncated ? 1 : 0, s.isError ? 1 : 0, now,
      )
    })
  })()
}

interface Row {
  id: string; parent_id: string | null; kind: string; name: string | null; ms: number | null
  input_tokens: number | null; output_tokens: number | null; cost: number | null
  payload: string | null; payload_truncated: number; is_error: number
}

// Read a result's trajectory back in emission order, deriving each node's render
// depth from the parent chain (parents always precede children, so a single pass
// suffices).
export function readTrace(resultId: string): TraceStepRow[] {
  const rows = getDb().prepare(
    `SELECT id, parent_id, kind, name, ms, input_tokens, output_tokens, cost, payload, payload_truncated, is_error
       FROM trace_steps WHERE result_id = ? ORDER BY step_index`,
  ).all(resultId) as Row[]

  const depthById = new Map<string, number>()
  return rows.map(r => {
    const depth = r.parent_id != null && depthById.has(r.parent_id) ? (depthById.get(r.parent_id) as number) + 1 : 0
    depthById.set(r.id, depth)
    return {
      id: r.id,
      parentId: r.parent_id,
      depth,
      kind: r.kind,
      name: r.name,
      ms: r.ms,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cost: r.cost,
      payload: r.payload,
      payloadTruncated: r.payload_truncated === 1,
      isError: r.is_error === 1,
    }
  })
}

// The per-result aggregates the agent built-in metrics resolve over. Cheap enough
// to compute from the stored steps on read.
export interface TraceAggregate {
  steps: number
  toolCalls: number
  toolErrors: number
  agentCost: number | null
}

export function traceAggregate(resultId: string): TraceAggregate | null {
  const rows = getDb().prepare(
    'SELECT kind, cost, is_error FROM trace_steps WHERE result_id = ?',
  ).all(resultId) as { kind: string; cost: number | null; is_error: number }[]
  if (rows.length === 0) return null
  let toolCalls = 0, toolErrors = 0, cost = 0, sawCost = false
  for (const r of rows) {
    if (r.kind === 'tool') {
      toolCalls++
      if (r.is_error === 1) toolErrors++
    }
    if (r.cost != null) { cost += r.cost; sawCost = true }
  }
  return { steps: rows.length, toolCalls, toolErrors, agentCost: sawCost ? cost : null }
}
