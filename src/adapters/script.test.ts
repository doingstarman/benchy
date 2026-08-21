import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scriptAdapter } from './script.js'
import type { Chunk, Message } from './base.js'

let dir: string
const MSGS: Message[] = [{ role: 'user', content: 'hi' }]

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'benchy-script-')) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

async function collect(command: string, agent?: Record<string, unknown>): Promise<Chunk[]> {
  const out: Chunk[] = []
  for await (const c of scriptAdapter.stream(MSGS, { model: 'test', baseUrl: command, agent })) out.push(c)
  return out
}

function write(name: string, body: string): string {
  const p = join(dir, name)
  writeFileSync(p, body)
  return p
}

describe('script adapter — agent trace streaming', () => {
  it('parses trace lines split across stdout chunk boundaries', async () => {
    // Emit a step line in two writes with the newline arriving only in the second,
    // so a naive per-chunk parser would choke on the partial line.
    const s = write('split.mjs', `
      process.stdout.write('{"type":"step","kind":"think",')
      await new Promise(r => setTimeout(r, 20))
      process.stdout.write('"name":"planning"}\\n')
      process.stdout.write('{"type":"token","text":"answer"}\\n')
    `)
    const chunks = await collect(`node ${s}`)
    const step = chunks.find(c => c.type === 'step')
    expect(step && step.type === 'step' && step.step.name).toBe('planning')
    expect(chunks.some(c => c.type === 'token' && c.text === 'answer')).toBe(true)
    expect(chunks.some(c => c.type === 'done')).toBe(true)
  })

  it('kills a process that exceeds the timeout and reports scope:agent', async () => {
    const s = write('hang.mjs', `
      process.stdout.write('{"type":"step","name":"start"}\\n')
      setInterval(() => {}, 1000) // never exits on its own
    `)
    const chunks = await collect(`node ${s}`, { timeoutMs: 300 })
    const err = chunks.find(c => c.type === 'error')
    expect(err && err.type === 'error' && err.scope).toBe('agent')
    expect(err && err.type === 'error' && /timed out/.test(err.message)).toBe(true)
  })

  it('reports a non-zero exit as scope:agent with stderr', async () => {
    const s = write('boom.mjs', `
      process.stderr.write('ModuleNotFoundError: boom')
      process.exit(1)
    `)
    const chunks = await collect(`node ${s}`)
    const err = chunks.find(c => c.type === 'error')
    expect(err && err.type === 'error' && err.scope).toBe('agent')
    expect(err && err.type === 'error' && err.message).toContain('boom')
  })

  it('applies cwd and env to the child', async () => {
    const s = write('env.mjs', `
      process.stdout.write('{"type":"token","text":"' + process.env.BENCHY_MARK + '|' + process.cwd().split(/[\\\\/]/).pop() + '"}\\n')
    `)
    const chunks = await collect(`node ${s}`, { cwd: dir, env: { BENCHY_MARK: 'ok42' } })
    const tok = chunks.find(c => c.type === 'token')
    expect(tok && tok.type === 'token' && tok.text).toContain('ok42|')
    expect(tok && tok.type === 'token' && tok.text.includes(dir.split(/[\\/]/).pop() as string)).toBe(true)
  })

  it('aborts on the step limit', async () => {
    const s = write('many.mjs', `
      for (let i = 0; i < 100; i++) process.stdout.write('{"type":"step","name":"s' + i + '"}\\n')
      setInterval(() => {}, 1000)
    `)
    const chunks = await collect(`node ${s}`, { maxSteps: 3, timeoutMs: 5000 })
    const err = chunks.find(c => c.type === 'error')
    expect(err && err.type === 'error' && /step limit/.test(err.message)).toBe(true)
  })
})
