import { describe, it, expect } from 'vitest'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { connectMcpServer } from '../tools/mcp.js'
import type { McpServer } from '../types.js'

// A tiny in-process MCP server exposing one echo tool, wired to the client over
// a linked in-memory transport pair — exercises the real connect → listTools →
// callTool → close path with no subprocess and no network.
async function linkedServer(handlers: {
  tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[]
  onCall?: (name: string, args: Record<string, unknown> | undefined) => { content: unknown[]; isError?: boolean }
}) {
  const server = new Server({ name: 'test-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: handlers.tools }))
  server.setRequestHandler(CallToolRequestSchema, async req => {
    const r = handlers.onCall?.(req.params.name, req.params.arguments)
    return r ?? { content: [{ type: 'text', text: `called ${req.params.name}` }] }
  })
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  return { server, clientT }
}

const cfg = (over: Partial<McpServer> = {}): McpServer =>
  ({ id: 'm1', name: 'My Server', transport: 'http', url: 'http://unused', enabled: true, ...over })

describe('connectMcpServer', () => {
  it('lists tools and namespaces their names to avoid collisions', async () => {
    const { clientT } = await linkedServer({
      tools: [{ name: 'search', description: 'searches', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }],
    })
    const { tools, close } = await connectMcpServer(cfg({ name: 'Docs Server' }), clientT)
    // <sanitized server name>_<tool>, lowercased.
    expect(tools.map(t => t.spec.name)).toEqual(['docs_server_search'])
    expect(tools[0].spec.description).toBe('searches')
    expect(tools[0].spec.parameters).toEqual({ type: 'object', properties: { q: { type: 'string' } } })
    await close()
  })

  it('run() forwards args under the RAW tool name and returns the text content', async () => {
    let sawName = ''
    let sawArgs: unknown
    const { clientT } = await linkedServer({
      tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }],
      onCall: (name, args) => { sawName = name; sawArgs = args; return { content: [{ type: 'text', text: `echo: ${(args as { text?: string }).text}` }] } },
    })
    const { tools, close } = await connectMcpServer(cfg({ name: 'srv' }), clientT)
    const out = await tools[0].run({ text: 'hi' })
    expect(sawName).toBe('echo')           // raw name, not the namespaced one
    expect(sawArgs).toEqual({ text: 'hi' })
    expect(out).toBe('echo: hi')
    await close()
  })

  it('throws when the tool reports isError, so the loop records an error result', async () => {
    const { clientT } = await linkedServer({
      tools: [{ name: 'boom', inputSchema: { type: 'object', properties: {} } }],
      onCall: () => ({ content: [{ type: 'text', text: 'kaboom' }], isError: true }),
    })
    const { tools, close } = await connectMcpServer(cfg(), clientT)
    await expect(tools[0].run({})).rejects.toThrow(/kaboom/)
    await close()
  })

  it('coerces an object schema with no properties to an empty properties map', async () => {
    const { clientT } = await linkedServer({
      tools: [{ name: 't', inputSchema: { type: 'object' } }],
    })
    const { tools, close } = await connectMcpServer(cfg(), clientT)
    expect(tools[0].spec.parameters).toEqual({ type: 'object', properties: {} })
    await close()
  })
})
