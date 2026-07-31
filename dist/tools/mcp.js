import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;
// Namespaced so a remote tool can't collide with a built-in / custom / another
// server's tool in the run's name→tool map (verify already caught that class of
// shadowing). The model calls this namespaced name; run() calls the raw one.
function toolName(serverName, raw) {
    const base = `${serverName}_${raw}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    return (base || 'mcp_tool').slice(0, 64);
}
// MCP inputSchema is a JSON Schema; coerce to the object shape benchy's ToolSpec
// wants. Anything odd degrades to "no arguments" rather than crashing the call.
function toParams(schema) {
    if (schema && typeof schema === 'object') {
        const s = schema;
        if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
            return {
                type: 'object',
                properties: s.properties,
                ...(Array.isArray(s.required) ? { required: s.required.filter((r) => typeof r === 'string') } : {}),
            };
        }
    }
    return { type: 'object', properties: {} };
}
function buildTransport(server) {
    if (server.transport === 'stdio') {
        if (!server.command?.trim())
            throw new Error('stdio MCP server has no command');
        const parts = server.command.trim().split(/\s+/);
        return new StdioClientTransport({ command: parts[0], args: parts.slice(1) });
    }
    if (!server.url?.trim())
        throw new Error(`${server.transport} MCP server has no url`);
    const url = new URL(server.url.trim());
    const requestInit = server.apiKey ? { headers: { Authorization: `Bearer ${server.apiKey}` } } : undefined;
    return server.transport === 'sse'
        ? new SSEClientTransport(url, requestInit ? { requestInit } : undefined)
        : new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined);
}
function withTimeout(p, ms, msg) {
    let timer;
    // Clear the timer once p settles so the loser doesn't linger holding an
    // event-loop ref (delaying clean process exit under many runs).
    return Promise.race([
        p.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(msg)), ms); }),
    ]);
}
// Connect to one MCP server, list its tools, and wrap each as a benchy Tool.
// The connection lives for the run; call close() when the run finishes so a
// stdio subprocess is killed and a socket is released — never leave it dangling.
// `transportOverride` is for tests only (an in-memory transport); production
// always derives the transport from the server config.
export async function connectMcpServer(server, transportOverride) {
    const client = new Client({ name: 'benchy', version: '0.1.0' });
    const transport = transportOverride ?? buildTransport(server);
    try {
        await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `MCP "${server.name}" connect timed out`);
    }
    catch (err) {
        await client.close().catch(() => { });
        throw err;
    }
    const close = async () => { await client.close().catch(() => { }); };
    try {
        const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `MCP "${server.name}" listTools timed out`);
        const tools = listed.tools.map(mcpTool => ({
            spec: {
                name: toolName(server.name, mcpTool.name),
                description: mcpTool.description ?? `${server.name} · ${mcpTool.name}`,
                parameters: toParams(mcpTool.inputSchema),
            },
            async run(args) {
                const res = await client.callTool({ name: mcpTool.name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
                const parts = Array.isArray(res.content) ? res.content : [];
                const text = parts
                    .filter((c) => typeof c === 'object' && c !== null && c.type === 'text')
                    .map(c => c.text)
                    .join('\n');
                const out = text || JSON.stringify(res.content ?? '');
                if (res.isError)
                    throw new Error(out || `tool "${mcpTool.name}" reported an error`);
                return out;
            },
        }));
        return { tools, close };
    }
    catch (err) {
        await close();
        throw err;
    }
}
