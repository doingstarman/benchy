import { describe, it, expect } from 'vitest'
import type { MetricDef, MetricFormat, MetricDirection, MetricScope, MetricAggregate, TargetKind } from '../../../src/types'
import { participantValues, appliesToKind, bestValue, type ParticipantAnswer } from './metricsView'

function def(key: string, over: Partial<MetricDef> = {}): MetricDef {
  return {
    key, name: key, kind: 'builtin', expression: null, unit: null,
    format: 'raw' as MetricFormat, direction: 'neutral' as MetricDirection,
    scope: 'answer' as MetricScope, aggregate: null as MetricAggregate | null,
    nullable: true, enabled: true, appliesTo: ['model', 'agent'] as TargetKind[], ...over,
  }
}

function answer(over: Partial<ParticipantAnswer> = {}): ParticipantAnswer {
  return {
    ttfs: null, totalTime: null, inputTokens: null, outputTokens: null,
    reasoningTokens: null, reasoningMs: null, score: null, model: 'p:m', ...over,
  }
}

const DEFS: MetricDef[] = [
  def('ttfs', { format: 'ms', direction: 'lower', appliesTo: ['model'] }),
  def('total_time', { format: 's', appliesTo: ['model', 'agent'] }),
  def('score', { format: 'pct', direction: 'higher', scope: 'run', aggregate: 'mean', appliesTo: ['model', 'agent'] }),
  def('steps', { direction: 'neutral', appliesTo: ['agent'] }),
]

describe('appliesToKind', () => {
  it('a metric applies only to the kinds in its appliesTo', () => {
    expect(appliesToKind(DEFS[0], 'model')).toBe(true)   // ttfs
    expect(appliesToKind(DEFS[0], 'agent')).toBe(false)
    expect(appliesToKind(DEFS[3], 'agent')).toBe(true)    // steps
    expect(appliesToKind(DEFS[3], 'model')).toBe(false)
  })
})

describe('participantValues — model column', () => {
  const vals = participantValues(
    [answer({ ttfs: 100, totalTime: 1, score: 1 }), answer({ ttfs: 200, totalTime: 2, score: 0 })],
    DEFS,
  )
  it('answer-scope built-ins average over the participant answers', () => {
    expect(vals.ttfs).toBe(150)
    expect(vals.total_time).toBe(1.5)
  })
  it('run-scope score uses its aggregate (mean), not a plain average of raw', () => {
    expect(vals.score).toBe(0.5)
  })
  it('an agent-only metric is null for a model (never 0) — the cell hatches on appliesTo', () => {
    expect(vals.steps).toBeNull()
  })
})

describe('participantValues — agent column', () => {
  const vals = participantValues(
    [answer({ model: 'a1', totalTime: 4, steps: 3, toolCalls: 2, toolErrors: 0, agentCost: 0.01 }),
     answer({ model: 'a1', totalTime: 6, steps: 5, toolCalls: 4, toolErrors: 1, agentCost: 0.03 })],
    DEFS,
  )
  it('trajectory metrics aggregate from the trace-derived fields', () => {
    expect(vals.steps).toBe(4)          // mean(3,5)
    expect(vals.total_time).toBe(5)     // mean(4,6)
  })
  it('a model-only metric is null for an agent', () => {
    expect(vals.ttfs).toBeNull()
  })
})

describe('bestValue', () => {
  it('lower-is-better picks the min, higher-is-better the max', () => {
    expect(bestValue([150, 90, null], 'lower')).toBe(90)
    expect(bestValue([0.5, 0.9, null], 'higher')).toBe(0.9)
  })
  it('a neutral metric has no best (nothing accented)', () => {
    expect(bestValue([1, 2, 3], 'neutral')).toBeNull()
  })
  it('an all-null row has no best', () => {
    expect(bestValue([null, null], 'lower')).toBeNull()
  })
})
