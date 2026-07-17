import type { Tool } from './types.js'
import { calcTool } from './calc.js'
import { fetchUrlTool } from './fetch-url.js'
import { makeWebSearchTool } from './web-search.js'
import { getSearchConfig } from '../config.js'

export type { Tool, ToolSpec } from './types.js'

// The tool ids a run may request. web_search is listed but only ever
// materializes when a search key is configured — see resolveTools.
export const TOOL_IDS = ['calc', 'fetch_url', 'web_search'] as const
export type ToolId = typeof TOOL_IDS[number]

export function isToolId(x: unknown): x is ToolId {
  return typeof x === 'string' && (TOOL_IDS as readonly string[]).includes(x)
}

// Turns the ids a run enabled into ready-to-run tools. web_search silently drops
// out when there's no key — a model is never handed a tool that would fail on
// its first call. Returns a name→Tool map so the loop can dispatch by name.
export async function resolveTools(ids: readonly string[]): Promise<Map<string, Tool>> {
  const wanted = new Set(ids)
  const out = new Map<string, Tool>()
  if (wanted.has('calc')) out.set(calcTool.spec.name, calcTool)
  if (wanted.has('fetch_url')) out.set(fetchUrlTool.spec.name, fetchUrlTool)
  if (wanted.has('web_search')) {
    const search = await getSearchConfig()
    if (search) {
      const tool = makeWebSearchTool(search)
      out.set(tool.spec.name, tool)
    }
  }
  return out
}
