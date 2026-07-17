import { describe, it, expect } from 'vitest'
import { ThinkTagParser, type ThinkPart } from '../adapters/think-tags.js'

// Feed the text one chunk at a time, then flush — mirrors how the SSE loop
// drives the parser.
function run(chunks: string[]): { answer: string; reasoning: string } {
  const p = new ThinkTagParser()
  const parts: ThinkPart[] = []
  for (const c of chunks) parts.push(...p.push(c))
  parts.push(...p.flush())
  return {
    answer: parts.filter(x => x.type === 'token').map(x => x.text).join(''),
    reasoning: parts.filter(x => x.type === 'reasoning').map(x => x.text).join(''),
  }
}

describe('ThinkTagParser', () => {
  it('splits a think block arriving as one chunk', () => {
    expect(run(['<think>weighing options</think>The answer is 4.'])).toEqual({
      reasoning: 'weighing options',
      answer: 'The answer is 4.',
    })
  })

  it('handles the tag split across chunk boundaries — the whole reason this is stateful', () => {
    // How it actually arrives over SSE: no chunk contains a complete tag.
    expect(run(['<thi', 'nk>', 'hmm', '</thi', 'nk>', 'Done.'])).toEqual({
      reasoning: 'hmm',
      answer: 'Done.',
    })
  })

  it('never emits a partial tag as answer text', () => {
    const p = new ThinkTagParser()
    // "<thi" could still become "<think>" — it must be held back, not shown.
    expect(p.push('<thi')).toEqual([])
    expect(p.push('nk>secret')).toEqual([{ type: 'reasoning', text: 'secret' }])
  })

  it('flushes text that only looked like a tag', () => {
    // "<thi" is a live prefix of "<think>" until the "n" turns into "ng".
    expect(run(['<thi', 'ng> is a word'])).toEqual({
      reasoning: '',
      answer: '<thing> is a word',
    })
  })

  it('streams reasoning incrementally rather than buffering to the close tag', () => {
    // A 30s think block must appear as it arrives — that is the whole feature.
    const p = new ThinkTagParser()
    p.push('<think>')
    expect(p.push('step one ')).toEqual([{ type: 'reasoning', text: 'step one ' }])
    expect(p.push('step two')).toEqual([{ type: 'reasoning', text: 'step two' }])
  })

  it('treats <think> as ordinary text once the answer has started', () => {
    // "Explain the <think> tag" must not have its answer swallowed.
    expect(run(['The ', '<think>', ' tag wraps reasoning.'])).toEqual({
      reasoning: '',
      answer: 'The <think> tag wraps reasoning.',
    })
  })

  it('stays armed through leading whitespace', () => {
    expect(run(['\n', '<think>a</think>', 'B'])).toEqual({ reasoning: 'a', answer: '\nB' })
  })

  it('keeps an unclosed think block as reasoning, not as the answer', () => {
    // Truncated/aborted stream: the thinking must not leak into the answer.
    expect(run(['<think>cut off mid-thou'])).toEqual({
      reasoning: 'cut off mid-thou',
      answer: '',
    })
  })

  it('passes through a plain answer untouched', () => {
    expect(run(['Just ', 'a normal ', 'answer.'])).toEqual({
      reasoning: '',
      answer: 'Just a normal answer.',
    })
  })

  it('does not reopen a think block after the first one closes', () => {
    expect(run(['<think>a</think>x<think>y</think>z'])).toEqual({
      reasoning: 'a',
      answer: 'x<think>y</think>z',
    })
  })
})
