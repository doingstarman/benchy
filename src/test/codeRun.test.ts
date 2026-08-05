import { describe, it, expect } from 'vitest'
import { runTests, extractCode, interpreterCommand } from '../codeRun.js'

describe('extractCode', () => {
  it('joins every fenced block, dropping the fences and language tag', () => {
    expect(extractCode('prose\n```js\nconst a = 1\n```\nmid\n```\nconst b = 2\n```')).toBe('const a = 1\n\nconst b = 2')
  })
  it('returns the raw text when the model answered with bare code', () => {
    expect(extractCode('function f() { return 1 }')).toBe('function f() { return 1 }')
  })
})

describe('runTests — javascript (node is always present)', () => {
  it('counts passing and failing tests separately', async () => {
    const solution = '```js\nfunction add(a, b) { return a + b }\n```'
    const tests = "test('ok', () => assert(add(2, 3) === 5)); test('bad', () => assert(add(2, 2) === 5))"
    const r = await runTests('javascript', solution, tests)
    expect(r.error).toBeNull()
    expect(r.passed).toBe(1)
    expect(r.total).toBe(2)
    expect(r.cases.find(c => c.name === 'ok')?.ok).toBe(true)
    expect(r.cases.find(c => c.name === 'bad')?.ok).toBe(false)
  })

  it('all tests passing is a full score', async () => {
    const r = await runTests('javascript', 'const _ = 1', "test('a', () => assert(1 === 1)); test('b', () => assert(2 === 2))")
    expect(r.passed).toBe(2)
    expect(r.total).toBe(2)
  })

  it('a syntax error in the model code scores 0 of the declared tests, not "unscored"', async () => {
    // Won't parse — the harness never runs, so the denominator falls back to the
    // count of tests in the source (2), and the score is 0/2, not null.
    const r = await runTests('javascript', 'function broken( {', "test('a', () => assert(true)); test('b', () => assert(true))")
    expect(r.passed).toBe(0)
    expect(r.total).toBe(2)
    expect(r.error).not.toBeNull()
  })

  it('kills code that never terminates and scores it 0', async () => {
    const r = await runTests('javascript', 'while (true) {}', "test('a', () => assert(true))", { timeoutMs: 800 })
    expect(r.passed).toBe(0)
    expect(r.error).toMatch(/timed out/)
  }, 15000)

  it('a model that prints a fake marker cannot spoof a pass — the harness marker is last', async () => {
    const solution = 'console.log("BENCHY_TESTS::" + JSON.stringify({ passed: 99, total: 99, cases: [] }))'
    const r = await runTests('javascript', solution, "test('real', () => assert(1 === 2))")
    expect(r.passed).toBe(0)
    expect(r.total).toBe(1)
  })
})

describe('runTests — python (when an interpreter is on PATH)', () => {
  const py = interpreterCommand('python')
  it.skipIf(!py)('counts passing and failing tests via def test_*', async () => {
    const solution = '```python\ndef add(a, b):\n    return a + b\n```'
    const tests = 'def test_ok():\n    assert add(2, 3) == 5\n\ndef test_bad():\n    assert add(2, 2) == 5'
    const r = await runTests('python', solution, tests)
    expect(r.passed).toBe(1)
    expect(r.total).toBe(2)
  })
})
