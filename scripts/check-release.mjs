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
const TARBALL = 'benchy-0.1.0.tgz'
const local = join(root, 'dist', 'version.json')

const fail = msg => { console.error(`\x1b[31m✗ ${msg}\x1b[0m`); process.exitCode = 1 }

// GNU tar reads "C:\..." as a remote host ("Cannot connect to C:"), so this
// guard silently crashed on the very machine that cuts the releases. Always run
// it from the repo root with a relative name.
const tar = args => execFileSync('tar', args, { cwd: root, encoding: 'utf8' })
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

if (!existsSync(join(root, TARBALL))) fail(`no ${TARBALL} — run \`npm pack\` first`)
if (!existsSync(local)) fail('no dist/version.json — the build did not stamp')
if (process.exitCode) process.exit(1)

const inTarball = tar(['-xzOf', TARBALL, 'package/dist/version.json']).trim()
const onDisk = readFileSync(local, 'utf8').trim()

if (inTarball !== onDisk) {
  console.error('\x1b[31m✗ dist/version.json in the tarball differs from the one on disk.\x1b[0m')
  console.error(`  tarball: ${inTarball.replace(/\s+/g, ' ')}`)
  console.error(`  on disk: ${onDisk.replace(/\s+/g, ' ')}`)
  console.error('\n  Something rebuilt dist/ after `npm pack`. Re-run `npm pack` and commit')
  console.error('  the resulting dist/version.json together with the .tgz, without rebuilding.')
  process.exit(1)
}

// The stamp being self-consistent proves nothing about WHICH build it stamps.
// A tarball packed twelve commits ago passes that check happily and ships a
// release containing none of itself — silently, because an old frontend and an
// old backend agree with each other.
//
// The test is not "stamp === HEAD": the build stamps HEAD before the tarball
// commit exists, so afterwards the stamp is legitimately one commit behind.
// What must hold is that no shippable source landed after the pack.
// --full-history so a merge commit that brings in source is SEEN as the last
// source change. Without it, git's default history simplification skips the
// merge (it's TREESAME to the merged branch) and returns an ancestor, so a
// release cut on a merge commit false-failed as "predates the source" even
// though the tarball, built from that merge, contained every commit.
// frontend/index.html and frontend/public are build inputs too — they ship into
// frontend/dist. Watch them, or a change there (a favicon, the HTML head) stamps
// a build the guard thinks predates its own "source".
const lastSource = git([
  'log', '-1', '--full-history', '--format=%h', '--',
  'src', 'frontend/src', 'frontend/index.html', 'frontend/public', 'package.json',
  ':(exclude)src/test', ':(exclude)*.test.ts', ':(exclude)*.test.tsx',
]).trim()
const { sha, builtAt } = JSON.parse(onDisk)
if (sha !== lastSource) {
  console.error(`\x1b[31m✗ the packed build predates the source.\x1b[0m stamped ${sha}, source is at ${lastSource}`)
  console.error('\n  Shipping this would deploy a build without the very commits being released.')
  console.error('  Commit your work first, then `npm pack` — its prepack rebuilds from HEAD.')
  process.exit(1)
}

// dist/ is what actually ships (package.json "files"), so it must be the build
// we are about to commit — not something left over from an earlier one.
const dirty = git(['status', '--porcelain', '--', 'dist/version.json', TARBALL]).trim()

console.log(`\x1b[32m✓ release stamp consistent\x1b[0m — ${sha} @ ${builtAt}`)
console.log(`  tarball == dist/version.json, and both contain every source commit (${lastSource}).`)
if (dirty) {
  console.log('\n  Now commit these together, WITHOUT rebuilding in between:')
  for (const line of dirty.split('\n')) console.log(`    ${line.trim()}`)
}
