import type { MetricDef, MetricDirection, MetricFormat, MetricScope, MetricAggregate, TargetKind } from '../types.js'

// Built-in metrics are DEFINED IN CODE, not the DB — their resolver is code (read a
// `results` column, compute cost from tokens×pricing, read elo from arena). They are
// never materialized; they resolve at read time. Only their enabled-state persists
// (config `disabledMetrics`). name/key/unit/direction/scope are fixed.
//
// `appliesTo` names the participant kinds a metric measures. A metric absent for a
// kind is SKIPPED for that target (distinct from a null value): ttfs/reasoning are
// model-only, the trajectory metrics (steps, tool_calls, …) are agent-only.

interface BuiltinDef {
  key: string
  name: string
  unit: string | null
  format: MetricFormat
  direction: MetricDirection
  scope: MetricScope
  aggregate: MetricAggregate | null
  nullable: boolean
  defaultEnabled: boolean
  appliesTo: TargetKind[]
}

const MODEL: TargetKind[] = ['model']
const BOTH: TargetKind[] = ['model', 'agent']
const AGENT: TargetKind[] = ['agent']

export const BUILTIN_METRICS: BuiltinDef[] = [
  { key: 'ttfs', name: 'Time to first token', unit: 'ms', format: 'ms', direction: 'lower', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true, appliesTo: MODEL },
  { key: 'total_time', name: 'Total time', unit: 's', format: 's', direction: 'lower', scope: 'answer', aggregate: null, nullable: false, defaultEnabled: true, appliesTo: BOTH },
  { key: 'input_tokens', name: 'Input tokens', unit: 'tokens', format: 'tokens', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true, appliesTo: BOTH },
  { key: 'output_tokens', name: 'Output tokens', unit: 'tokens', format: 'tokens', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true, appliesTo: BOTH },
  { key: 'reasoning_tokens', name: 'Reasoning tokens', unit: 'tokens', format: 'tokens', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true, appliesTo: MODEL },
  { key: 'reasoning_ms', name: 'Reasoning time', unit: 's', format: 's', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: false, appliesTo: MODEL },
  { key: 'score', name: 'Score', unit: '%', format: 'pct', direction: 'higher', scope: 'run', aggregate: 'mean', nullable: true, defaultEnabled: true, appliesTo: BOTH },
  { key: 'cost', name: 'Cost', unit: 'USD', format: 'usd', direction: 'lower', scope: 'run', aggregate: 'sum', nullable: true, defaultEnabled: true, appliesTo: MODEL },
  { key: 'elo', name: 'Elo', unit: 'rating', format: 'raw', direction: 'higher', scope: 'run', aggregate: null, nullable: true, defaultEnabled: true, appliesTo: MODEL },
  // ── agent trajectory metrics (per result, resolved from trace_steps) ──
  { key: 'steps', name: 'Steps', unit: 'steps', format: 'raw', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true, appliesTo: AGENT },
  { key: 'tool_calls', name: 'Tool calls', unit: 'calls', format: 'raw', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true, appliesTo: AGENT },
  { key: 'tool_error_rate', name: 'Tool error rate', unit: '%', format: 'pct', direction: 'lower', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true, appliesTo: AGENT },
  { key: 'agent_cost', name: 'Agent cost', unit: 'USD', format: 'usd', direction: 'lower', scope: 'run', aggregate: 'sum', nullable: true, defaultEnabled: true, appliesTo: AGENT },
  { key: 'wall_clock', name: 'Wall clock', unit: 'ms', format: 'ms', direction: 'lower', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true, appliesTo: AGENT },
]

export const BUILTIN_KEYS: string[] = BUILTIN_METRICS.map(m => m.key)
export const DEFAULT_DISABLED_METRICS: string[] = BUILTIN_METRICS.filter(m => !m.defaultEnabled).map(m => m.key)

// Built-ins a custom expression may reference: exactly those `resolveBuiltins`
// provides per answer. `elo` is per-run only (from arena standings) and has no
// per-answer value, so referencing it would materialize to null — keep it out.
export const RESOLVABLE_BUILTIN_KEYS: string[] = [
  'ttfs', 'total_time', 'input_tokens', 'output_tokens', 'reasoning_tokens', 'reasoning_ms', 'score', 'cost',
  'steps', 'tool_calls', 'tool_error_rate', 'agent_cost', 'wall_clock',
]

export function isBuiltinKey(key: string): boolean {
  return BUILTIN_KEYS.includes(key)
}

export function builtinAppliesTo(key: string): TargetKind[] {
  return BUILTIN_METRICS.find(m => m.key === key)?.appliesTo ?? ['model', 'agent', 'pipeline']
}

// The registry view of the built-ins, with enabled applied from config.
export function builtinDefs(disabled: string[]): MetricDef[] {
  return BUILTIN_METRICS.map(m => ({
    key: m.key,
    name: m.name,
    kind: 'builtin' as const,
    expression: null,
    unit: m.unit,
    format: m.format,
    direction: m.direction,
    scope: m.scope,
    aggregate: m.aggregate,
    nullable: m.nullable,
    enabled: !disabled.includes(m.key),
    appliesTo: m.appliesTo,
  }))
}
