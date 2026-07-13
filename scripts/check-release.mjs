// Run AFTER `npm pack`, BEFORE committing the tarball. Guards the one invariant
// update detection rests on:
//
//   the dist/version.json inside the tarball  ==  the dist/version.json we commit
//
// `npm pack` re-runs the build (prepack), which re-stamps builtAt. So any rebuild
// between packing and committing silently desyncs the two, and then either
//   - committed stamp is NEWER than the tarball's → every fresh install claims
//     "update available" on day one, and `benchy update` can never clear it; or
//   - committed stamp is OLDER → no user is ever told about any update.
// Both are invisible until it's too late. Fail loudly instead.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tarball = join(root, 'benchy-0.1.0.tgz')
const local = join(root, 'dist', 'version.json')

const fail = msg => { console.error(`\x1b[31m✗ ${msg}\x1b[0m`); process.exitCode = 1 }

if (!existsSync(tarball)) fail(`no tarball at ${tarball} — run \`npm pack\` first`)
if (!existsSync(local)) fail(`no dist/version.json — the build did not stamp`)
if (process.exitCode) process.exit(1)

const inTarball = execFileSync('tar', ['-xzOf', tarball, 'package/dist/version.json'], { encoding: 'utf8' })
const onDisk = readFileSync(local, 'utf8')

if (inTarball.trim() !== onDisk.trim()) {
  console.error('\x1b[31m✗ dist/version.json in the tarball differs from the one on disk.\x1b[0m')
  console.error(`  tarball: ${inTarball.trim().replace(/\s+/g, ' ')}`)
  console.error(`  on disk: ${onDisk.trim().replace(/\s+/g, ' ')}`)
  console.error('\n  Something rebuilt dist/ after `npm pack`. Re-run `npm pack` and commit')
  console.error('  the resulting dist/version.json together with the .tgz, without rebuilding.')
  process.exit(1)
}

const { sha, builtAt } = JSON.parse(onDisk)
console.log(`\x1b[32m✓ release stamp consistent\x1b[0m — ${sha} @ ${builtAt}`)
console.log('  Commit dist/version.json and benchy-0.1.0.tgz together; do not rebuild before committing.')
