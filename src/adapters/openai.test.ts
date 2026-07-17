import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { openaiAdapter } from './openai.js'

// Tests assign global.fetch directly; the suite runs singleFork, so without
// this restore the mock leaks into whichever test file runs next.
const realFetch = global.fetch
afterAll(() => { global.fetch = realFetch })

function makeSseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'))
      controller.close()
    },
  })
}

function tokenChunk(text: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  const base = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`
  if (!usage) return base
  return base + `data: ${JSON.stringify({ choices: [], usage })}\n`
}

beforeEach(() => { vi.restoreAllMocks() })

describe('openaiAdapter.stream', () => {
  it('yields token chunks and done', async () => {
    const lines = [
      tokenChunk('Hello'),
      tokenChunk(' world', { prompt_tokens: 5, completion_tokens: 2 }),
      'data: [DONE]',
    ]

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream(lines),
    })

    const chunks = []
    for await (const chunk of openaiAdapter.stream(
      [{ role: 'user', content: 'hi' }],
      { model: 'gpt-4o', apiKey: 'sk-test' },
    )) {
      chunks.push(chunk)
    }

    const tokens = chunks.filter(c => c.type === 'token')
    const done = chunks.find(c => c.type === 'done')

    expect(tokens).toHaveLength(2)
    expect(tokens.map(c => c.type === 'token' && c.text).join('')).toBe('Hello world')
    expect(done?.type).toBe('done')
    if (done?.type === 'done') {
      expect(done.usage.inputTokens).toBe(5)
      expect(done.usage.outputTokens).toBe(2)
    }
  })

  it('yields error chunk on non-200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
      body: null,
    })

    const chunks = []
    for await (const chunk of openaiAdapter.stream(
      [{ role: 'user', content: 'hi' }],
      { model: 'gpt-4o', apiKey: 'bad-key' },
    )) {
      chunks.push(chunk)
    }

    expect(chunks).toHaveLength(1)
    expect(chunks[0].type).toBe('error')
    if (chunks[0].type === 'error') {
      expect(chunks[0].message).toContain('401')
    }
  })

  it('uses custom baseUrl when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream(['data: [DONE]']),
    })

    for await (const _ of openaiAdapter.stream(
      [{ role: 'user', content: 'hi' }],
      { model: 'llama3', baseUrl: 'http://localhost:11434/v1' },
    )) { /* drain */ }

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.any(Object),
    )
  })

  it('skips non-data lines and [DONE]', async () => {
    const lines = [
      ': ping',
      '',
      tokenChunk('Hi'),
      'data: [DONE]',
    ]
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream(lines),
    })

    const chunks = []
    for await (const chunk of openaiAdapter.stream(
      [{ role: 'user', content: 'x' }],
      { model: 'gpt-4o' },
    )) chunks.push(chunk)

    expect(chunks.filter(c => c.type === 'token')).toHaveLength(1)
  })
})

describe('openaiAdapter — reasoning', () => {
  async function collect(lines: string[]) {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: makeSseStream(lines) })
    const chunks = []
    for await (const chunk of openaiAdapter.stream(
      [{ role: 'user', content: 'hi' }],
      { model: 'm', apiKey: 'sk-test' },
    )) chunks.push(chunk)
    return {
      answer: chunks.filter(c => c.type === 'token').map(c => c.type === 'token' && c.text).join(''),
      reasoning: chunks.filter(c => c.type === 'reasoning').map(c => c.type === 'reasoning' && c.text).join(''),
      done: chunks.find(c => c.type === 'done'),
    }
  }

  it('reads OpenRouter-style delta.reasoning', async () => {
    const { answer, reasoning } = await collect([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'let me think' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: '42' } }] })}`,
      'data: [DONE]',
    ])
    expect(reasoning).toBe('let me think')
    expect(answer).toBe('42')
  })

  it('reads DeepSeek/vLLM-style delta.reasoning_content', async () => {
    const { answer, reasoning } = await collect([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hmm' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'yes' } }] })}`,
      'data: [DONE]',
    ])
    expect(reasoning).toBe('hmm')
    expect(answer).toBe('yes')
  })

  it('keeps reasoning out of the answer when it arrives as inline <think> tags', async () => {
    // The qwen/Ollama shape: no reasoning field at all, tags inside content,
    // split across chunks the way SSE actually delivers them.
    const { answer, reasoning } = await collect([
      `data: ${JSON.stringify({ choices: [{ delta: { content: '<thi' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'nk>pondering</think>' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Final.' } }] })}`,
      'data: [DONE]',
    ])
    expect(reasoning).toBe('pondering')
    expect(answer).toBe('Final.')
  })

  it('reports reasoning tokens from completion_tokens_details', async () => {
    // OpenAI's o-series over chat/completions gives a count and no text.
    const { done } = await collect([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}`,
      `data: ${JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 90, completion_tokens_details: { reasoning_tokens: 64 } },
      })}`,
      'data: [DONE]',
    ])
    expect(done?.type === 'done' && done.usage.reasoningTokens).toBe(64)
  })

  it('omits reasoningTokens entirely when the provider reports none', async () => {
    const { done } = await collect([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}`,
      'data: [DONE]',
    ])
    expect(done?.type === 'done' && 'reasoningTokens' in done.usage).toBe(false)
  })
})

describe('openaiAdapter — tools', () => {
  it('wraps tool specs in the {type:function} shape the API expects', async () => {
    let sentBody: Record<string, unknown> = {}
    global.fetch = vi.fn().mockImplementation((_url, init: { body: string }) => {
      sentBody = JSON.parse(init.body) as Record<string, unknown>
      return Promise.resolve({ ok: true, body: makeSseStream(['data: [DONE]']) })
    })

    const gen = openaiAdapter.stream([{ role: 'user', content: 'hi' }], {
      model: 'm', apiKey: 'sk-test',
      tools: [{ name: 'calc', description: 'd', parameters: { type: 'object', properties: {} } }],
    })
    for await (const _ of gen) { void _ }

    expect(sentBody.tools).toEqual([{
      type: 'function',
      function: { name: 'calc', description: 'd', parameters: { type: 'object', properties: {} } },
    }])
  })

  it('sends no tools key when the call has none — request is unchanged from before tools', async () => {
    let sentBody: Record<string, unknown> = {}
    global.fetch = vi.fn().mockImplementation((_url, init: { body: string }) => {
      sentBody = JSON.parse(init.body) as Record<string, unknown>
      return Promise.resolve({ ok: true, body: makeSseStream(['data: [DONE]']) })
    })
    const gen = openaiAdapter.stream([{ role: 'user', content: 'hi' }], { model: 'm', apiKey: 'sk-test' })
    for await (const _ of gen) { void _ }
    expect('tools' in sentBody).toBe(false)
  })

  it('assembles a tool call whose arguments arrive as fragments across chunks', async () => {
    // How chat/completions actually delivers a tool call: id+name first, then
    // the JSON arguments a few characters at a time.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream([
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'calc', arguments: '{"exp' } }] } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ression":"2+2"}' } }] } }] })}`,
        'data: [DONE]',
      ]),
    })

    const calls = []
    for await (const chunk of openaiAdapter.stream([{ role: 'user', content: 'x' }], { model: 'm', apiKey: 'sk-test' })) {
      if (chunk.type === 'tool_call') calls.push(chunk.call)
    }
    expect(calls).toEqual([{ id: 'call_1', name: 'calc', args: { expression: '2+2' } }])
  })
})
