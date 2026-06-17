export type Theme = 'dark' | 'light' | 'system'

export function getTheme(): Theme {
  return (localStorage.getItem('benchy-theme') as Theme) ?? 'dark'
}

export function setTheme(theme: Theme) {
  localStorage.setItem('benchy-theme', theme)
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
}

export function watchSystem(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
