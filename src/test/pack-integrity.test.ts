import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// The published tarball IS the product for every user (`npm i -g <tarball>`),
// and a tarball install never runs prepack. So anything the running app needs at
// runtime must physically be inside the .tgz. The first alpha nearly shipped
// without dist/version.json in it, which would have killed update detection for
// every user, silently and forever. This test makes that impossible to repeat.
const ROOT = join(import.meta.dirname, '..', '..')
const TARBALL = join(ROOT, 'benchy-0.1.0.tgz')

function tarballEntries(): string[] {
  return execFileSync('tar', ['-tzf', TARBALL], { encoding: 'utf8' })
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
}

function readFromTarball(entry: string): string {
  return execFileSync('tar', ['-xzOf', TARBALL, entry], { encoding: 'utf8' })
}

describe('published tarball', () => {
  it('exists — it is what users actually install', () => {
    expect(existsSync(TARBALL)).toBe(true)
  })

  it('ships the runtime the app needs: cli, server, frontend build', () => {
    const entries = tarballEntries()
    for (const required of ['package/dist/cli.js', 'package/dist/server.js', 'package/frontend/dist/index.html']) {
      expect(entries, `missing ${required}`).toContain(required)
    }
  })

  it('ships dist/version.json, or update detection is dead on arrival', () => {
    // Without this file readLocalVersion() falls back to the dev stamp, isNewer()
    // returns false unconditionally, and the user is told "dev build — updates
    // not tracked" on a real install.
    expect(tarballEntries()).toContain('package/dist/version.json')
  })

  it('carries a well-formed build stamp that isNewer() can actually compare', () => {
    const stamp = JSON.parse(readFromTarball('package/dist/version.json')) as Record<string, unknown>
    expect(typeof stamp.sha).toBe('string')
    expect(stamp.sha).not.toBe('dev')
    // Must be the exact ISO-UTC shape isNewer() accepts, or every comparison is inert.
    expect(String(stamp.builtAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  })
})
