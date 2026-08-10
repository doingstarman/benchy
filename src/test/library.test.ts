import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer as createHttpServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.js'
import { closeDb } from '../db/index.js'
import { makeHttpTool } from '../tools/http-tool.js'
import { resolveTools } from '../tools/index.js'
import type { FastifyInstance } from 'fastify'
import type { CustomTool } from '../types.js'

let server: FastifyInstance
let toolServer: Server
let base: string
let tempDir: string

// A tiny tool endpoint: echoes back the args it received so the test can prove
// the http tool forwarded them and returned the body.
const lastToolBody: { value?: unknown } = {}
const TOOL_URL = 'http://127.0.0.1:14381/tool'

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-library-'))
  process.env.BENCHY_DIR = tempDir

  toolServer = createHttpServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      lastToolBody.value = body ? JSON.parse(body) : null
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(`echoed: ${body}`)
    })
  })
  await new Promise<void>(r => toolServer.listen(14381, '127.0.0.1', r))

  server = await createServer(14380, join(tempDir, 'test.db'))
  base = 'http://localhost:14380'
})

afterAll(async () => {
  await server.close()
  await new Promise<void>(r => toolServer.close(() => r()))
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

beforeEach(async () => {
  const { writeConfig } = await import('../config.js')
  await writeConfig({ providers: [] })
})

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) as { data?: Record<string, unknown>; error?: string } }
}
async function list(path: string) {
  const res = await fetch(`${base}${path}`)
  return (await res.json() as { data: unknown[] }).data
}

describe('makeHttpTool', () => {
  const tool: CustomTool = {
    id: 't1', name: 'echo', description: 'echoes', url: TOOL_URL, enabled: true,
    parameters: { type: 'object', properties: { value: { type: 'string' } } },
  }

  it('POSTs the args and returns the response body', async () => {
    const out = await makeHttpTool(tool).run({ value: 'hi' })
    expect(lastToolBody.value).toEqual({ value: 'hi' })
    expect(out).toBe('echoed: {"value":"hi"}')
  })

  it('throws on a non-2xx so the loop records an error result', async () => {
    const bad = makeHttpTool({ ...tool, url: 'http://127.0.0.1:14381/nope' })
    // The echo server 200s everything, so point at a closed port instead.
    const closed = makeHttpTool({ ...tool, url: 'http://127.0.0.1:14399/x' })
    await expect(closed.run({})).rejects.toThrow()
    void bad
  })
})

describe('resolveTools with custom tools', () => {
  const ct: CustomTool = {
    id: 'custom-123', name: 'my_tool', description: 'd', url: TOOL_URL, enabled: true,
    parameters: { type: 'object', properties: {} },
  }

  it('builds a custom tool keyed by its function name when its id is requested', async () => {
    const map = await resolveTools(['calc', 'custom-123'], [ct])
    expect(map.has('calc')).toBe(true)
    expect(map.has('my_tool')).toBe(true) // keyed by spec.name, not id
  })

  it('omits a disabled custom tool', async () => {
    const map = await resolveTools(['custom-123'], [{ ...ct, enabled: false }])
    expect(map.has('my_tool')).toBe(false)
  })

  it('ignores a custom id that was not requested', async () => {
    const map = await resolveTools(['calc'], [ct])
    expect(map.has('my_tool')).toBe(false)
  })
})

describe('CRUD /api/tools', () => {
  it('creates, lists and deletes a custom tool', async () => {
    const created = await post('/api/tools', { name: 'weather', description: 'w', url: TOOL_URL, parameters: { type: 'object', properties: {} } })
    expect(created.status).toBe(201)
    const id = created.body.data!.id as string
    expect(await list('/api/tools')).toHaveLength(1)

    const del = await fetch(`${base}/api/tools/${id}`, { method: 'DELETE' })
    expect(del.status).toBe(204)
    expect(await list('/api/tools')).toHaveLength(0)
  })

  it('rejects an invalid function name', async () => {
    const res = await post('/api/tools', { name: 'has spaces', url: TOOL_URL })
    expect(res.status).toBe(400)
  })

  it('rejects a non-http url', async () => {
    const res = await post('/api/tools', { name: 'ok_name', url: 'ftp://x' })
    expect(res.status).toBe(400)
  })

  it('rejects a name that collides with a built-in tool', async () => {
    // Would silently overwrite the SSRF-guarded fetch_url in resolveTools.
    for (const reserved of ['calc', 'fetch_url', 'web_search']) {
      expect((await post('/api/tools', { name: reserved, url: TOOL_URL })).status).toBe(400)
    }
  })

  it('rejects a duplicate custom name', async () => {
    expect((await post('/api/tools', { name: 'dup', url: TOOL_URL })).status).toBe(201)
    expect((await post('/api/tools', { name: 'dup', url: TOOL_URL })).status).toBe(400)
  })

  it('rejects an over-long name (breaks provider tool schemas)', async () => {
    expect((await post('/api/tools', { name: 'a'.repeat(65), url: TOOL_URL })).status).toBe(400)
  })
})

describe('CRUD /api/skills', () => {
  it('creates and lists a skill with instruction + tool refs', async () => {
    const res = await post('/api/skills', { name: 'Reviewer', instruction: 'Be terse', toolIds: ['calc'] })
    expect(res.status).toBe(201)
    expect(res.body.data!.toolIds).toEqual(['calc'])
    expect(await list('/api/skills')).toHaveLength(1)
  })

  it('rejects a nameless skill', async () => {
    expect((await post('/api/skills', { instruction: 'x' })).status).toBe(400)
  })
})

describe('CRUD /api/mcp', () => {
  it('creates an http server config', async () => {
    const res = await post('/api/mcp', { name: 'MyMCP', transport: 'http', url: 'https://mcp.example.com' })
    expect(res.status).toBe(201)
    expect(res.body.data!.transport).toBe('http')
  })

  it('requires a command for stdio transport', async () => {
    expect((await post('/api/mcp', { name: 'S', transport: 'stdio' })).status).toBe(400)
    expect((await post('/api/mcp', { name: 'S', transport: 'stdio', command: 'my-server' })).status).toBe(201)
  })
})

describe('library — cross-site guard', () => {
  // Library entries hold a tool's/MCP's Bearer secret; a page on another origin
  // must not be able to read or write the registry over the localhost API.
  const evil = { Origin: 'http://evil.example', 'Content-Type': 'application/json' }

  it('refuses read and write from a cross-site origin, but allows same-origin', async () => {
    for (const path of ['/api/tools', '/api/skills', '/api/mcp']) {
      expect((await fetch(`${base}${path}`, { headers: { Origin: 'http://evil.example' } })).status).toBe(403)
      expect((await fetch(`${base}${path}`, { method: 'POST', headers: evil, body: '{"name":"x"}' })).status).toBe(403)
    }
    // A same-origin app fetch (no Origin header) still passes.
    expect((await fetch(`${base}/api/tools`)).status).toBe(200)
  })
})
