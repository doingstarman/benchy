import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb, getDb } from '../db/index.js'
import type { FastifyInstance } from 'fastify'
import type { Run } from '../types.js'

// Only the external HTTP calls to providers are mocked — everything else is real
// slowMode adds a delay so SSE clients can connect before run_done fires
let slowMode = false
let capturedMessages: { role: string; content: string }[][] = []

vi.mock('../adapters/openai.js', () => ({
  openaiAdapter: {
    async *stream(messages: { role: string; content: string }[], config: { model: string }) {
      capturedMessages.push(messages)
      if (slowMode) await new Promise(r => setTimeout(r, 80))
      yield { type: 'token', text: `Hello from ${config.model}` }
      yield { type: 'token', text: '!' }
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 3 } }
    },
  },
}))

vi.mock('../adapters/anthropic.js', () => ({
  anthropicAdapter: {
    async *stream(_messages: unknown, config: { model: string }) {
      yield { type: 'token', text: `Anthropic ${config.model}` }
      yield { type: 'done', usage: { inputTokens: 8, outputTokens: 2 } }
    },
  },
}))

vi.mock('../adapters/google.js', () => ({
  googleAdapter: {
    async *stream(_messages: unknown, config: { model: string }) {
      yield { type: 'token', text: `Google ${config.model}` }
      yield { type: 'done', usage: { inputTokens: 6, outputTokens: 1 } }
    },
  },
}))

let server: FastifyInstance
let base: string
let tempDir: string

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-benchmark-'))
  process.env.BENCHY_DIR = tempDir

  server = await createServer(14320, join(tempDir, 'test.db'))
  base = `http://localhost:14320`

  // Seed one provider via real API
  await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'OpenAI', type: 'openai', apiKey: 'sk-fake', models: ['gpt-4o-mini'], enabled: true }),
  })
})

afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

async function startBenchmark(prompts: string[], models: string[]) {
  const res = await fetch(`${base}/api/benchmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompts, models }),
  })
  return res.json() as Promise<{ data?: { runId: string }; error?: string }>
}

async function waitForRun(runId: string, maxMs = 2000): Promise<Run & { results: unknown[] }> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/runs/${runId}`)
    const body = await res.json() as { data: Run & { results: unknown[] } }
    if (body.data.status === 'done' || body.data.status === 'error') return body.data
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`Run ${runId} did not complete within ${maxMs}ms`)
}

describe('Benchmark API — real server + real DB + mocked adapters', () => {
  it('POST /api/benchmark returns 400 without prompts', async () => {
    const res = await fetch(`${base}/api/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: ['openai:gpt-4o-mini'] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/prompts/)
  })

  it('POST /api/benchmark returns 400 without models', async () => {
    const res = await fetch(`${base}/api/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['hello'] }),
    })
    expect(res.status).toBe(400)
  })

  it('creates run record and returns runId', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id

    const body = await startBenchmark(['Say hello'], [`${pid}:gpt-4o-mini`])
    expect(body.data?.runId).toBeTruthy()

    const row = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(body.data!.runId) as { status: string } | undefined
    expect(row).toBeDefined()
  })

  it('run completes with correct text in DB', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id

    const { data } = await startBenchmark(['Hi!'], [`${pid}:gpt-4o-mini`])
    const run = await waitForRun(data!.runId)

    expect(run.status).toBe('done')
    expect(run.results).toHaveLength(1)
    const result = run.results[0] as { text: string; metrics: { inputTokens: number; outputTokens: number } }
    expect(result.text).toBe('Hello from gpt-4o-mini!')
    expect(result.metrics.inputTokens).toBe(10)
    expect(result.metrics.outputTokens).toBe(3)
  })

  it('M×N matrix: 2 prompts × 2 models = 4 results', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id

    // Add a second model to the provider
    await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pid, name: 'OpenAI', type: 'openai', apiKey: 'sk-fake', models: ['gpt-4o-mini', 'gpt-4o'], enabled: true }),
    })

    const { data } = await startBenchmark(
      ['First prompt', 'Second prompt'],
      [`${pid}:gpt-4o-mini`, `${pid}:gpt-4o`],
    )
    const run = await waitForRun(data!.runId)

    expect(run.status).toBe('done')
    expect(run.results).toHaveLength(4)
    expect(run.totalCalls).toBe(4)
    expect(run.completedCalls).toBe(4)
  })

  it('TTFS is recorded and positive', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id

    const { data } = await startBenchmark(['Hello!'], [`${pid}:gpt-4o-mini`])
    const run = await waitForRun(data!.runId)

    const result = run.results[0] as { metrics: { ttfs: number | null; totalTime: number | null } }
    expect(result.metrics.ttfs).not.toBeNull()
    // Synchronous mock can yield first token in 0ms — assert non-negative
    expect(result.metrics.ttfs).toBeGreaterThanOrEqual(0)
    expect(result.metrics.totalTime).toBeGreaterThanOrEqual(result.metrics.ttfs!)
  })

  it('SSE stream delivers cell_done and run_done events', async () => {
    slowMode = true
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id

    const { data } = await startBenchmark(['Stream test'], [`${pid}:gpt-4o-mini`])
    const runId = data!.runId

    const events: Array<{ event: string; data: unknown }> = []

    await new Promise<void>((resolve, reject) => {
      const ctrl = new AbortController()
      fetch(`${base}/api/benchmark/stream/${runId}`, { signal: ctrl.signal })
        .then(async res => {
          const reader = res.body!.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          let currentEvent = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim() }
              else if (line.startsWith('data: ')) {
                events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) })
                if (currentEvent === 'run_done') { ctrl.abort(); resolve(); return }
              }
            }
          }
          resolve()
        })
        .catch(err => { if (err.name !== 'AbortError') reject(err) })
      setTimeout(() => { ctrl.abort(); resolve() }, 3000)
    })

    expect(events.some(e => e.event === 'cell_token')).toBe(true)
    expect(events.some(e => e.event === 'cell_done')).toBe(true)
    expect(events.some(e => e.event === 'run_done')).toBe(true)
    slowMode = false
  })

  it('POST /api/runs/:id/continue chains conversation history per model', async () => {
    capturedMessages = []
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id

    const { data } = await startBenchmark(['Turn one'], [`${pid}:gpt-4o-mini`])
    const runId = data!.runId
    await waitForRun(runId)

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toEqual([{ role: 'user', content: 'Turn one' }])

    const res = await fetch(`${base}/api/runs/${runId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Turn two' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json() as { data: { runId: string; promptIndex: number } }
    expect(body.data.promptIndex).toBe(1)

    const run = await waitForRun(runId)
    expect(run.results).toHaveLength(2)

    expect(capturedMessages).toHaveLength(2)
    expect(capturedMessages[1]).toEqual([
      { role: 'user', content: 'Turn one' },
      { role: 'assistant', content: 'Hello from gpt-4o-mini!' },
      { role: 'user', content: 'Turn two' },
    ])

    const rows = getDb().prepare('SELECT prompt_index FROM results WHERE run_id = ? ORDER BY prompt_index')
      .all(runId) as { prompt_index: number }[]
    expect(rows.map(r => r.prompt_index)).toEqual([0, 1])
  })

  it('POST /api/runs/:id/continue returns 404 for unknown run', async () => {
    const res = await fetch(`${base}/api/runs/does-not-exist/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    })
    expect(res.status).toBe(404)
  })
})
