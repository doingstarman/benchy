import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll } from 'vitest'
import { createServer } from '../server.js'
import type { FastifyInstance } from 'fastify'

let tempDir: string
let server: FastifyInstance
export let baseUrl: string

export function getServer() { return server }

export const TEST_PORT = 14242

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-test-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(TEST_PORT, join(tempDir, 'test.db'))
  baseUrl = `http://localhost:${TEST_PORT}`
})

afterAll(async () => {
  await server.close()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})
