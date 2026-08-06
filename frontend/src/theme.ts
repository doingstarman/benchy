import { makePref } from './prefs'

export type Theme = 'dark' | 'light' | 'system'

// Storing the theme and APPLYING it are separate jobs. The store is a pref like
// any other; a single effect in App owns the data-theme attribute, so the
// attribute tracks the pref no matter who set it — and, with theme='system',
// keeps tracking the OS after the Settings page is closed.
const themePref = makePref<Theme>(
  'benchy-theme',
  raw => raw === 'light' || raw === 'system' ? raw : 'dark',
  v => v,
)
export const getTheme = themePref.get
export const setTheme = themePref.set
export const useTheme = themePref.use

// The accent hues. Deliberately not green or amber: --success and --warning
// already own those, and the code-execution warning card renders three rows
// below the swatches that would pick one.
export const ACCENTS = ['purple', 'blue', 'teal', 'rose'] as const
export type Accent = typeof ACCENTS[number]

function isAccent(raw: string | null): raw is Accent {
  return ACCENTS.includes(raw as Accent)
}

const accentPref = makePref<Accent>(
  'benchy-accent',
  raw => isAccent(raw) ? raw : 'purple',
  v => v,
)
export const getAccent = accentPref.get
export const setAccent = accentPref.set
export const useAccent = accentPref.use

export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function watchSystem(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
