import type { ModelPricing } from '../pricing.js'
import { resolvePricing, computeCost } from '../pricing.js'
import type { CustomMetric } from '../types.js'
import { parse, evaluate, evaluateRun, validate, type Scope } from './expr.js'
import { BUILTIN_KEYS } from './builtins.js'

// Pure (no db/node) so the frontend can reuse it. The db-facing materializer lives
// in the backend (api/metrics.ts); this file only turns inputs into values.

export interface AnswerMetricInput {
  ttfs: number | null
  totalTime: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  reasoningMs: number | null
  score: number | null
  model: string                                   // "providerId:model"
  pricingOverrides?: Record<string, ModelPricing>
}

// The per-answer built-ins a custom expression can reference. `elo` is per-run only
// (from arena standings) and is not part of the per-answer scope.
export function resolveBuiltins(r: AnswerMetricInput): Scope {
  return {
    ttfs: r.ttfs,
    total_time: r.totalTime,
    input_tokens: r.inputTokens,
    output_tokens: r.outputTokens,
    reasoning_tokens: r.reasoningTokens,
    reasoning_ms: r.reasoningMs,
    score: r.score,
    cost: computeCost(resolvePricing(r.model, r.pricingOverrides), r.inputTokens, r.outputTokens),
  }
}

// Order customs so each is evaluated after any custom it references; throws on a
// reference cycle (including self-reference). Refs to built-ins need no ordering.
export function topoSortCustoms(customs: CustomMetric[]): CustomMetric[] {
  const byKey = new Map(customs.map(c => [c.key, c]))
  const known = [...BUILTIN_KEYS, ...customs.map(c => c.key)]
  const state = new Map<string, 'visiting' | 'done'>()
  const out: CustomMetric[] = []
  const visit = (c: CustomMetric): void => {
    const s = state.get(c.key)
    if (s === 'done') return
    if (s === 'visiting') throw new Error(`Metric ${c.key} is part of a reference cycle`)
    state.set(c.key, 'visiting')
    for (const ref of validate(c.expression, known, c.scope).refs) {
      const dep = byKey.get(ref)
      if (dep) visit(dep)
    }
    state.set(c.key, 'done')
    out.push(c)
  }
  for (const c of customs) visit(c)
  return out
}

// Evaluate the enabled customs for one answer, layering each result into the scope
// so a custom may reference an earlier custom. Returns key → value|null.
export function evaluateAnswerCustoms(ordered: CustomMetric[], builtinScope: Scope): Record<string, number | null> {
  const scope: Scope = { ...builtinScope }
  const out: Record<string, number | null> = {}
  for (const c of ordered) {
    if (c.scope !== 'answer') continue
    const { ast } = parse(c.expression)
    const v = ast ? evaluate(ast, scope) : null
    scope[c.key] = v
    out[c.key] = v
  }
  return out
}

// Evaluate a per-run custom over the run's answer scopes (built-ins layered with the
// already-computed per-answer customs for each answer).
export function evaluateRunCustom(metric: CustomMetric, answerScopes: Scope[]): number | null {
  const { ast } = parse(metric.expression)
  if (!ast) return null
  return evaluateRun(ast, answerScopes, metric.aggregate ?? 'mean')
}
