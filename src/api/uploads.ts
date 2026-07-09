import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile, stat, unlink, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb, getBenchyDir } from '../db/index.js'

export const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export function getUploadsDir(): string {
  return join(getBenchyDir(), 'uploads')
}

export function uploadPath(id: string, mimeType: string): string {
  return join(getUploadsDir(), `${id}${ALLOWED_MIME_TYPES[mimeType] ?? ''}`)
}

interface AttachmentRow {
  id: string
  run_id: string | null
  prompt_index: number | null
  mime_type: string
  name: string
  size: number
  created_at: number
}

export function getAttachmentRow(id: string): AttachmentRow | undefined {
  return getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined
}

// Deletes every attachment bound to a run — files on disk AND DB rows. Called
// when a run is deleted so "deleted" media doesn't linger on disk/URL and
// storage doesn't leak unbounded (the attachments table has no FK cascade
// because it predates the run when unbound).
export async function deleteAttachmentsForRun(runId: string): Promise<void> {
  const db = getDb()
  const rows = db.prepare('SELECT id, mime_type FROM attachments WHERE run_id = ?')
    .all(runId) as { id: string; mime_type: string }[]
  for (const row of rows) {
    await unlink(uploadPath(row.id, row.mime_type)).catch(() => {})
  }
  db.prepare('DELETE FROM attachments WHERE run_id = ?').run(runId)
}

// Copies a source run's attachments (files + rows) onto a target run, keeping
// prompt_index, so a forked run re-runs with the same media instead of
// silently losing it.
export async function cloneAttachmentsForRun(sourceRunId: string, targetRunId: string): Promise<void> {
  const db = getDb()
  const rows = db.prepare(
    'SELECT id, prompt_index, mime_type, name, size FROM attachments WHERE run_id = ? ORDER BY created_at'
  ).all(sourceRunId) as { id: string; prompt_index: number | null; mime_type: string; name: string; size: number }[]
  const insert = db.prepare(
    'INSERT INTO attachments (id, run_id, prompt_index, mime_type, name, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  for (const row of rows) {
    const newId = randomUUID()
    await copyFile(uploadPath(row.id, row.mime_type), uploadPath(newId, row.mime_type)).catch(() => {})
    insert.run(newId, targetRunId, row.prompt_index, row.mime_type, row.name, row.size, Date.now())
  }
}

// Sweeps abandoned uploads: rows never bound to a run (user attached then
// removed the chip or closed the tab without sending) older than the cutoff.
// Runs on startup — bounds the disk leak without touching an in-flight upload.
export async function gcUnboundUploads(olderThanMs: number): Promise<number> {
  const db = getDb()
  const cutoff = Date.now() - olderThanMs
  const rows = db.prepare('SELECT id, mime_type FROM attachments WHERE run_id IS NULL AND created_at < ?')
    .all(cutoff) as { id: string; mime_type: string }[]
  for (const row of rows) {
    await unlink(uploadPath(row.id, row.mime_type)).catch(() => {})
  }
  db.prepare('DELETE FROM attachments WHERE run_id IS NULL AND created_at < ?').run(cutoff)
  return rows.length
}

export async function registerUploadsRoutes(app: FastifyInstance): Promise<void> {
  const { default: fastifyMultipart } = await import('@fastify/multipart')
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_FILE_SIZE, files: 8 },
  })

  app.post('/api/uploads', async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'No file in request' })

    const mimeType = file.mimetype
    if (!ALLOWED_MIME_TYPES[mimeType]) {
      return reply.code(400).send({
        error: `Unsupported file type "${mimeType}" — allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(', ')}`,
      })
    }

    let buf: Buffer
    try {
      buf = await file.toBuffer()
    } catch {
      // @fastify/multipart throws when the stream exceeds the fileSize limit
      return reply.code(413).send({ error: `File is too large — the limit is ${MAX_FILE_SIZE / 1024 / 1024} MB` })
    }

    const id = randomUUID()
    await mkdir(getUploadsDir(), { recursive: true })
    await writeFile(uploadPath(id, mimeType), buf)

    const name = file.filename || `file${ALLOWED_MIME_TYPES[mimeType]}`
    getDb().prepare(
      'INSERT INTO attachments (id, mime_type, name, size, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, mimeType, name, buf.length, Date.now())

    return reply.code(201).send({ data: { id, name, mimeType, size: buf.length } })
  })

  app.get<{ Params: { id: string } }>('/api/uploads/:id', async (req, reply) => {
    const row = getAttachmentRow(req.params.id)
    if (!row) return reply.code(404).send({ error: 'Attachment not found' })

    const path = uploadPath(row.id, row.mime_type)
    try {
      await stat(path)
    } catch {
      return reply.code(404).send({ error: 'Attachment file missing on disk' })
    }

    reply.header('Content-Type', row.mime_type)
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(row.name)}"`)
    return reply.send(createReadStream(path))
  })

  // Only unbound uploads can be deleted this way — removing a chip before send.
  // A bound attachment belongs to a run and is cleaned up with it, never here.
  app.delete<{ Params: { id: string } }>('/api/uploads/:id', async (req, reply) => {
    const row = getAttachmentRow(req.params.id)
    if (!row) return reply.code(404).send({ error: 'Attachment not found' })
    if (row.run_id) return reply.code(409).send({ error: 'Attachment is bound to a run — delete the run instead' })

    await unlink(uploadPath(row.id, row.mime_type)).catch(() => {})
    getDb().prepare('DELETE FROM attachments WHERE id = ?').run(row.id)
    return reply.code(204).send()
  })
}
