import { describe, it, expect } from 'vitest'
import { parse, validate, evaluate, evaluateRun, aggregate } from '../metrics/expr.js'

const KEYS = ['ttfs', 'total_time', 'input_tokens', 'output_tokens', 'reasoning_tokens', 'score', 'cost']
const ev = (src: string, scope: Record<string, number | null>) => {
  const { ast } = parse(src)
  return ast ? evaluate(ast, scope) : 'PARSE_FAIL'
}

describe('parse', () => {
  it('parses arithmetic with precedence and parens', () => {
    expect(parse('output_tokens / total_time * 1000').error).toBeNull()
    expect(parse('(a + b) / c').error).toBeNull()
  })
  it('reports an unbalanced bracket with a span', () => {
    const { ast, error } = parse('output_tokens / (total_time * 1000')
    expect(ast).toBeNull()
    expect(error?.message).toMatch(/never closed/i)
    expect(error?.span).toHaveLength(2)
  })
  it('rejects an empty expression and a trailing operator', () => {
    expect(parse('').error).toBeTruthy()
    expect(parse('ttfs +').error).toBeTruthy()
  })
})

describe('validate', () => {
  it('accepts a good per-answer expression and collects refs', () => {
    const r = validate('output_tokens / total_time * 1000', KEYS, 'answer')
    expect(r.ok).toBe(true)
    expect(r.refs.sort()).toEqual(['output_tokens', 'total_time'])
    expect(r.usesAggregate).toBe(false)
  })
  it('flags an unknown key, suggesting the nearest on a near-typo', () => {
    const far = validate('output_tokens / latency_ms * 1000', KEYS, 'answer')
    expect(far.ok).toBe(false)
    expect(far.error?.message).toMatch(/No metric named latency_ms/)

    expect(validate('ttf', KEYS, 'answer').error?.suggestion).toBe('ttfs')
    expect(validate('total_tim', KEYS, 'answer').error?.suggestion).toBe('total_time')
  })
  it('forbids aggregates in a per-answer metric', () => {
    expect(validate('p95(ttfs)', KEYS, 'answer').ok).toBe(false)
  })
  it('allows aggregates in a per-run metric, and requires keys be aggregated', () => {
    expect(validate('p95(ttfs)', KEYS, 'run').ok).toBe(true)
    expect(validate('mean(cost) / p95(ttfs)', KEYS, 'run').ok).toBe(true)
    const bare = validate('p95(ttfs) + ttfs', KEYS, 'run')
    expect(bare.ok).toBe(false)
    expect(bare.error?.message).toMatch(/must sit inside an aggregate/)
  })
  it('accepts a plain per-run expression (scope aggregate wraps it)', () => {
    expect(validate('cost / score', KEYS, 'run').ok).toBe(true)
  })
  it('checks function arity', () => {
    expect(validate('clamp(ttfs, 0)', KEYS, 'answer').ok).toBe(false)
    expect(validate('round(ttfs, 2)', KEYS, 'answer').ok).toBe(true)
  })

  it('rejects a nested aggregate (would silently evaluate to null)', () => {
    expect(validate('mean(max(ttfs))', KEYS, 'run').ok).toBe(false)
    expect(validate('mean(ttfs) + max(mean(ttfs))', KEYS, 'run').ok).toBe(false)
    expect(validate('mean(ttfs) + max(total_time)', KEYS, 'run').ok).toBe(true) // siblings ok
  })

  it('fails a too-deeply-nested expression cleanly instead of throwing', () => {
    const deep = '('.repeat(500) + 'ttfs' + ')'.repeat(500)
    expect(() => validate(deep, KEYS, 'answer')).not.toThrow()
    expect(validate(deep, KEYS, 'answer').ok).toBe(false)
  })
})

describe('evaluate (per answer) — null ≠ 0, ÷0 → null', () => {
  const scope = { output_tokens: 812, total_time: 3100, score: 0, cost: 0.0031, reasoning_tokens: null }
  it('computes arithmetic', () => {
    expect(ev('output_tokens / total_time * 1000', scope)).toBeCloseTo(261.9, 1)
  })
  it('propagates null through any operand', () => {
    expect(ev('reasoning_tokens / output_tokens', scope)).toBeNull()
    expect(ev('reasoning_tokens + 1', scope)).toBeNull()
  })
  it('returns null on division by zero, not Infinity or 0', () => {
    expect(ev('cost / score', scope)).toBeNull()
  })
  it('keeps a real zero distinct from null', () => {
    expect(ev('score', scope)).toBe(0)
  })
  it('applies scalar functions', () => {
    expect(ev('abs(0 - ttfs)', { ttfs: 412 })).toBe(412)
    expect(ev('round(output_tokens / total_time, 2)', scope)).toBeCloseTo(0.26, 2)
    expect(ev('clamp(score, 0, 1)', { score: 1.5 })).toBe(1)
  })
})

describe('aggregate', () => {
  it('computes the collapse functions, null on empty', () => {
    const xs = [10, 20, 30, 40]
    expect(aggregate('sum', xs)).toBe(100)
    expect(aggregate('mean', xs)).toBe(25)
    expect(aggregate('min', xs)).toBe(10)
    expect(aggregate('max', xs)).toBe(40)
    expect(aggregate('median', xs)).toBe(20)
    expect(aggregate('p95', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(10)
    expect(aggregate('mean', [])).toBeNull()
  })
  it('ignores non-finite values (never returns NaN)', () => {
    expect(aggregate('mean', [1, NaN, 3])).toBe(2)
    expect(aggregate('p95', [5, NaN, 1, 9, 2])).toBe(9)
    expect(aggregate('mean', [NaN, Infinity])).toBeNull()
  })
})

describe('non-finite results collapse to null (never NaN/Infinity)', () => {
  it('overflow, big-minus-big, and out-of-range round → null', () => {
    expect(ev('9'.repeat(400), {})).toBeNull()          // 400-digit literal → Infinity
    expect(ev('x * x', { x: 1e200 })).toBeNull()        // overflow → Infinity
    expect(ev('round(5, 400)', {})).toBeNull()          // 10**400 = Infinity → NaN
    expect(ev('abs(0 - x)', { x: 42 })).toBe(42)        // ordinary case unaffected
  })
})

describe('evaluateRun', () => {
  const series = [
    { ttfs: 400, cost: 0.004, score: 0.8 },
    { ttfs: 600, cost: 0.006, score: 0 },      // score 0 → cost/score is null this answer
    { ttfs: 800, cost: 0.002, score: 0.5 },
  ]
  it('wraps a plain expression in the scope aggregate, skipping null answers', () => {
    const { ast } = parse('cost / score')
    // answers: 0.005, null(÷0), 0.004 → mean of [0.005, 0.004]
    expect(evaluateRun(ast!, series, 'mean')).toBeCloseTo(0.0045, 6)
  })
  it('collapses an in-expression aggregate over the answer series', () => {
    const { ast } = parse('p95(ttfs)')
    expect(evaluateRun(ast!, series, 'p95')).toBe(800)
  })
  it('combines multiple aggregates arithmetically', () => {
    const { ast } = parse('max(ttfs) - min(ttfs)')
    expect(evaluateRun(ast!, series, 'mean')).toBe(400)
  })
})
