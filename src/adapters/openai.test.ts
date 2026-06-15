import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openaiAdapter } from './openai.js'

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
