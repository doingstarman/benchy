import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb, getDb } from '../db/index.js'
import { uploadPath } from '../api/uploads.js'
import type { FastifyInstance } from 'fastify'
import type { Run } from '../types.js'

// The upload endpoint sniffs magic bytes — fixtures need a real PNG signature.
const pngBytes = (...tail: number[]): Buffer => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...tail])

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

  it('POST /api/runs/:id/edit-turn discards later turns and re-runs the edited one', async () => {
    capturedMessages = []
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id
    const model = `${pid}:gpt-4o-mini`

    const { data } = await startBenchmark(['First'], [model])
    const runId = data!.runId
    await waitForRun(runId)

    await fetch(`${base}/api/runs/${runId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Second' }),
    })
    await waitForRun(runId)

    // Edit turn 0 — turn 1 must be discarded, conversation restarts from scratch
    capturedMessages = []
    const res = await fetch(`${base}/api/runs/${runId}/edit-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptIndex: 0, prompt: 'First edited' }),
    })
    expect(res.status).toBe(202)

    const run = await waitForRun(runId)
    expect(run.prompts).toEqual(['First edited'])
    expect(run.results).toHaveLength(1)
    expect(run.totalCalls).toBe(1)
    expect(run.completedCalls).toBe(1)

    // The re-run got NO history (nothing precedes turn 0)
    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toEqual([{ role: 'user', content: 'First edited' }])
  })

  it('attachments flow into the adapter, persist through history, and die with edit-turn', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    // Upload a small "PNG"
    const bytes = pngBytes(9, 9, 9)
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'screen.png')
    const up = await fetch(`${base}/api/uploads`, { method: 'POST', body: form })
    const { data: att } = await up.json() as { data: { id: string } }

    // Turn 0 with the attachment
    capturedMessages = []
    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['what is this?'], models: [model], attachments: [att.id] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    const firstMsg = capturedMessages[0][0] as { content: string; attachments?: { mimeType: string; data: string; name: string }[] }
    expect(firstMsg.attachments).toHaveLength(1)
    expect(firstMsg.attachments![0].mimeType).toBe('image/png')
    expect(firstMsg.attachments![0].name).toBe('screen.png')
    expect(Buffer.from(firstMsg.attachments![0].data, 'base64').equals(bytes)).toBe(true)

    // Continue — history's turn-0 user message must carry the attachment again
    capturedMessages = []
    await fetch(`${base}/api/runs/${data.runId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'and now?' }),
    })
    await waitForRun(data.runId)
    const history = capturedMessages[0] as Array<{ role: string; attachments?: unknown[] }>
    expect(history[0].attachments).toHaveLength(1)
    expect(history[2].attachments).toBeUndefined()

    // Edit turn 0 without re-sending the attachment — row and file must be gone
    await fetch(`${base}/api/runs/${data.runId}/edit-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptIndex: 0, prompt: 'edited' }),
    })
    await waitForRun(data.runId)
    const row = getDb().prepare('SELECT COUNT(*) AS n FROM attachments WHERE id = ?').get(att.id) as { n: number }
    expect(row.n).toBe(0)
    const fileRes = await fetch(`${base}/api/uploads/${att.id}`)
    expect(fileRes.status).toBe(404)
  })

  it('deleting a run removes its attachment rows AND files from disk', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    const bytes = pngBytes(1, 2, 3)
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'del.png')
    const up = await fetch(`${base}/api/uploads`, { method: 'POST', body: form })
    const { data: att } = await up.json() as { data: { id: string } }

    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['what is this?'], models: [model], attachments: [att.id] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    const filePath = uploadPath(att.id, 'image/png')
    expect(existsSync(filePath)).toBe(true)

    const del = await fetch(`${base}/api/runs/${data.runId}`, { method: 'DELETE' })
    expect(del.status).toBe(204)

    const row = getDb().prepare('SELECT COUNT(*) AS n FROM attachments WHERE id = ?').get(att.id) as { n: number }
    expect(row.n).toBe(0)
    expect(existsSync(filePath)).toBe(false)
    expect((await fetch(`${base}/api/uploads/${att.id}`)).status).toBe(404)
  })

  it('forking a run copies its attachments as independent files', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    const bytes = pngBytes(4, 5, 6)
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'fork.png')
    const up = await fetch(`${base}/api/uploads`, { method: 'POST', body: form })
    const { data: att } = await up.json() as { data: { id: string } }

    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['orig'], models: [model], attachments: [att.id] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    const forkRes = await fetch(`${base}/api/runs/${data.runId}/fork`, { method: 'POST' })
    const { data: fork } = await forkRes.json() as { data: { id: string } }

    const forkRun = await fetch(`${base}/api/runs/${fork.id}`).then(r => r.json()) as {
      data: { attachments: Array<{ id: string; promptIndex: number; name: string }> }
    }
    expect(forkRun.data.attachments).toHaveLength(1)
    const copy = forkRun.data.attachments[0]
    expect(copy.id).not.toBe(att.id)
    expect(copy.promptIndex).toBe(0)
    expect(copy.name).toBe('fork.png')
    expect(existsSync(uploadPath(copy.id, 'image/png'))).toBe(true)

    // The copy is independent — deleting the original leaves the fork's file intact.
    await fetch(`${base}/api/runs/${data.runId}`, { method: 'DELETE' })
    expect(existsSync(uploadPath(copy.id, 'image/png'))).toBe(true)
    const copyRes = await fetch(`${base}/api/uploads/${copy.id}`)
    expect(copyRes.status).toBe(200)
    await copyRes.arrayBuffer() // drain the stream so it doesn't hold a file handle
  })

  it('DELETE /api/uploads/:id removes an unbound upload but refuses a bound one', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    // Unbound → 204 and gone from disk
    const f1 = new FormData()
    f1.append('file', new Blob([pngBytes(7)], { type: 'image/png' }), 'chip.png')
    const up1 = await fetch(`${base}/api/uploads`, { method: 'POST', body: f1 })
    const { data: unbound } = await up1.json() as { data: { id: string } }
    const p1 = uploadPath(unbound.id, 'image/png')
    expect(existsSync(p1)).toBe(true)
    const rm = await fetch(`${base}/api/uploads/${unbound.id}`, { method: 'DELETE' })
    expect(rm.status).toBe(204)
    expect(existsSync(p1)).toBe(false)

    // Bound to a run → refused (409), file untouched
    const f2 = new FormData()
    f2.append('file', new Blob([pngBytes(8)], { type: 'image/png' }), 'bound.png')
    const up2 = await fetch(`${base}/api/uploads`, { method: 'POST', body: f2 })
    const { data: bound } = await up2.json() as { data: { id: string } }
    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['keep it'], models: [model], attachments: [bound.id] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)
    const refused = await fetch(`${base}/api/uploads/${bound.id}`, { method: 'DELETE' })
    expect(refused.status).toBe(409)
    expect(existsSync(uploadPath(bound.id, 'image/png'))).toBe(true)
  })

  it('surfaces an honest per-cell error when a bound attachment file is gone', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    const form = new FormData()
    form.append('file', new Blob([pngBytes(3, 3, 3)], { type: 'image/png' }), 'gone.png')
    const up = await fetch(`${base}/api/uploads`, { method: 'POST', body: form })
    const { data: att } = await up.json() as { data: { id: string } }

    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['see this?'], models: [model], attachments: [att.id] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    // Corrupt storage: delete the file but keep the DB row bound to turn 0.
    await unlink(uploadPath(att.id, 'image/png'))

    // Re-run turn 0 (re-sending the id keeps it bound) — the vanished file must
    // become a per-cell error, not a silent answer as if nothing was attached.
    await fetch(`${base}/api/runs/${data.runId}/edit-turn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptIndex: 0, prompt: 'see this now?', attachments: [att.id] }),
    })
    await waitForRun(data.runId)

    const run = await fetch(`${base}/api/runs/${data.runId}`).then(r => r.json()) as {
      data: { results: Array<{ promptIndex: number; error: string | null }> }
    }
    const cell = run.data.results.find(r => r.promptIndex === 0)
    expect(cell?.error).toMatch(/missing on disk/)
  })

  it('regenerate clones the turn attachments so the re-run keeps the image', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    const form = new FormData()
    form.append('file', new Blob([pngBytes(2, 2, 2)], { type: 'image/png' }), 'regen.png')
    const up = await fetch(`${base}/api/uploads`, { method: 'POST', body: form })
    const { data: att } = await up.json() as { data: { id: string } }

    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['orig prompt'], models: [model], attachments: [att.id] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    // Regenerate = throwaway run that clones turn 0's attachments onto itself.
    capturedMessages = []
    const regen = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['orig prompt'], models: [model], cloneAttachmentsFrom: { runId: data.runId, promptIndex: 0 } }),
    })
    const { data: regenData } = await regen.json() as { data: { runId: string } }
    await waitForRun(regenData.runId)

    const msg = capturedMessages[0][0] as { attachments?: Array<{ name: string }> }
    expect(msg.attachments).toHaveLength(1)
    expect(msg.attachments![0].name).toBe('regen.png')

    // The copy is an independent new row bound to the regen run at turn 0.
    const regenRun = await fetch(`${base}/api/runs/${regenData.runId}`).then(r => r.json()) as {
      data: { attachments: Array<{ id: string; promptIndex: number }> }
    }
    expect(regenRun.data.attachments).toHaveLength(1)
    expect(regenRun.data.attachments[0].id).not.toBe(att.id)
    expect(regenRun.data.attachments[0].promptIndex).toBe(0)

    // Reap: the frontend DELETEs the throwaway run on run_done — that must take
    // the cloned file with it (no per-regenerate disk leak).
    const copyId = regenRun.data.attachments[0].id
    expect(existsSync(uploadPath(copyId, 'image/png'))).toBe(true)
    await fetch(`${base}/api/runs/${regenData.runId}`, { method: 'DELETE' })
    expect(existsSync(uploadPath(copyId, 'image/png'))).toBe(false)
    // The original run's attachment is untouched by reaping the regen copy.
    expect(existsSync(uploadPath(att.id, 'image/png'))).toBe(true)
  })

  it('rejects a malformed cloneAttachmentsFrom at the boundary without stranding a zombie run', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`
    const db = getDb()
    const runsBefore = (db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n

    // Non-integer promptIndex would throw inside better-sqlite3 after the INSERT.
    const bad = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['x'], models: [model], cloneAttachmentsFrom: { runId: 'nope', promptIndex: { evil: 1 } } }),
    })
    expect(bad.status).toBe(400)
    // No run row created, so nothing is stuck in 'running'.
    const runsAfter = (db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n
    expect(runsAfter).toBe(runsBefore)

    // Belt-and-suspenders: attachments + cloneAttachmentsFrom together is rejected.
    const combo = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['x'], models: [model], attachments: ['a'], cloneAttachmentsFrom: { runId: 'r', promptIndex: 0 } }),
    })
    expect(combo.status).toBe(400)
  })

  it('handles many concurrent uploads without id or file collision', async () => {
    const uploads = await Promise.all(
      Array.from({ length: 12 }, (_, i) => {
        const f = new FormData()
        f.append('file', new Blob([pngBytes(i, i, i)], { type: 'image/png' }), `conc-${i}.png`)
        return fetch(`${base}/api/uploads`, { method: 'POST', body: f }).then(r => r.json() as Promise<{ data: { id: string } }>)
      }),
    )
    const ids = uploads.map(u => u.data.id)
    expect(new Set(ids).size).toBe(12)
    for (const id of ids) expect(existsSync(uploadPath(id, 'image/png'))).toBe(true)
  })

  it('two concurrent regenerates of the same source turn get independent, separately-reapable clones', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    const form = new FormData()
    form.append('file', new Blob([pngBytes(6, 6, 6)], { type: 'image/png' }), 'shared.png')
    const up = await fetch(`${base}/api/uploads`, { method: 'POST', body: form })
    const { data: att } = await up.json() as { data: { id: string } }

    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['source'], models: [model], attachments: [att.id] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    // Fire both regenerates at once — they read the same source rows and must
    // each produce an independent copy (source file is only read, never mutated).
    const regenBody = JSON.stringify({ prompts: ['source'], models: [model], cloneAttachmentsFrom: { runId: data.runId, promptIndex: 0 } })
    const [g1, g2] = await Promise.all([
      fetch(`${base}/api/benchmark`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: regenBody }).then(r => r.json() as Promise<{ data: { runId: string } }>),
      fetch(`${base}/api/benchmark`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: regenBody }).then(r => r.json() as Promise<{ data: { runId: string } }>),
    ])
    await Promise.all([waitForRun(g1.data.runId), waitForRun(g2.data.runId)])

    const attsOf = async (runId: string) => (await fetch(`${base}/api/runs/${runId}`).then(r => r.json()) as { data: { attachments: Array<{ id: string }> } }).data.attachments
    const [a1, a2] = await Promise.all([attsOf(g1.data.runId), attsOf(g2.data.runId)])
    expect(a1).toHaveLength(1)
    expect(a2).toHaveLength(1)
    expect(a1[0].id).not.toBe(a2[0].id)
    expect(a1[0].id).not.toBe(att.id)
    expect(a2[0].id).not.toBe(att.id)

    // Reaping one clone leaves the other clone AND the source file intact.
    await fetch(`${base}/api/runs/${g1.data.runId}`, { method: 'DELETE' })
    expect(existsSync(uploadPath(a1[0].id, 'image/png'))).toBe(false)
    expect(existsSync(uploadPath(a2[0].id, 'image/png'))).toBe(true)
    expect(existsSync(uploadPath(att.id, 'image/png'))).toBe(true)
  })

  it('never replays a batch run as a conversation — its prompts are independent', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    // Three unrelated questions fanned out to one model — NOT a dialogue.
    capturedMessages = []
    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['capital of France?', 'square root of 9?', 'colour of the sky?'], models: [model] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    const run = await fetch(`${base}/api/runs/${data.runId}`).then(r => r.json()) as { data: { kind: string } }
    expect(run.data.kind).toBe('batch')

    // Each of the three calls must have carried exactly one user message.
    expect(capturedMessages).toHaveLength(3)
    for (const messages of capturedMessages) {
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('user')
    }

    // Adding a fourth prompt is another independent question, not a follow-up:
    // the model must NOT be handed the previous three as chat history.
    capturedMessages = []
    await fetch(`${base}/api/runs/${data.runId}/continue`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'and the tallest mountain?' }),
    })
    await waitForRun(data.runId)
    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toEqual([{ role: 'user', content: 'and the tallest mountain?' }])
  })

  it('editing one batch prompt re-runs only it, leaving its neighbours alone', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['first', 'second', 'third'], models: [model] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    // In a chat this would fork and discard turns 1 and 2. In a batch they are
    // unrelated questions — they must survive.
    await fetch(`${base}/api/runs/${data.runId}/edit-turn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptIndex: 0, prompt: 'first (edited)' }),
    })
    await waitForRun(data.runId)

    const run = await fetch(`${base}/api/runs/${data.runId}`).then(r => r.json()) as {
      data: { prompts: string[]; results: Array<{ promptIndex: number }> }
    }
    expect(run.data.prompts).toEqual(['first (edited)', 'second', 'third'])
    // All three prompts still have their answer.
    expect(new Set(run.data.results.map(r => r.promptIndex))).toEqual(new Set([0, 1, 2]))
  })

  it('editing a pairs prompt re-runs only the model it was paired with', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id
    const A = `${pid}:gpt-4o-mini`
    const B = `${pid}:gpt-4o`

    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairs: [{ prompt: 'for-A', model: A }, { prompt: 'for-B', model: B }] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    let run = await fetch(`${base}/api/runs/${data.runId}`).then(r => r.json()) as {
      data: { kind: string; results: Array<{ promptIndex: number; model: string }> }
    }
    expect(run.data.kind).toBe('pairs')
    expect(run.data.results).toHaveLength(2)

    // prompts[0] belongs to A alone. B must not be dragged into answering it.
    await fetch(`${base}/api/runs/${data.runId}/edit-turn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptIndex: 0, prompt: 'edited-for-A' }),
    })
    await waitForRun(data.runId)

    run = await fetch(`${base}/api/runs/${data.runId}`).then(r => r.json()) as typeof run
    expect(run.data.results).toHaveLength(2)
    const atZero = run.data.results.filter(r => r.promptIndex === 0)
    expect(atZero).toHaveLength(1)
    expect(atZero[0].model).toBe(A)
    // B's own pair is untouched.
    const atOne = run.data.results.filter(r => r.promptIndex === 1)
    expect(atOne).toHaveLength(1)
    expect(atOne[0].model).toBe(B)
  })

  it('a pairs run continues each model on its own thread, not the batch void', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id
    const A = `${pid}:gpt-4o-mini`
    const B = `${pid}:gpt-4o`

    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairs: [{ prompt: 'A-first', model: A }, { prompt: 'B-first', model: B }] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    capturedMessages = []
    await fetch(`${base}/api/runs/${data.runId}/continue`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'follow-up' }),
    })
    await waitForRun(data.runId)

    // Each model carries ITS OWN prompt + reply + the follow-up — and never the
    // other model's prompt, which was addressed to somebody else entirely.
    expect(capturedMessages).toHaveLength(2)
    for (const messages of capturedMessages) {
      expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user'])
      expect(messages[2].content).toBe('follow-up')
      const own = messages[0].content
      expect(['A-first', 'B-first']).toContain(own)
      const foreign = own === 'A-first' ? 'B-first' : 'A-first'
      expect(messages.some(m => m.content === foreign)).toBe(false)
    }
  })

  it('still replays a chat run as a conversation', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    const startRes = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['hello'], models: [model] }),
    })
    const { data } = await startRes.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    const run = await fetch(`${base}/api/runs/${data.runId}`).then(r => r.json()) as { data: { kind: string } }
    expect(run.data.kind).toBe('chat')

    capturedMessages = []
    await fetch(`${base}/api/runs/${data.runId}/continue`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'and again?' }),
    })
    await waitForRun(data.runId)
    // user → assistant → user: the chat still sees its own past.
    expect(capturedMessages[0]).toHaveLength(3)
    expect(capturedMessages[0].map(m => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('the history search box is a search box, not a pattern language', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`
    const tag = `S${Date.now()}`

    const start = async (prompt: string) => {
      const res = await fetch(`${base}/api/benchmark`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: [prompt], models: [model] }),
      })
      const { data } = await res.json() as { data: { runId: string } }
      await waitForRun(data.runId)
      return data.runId
    }
    await start(`${tag} discount is 50% off`)
    await start(`${tag} plain text`)

    const search = async (q: string) => {
      const res = await fetch(`${base}/api/runs?search=${encodeURIComponent(q)}`)
      const { data } = await res.json() as { data: Array<{ prompts: string[] }> }
      return data.filter(r => r.prompts[0]?.startsWith(tag))
    }

    // A literal % used to be a wildcard, so this matched every run ever made.
    expect(await search('%')).toHaveLength(1)
    expect((await search('%'))[0].prompts[0]).toContain('50%')
    // Same for _, LIKE's single-character wildcard.
    expect(await search('_')).toHaveLength(0)
    // And the plain case still works.
    expect(await search(`${tag} plain`)).toHaveLength(1)
  })

  it('the history model filter matches a model, not any name containing it', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id
    const tag = `M${Date.now()}`

    const res = await fetch(`${base}/api/benchmark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: [`${tag} mini only`], models: [`${pid}:gpt-4o-mini`] }),
    })
    const { data } = await res.json() as { data: { runId: string } }
    await waitForRun(data.runId)

    const byModel = async (m: string) => {
      const r = await fetch(`${base}/api/runs?model=${encodeURIComponent(m)}`)
      const { data: runs } = await r.json() as { data: Array<{ prompts: string[] }> }
      return runs.filter(x => x.prompts[0]?.startsWith(tag))
    }

    // "gpt-4o" is a prefix of "gpt-4o-mini": a substring match claimed this run
    // used gpt-4o, which it never did.
    expect(await byModel(`${pid}:gpt-4o`)).toHaveLength(0)
    expect(await byModel(`${pid}:gpt-4o-mini`)).toHaveLength(1)
  })

  it('a nonsense page number does not 500', async () => {
    // parseInt('abc') reached SQLite as NaN → "datatype mismatch".
    for (const page of ['abc', '0', '-1', '']) {
      const res = await fetch(`${base}/api/runs?page=${page}`)
      expect(res.status, `page=${page}`).toBe(200)
    }
  })

  it('rejects attachments with multiple prompts or unknown ids', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const model = `${providers.data[0].id}:gpt-4o-mini`

    const multi = await fetch(`${base}/api/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['a', 'b'], models: [model], attachments: ['whatever'] }),
    })
    expect(multi.status).toBe(400)

    const unknown = await fetch(`${base}/api/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: ['a'], models: [model], attachments: ['nope'] }),
    })
    expect(unknown.status).toBe(400)
  })

  it('POST /api/runs/:id/edit-turn rejects out-of-range promptIndex', async () => {
    const providers = await fetch(`${base}/api/providers`).then(r => r.json()) as { data: Array<{ id: string }> }
    const pid = providers.data[0].id
    const { data } = await startBenchmark(['Solo'], [`${pid}:gpt-4o-mini`])
    await waitForRun(data!.runId)

    const res = await fetch(`${base}/api/runs/${data!.runId}/edit-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptIndex: 5, prompt: 'x' }),
    })
    expect(res.status).toBe(400)
  })
})
