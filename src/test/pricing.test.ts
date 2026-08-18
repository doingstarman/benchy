import { describe, it, expect } from 'vitest'
import { pricingFor, computeCost, formatCost, resolvePricing } from '../pricing.js'

describe('pricing', () => {
  it('prices by the model part of a provider:model id, null when unknown', () => {
    expect(pricingFor('openai:gpt-4o')).toEqual({ inputPer1M: 2.5, outputPer1M: 10 })
    expect(pricingFor('gpt-4o')).toEqual({ inputPer1M: 2.5, outputPer1M: 10 })
    expect(pricingFor('p:some-unlisted-model')).toBeNull()
  })

  it('prefers a provider override over the table, and falls back when it has no entry', () => {
    const overrides = { 'gpt-4o': { inputPer1M: 99, outputPer1M: 199 } }
    // Override wins for gpt-4o…
    expect(resolvePricing('openai:gpt-4o', overrides)).toEqual({ inputPer1M: 99, outputPer1M: 199 })
    // …but a model the override doesn't list falls back to the curated table…
    expect(resolvePricing('openai:gpt-4o-mini', overrides)).toEqual({ inputPer1M: 0.15, outputPer1M: 0.6 })
    // …and an unknown model with no override is null (no confidently-wrong cost).
    expect(resolvePricing('p:mystery', overrides)).toBeNull()
    // No overrides at all behaves like the table.
    expect(resolvePricing('gpt-4o')).toEqual({ inputPer1M: 2.5, outputPer1M: 10 })
  })

  it('computes cost from tokens, or null when usage is missing', () => {
    expect(computeCost({ inputPer1M: 2.5, outputPer1M: 10 }, 1_000_000, 1_000_000)).toBe(12.5)
    expect(computeCost(null, 1, 1)).toBeNull()
    expect(computeCost({ inputPer1M: 1, outputPer1M: 1 }, null, 5)).toBeNull()
  })

  it('formats sub-cent, cent, and dollar costs at readable precision', () => {
    expect(formatCost(null)).toBe('—')
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.0001234)).toBe('$0.0001')
    expect(formatCost(0.1234)).toBe('$0.123')
    expect(formatCost(12.345)).toBe('$12.35')
  })
})
