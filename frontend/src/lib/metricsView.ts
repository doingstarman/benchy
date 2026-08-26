import type { MetricDef, MetricDirection, TargetKind, CustomMetric } from '../../../src/types'
import {
  resolveBuiltins, topoSortCustoms, evaluateAnswerCustoms, evaluateRunCustom,
  type AnswerMetricInput,
} from '../../../src/metrics/resolve'
import { aggregate, type Scope } from '../../../src/metrics/expr'

// Turn a run's raw answers + the metric registry into a per-participant table of
// display values, reusing the pure resolver (src/metrics/resolve.ts) client-side —
// exactly the derivation api/metrics.ts uses server-side, so the table needs no
// backend call and a metric created after a run still shows for it. Agent columns
// carry trajectory fields (steps/toolCalls/toolErrors/agentCost) derived from the
// result's trace; model columns leave them undefined so they resolve to null.

// A participant answer is exactly the resolver's per-answer input.
export type ParticipantAnswer = AnswerMetricInput

// A metric applies to a participant kind iff that kind is in its appliesTo. A metric
// that does NOT apply is SKIPPED (a hatched cell) — distinct from a null value and 0.
export function appliesToKind(def: MetricDef, kind: TargetKind): boolean {
  return def.appliesTo.includes(kind)
}

function toCustom(d: MetricDef & { expression: string }): CustomMetric {
  return {
    key: d.key, name: d.name, expression: d.expression, unit: d.unit, format: d.format,
    direction: d.direction, scope: d.scope, aggregate: d.aggregate, nullable: d.nullable,
    enabled: d.enabled, sortOrder: 0, appliesTo: d.appliesTo, createdAt: 0, updatedAt: 0,
  }
}

function customMetrics(defs: MetricDef[]): CustomMetric[] {
  const customs = defs
    .filter((d): d is MetricDef & { expression: string } => d.kind === 'custom' && d.expression != null)
    .map(toCustom)
  try { return topoSortCustoms(customs) } catch { return [] } // a bad-state cycle just drops customs
}

// The full per-answer scope for one result: built-ins layered with per-answer customs.
function answerScope(a: ParticipantAnswer, ordered: CustomMetric[]): Scope {
  const builtin = resolveBuiltins(a)
  return { ...builtin, ...evaluateAnswerCustoms(ordered, builtin) }
}

// Per-participant-per-run value for every metric: a built-in is aggregated over the
// participant's answers (by its run aggregate, else mean); a per-run custom via
// evaluateRunCustom. (`elo` has no per-answer value client-side → null.)
export function participantValues(answers: ParticipantAnswer[], defs: MetricDef[]): Record<string, number | null> {
  const ordered = customMetrics(defs)
  const scopes = answers.map(a => answerScope(a, ordered))
  const collapse = (key: string, agg: string) =>
    aggregate(agg, scopes.map(s => s[key]).filter((v): v is number => v != null))

  const out: Record<string, number | null> = {}
  for (const def of defs) {
    if (def.kind === 'custom' && def.expression && def.scope === 'run') {
      out[def.key] = evaluateRunCustom(toCustom({ ...def, expression: def.expression }), scopes)
    } else {
      out[def.key] = collapse(def.key, def.scope === 'run' ? (def.aggregate ?? 'mean') : 'mean')
    }
  }
  return out
}

// The best value in a column for a metric — accented only for a directional metric.
export function bestValue(values: (number | null)[], direction: MetricDirection): number | null {
  if (direction === 'neutral') return null
  const real = values.filter((v): v is number => v != null)
  if (!real.length) return null
  return direction === 'lower' ? Math.min(...real) : Math.max(...real)
}
