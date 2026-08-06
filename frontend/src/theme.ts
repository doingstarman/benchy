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

export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function watchSystem(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
