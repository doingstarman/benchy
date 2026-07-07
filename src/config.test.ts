import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig, upsertProvider, removeProvider, getProviders } from './config.js'
import type { Provider } from './types.js'

let tempDir: string | null = null

function useTempBenchyDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-config-'))
  process.env.BENCHY_DIR = tempDir
  return tempDir
}

function useTempDevBenchyDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-config-'))
  const devDir = join(tempDir, '.benchy-dev')
  process.env.BENCHY_DIR = devDir
  return devDir
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
  delete process.env.BENCHY_DIR
})

describe('config file storage', () => {
  it('returns an empty providers list when config file is absent', async () => {
    useTempBenchyDir()

    await expect(readConfig()).resolves.toEqual({ providers: [] })
  })

  it('honors BENCHY_DIR even when it is set after module import', async () => {
    const dir = useTempBenchyDir()
    const provider: Provider = {
      id: 'local-openai',
      name: 'Local OpenAI',
      type: 'openai',
      apiKey: 'sk-test',
      models: ['gpt-4o-mini'],
      enabled: true,
    }

    await writeConfig({ providers: [provider] })

    const configPath = join(dir, 'config.json')
    expect(existsSync(configPath)).toBe(true)
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({ providers: [provider] })
  })

  it('upserts and removes providers by id', async () => {
    useTempBenchyDir()

    await upsertProvider({
      id: 'p1',
      name: 'Provider',
      type: 'custom',
      models: ['m1'],
      enabled: true,
    })
    await upsertProvider({
      id: 'p1',
      name: 'Provider Updated',
      type: 'custom',
      models: ['m1', 'm2'],
      enabled: false,
    })

    expect((await readConfig()).providers).toEqual([
      {
        id: 'p1',
        name: 'Provider Updated',
        type: 'custom',
        models: ['m1', 'm2'],
        enabled: false,
      },
    ])

    await removeProvider('p1')
    expect((await readConfig()).providers).toEqual([])
  })

  it('hides mock- providers from getProviders outside a .benchy-dev directory', async () => {
    useTempBenchyDir()

    await writeConfig({
      providers: [
        { id: 'mock-openai', name: 'Mock OpenAI', type: 'openai', models: ['gpt-4o'], enabled: true },
        { id: 'real-openai', name: 'OpenAI', type: 'openai', models: ['gpt-4o'], enabled: true },
      ],
    })

    expect((await getProviders()).map(p => p.id)).toEqual(['real-openai'])
  })

  it('keeps mock- providers from getProviders inside a .benchy-dev directory', async () => {
    useTempDevBenchyDir()

    await writeConfig({
      providers: [
        { id: 'mock-openai', name: 'Mock OpenAI', type: 'openai', models: ['gpt-4o'], enabled: true },
        { id: 'real-openai', name: 'OpenAI', type: 'openai', models: ['gpt-4o'], enabled: true },
      ],
    })

    expect((await getProviders()).map(p => p.id)).toEqual(['mock-openai', 'real-openai'])
  })
})
