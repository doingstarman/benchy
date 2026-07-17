import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'

// The runtime dist/ ships in the tarball and runs on a machine that installed
// ONLY package.json's declared dependencies. A bare import of anything else
// throws ERR_MODULE_NOT_FOUND on startup — which is exactly how a stray
// `import { Agent } from 'undici'` took down every global install: undici is
// bundled inside Node for global fetch but is NOT an installable dependency, so
// the import resolved on the dev box (transitively present) and crashed on a
// clean install. This test makes that class of break impossible to ship.
const ROOT = join(import.meta.dirname, '..', '..')

function distJsFiles(): string[] {
  // git ls-files so the test sees exactly what is committed/shipped, not stray
  // local build junk.
  return execFileSync('git', ['ls-files', 'dist'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(l => l.trim()).filter(f => f.endsWith('.js'))
}

// Package name of a bare specifier: "@scope/pkg/sub" -> "@scope/pkg", "pkg/sub" -> "pkg".
function packageName(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const IMPORT_RE = /(?:import\b[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g

describe('dist imports', () => {
  it('only imports declared dependencies and node builtins', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const declared = new Set(Object.keys(pkg.dependencies ?? {}))
    const builtins = new Set(builtinModules)

    const offenders: string[] = []
    for (const file of distJsFiles()) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      for (const m of src.matchAll(IMPORT_RE)) {
        const spec = m[1]
        if (spec.startsWith('.') || spec.startsWith('node:')) continue // relative / explicit builtin
        const name = packageName(spec)
        if (builtins.has(name)) continue // bare builtin (e.g. "http")
        if (declared.has(name)) continue // declared runtime dependency
        offenders.push(`${file}: imports "${spec}" (package "${name}" is not a dependency)`)
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
