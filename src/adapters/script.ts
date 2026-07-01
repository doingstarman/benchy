import { spawn } from 'node:child_process'
import type { Adapter, AdapterConfig, Chunk, Message } from './base.js'

export const scriptAdapter: Adapter = {
  async *stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk> {
    const command = config.baseUrl?.trim()
    if (!command) { yield { type: 'error', message: 'No script command configured' }; return }

    const parts = command.split(/\s+/)
    const cmd = parts[0]
    const args = parts.slice(1)

    const [exitCode, stdout, stderr] = await new Promise<[number | null, string, string]>(resolve => {
      const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false })
      let out = ''
      let err = ''
      proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
      proc.on('close', code => resolve([code, out, err]))
      proc.on('error', e => resolve([1, '', e.message]))
      proc.stdin.write(JSON.stringify({ messages, model: config.model }))
      proc.stdin.end()
    })

    if (exitCode !== 0) {
      yield { type: 'error', message: stderr.trim() || `Script exited with code ${exitCode}` }
      return
    }

    // Each non-empty line is a token; allows scripts to emit progressively
    for (const line of stdout.split('\n')) {
      if (line) yield { type: 'token', text: line + '\n' }
    }

    yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }
  },
}
