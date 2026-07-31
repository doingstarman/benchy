import { describe, it, expect } from 'vitest'
import { valuesMatch, parseModelOutput, scoreResult } from '../scoring.js'
import type { DatasetVar } from '../types.js'

describe('valuesMatch', () => {
  it('normalizes numbers: thousands spaces and a comma decimal are the same value', () => {
    expect(valuesMatch('number', '1 105,90', 1105.9)).toBe(true)
    expect(valuesMatch('number', '1 105,90', '1105.90')).toBe(true)
    // A genuinely different amount must still miss — normalization ≠ blindness.
    expect(valuesMatch('number', '1 105,90', '1149.90')).toBe(false)
  })

  it('normalizes dates: DD.MM.YYYY and ISO are the same day', () => {
    expect(valuesMatch('date', '2024-03-12', '12.03.2024')).toBe(true)
    expect(valuesMatch('date', '2024-03-12', '2024-03-13')).toBe(false)
  })

  it('text is trimmed and case-folded', () => {
    expect(valuesMatch('text', 'Магнит', '  магнит ')).toBe(true)
    expect(valuesMatch('text', 'Магнит', 'Пятёрочка')).toBe(false)
  })
})

describe('parseModelOutput', () => {
  it('pulls the JSON object out of surrounding prose / fences', () => {
    expect(parseModelOutput('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseModelOutput('no json here')).toBeNull()
  })

  it('skips a stray non-JSON brace group and finds the real object after it', () => {
    // The old "first { … last }" slice spanned both groups and failed to parse,
    // scoring a correct answer as 0. The balanced scan must skip {id: 5}.
    expect(parseModelOutput('The record {id: 5} maps to {"amount":"100"}')).toEqual({ amount: '100' })
    // A brace inside a JSON string must not end the object early.
    expect(parseModelOutput('{"note":"a } brace","v":2}')).toEqual({ note: 'a } brace', v: 2 })
  })
})

describe('scoreResult', () => {
  const schema: DatasetVar[] = [
    { key: 'total', type: 'number' },
    { key: 'merchant', type: 'text' },
  ]

  it('scores matched fields over labeled fields — one hit, one miss ⇒ 0.5', () => {
    const { score, detail } = scoreResult(
      schema,
      { total: '1 105,90', merchant: 'Магнит' },
      '{"total": 1105.90, "merchant": "Пятёрочка"}',
    )
    expect(score).toBe(0.5)
    expect(detail).toEqual({ total: 'match', merchant: 'miss' })
  })

  it('skips unlabeled fields — an empty ground truth is not judged', () => {
    const { score, detail } = scoreResult(schema, { total: '10' }, '{"total": 10}')
    expect(score).toBe(1)
    expect(detail).toEqual({ total: 'match' })
  })

  it('unparseable output misses every labeled field', () => {
    const { score, detail } = scoreResult(schema, { total: '10', merchant: 'X' }, 'sorry, no idea')
    expect(score).toBe(0)
    expect(detail).toEqual({ total: 'miss', merchant: 'miss' })
  })
})
