import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DICT } from './i18n'

// A missing translation key is invisible to tsc and to every runtime test: t()
// falls back to returning the key, so the UI silently renders "code.copyCode" at
// the user. This audit is the only thing that catches a typo'd or dropped key.
const FRONTEND_SRC = import.meta.dirname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : []
  })
}

const definedKeys = new Set(Object.keys(DICT))

// Static keys: t('some.key'). Dynamic keys: t(`run.mode${i}`) — expand the one
// template form the app uses rather than pretend it doesn't exist.
const usedKeys = new Set<string>()
for (const file of sourceFiles(FRONTEND_SRC)) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/\bt\('([a-zA-Z0-9._]+)'/g)) usedKeys.add(m[1])
  for (const m of src.matchAll(/\bt\(`([a-zA-Z0-9._]+)\$\{/g)) {
    for (let i = 0; i < 3; i++) usedKeys.add(`${m[1]}${i}`)
  }
}

describe('i18n dictionary', () => {
  it('defines every key the UI asks for (a missing key renders raw at the user)', () => {
    const missing = [...usedKeys].filter(k => !definedKeys.has(k)).sort()
    expect(missing, `undefined keys: ${missing.join(', ')}`).toEqual([])
  })

  it('translates every key into both languages, with no empty strings', () => {
    const broken = Object.entries(DICT)
      .filter(([, v]) => !v.en?.trim() || !v.ru?.trim())
      .map(([k]) => k)
    expect(broken, `entries missing a translation: ${broken.join(', ')}`).toEqual([])
  })

  it('keeps every {var} placeholder answerable — a stray one renders literally', () => {
    // t() only substitutes vars the caller passes; an en/ru pair that disagrees
    // on placeholders leaks a raw "{n}" into one of the languages.
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
    const mismatched = Object.entries(DICT)
      .filter(([, v]) => placeholders(v.en) !== placeholders(v.ru))
      .map(([k]) => k)
    expect(mismatched, `en/ru placeholder mismatch: ${mismatched.join(', ')}`).toEqual([])
  })

  it('audits a real dictionary, not an empty one', () => {
    expect(definedKeys.size).toBeGreaterThan(100)
    expect(usedKeys.size).toBeGreaterThan(100)
  })
})
