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
const TARBALL = 'benchy-0.1.0.tgz'

// GNU tar treats "C:\..." as a remote host and dies with "Cannot connect to C:",
// so these tests — the guard against shipping a broken artifact — failed on the
// one machine that builds the releases, and the suite was reported as green
// anyway. Run tar from the repo root with a relative name instead.
function tarballEntries(): string[] {
  return execFileSync('tar', ['-tzf', TARBALL], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
}

function readFromTarball(entry: string): string {
  return execFileSync('tar', ['-xzOf', TARBALL, entry], { cwd: ROOT, encoding: 'utf8' })
}

describe('published tarball', () => {
  it('exists — it is what users actually install', () => {
    expect(existsSync(join(ROOT, TARBALL))).toBe(true)
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

  it('contains every source commit — a stale tarball ships a release with none of itself', () => {
    // The stamp being self-consistent proves nothing about WHICH build it
    // stamps. A tarball packed twelve commits ago passed every other check here
    // and would have deployed silently: an old frontend and an old backend
    // agree with each other, so nothing 404s and nothing looks wrong.
    //
    // Not "stamp === HEAD": the build stamps HEAD *before* the tarball commit
    // exists, so the stamp is legitimately one commit behind ever after. What
    // must hold is that no shippable source has landed since the pack.
    const stamp = JSON.parse(readFromTarball('package/dist/version.json')) as { sha?: string }
    // --full-history so a release cut on a merge commit sees the merge as the
    // last source change instead of an ancestor (default simplification skips
    // it); otherwise a legitimately complete tarball false-fails here.
    const lastSource = execFileSync('git', [
      'log', '-1', '--full-history', '--format=%h', '--',
      'src', 'frontend/src', 'frontend/index.html', 'frontend/public', 'package.json',
      ':(exclude)src/test', ':(exclude)*.test.ts', ':(exclude)*.test.tsx',
    ], { cwd: ROOT, encoding: 'utf8' }).trim()

    expect(
      stamp.sha,
      `source moved to ${lastSource} after the tarball was packed at ${stamp.sha} — run \`npm pack\` and commit the .tgz with dist/version.json`,
    ).toBe(lastSource)
  })

  it('carries a well-formed build stamp that isNewer() can actually compare', () => {
    const stamp = JSON.parse(readFromTarball('package/dist/version.json')) as Record<string, unknown>
    expect(typeof stamp.sha).toBe('string')
    expect(stamp.sha).not.toBe('dev')
    // Must be the exact ISO-UTC shape isNewer() accepts, or every comparison is inert.
    expect(String(stamp.builtAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  })
})
