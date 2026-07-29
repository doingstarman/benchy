import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import {
  getCustomTools, upsertCustomTool, removeCustomTool,
  getSkills, upsertSkill, removeSkill,
  getMcpServers, upsertMcpServer, removeMcpServer,
} from '../config.js'
import type { CustomTool, Skill, McpServer, ToolParams } from '../types.js'

// The name a model calls the tool by — must be a valid function identifier for
// every provider's tool-calling schema.
const TOOL_NAME_RE = /^[a-z0-9_]+$/i

function parseParams(x: unknown): ToolParams | null {
  if (!x || typeof x !== 'object') return null
  const p = x as { type?: unknown; properties?: unknown; required?: unknown }
  if (p.type !== 'object') return null
  if (!p.properties || typeof p.properties !== 'object' || Array.isArray(p.properties)) return null
  if (p.required !== undefined && !(Array.isArray(p.required) && p.required.every(r => typeof r === 'string'))) return null
  return { type: 'object', properties: p.properties as Record<string, unknown>, required: p.required as string[] | undefined }
}

export async function registerLibraryRoutes(app: FastifyInstance): Promise<void> {
  // ─── Custom tools ─────────────────────────────────────────────────────────
  app.get('/api/tools', async () => ({ data: await getCustomTools() }))

  app.post<{ Body: Partial<CustomTool> }>('/api/tools', async (req, reply) => {
    const b = req.body
    if (!b || typeof b.name !== 'string' || !TOOL_NAME_RE.test(b.name.trim())) {
      return reply.code(400).send({ error: 'name is required and must match [a-z0-9_]' })
    }
    if (typeof b.url !== 'string' || !/^https?:\/\//i.test(b.url.trim())) {
      return reply.code(400).send({ error: 'url must be an http(s) endpoint' })
    }
    const params = parseParams(b.parameters) ?? { type: 'object' as const, properties: {} }
    const tool: CustomTool = {
      id: b.id ?? randomUUID(),
      name: b.name.trim(),
      description: typeof b.description === 'string' ? b.description : '',
      parameters: params,
      url: b.url.trim(),
      ...(b.apiKey ? { apiKey: b.apiKey } : {}),
      enabled: b.enabled ?? true,
    }
    await upsertCustomTool(tool)
    return reply.code(201).send({ data: tool })
  })

  app.delete<{ Params: { id: string } }>('/api/tools/:id', async (req, reply) => {
    await removeCustomTool(req.params.id)
    return reply.code(204).send()
  })

  // ─── Skills ───────────────────────────────────────────────────────────────
  app.get('/api/skills', async () => ({ data: await getSkills() }))

  app.post<{ Body: Partial<Skill> }>('/api/skills', async (req, reply) => {
    const b = req.body
    if (!b || typeof b.name !== 'string' || !b.name.trim()) {
      return reply.code(400).send({ error: 'name is required' })
    }
    const skill: Skill = {
      id: b.id ?? randomUUID(),
      name: b.name.trim(),
      instruction: typeof b.instruction === 'string' ? b.instruction : '',
      toolIds: Array.isArray(b.toolIds) ? b.toolIds.filter((t): t is string => typeof t === 'string') : [],
      enabled: b.enabled ?? true,
    }
    await upsertSkill(skill)
    return reply.code(201).send({ data: skill })
  })

  app.delete<{ Params: { id: string } }>('/api/skills/:id', async (req, reply) => {
    await removeSkill(req.params.id)
    return reply.code(204).send()
  })

  // ─── MCP servers (registry only) ──────────────────────────────────────────
  app.get('/api/mcp', async () => ({ data: await getMcpServers() }))

  app.post<{ Body: Partial<McpServer> }>('/api/mcp', async (req, reply) => {
    const b = req.body
    if (!b || typeof b.name !== 'string' || !b.name.trim()) {
      return reply.code(400).send({ error: 'name is required' })
    }
    const transport = b.transport === 'stdio' || b.transport === 'sse' || b.transport === 'http' ? b.transport : 'http'
    if (transport === 'stdio' ? !b.command?.trim() : !b.url?.trim()) {
      return reply.code(400).send({ error: transport === 'stdio' ? 'command is required for stdio' : 'url is required for sse/http' })
    }
    const server: McpServer = {
      id: b.id ?? randomUUID(),
      name: b.name.trim(),
      transport,
      ...(b.url ? { url: b.url.trim() } : {}),
      ...(b.command ? { command: b.command.trim() } : {}),
      ...(b.apiKey ? { apiKey: b.apiKey } : {}),
      enabled: b.enabled ?? true,
    }
    await upsertMcpServer(server)
    return reply.code(201).send({ data: server })
  })

  app.delete<{ Params: { id: string } }>('/api/mcp/:id', async (req, reply) => {
    await removeMcpServer(req.params.id)
    return reply.code(204).send()
  })
}
