import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/index.js'
import { getProviders, DEFAULT_PROVIDER_SETTINGS } from '../config.js'
import { openaiAdapter } from '../adapters/openai.js'
import { anthropicAdapter } from '../adapters/anthropic.js'
import { googleAdapter } from '../adapters/google.js'
import { httpJsonAdapter } from '../adapters/http-json.js'
import { scriptAdapter } from '../adapters/script.js'
import { webhookAdapter } from '../adapters/webhook.js'
import { readFile, unlink } from 'node:fs/promises'
import { getAttachmentRow, uploadPath, cloneAttachmentsForTurn } from './uploads.js'
import type { Adapter, Message, MessageAttachment } from '../adapters/base.js'
import type { ProviderType, BenchmarkRequest, RunSettings } from '../types.js'

export function getAdapter(type: ProviderType): Adapter {
  if (type === 'anthropic') return anthropicAdapter
  if (type === 'google') return googleAdapter
  if (type === 'http-json') return httpJsonAdapter
  if (type === 'script') return scriptAdapter
  if (type === 'webhook') return webhookAdapter
  return openaiAdapter
}

// In-memory SSE connections keyed by runId
const sseConnections = new Map<string, FastifyReply[]>()

function broadcast(runId: string, event: string, data: unknown) {
  const conns = sseConnections.get(runId)
  if (!conns) return
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const reply of conns) {
    try { reply.raw.write(line) } catch { /* client disconnected */ }
  }
}

