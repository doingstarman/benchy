import { describe, it, expect } from 'vitest'
import { parseCsv } from '../csv.js'

describe('parseCsv', () => {
  it('parses a simple grid', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })

  it('handles quoted commas, escaped quotes, and newlines inside quotes', () => {
    expect(parseCsv('x\n"a,b"')).toEqual([['x'], ['a,b']])
    expect(parseCsv('x\n"a""b"')).toEqual([['x'], ['a"b']])
    expect(parseCsv('x\n"a\nb"')).toEqual([['x'], ['a\nb']])
  })

  it('normalizes CRLF and drops a trailing blank line', () => {
    expect(parseCsv('a\r\n1\r\n')).toEqual([['a'], ['1']])
  })

  it('keeps empty cells but drops fully-empty rows', () => {
    expect(parseCsv('a,b\n1,\n\n,2')).toEqual([['a', 'b'], ['1', ''], ['', '2']])
  })
})
