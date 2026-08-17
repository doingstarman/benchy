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

// "это то же самое": opting a type into lenient scoring keeps only the value's
// core, so surrounding noise stops being a miss — but a real difference still is.
describe('valuesMatch — lenient (это то же самое)', () => {
  it('number ignores a currency word only when lenient', () => {
    expect(valuesMatch('number', '214.08', '214,08 руб.')).toBe(false)
    expect(valuesMatch('number', '214.08', '214,08 руб.', true)).toBe(true)
    expect(valuesMatch('number', '1105.90', '1 105,90 ₽', true)).toBe(true)
  })
  it('date pulls the date out of prose when lenient', () => {
    expect(valuesMatch('date', '2024-03-12', 'выдан 12.03.2024 г.', true)).toBe(true)
  })
  it('text drops punctuation when lenient', () => {
    expect(valuesMatch('text', 'ООО Ромашка', '«ООО Ромашка».', true)).toBe(true)
  })
  it('lenient is not blindness — a real difference still misses', () => {
    expect(valuesMatch('number', '214.08', '999 руб.', true)).toBe(false)
    expect(valuesMatch('text', 'Магнит', 'Пятёрочка!', true)).toBe(false)
  })
})

// A tool call's arguments arrive as decoded JSON — an object/array, not a string.
// String-comparing them reads the model's object as "[object Object]" and always
// misses; these compare by shape so a differently-written-but-equal call scores.
describe('valuesMatch — structured tool arguments', () => {
  it('object keys match in any order, and the model object arrives decoded', () => {
    expect(valuesMatch('text', '{"a":1,"b":2}', { b: 2, a: 1 })).toBe(true)
  })

  it('whitespace and numeric formatting inside the JSON are irrelevant', () => {
    expect(valuesMatch('text', '{"a": 1}', '{"a":1}')).toBe(true)
    expect(valuesMatch('text', '{"n":5.0}', { n: 5 })).toBe(true)
  })

  it('a number equals its stringified form inside a structure (5 vs "5")', () => {
    expect(valuesMatch('text', '{"limit":5}', { limit: '5' })).toBe(true)
  })

  it('nested objects and case/trim on string leaves', () => {
    expect(valuesMatch('text', '{"q":"Moscow","opts":{"safe":true}}', { opts: { safe: true }, q: 'moscow ' })).toBe(true)
  })

  it('arrays stay order-sensitive — argument order carries meaning', () => {
    expect(valuesMatch('text', '{"tags":["a","b"]}', { tags: ['a', 'b'] })).toBe(true)
    expect(valuesMatch('text', '{"tags":["a","b"]}', { tags: ['b', 'a'] })).toBe(false)
  })

  it('a genuinely different structure still misses', () => {
    expect(valuesMatch('text', '{"a":1,"b":2}', { a: 1 })).toBe(false)          // missing key
    expect(valuesMatch('text', '{"a":1}', { a: 2 })).toBe(false)                // different value
    expect(valuesMatch('text', '{"a":1}', 'sorry, no idea')).toBe(false)        // structure expected, prose given
  })

  it('does not disturb scalar matching — only JSON-structure ground truth triggers it', () => {
    expect(valuesMatch('text', 'Moscow', 'moscow')).toBe(true)                  // plain text unchanged
    expect(valuesMatch('text', 'true', 'True')).toBe(true)                      // JSON scalar → still text-folded
    expect(valuesMatch('number', '1 105,90', '1105.90')).toBe(true)            // number path unchanged
    expect(valuesMatch('text', '5', '6')).toBe(false)
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

  it('scores a tool call whose object argument is written differently but equal', () => {
    const toolsSchema: DatasetVar[] = [
      { key: 'tool', type: 'text' },
      { key: 'args', type: 'text' },
    ]
    const { score, detail } = scoreResult(
      toolsSchema,
      { tool: 'search', args: '{"query":"pizza","limit":5}' },
      '{"tool":"search","args":{"limit":"5","query":"Pizza"}}',
    )
    expect(score).toBe(1)
    expect(detail).toEqual({ tool: 'match', args: 'match' })
  })
})
