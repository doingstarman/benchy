import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('npm CLI package wiring', () => {
  const root = process.cwd()
  const packageJson = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf-8'),
  ) as {
    bin?: Record<string, string>
    engines?: Record<string, string>
    files?: string[]
    scripts?: Record<string, string>
  }

  it('exposes the benchy executable from the compiled CLI', () => {
    expect(packageJson.bin?.benchy).toBe('./dist/cli.js')
    expect(packageJson.engines?.node).toBe('>=22')
    expect(packageJson.files).toEqual(
      expect.arrayContaining(['dist', 'frontend/dist']),
    )
  })

  it('builds before npm packs the installable artifact', () => {
    expect(packageJson.scripts?.build).toContain('tsconfig.build.json')
    expect(packageJson.scripts?.prepack).toBe('npm run build')
    expect(packageJson.scripts?.prepare).toBeUndefined()
    expect(packageJson.scripts?.start).toBe('node dist/cli.js')
  })

  it('documents the GitHub-hosted npm tarball install command', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf-8')
    expect(readme).toContain(
      'npm install -g https://raw.githubusercontent.com/doingstarman/benchy/main/benchy-0.1.0.tgz',
    )
    expect(readme).not.toContain('npm install -g benchy\n')
    expect(readme).not.toContain('npm install -g github:doingstarman/benchy')
  })

  it('keeps a shebang in the TypeScript CLI for npm bin execution', () => {
    const cliSource = readFileSync(join(root, 'src', 'cli.ts'), 'utf-8')
    expect(cliSource.startsWith('#!/usr/bin/env node')).toBe(true)
  })
})
