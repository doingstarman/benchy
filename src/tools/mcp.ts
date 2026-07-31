import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Tool, ToolSpec } from './types.js'
import type { McpServer } from '../types.js'

const CONNECT_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 30_000

// Namespaced so a remote tool can't collide with a built-in / custom / another
// server's tool in the run's name→tool map (verify already caught that class of
// shadowing). The model calls this namespaced name; run() calls the raw one.
function toolName(serverName: string, raw: string): string {
  const base = `${serverName}_${raw}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return (base || 'mcp_tool').slice(0, 64)
}

// MCP inputSchema is a JSON Schema; coerce to the object shape benchy's ToolSpec
// wants. Anything odd degrades to "no arguments" rather than crashing the call.
function toParams(schema: unknown): ToolSpec['parameters'] {
  if (schema && typeof schema === 'object') {
    const s = schema as { type?: unknown; properties?: unknown; required?: unknown }
    if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
      return {
        type: 'object',
        properties: s.properties as Record<string, unknown>,
        ...(Array.isArray(s.required) ? { required: s.required.filter((r): r is string => typeof r === 'string') } : {}),
      }
    }
  }
  return { type: 'object', properties: {} }
}

function buildTransport(server: McpServer): Transport {
  if (server.transport === 'stdio') {
    if (!server.command?.trim()) throw new Error('stdio MCP server has no command')
    const parts = server.command.trim().split(/\s+/)
    return new StdioClientTransport({ command: parts[0], args: parts.slice(1) })
  }
  if (!server.url?.trim()) throw new Error(`${server.transport} MCP server has no url`)
  const url = new URL(server.url.trim())
  const requestInit = server.apiKey ? { headers: { Authorization: `Bearer ${server.apiKey}` } } : undefined
  return server.transport === 'sse'
    ? new SSEClientTransport(url, requestInit ? { requestInit } : undefined)
    : new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined)
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  // Clear the timer once p settles so the loser doesn't linger holding an
  // event-loop ref (delaying clean process exit under many runs).
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(msg)), ms) }),
  ])
}

// Connect to one MCP server, list its tools, and wrap each as a benchy Tool.
// The connection lives for the run; call close() when the run finishes so a
// stdio subprocess is killed and a socket is released — never leave it dangling.
// `transportOverride` is for tests only (an in-memory transport); production
// always derives the transport from the server config.
export async function connectMcpServer(
  server: McpServer,
  transportOverride?: Transport,
): Promise<{ tools: Tool[]; close: () => Promise<void> }> {
  const client = new Client({ name: 'benchy', version: '0.1.0' })
  const transport = transportOverride ?? buildTransport(server)

  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `MCP "${server.name}" connect timed out`)
  } catch (err) {
    await client.close().catch(() => {})
    throw err
  }

  const close = async () => { await client.close().catch(() => {}) }

  try {
    const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `MCP "${server.name}" listTools timed out`)
    const tools: Tool[] = listed.tools.map(mcpTool => ({
      spec: {
        name: toolName(server.name, mcpTool.name),
        description: mcpTool.description ?? `${server.name} · ${mcpTool.name}`,
        parameters: toParams(mcpTool.inputSchema),
      },
      async run(args) {
        const res = await client.callTool({ name: mcpTool.name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS })
        const parts = Array.isArray(res.content) ? res.content : []
        const text = parts
          .filter((c): c is { type: 'text'; text: string } => typeof c === 'object' && c !== null && (c as { type?: unknown }).type === 'text')
          .map(c => c.text)
          .join('\n')
        const out = text || JSON.stringify(res.content ?? '')
        if (res.isError) throw new Error(out || `tool "${mcpTool.name}" reported an error`)
        return out
      },
    }))
    return { tools, close }
  } catch (err) {
    await close()
    throw err
  }
}
