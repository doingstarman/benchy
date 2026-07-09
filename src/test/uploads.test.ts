import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb, getDb } from '../db/index.js'
import { gcUnboundUploads, uploadPath } from '../api/uploads.js'
import type { FastifyInstance } from 'fastify'

let server: FastifyInstance
let base: string
let tempDir: string

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-uploads-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(14350, join(tempDir, 'test.db'))
  base = 'http://localhost:14350'
})

afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

function makeForm(bytes: Buffer, name: string, type: string): FormData {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), name)
  return form
}

describe('Uploads API', () => {
  it('accepts a PNG, stores it on disk, and returns metadata', async () => {
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: makeForm(PNG_BYTES, 'shot.png', 'image/png') })
    expect(res.status).toBe(201)
    const { data } = await res.json() as { data: { id: string; name: string; mimeType: string; size: number } }
    expect(data.name).toBe('shot.png')
    expect(data.mimeType).toBe('image/png')
    expect(data.size).toBe(PNG_BYTES.length)
    expect(existsSync(join(tempDir, 'uploads', `${data.id}.png`))).toBe(true)
  })

  it('round-trips file content via GET with the right content type', async () => {
    const up = await fetch(`${base}/api/uploads`, { method: 'POST', body: makeForm(PNG_BYTES, 'x.png', 'image/png') })
    const { data } = await up.json() as { data: { id: string } }

    const res = await fetch(`${base}/api/uploads/${data.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(PNG_BYTES)).toBe(true)
  })

  it('rejects unsupported mime types with the allowlist in the message', async () => {
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: makeForm(Buffer.from('hello'), 'x.txt', 'text/plain') })
    expect(res.status).toBe(400)
    const { error } = await res.json() as { error: string }
    expect(error).toContain('text/plain')
    expect(error).toContain('application/pdf')
  })

  it('rejects files over the 10 MB limit with 413', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 7)
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: makeForm(big, 'big.png', 'image/png') })
    expect(res.status).toBe(413)
  })

  it('404s on unknown attachment id', async () => {
    const res = await fetch(`${base}/api/uploads/does-not-exist`)
    expect(res.status).toBe(404)
  })

  it('garbage-collects unbound uploads older than the cutoff, sparing fresh ones', async () => {
    // Two unbound uploads; backdate one past the TTL.
    const mkUpload = async (name: string) => {
      const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: makeForm(PNG_BYTES, name, 'image/png') })
      return (await res.json() as { data: { id: string } }).data.id
    }
    const staleId = await mkUpload('stale.png')
    const freshId = await mkUpload('fresh.png')

    getDb().prepare('UPDATE attachments SET created_at = ? WHERE id = ?')
      .run(Date.now() - 48 * 60 * 60 * 1000, staleId)

    const removed = await gcUnboundUploads(24 * 60 * 60 * 1000)
    expect(removed).toBe(1)

    expect(existsSync(uploadPath(staleId, 'image/png'))).toBe(false)
    expect((await fetch(`${base}/api/uploads/${staleId}`)).status).toBe(404)
    // Drain the streamed body — an unread file stream keeps a handle open and
    // blocks the afterAll tempdir cleanup on Windows.
    const fresh = await fetch(`${base}/api/uploads/${freshId}`)
    expect(fresh.status).toBe(200)
    await fresh.arrayBuffer()
  })
})
