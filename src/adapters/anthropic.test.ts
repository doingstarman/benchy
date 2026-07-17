import { describe, it, expect, vi, beforeEach } from 'vitest'

// Captures the params the adapter actually sends to the SDK. The request body
// is the whole contract here: benchy's default temperature and Claude's
// extended thinking are mutually exclusive, and getting that wrong is a 400 on
// every single call rather than a subtly wrong answer.
const sentParams: Record<string, unknown>[] = []
const events: unknown[] = []

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: (params: Record<string, unknown>) => {
        sentParams.push(params)
        return {
          async *[Symbol.asyncIterator]() { yield* events },
          finalMessage: async () => ({ usage: { input_tokens: 3, output_tokens: 7 } }),
        }
      },
    }
  },
}))

const { anthropicAdapter } = await import('./anthropic.js')

async function collect(settings?: Record<string, unknown>) {
  const chunks = []
  for await (const chunk of anthropicAdapter.stream(
    [{ role: 'user', content: 'hi' }],
    { model: 'claude-opus-4-8', apiKey: 'sk-test', settings },
  )) chunks.push(chunk)
  return chunks
}

beforeEach(() => { sentParams.length = 0; events.length = 0 })

describe('anthropicAdapter — extended thinking', () => {
  it('sends no thinking param by default, so an ordinary run is unchanged', async () => {
    await collect({ temperature: 0.7, maxOutputTokens: 100 })
    expect('thinking' in sentParams[0]).toBe(false)
    expect(sentParams[0].temperature).toBe(0.7)
  })

  it('asks for adaptive thinking when enabled', async () => {
    await collect({ extendedThinking: true, maxOutputTokens: 100 })
    // budget_tokens is rejected outright on Opus 4.8/4.7 and Fable 5.
    expect(sentParams[0].thinking).toEqual({ type: 'adaptive' })
  })

  it('suppresses thinking when tools are enabled — the two together 400 on the tool round', async () => {
    const chunks = []
    for await (const chunk of anthropicAdapter.stream(
      [{ role: 'user', content: 'hi' }],
      {
        model: 'claude-opus-4-8', apiKey: 'sk-test',
        settings: { extendedThinking: true, temperature: 0.7 },
        tools: [{ name: 'calc', description: 'd', parameters: { type: 'object', properties: {} } }],
      },
    )) chunks.push(chunk)

    expect('thinking' in sentParams[0]).toBe(false)
    // With thinking off, temperature flows again as normal.
    expect(sentParams[0].temperature).toBe(0.7)
    expect(sentParams[0].tools).toBeDefined()
  })

  it('drops temperature when thinking is on — sending both is a 400 every time', async () => {
    await collect({ extendedThinking: true, temperature: 0.7, topP: 0.9 })
    expect('temperature' in sentParams[0]).toBe(false)
    expect('top_p' in sentParams[0]).toBe(false)
  })

  it('yields thinking_delta as reasoning and text_delta as the answer', async () => {
    events.push(
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'weighing' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer.' } },
    )
    const chunks = await collect({ extendedThinking: true })

    expect(chunks.filter(c => c.type === 'reasoning').map(c => c.type === 'reasoning' && c.text)).toEqual(['weighing'])
    expect(chunks.filter(c => c.type === 'token').map(c => c.type === 'token' && c.text)).toEqual(['Answer.'])
  })

  it('ignores signature_delta rather than leaking it into the answer', async () => {
    events.push(
      { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'abc123' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
    )
    const chunks = await collect({ extendedThinking: true })
    expect(chunks.filter(c => c.type === 'token').map(c => c.type === 'token' && c.text)).toEqual(['Hi'])
    expect(chunks.filter(c => c.type === 'reasoning')).toHaveLength(0)
  })
})
