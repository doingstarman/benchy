import { describe, it, expect } from 'vitest'
import { createTraceParser } from './protocol.js'
import type { Chunk, TraceStep } from './base.js'

function steps(chunks: Chunk[]): TraceStep[] {
  return chunks.filter((c): c is Extract<Chunk, { type: 'step' }> => c.type === 'step').map(c => c.step)
}

describe('trace protocol parser', () => {
  it('maps known line types to the right chunks', () => {
    const p = createTraceParser()
    expect(p.push('{"type":"token","text":"hi"}')).toEqual([{ type: 'token', text: 'hi' }])
    expect(p.push('{"type":"reasoning","text":"hmm"}')).toEqual([{ type: 'reasoning', text: 'hmm' }])
    expect(p.push('{"type":"done","usage":{"inputTokens":10,"outputTokens":20}}'))
      .toEqual([{ type: 'done', usage: { inputTokens: 10, outputTokens: 20 } }])

    const tool = steps(p.push('{"type":"tool","name":"web_search","ms":120,"args":{"q":"x"}}'))[0]
    expect(tool.kind).toBe('tool')
    expect(tool.name).toBe('web_search')
    expect(tool.ms).toBe(120)
    expect(tool.payload).toContain('"q":"x"') // args folded into payload

    const model = steps(p.push('{"type":"model","name":"gpt-4o","usage":{"inputTokens":100,"outputTokens":50}}'))[0]
    expect(model.kind).toBe('model')
    expect(model.inputTokens).toBe(100)
    expect(model.outputTokens).toBe(50)

    const think = steps(p.push('{"type":"step","kind":"think","name":"planning"}'))[0]
    expect(think.kind).toBe('think')
  })

  it('treats a non-JSON line as an output token (back-compat with bare scripts)', () => {
    const p = createTraceParser()
    expect(p.push('just some text')).toEqual([{ type: 'token', text: 'just some text\n' }])
  })

  it('treats JSON without a known type as an output token', () => {
    const p = createTraceParser()
    expect(p.push('{"answer":"4"}')).toEqual([{ type: 'token', text: '{"answer":"4"}\n' }])
    // A JSON array is not a trace line either.
    expect(p.push('[1,2,3]')).toEqual([{ type: 'token', text: '[1,2,3]\n' }])
  })

  it('drops a forward/unknown parent ref to null with a warning, never fatal', () => {
    const p = createTraceParser()
    const s = steps(p.push('{"type":"step","id":"b","parent":"a","name":"orphan"}'))[0]
    expect(s.parentId).toBeNull()
    expect(p.warnings.some(w => w.includes('unknown/forward parent'))).toBe(true)
  })

  it('resolves a real earlier parent', () => {
    const p = createTraceParser()
    p.push('{"type":"step","id":"a","name":"root"}')
    const s = steps(p.push('{"type":"step","id":"b","parent":"a","name":"child"}'))[0]
    expect(s.parentId).toBe('a')
  })

  it('flattens nesting deeper than 3 levels instead of rejecting', () => {
    const p = createTraceParser()
    p.push('{"type":"step","id":"a"}')                       // depth 0
    p.push('{"type":"step","id":"b","parent":"a"}')          // depth 1
    p.push('{"type":"step","id":"c","parent":"b"}')          // depth 2
    p.push('{"type":"step","id":"d","parent":"c"}')          // depth 3
    const e = steps(p.push('{"type":"step","id":"e","parent":"d"}'))[0] // would be depth 4
    // Reparented onto the nearest ancestor that keeps it at the max depth.
    expect(e.parentId).toBe('c')
  })

  it('flags a truncated payload rather than silently cutting it', () => {
    const p = createTraceParser({ payloadCapBytes: 32 })
    const big = 'x'.repeat(500)
    const s = steps(p.push(JSON.stringify({ type: 'tool', name: 't', result: big })))[0]
    expect(s.payloadTruncated).toBe(true)
    expect(Buffer.byteLength(s.payload ?? '', 'utf-8')).toBeLessThanOrEqual(32)
  })

  it('trusts an agent-reported cost, computes from usage+model otherwise, else null', () => {
    const explicit = createTraceParser({ model: 'openai:gpt-4o' })
    expect(steps(explicit.push('{"type":"model","cost":0.42,"usage":{"inputTokens":1,"outputTokens":1}}'))[0].cost).toBe(0.42)

    const computed = createTraceParser({ model: 'openai:gpt-4o' })
    const c = steps(computed.push('{"type":"model","usage":{"inputTokens":1000000,"outputTokens":1000000}}'))[0].cost
    expect(c).toBeCloseTo(2.5 + 10, 5)

    const none = createTraceParser({ model: 'openai:gpt-4o' })
    expect(steps(none.push('{"type":"model","name":"no-usage"}'))[0].cost).toBeNull()
  })

  it('makes a tool-scope error a recoverable step, agent/task scope a fatal chunk', () => {
    const p = createTraceParser()
    const toolErr = p.push('{"type":"error","scope":"tool","name":"502 upstream"}')
    expect(toolErr[0].type).toBe('step')
    expect(steps(toolErr)[0].isError).toBe(true)

    const agentErr = p.push('{"type":"error","scope":"agent","name":"crashed"}')
    expect(agentErr).toEqual([{ type: 'error', message: 'crashed', scope: 'agent' }])

    const taskErr = createTraceParser().push('{"type":"error","scope":"task","name":"gave up"}')
    expect(taskErr).toEqual([{ type: 'error', message: 'gave up', scope: 'task' }])
  })

  it('reassigns a duplicate id with a warning so ids stay unique', () => {
    const p = createTraceParser()
    p.push('{"type":"step","id":"dup"}')
    const second = steps(p.push('{"type":"step","id":"dup"}'))[0]
    expect(second.id).not.toBe('dup')
    expect(p.warnings.some(w => w.includes('duplicate step id'))).toBe(true)
  })
})
