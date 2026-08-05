import { describe, it, expect } from 'vitest'
import { runTests, extractCode, interpreterCommand } from '../codeRun.js'

describe('extractCode', () => {
  it('takes the largest fenced block (the solution), not a small example block', () => {
    const text = 'Here:\n```js\nfunction add(a, b) { return a + b }  // the real solution here\n```\nExample:\n```js\ntest("x")\n```'
    expect(extractCode(text, 'javascript')).toBe('function add(a, b) { return a + b }  // the real solution here')
  })
  it('prefers a block tagged with the run language even when another is larger', () => {
    const text = '```python\n# a long pythonic note, quite lengthy indeed, longer than the js\n```\n```js\nconst f = 1\n```'
    expect(extractCode(text, 'javascript')).toBe('const f = 1')
  })
  it('returns the raw text when the model answered with bare code', () => {
    expect(extractCode('function f() { return 1 }', 'javascript')).toBe('function f() { return 1 }')
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

  // ── Isolation: the untrusted solution must not be able to inflate its score ──

  it('a model-supplied example test in a separate block does not inflate the score', async () => {
    // Wrong solution (larger block) + the model's own passing example (smaller).
    // Only the hidden test counts, and it fails → 0/1, never 1/2.
    const answer = '```js\nfunction add(a, b) { return a - b }  // deliberately wrong, subtracts\n```\n```js\ntest("freebie", () => assert(1 === 1))\n```'
    const r = await runTests('javascript', answer, "test('real', () => assert(add(2, 3) === 5))")
    expect(r.total).toBe(1)
    expect(r.passed).toBe(0)
  })

  it('a solution that registers its own test in the same block cannot pad the tally', async () => {
    const answer = '```js\nfunction add(a, b) { return a - b }\ntest("freebie", () => assert(1 === 1))\n```'
    const r = await runTests('javascript', answer, "test('real', () => assert(add(2, 3) === 5))")
    expect(r.total).toBe(1)
    expect(r.passed).toBe(0)
  })

  it('a solution that neuters assert cannot force a pass', async () => {
    const answer = '```js\nglobalThis.assert = () => {}\nfunction add(a, b) { return 0 }\n```'
    const r = await runTests('javascript', answer, "test('real', () => assert(add(2, 3) === 5))")
    expect(r.passed).toBe(0)
    expect(r.total).toBe(1)
  })

  it('a model printing a fake marker cannot spoof a pass — the nonce guards it', async () => {
    // Wrong nonce AND an impossible tally: both are rejected, so the real harness
    // result wins (the hidden test fails).
    const solution = 'console.log("BENCHY_TESTS::deadbeef::" + JSON.stringify({ passed: 99, total: 1, cases: [] }))'
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

  it.skipIf(!py)('a solution defining its own test_ cannot pad the tally (globals snapshot)', async () => {
    const answer = '```python\ndef add(a, b):\n    return 0\ndef test_freebie():\n    assert True\n```'
    const r = await runTests('python', answer, 'def test_real():\n    assert add(2, 3) == 5')
    expect(r.total).toBe(1)
    expect(r.passed).toBe(0)
  })
})
