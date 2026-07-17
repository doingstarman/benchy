import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig, upsertProvider, removeProvider } from '../config.js'
import type { Provider } from '../types.js'

// config.json holds the user's API keys. Losing it is the worst thing this tool
// can do to someone, and it used to: readConfig() caught every error — including
// "the JSON is broken" — and answered "no providers", after which the next save
// wrote a config containing only the new entry. Confirmed live: two providers
// and their keys vanished on the next save after a truncated write.

let dir: string
const provider = (id: string, apiKey: string): Provider => ({
  id, name: id, type: 'openai-compatible', apiKey,
  baseUrl: 'https://x.test/v1', models: ['m1'], enabled: true,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'benchy-config-'))
  process.env.BENCHY_DIR = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})

const configPath = () => join(dir, 'config.json')

describe('config read', () => {
  it('treats a missing config as an empty one — a first run is legitimately empty', async () => {
    expect(await readConfig()).toEqual({ providers: [] })
  })

  it('refuses a corrupt config instead of reporting it as empty', async () => {
    await upsertProvider(provider('alpha', 'sk-alpha-SECRET'))
    const good = readFileSync(configPath(), 'utf8')

    // A torn write — what a crash or a full disk leaves behind.
    writeFileSync(configPath(), good.slice(0, Math.floor(good.length / 2)))
    await expect(readConfig()).rejects.toThrow(/not valid JSON/)

    // Valid JSON of the wrong shape must not pass either.
    writeFileSync(configPath(), '{"providers": "nope"}')
    await expect(readConfig()).rejects.toThrow(/no providers array/)
    writeFileSync(configPath(), '"just a string"')
    await expect(readConfig()).rejects.toThrow(/not a JSON object/)
  })

  it('a corrupt config survives a save attempt — keys are never overwritten away', async () => {
    await upsertProvider(provider('alpha', 'sk-alpha-SECRET'))
    await upsertProvider(provider('beta', 'sk-beta-SECRET'))

    const good = readFileSync(configPath(), 'utf8')
    const torn = good.slice(0, Math.floor(good.length / 2))
    writeFileSync(configPath(), torn)

    // The save must fail loudly rather than silently rebuild the file.
    await expect(upsertProvider(provider('gamma', 'sk-gamma'))).rejects.toThrow(/refusing to overwrite/)
    // The user's bytes are still there to recover from.
    expect(readFileSync(configPath(), 'utf8')).toBe(torn)

    // Same for a delete.
    await expect(removeProvider('alpha')).rejects.toThrow(/refusing to overwrite/)
    expect(readFileSync(configPath(), 'utf8')).toBe(torn)
  })
})

describe('the user is told what happened', () => {
  it('names the file and says what to do — a blank 500 helps nobody', async () => {
    await upsertProvider(provider('alpha', 'sk-alpha-SECRET'))
    writeFileSync(configPath(), '{"providers": [')

    const err = await readConfig().then(() => null, (e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    // The path, so they can find it; the promise not to touch it; the way out.
    expect(err!.message).toContain(configPath())
    expect(err!.message).toContain('refusing to overwrite')
    expect(err!.message).toMatch(/Fix or move the file/)
  })
})

describe('config write', () => {
  it('is atomic — a reader never sees a half-written config', async () => {
    await writeConfig({ providers: [provider('alpha', 'sk-alpha')] })
    // Rename-into-place means the file is only ever the old one or the new one.
    expect((await readConfig()).providers).toHaveLength(1)

    await writeConfig({ providers: [provider('alpha', 'sk-alpha'), provider('beta', 'sk-beta')] })
    expect((await readConfig()).providers).toHaveLength(2)
  })

  it('leaves no temp files behind', async () => {
    await writeConfig({ providers: [provider('alpha', 'sk-alpha')] })
    await writeConfig({ providers: [provider('beta', 'sk-beta')] })
    expect(readdirSync(dir).filter(f => f.includes('.tmp'))).toEqual([])
    expect(existsSync(configPath())).toBe(true)
  })

  it('round-trips providers and their keys through upsert/remove', async () => {
    await upsertProvider(provider('alpha', 'sk-alpha-SECRET'))
    await upsertProvider(provider('beta', 'sk-beta-SECRET'))
    // Updating one must not disturb the other's key.
    await upsertProvider({ ...provider('alpha', 'sk-alpha-ROTATED'), models: ['m1', 'm2'] })

    let stored = (await readConfig()).providers
    expect(stored).toHaveLength(2)
    expect(stored.find(p => p.id === 'alpha')?.apiKey).toBe('sk-alpha-ROTATED')
    expect(stored.find(p => p.id === 'beta')?.apiKey).toBe('sk-beta-SECRET')

    await removeProvider('alpha')
    stored = (await readConfig()).providers
    expect(stored.map(p => p.id)).toEqual(['beta'])
    expect(stored[0].apiKey).toBe('sk-beta-SECRET')
  })
})
