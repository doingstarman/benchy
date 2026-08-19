import type { MetricDef, MetricDirection, MetricFormat, MetricScope, MetricAggregate } from '../types.js'

// Built-in metrics are DEFINED IN CODE, not the DB — their resolver is code (read a
// `results` column, compute cost from tokens×pricing, read elo from arena). They are
// never materialized; they resolve at read time. Only their enabled-state persists
// (config `disabledMetrics`). name/key/unit/direction/scope are fixed.

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
}

export const BUILTIN_METRICS: BuiltinDef[] = [
  { key: 'ttfs', name: 'Time to first token', unit: 'ms', format: 'ms', direction: 'lower', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true },
  { key: 'total_time', name: 'Total time', unit: 's', format: 's', direction: 'lower', scope: 'answer', aggregate: null, nullable: false, defaultEnabled: true },
  { key: 'input_tokens', name: 'Input tokens', unit: 'tokens', format: 'tokens', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true },
  { key: 'output_tokens', name: 'Output tokens', unit: 'tokens', format: 'tokens', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true },
  { key: 'reasoning_tokens', name: 'Reasoning tokens', unit: 'tokens', format: 'tokens', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true },
  { key: 'reasoning_ms', name: 'Reasoning time', unit: 's', format: 's', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: false },
  { key: 'score', name: 'Score', unit: '%', format: 'pct', direction: 'higher', scope: 'run', aggregate: 'mean', nullable: true, defaultEnabled: true },
  { key: 'cost', name: 'Cost', unit: 'USD', format: 'usd', direction: 'lower', scope: 'run', aggregate: 'sum', nullable: true, defaultEnabled: true },
  { key: 'elo', name: 'Elo', unit: 'rating', format: 'raw', direction: 'higher', scope: 'run', aggregate: null, nullable: true, defaultEnabled: true },
]

export const BUILTIN_KEYS: string[] = BUILTIN_METRICS.map(m => m.key)
export const DEFAULT_DISABLED_METRICS: string[] = BUILTIN_METRICS.filter(m => !m.defaultEnabled).map(m => m.key)

export function isBuiltinKey(key: string): boolean {
  return BUILTIN_KEYS.includes(key)
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
  }))
}