async function runCell(
  runId: string,
  promptIndex: number,
  promptText: string,
  modelKey: string,
  providers: Awaited<ReturnType<typeof getProviders>>,
  runSettings?: RunSettings,
  history: Message[] = [],
) {
  const [providerId, ...modelParts] = modelKey.split(':')
  const model = modelParts.join(':')
  const provider = providers.find(p => p.id === providerId)

  if (!provider) {
    broadcast(runId, 'cell_error', { runId, promptIndex, model: modelKey, error: `Provider "${providerId}" not found` })
    return
  }

  const db = getDb()
  const resultId = randomUUID()
  db.prepare(
    'INSERT INTO results (id, run_id, prompt_index, model, provider_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(resultId, runId, promptIndex, modelKey, providerId, '', Date.now())

  broadcast(runId, 'cell_start', { runId, promptIndex, model: modelKey })

  const t0 = Date.now()
  let ttfs: number | null = null
  let fullText = ''
  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens: number | undefined

  try {
    const adapter = getAdapter(provider.type)
    const effectiveSettings = {
      ...DEFAULT_PROVIDER_SETTINGS,
      ...provider.defaults,
      ...(runSettings?.global ?? {}),
      ...(runSettings?.perModel?.[modelKey] ?? {}),
    }
    const attachments = await loadAttachments(runId, promptIndex)
    const stream = adapter.stream(
      [...history, { role: 'user', content: promptText, ...(attachments.length ? { attachments } : {}) }],
      { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model, settings: effectiveSettings },
    )

    for await (const chunk of stream) {
      if (chunk.type === 'token') {
        if (ttfs === null) ttfs = Date.now() - t0
        fullText += chunk.text
        broadcast(runId, 'cell_token', { runId, promptIndex, model: modelKey, text: chunk.text })
      } else if (chunk.type === 'done') {
        inputTokens = chunk.usage.inputTokens
        outputTokens = chunk.usage.outputTokens
        reasoningTokens = chunk.usage.reasoningTokens
      } else if (chunk.type === 'error') {
        throw new Error(chunk.message)
      }
    }

    const totalTime = Date.now() - t0
    db.prepare(
      'UPDATE results SET text = ?, ttfs = ?, total_time = ?, input_tokens = ?, output_tokens = ?, reasoning_tokens = ? WHERE id = ?'
    ).run(fullText, ttfs, totalTime, inputTokens, outputTokens, reasoningTokens ?? null, resultId)

    broadcast(runId, 'cell_done', {
      runId, promptIndex, model: modelKey,
      ttfs, totalTime,
      usage: { inputTokens, outputTokens, ...(reasoningTokens != null ? { reasoningTokens } : {}) },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    db.prepare('UPDATE results SET error = ? WHERE id = ?').run(msg, resultId)
    broadcast(runId, 'cell_error', { runId, promptIndex, model: modelKey, error: msg })
  } finally {
    db.prepare('UPDATE runs SET completed_calls = completed_calls + 1 WHERE id = ?').run(runId)
  }
}

function finalizeRun(runId: string, tasks: Promise<void>[]): void {
  const db = getDb()
  Promise.all(tasks)
    .then(() => {
      db.prepare("UPDATE runs SET status = 'done' WHERE id = ?").run(runId)
      broadcast(runId, 'run_done', { runId })
      sseConnections.delete(runId)
    })
    .catch(() => {
      db.prepare("UPDATE runs SET status = 'error' WHERE id = ?").run(runId)
      sseConnections.delete(runId)
    })
}

interface RunRow {
  id: string
  prompts: string
  models: string
  status: string
  saved: number
  total_calls: number
  completed_calls: number
  created_at: number
  run_settings: string | null
}

interface ResultHistoryRow {
  prompt_index: number
  text: string
}

// Binds freshly-uploaded attachments to a specific turn. Rejects ids that
// don't exist or already belong to a different turn.
function bindAttachments(ids: string[], runId: string, promptIndex: number): string | null {
  const db = getDb()
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
    return 'attachments must be an array of upload id strings'
  }
  for (const id of ids) {
    const row = getAttachmentRow(id)
    if (!row) return `Attachment ${id} not found — upload it first`
    if (row.run_id && (row.run_id !== runId || row.prompt_index !== promptIndex)) {
      return `Attachment ${id} already belongs to another message`
    }
  }
  const bind = db.prepare('UPDATE attachments SET run_id = ?, prompt_index = ? WHERE id = ?')
  for (const id of ids) bind.run(runId, promptIndex, id)
  return null
}

// Reads a turn's attachments from disk into adapter-ready base64 payloads.
// Strict by default: a bound attachment whose file is gone throws, so the
// current call surfaces an honest per-cell error instead of silently answering
// as if no file was attached (capability differences are the benchmark signal).
// History reconstruction passes lenient — a vanished older file shouldn't sink
// a fresh turn — but still warns rather than dropping in silence.
async function loadAttachments(runId: string, promptIndex: number, lenient = false): Promise<MessageAttachment[]> {
  const rows = getDb().prepare(
    'SELECT id, mime_type, name FROM attachments WHERE run_id = ? AND prompt_index = ? ORDER BY created_at'
  ).all(runId, promptIndex) as { id: string; mime_type: string; name: string }[]

  const out: MessageAttachment[] = []
  for (const row of rows) {
    try {
      const buf = await readFile(uploadPath(row.id, row.mime_type))
      out.push({ mimeType: row.mime_type, data: buf.toString('base64'), name: row.name })
    } catch {
      if (!lenient) throw new Error(`Attachment "${row.name}" is missing on disk — re-upload it`)
      console.warn(`benchy: history attachment "${row.name}" (${row.id}) missing on disk, skipping`)
    }
  }
  return out
}

async function deleteAttachmentsFrom(runId: string, promptIndex: number): Promise<void> {
  const db = getDb()
  const rows = db.prepare(
    'SELECT id, mime_type FROM attachments WHERE run_id = ? AND prompt_index >= ?'
  ).all(runId, promptIndex) as { id: string; mime_type: string }[]
  for (const row of rows) {
    await unlink(uploadPath(row.id, row.mime_type)).catch(() => {})
  }
  db.prepare('DELETE FROM attachments WHERE run_id = ? AND prompt_index >= ?').run(runId, promptIndex)
}

// Reconstructs one model's own conversation branch from prior turns —
// failed turns (error IS NOT NULL) are skipped entirely rather than
// injected as broken/empty assistant messages.
async function buildHistory(runId: string, model: string, prompts: string[]): Promise<Message[]> {
  const db = getDb()
  const rows = db.prepare(
    'SELECT prompt_index, text FROM results WHERE run_id = ? AND model = ? AND error IS NULL ORDER BY prompt_index'
  ).all(runId, model) as ResultHistoryRow[]

  const history: Message[] = []
  for (const row of rows) {
    const attachments = await loadAttachments(runId, row.prompt_index, true)
    history.push({
      role: 'user',
      content: prompts[row.prompt_index],
      ...(attachments.length ? { attachments } : {}),
    })
    history.push({ role: 'assistant', content: row.text })
  }
  return history
}

export async function registerBenchmarkRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: BenchmarkRequest }>('/api/benchmark', async (req, reply) => {
    const { prompts, models, pairs, runSettings, attachments, cloneAttachmentsFrom } = req.body
    if (!pairs?.length && (!prompts?.length || !models?.length)) {
      return reply.code(400).send({ error: 'provide pairs[] or prompts[]+models[]' })
    }
    if ((attachments?.length || cloneAttachmentsFrom) && (pairs?.length || (prompts?.length ?? 0) > 1)) {
      return reply.code(400).send({ error: 'attachments are only supported with a single prompt' })
    }
    if (cloneAttachmentsFrom && attachments?.length) {
      return reply.code(400).send({ error: 'cannot combine attachments with cloneAttachmentsFrom' })
    }
    // Validate the clone source shape at the boundary: a non-primitive runId or
    // promptIndex would otherwise throw inside better-sqlite3 AFTER the run row
    // is inserted, stranding a zombie run stuck in 'running'.
    if (cloneAttachmentsFrom &&
        (typeof cloneAttachmentsFrom.runId !== 'string' || !Number.isInteger(cloneAttachmentsFrom.promptIndex))) {
      return reply.code(400).send({ error: 'cloneAttachmentsFrom needs a string runId and an integer promptIndex' })
    }

    const runId = randomUUID()
    const totalCalls = pairs ? pairs.length : prompts!.length * models!.length
    const db = getDb()

    const storedPrompts = pairs ? pairs.map(p => p.prompt) : prompts!
    const storedModels = pairs ? pairs.map(p => p.model) : models!
    const hasSettings = runSettings && (
      Object.keys(runSettings.global ?? {}).length > 0 ||
      Object.keys(runSettings.perModel ?? {}).length > 0
    )
    const runSettingsJson = hasSettings ? JSON.stringify(runSettings) : null

    if (attachments?.length) {
      const bindError = bindAttachments(attachments, runId, 0)
      if (bindError) return reply.code(400).send({ error: bindError })
    }

    db.prepare(
      'INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at, run_settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(runId, JSON.stringify(storedPrompts), JSON.stringify(storedModels), 'running', 0, totalCalls, 0, Date.now(), runSettingsJson)

    // Regenerate copies the source turn's attachments onto this run so the
    // re-run sees the same media. Done after the INSERT (rows FK-reference it).
    if (cloneAttachmentsFrom) {
      await cloneAttachmentsForTurn(cloneAttachmentsFrom.runId, cloneAttachmentsFrom.promptIndex, runId, 0)
    }

    // Fire and forget — SSE stream delivers results
    const providers = await getProviders()
    const tasks = pairs
      ? pairs.map(({ prompt, model }, pi) => runCell(runId, pi, prompt, model, providers, runSettings))
      : prompts!.flatMap((prompt, pi) => models!.map(model => runCell(runId, pi, prompt, model, providers, runSettings)))

    finalizeRun(runId, tasks)

    return reply.code(202).send({ data: { runId } })
  })

  app.post<{ Params: { id: string }; Body: { prompt: string; runSettings?: RunSettings; attachments?: string[] } }>(
    '/api/runs/:id/continue',
    async (req, reply) => {
      const { prompt, runSettings, attachments } = req.body
      if (!prompt?.trim()) return reply.code(400).send({ error: 'prompt is required' })

      const db = getDb()
      const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as RunRow | undefined
      if (!run) return reply.code(404).send({ error: 'Run not found' })

      const prompts = JSON.parse(run.prompts) as string[]
      const models = JSON.parse(run.models) as string[]
      const newPromptIndex = prompts.length
      const updatedPrompts = [...prompts, prompt]

      if (attachments?.length) {
        const bindError = bindAttachments(attachments, req.params.id, newPromptIndex)
        if (bindError) return reply.code(400).send({ error: bindError })
      }

      const effectiveRunSettings = runSettings ?? (run.run_settings ? JSON.parse(run.run_settings) as RunSettings : undefined)
      const runSettingsJson = effectiveRunSettings ? JSON.stringify(effectiveRunSettings) : run.run_settings

      db.prepare(
        "UPDATE runs SET prompts = ?, status = 'running', total_calls = total_calls + ?, run_settings = ? WHERE id = ?"
      ).run(JSON.stringify(updatedPrompts), models.length, runSettingsJson, req.params.id)

      const providers = await getProviders()
      const tasks = models.map(async model => {
        const history = await buildHistory(req.params.id, model, prompts)
        return runCell(req.params.id, newPromptIndex, prompt, model, providers, effectiveRunSettings, history)
      })

      finalizeRun(req.params.id, tasks)

      return reply.code(202).send({ data: { runId: req.params.id, promptIndex: newPromptIndex } })
    }
  )

  // Edit a past user message — ChatGPT fork semantics: everything after the
  // edited turn is discarded and the turn re-runs with the new prompt.
  app.post<{ Params: { id: string }; Body: { promptIndex: number; prompt: string; attachments?: string[] } }>(
    '/api/runs/:id/edit-turn',
    async (req, reply) => {
      const { promptIndex, prompt, attachments } = req.body
      if (!prompt?.trim()) return reply.code(400).send({ error: 'prompt is required' })

      const db = getDb()
      const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as RunRow | undefined
      if (!run) return reply.code(404).send({ error: 'Run not found' })

      const prompts = JSON.parse(run.prompts) as string[]
      const models = JSON.parse(run.models) as string[]
      if (!Number.isInteger(promptIndex) || promptIndex < 0 || promptIndex >= prompts.length) {
        return reply.code(400).send({ error: `promptIndex out of range (0..${prompts.length - 1})` })
      }

      // Discarded turns take their attachments (rows + files) with them; on
      // the edited turn itself, only the re-sent ids survive.
      await deleteAttachmentsFrom(req.params.id, promptIndex + 1)
      const keep = new Set(attachments ?? [])
      const ownRows = db.prepare('SELECT id, mime_type FROM attachments WHERE run_id = ? AND prompt_index = ?')
        .all(req.params.id, promptIndex) as { id: string; mime_type: string }[]
      for (const row of ownRows) {
        if (keep.has(row.id)) continue
        await unlink(uploadPath(row.id, row.mime_type)).catch(() => {})
        db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id)
      }
      if (attachments?.length) {
        const bindError = bindAttachments(attachments, req.params.id, promptIndex)
        if (bindError) return reply.code(400).send({ error: bindError })
      }

      const updatedPrompts = [...prompts.slice(0, promptIndex), prompt]
      const dropped = db.prepare('SELECT COUNT(*) AS n FROM results WHERE run_id = ? AND prompt_index >= ?')
        .get(req.params.id, promptIndex) as { n: number }
      db.prepare('DELETE FROM results WHERE run_id = ? AND prompt_index >= ?').run(req.params.id, promptIndex)
      db.prepare(
        "UPDATE runs SET prompts = ?, status = 'running', total_calls = total_calls - ? + ?, completed_calls = completed_calls - ? WHERE id = ?"
      ).run(JSON.stringify(updatedPrompts), dropped.n, models.length, dropped.n, req.params.id)

      const effectiveRunSettings = run.run_settings ? JSON.parse(run.run_settings) as RunSettings : undefined
      const providers = await getProviders()
      const tasks = models.map(async model => {
        const history = await buildHistory(req.params.id, model, prompts)
        return runCell(req.params.id, promptIndex, prompt, model, providers, effectiveRunSettings, history)
      })

      finalizeRun(req.params.id, tasks)

      return reply.code(202).send({ data: { runId: req.params.id, promptIndex } })
    }
  )

  app.get<{ Params: { runId: string } }>(
    '/api/benchmark/stream/:runId',
    async (req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      const { runId } = req.params

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      reply.raw.flushHeaders()

      if (!sseConnections.has(runId)) sseConnections.set(runId, [])
      sseConnections.get(runId)!.push(reply)

      // Send heartbeat comment to keep connection alive
      const heartbeat = setInterval(() => {
        try { reply.raw.write(': ping\n\n') } catch { clearInterval(heartbeat) }
      }, 15000)

      req.raw.on('close', () => {
        clearInterval(heartbeat)
        const conns = sseConnections.get(runId)
        if (conns) {
          const idx = conns.indexOf(reply)
          if (idx >= 0) conns.splice(idx, 1)
        }
      })

      // Don't resolve — keep connection open
      await new Promise<void>(resolve => req.raw.on('close', resolve))
    }
  )
}
