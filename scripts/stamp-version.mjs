// Stamps dist/version.json with the build's identity so a running server can
// tell whether a newer build is installable. Run during build/prepack, after
// tsc has (re)created dist/. builtAt is the comparison key (monotonic per
// build); sha/commitDate are for display.
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function git(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const version = {
  sha: git('git rev-parse --short HEAD') || 'unknown',
  commitDate: git('git show -s --format=%cI HEAD') || null,
  builtAt: new Date().toISOString(),
}

mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(join(root, 'dist', 'version.json'), JSON.stringify(version, null, 2) + '\n')
console.log(`stamped dist/version.json → ${version.sha} @ ${version.builtAt}`)
