import { randomUUID } from 'node:crypto';
import { getCustomTools, upsertCustomTool, removeCustomTool, getSkills, upsertSkill, removeSkill, getMcpServers, upsertMcpServer, removeMcpServer, } from '../config.js';
import { TOOL_IDS } from '../tools/index.js';
// The name a model calls the tool by — must be a valid function identifier for
// every provider's tool-calling schema. Capped at 64: OpenAI/Anthropic reject
// longer tool names, so an over-long one would fail every provider call in the
// run rather than error here.
const TOOL_NAME_RE = /^[a-z0-9_]{1,64}$/i;
const RESERVED_TOOL_NAMES = new Set(TOOL_IDS);
function parseParams(x) {
    if (!x || typeof x !== 'object')
        return null;
    const p = x;
    if (p.type !== 'object')
        return null;
    if (!p.properties || typeof p.properties !== 'object' || Array.isArray(p.properties))
        return null;
    if (p.required !== undefined && !(Array.isArray(p.required) && p.required.every(r => typeof r === 'string')))
        return null;
    return { type: 'object', properties: p.properties, required: p.required };
}
export async function registerLibraryRoutes(app) {
    // ─── Custom tools ─────────────────────────────────────────────────────────
    app.get('/api/tools', async () => ({ data: await getCustomTools() }));
    app.post('/api/tools', async (req, reply) => {
        const b = req.body;
        if (!b || typeof b.name !== 'string' || !TOOL_NAME_RE.test(b.name.trim())) {
            return reply.code(400).send({ error: 'name is required, must match [a-z0-9_] and be at most 64 chars' });
        }
        const name = b.name.trim();
        // A custom name that equals a built-in id would silently overwrite the safe
        // built-in in resolveTools' name→tool map (e.g. shadowing the SSRF-guarded
        // fetch_url with an unguarded POST). Reserve them.
        if (RESERVED_TOOL_NAMES.has(name.toLowerCase())) {
            return reply.code(400).send({ error: `"${name}" is a built-in tool name — choose another` });
        }
        // Two custom tools with the same name collide the same way (last wins).
        const existing = await getCustomTools();
        if (existing.some(t => t.name === name && t.id !== b.id)) {
            return reply.code(400).send({ error: `a custom tool named "${name}" already exists` });
        }
        if (typeof b.url !== 'string' || !/^https?:\/\//i.test(b.url.trim())) {
            return reply.code(400).send({ error: 'url must be an http(s) endpoint' });
        }
        const params = parseParams(b.parameters) ?? { type: 'object', properties: {} };
        const tool = {
            id: b.id ?? randomUUID(),
            name,
            description: typeof b.description === 'string' ? b.description.slice(0, 1024) : '',
            parameters: params,
            url: b.url.trim(),
            ...(b.apiKey ? { apiKey: b.apiKey } : {}),
            enabled: b.enabled ?? true,
        };
        await upsertCustomTool(tool);
        return reply.code(201).send({ data: tool });
    });
    app.delete('/api/tools/:id', async (req, reply) => {
        await removeCustomTool(req.params.id);
        return reply.code(204).send();
    });
    // ─── Skills ───────────────────────────────────────────────────────────────
    app.get('/api/skills', async () => ({ data: await getSkills() }));
    app.post('/api/skills', async (req, reply) => {
        const b = req.body;
        if (!b || typeof b.name !== 'string' || !b.name.trim()) {
            return reply.code(400).send({ error: 'name is required' });
        }
        const skill = {
            id: b.id ?? randomUUID(),
            name: b.name.trim(),
            instruction: typeof b.instruction === 'string' ? b.instruction : '',
            toolIds: Array.isArray(b.toolIds) ? b.toolIds.filter((t) => typeof t === 'string') : [],
            enabled: b.enabled ?? true,
        };
        await upsertSkill(skill);
        return reply.code(201).send({ data: skill });
    });
    app.delete('/api/skills/:id', async (req, reply) => {
        await removeSkill(req.params.id);
        return reply.code(204).send();
    });
    // ─── MCP servers (registry only) ──────────────────────────────────────────
    app.get('/api/mcp', async () => ({ data: await getMcpServers() }));
    app.post('/api/mcp', async (req, reply) => {
        const b = req.body;
        if (!b || typeof b.name !== 'string' || !b.name.trim()) {
            return reply.code(400).send({ error: 'name is required' });
        }
        const transport = b.transport === 'stdio' || b.transport === 'sse' || b.transport === 'http' ? b.transport : 'http';
        if (transport === 'stdio' ? !b.command?.trim() : !b.url?.trim()) {
            return reply.code(400).send({ error: transport === 'stdio' ? 'command is required for stdio' : 'url is required for sse/http' });
        }
        const server = {
            id: b.id ?? randomUUID(),
            name: b.name.trim(),
            transport,
            ...(b.url ? { url: b.url.trim() } : {}),
            ...(b.command ? { command: b.command.trim() } : {}),
            ...(b.apiKey ? { apiKey: b.apiKey } : {}),
            enabled: b.enabled ?? true,
        };
        await upsertMcpServer(server);
        return reply.code(201).send({ data: server });
    });
    app.delete('/api/mcp/:id', async (req, reply) => {
        await removeMcpServer(req.params.id);
        return reply.code(204).send();
    });
}
