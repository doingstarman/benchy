import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACCENTS } from './theme'

// The accent palette exists in three places that cannot import each other: the
// CSS that defines it, the TS list the UI offers, and the boot script in
// index.html that must apply it before React mounts. Nothing at runtime can see
// them disagree — a half-defined palette just renders the wrong colour, and a
// stale boot list just flashes purple on reload. This is the only guard.
const CSS = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8')
const HTML = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8')

const ACCENT_PROPS = ['--accent', '--accent-dim', '--accent-bg', '--on-accent']

// Anchored to the start of a line: '[data-accent="rose"]' is a substring of
// '[data-theme="light"][data-accent="rose"]', so an unanchored search would
// happily report the twin as proof the plain block exists.
function blockFor(selector: string): string | null {
  const at = new RegExp(`^${selector.replace(/[[\]"]/g, '\\$&')}\\s*\\{`, 'm').exec(CSS)
  if (!at) return null
  const open = at.index + at[0].length - 1
  const close = CSS.indexOf('}', open)
  return close === -1 ? null : CSS.slice(open + 1, close)
}

describe('accent palettes', () => {
  it('defines a dark block for every accent the UI offers', () => {
    const missing = ACCENTS.filter(a => blockFor(`[data-accent="${a}"]`) === null)
    expect(missing, `no [data-accent] block in tokens.css for: ${missing.join(', ')}`).toEqual([])
  })

  // Without the theme-qualified twin the plain block wins in light mode too,
  // because both are (0,1,0) and the accent block sits later in the file.
  it('pairs every dark block with a light-theme twin', () => {
    const missing = ACCENTS.filter(a => blockFor(`[data-theme="light"][data-accent="${a}"]`) === null)
    expect(missing, `dark accent would leak into the light theme for: ${missing.join(', ')}`).toEqual([])
  })

  it('sets all four accent properties in both blocks', () => {
    const incomplete: string[] = []
    for (const a of ACCENTS) {
      for (const selector of [`[data-accent="${a}"]`, `[data-theme="light"][data-accent="${a}"]`]) {
        const block = blockFor(selector) ?? ''
        for (const prop of ACCENT_PROPS) {
          if (!new RegExp(`${prop}\\s*:`).test(block)) incomplete.push(`${selector} ${prop}`)
        }
      }
    }
    expect(incomplete, `incomplete palettes: ${incomplete.join(', ')}`).toEqual([])
  })

  it('offers exactly the palettes tokens.css defines — no more, no fewer', () => {
    const inCss = [...CSS.matchAll(/^\[data-accent="([a-z]+)"\]/gm)].map(m => m[1])
    expect([...inCss].sort()).toEqual([...ACCENTS].sort())
  })

  it('keeps the boot script whitelist in step with ACCENTS', () => {
    const list = /var known = \[([^\]]+)\]/.exec(HTML)
    expect(list, 'boot script accent whitelist not found in index.html').not.toBeNull()
    const inBoot = [...list![1].matchAll(/'([a-z]+)'/g)].map(m => m[1])
    expect(inBoot.sort()).toEqual([...ACCENTS].sort())
  })

  it('leaves purple identical to the pre-accent tokens, so nothing shifts by default', () => {
    const dark = blockFor('[data-accent="purple"]') ?? ''
    expect(dark).toContain('#7F77DD')
    expect(dark).toContain('#4a4390')
    expect(dark).toContain('#1e1a3a')
    const light = blockFor('[data-theme="light"][data-accent="purple"]') ?? ''
    expect(light).toContain('#6a61d0')
    expect(light).toContain('#b3aeea')
    expect(light).toContain('#eeedf9')
  })
})

describe('semantic dim tokens', () => {
  // The warning and danger cards on the Settings page need a mid-tone border,
  // the way --success-dim and --accent-dim already provide one.
  it('defines --warning-dim and --error-dim in both themes', () => {
    const root = blockFor(':root') ?? ''
    const light = blockFor('[data-theme="light"]') ?? ''
    for (const prop of ['--warning-dim', '--error-dim']) {
      expect(root, `${prop} missing from :root`).toContain(prop)
      expect(light, `${prop} missing from the light theme`).toContain(prop)
    }
  })
})
