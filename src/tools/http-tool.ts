import type { Tool } from './types.js'
import type { CustomTool } from '../types.js'

const TIMEOUT_MS = 20_000
const MAX_BYTES = 100_000

// Wraps a user-defined tool as a Tool the loop can dispatch: POST the model's
// arguments to the author-configured URL, return the response text to the model.
//
// Deliberately NOT SSRF-guarded, unlike fetch_url: here the URL is set by the
// person, not the model (the model only supplies `args`), so pointing at a local
// tool server on 127.0.0.1 is a legitimate use — same trust model as a provider
// baseUrl. Bounded by a timeout and a body cap so a slow or gushing endpoint
// can't hang or flood the cell.
export function makeHttpTool(tool: CustomTool): Tool {
  return {
    spec: { name: tool.name, description: tool.description, parameters: tool.parameters },
    async run(args) {
      const res = await fetch(tool.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tool.apiKey ? { Authorization: `Bearer ${tool.apiKey}` } : {}),
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`tool "${tool.name}" returned HTTP ${res.status}`)

      const reader = res.body?.getReader()
      if (!reader) return ''
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          total += value.length
          if (total >= MAX_BYTES) { await reader.cancel().catch(() => {}); break }
        }
      }
      const buf = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { buf.set(c, off); off += c.length }
      return new TextDecoder().decode(buf).slice(0, MAX_BYTES)
    },
  }
}
