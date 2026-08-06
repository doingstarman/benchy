import { useSyncExternalStore } from 'react'

// Display preferences that are the viewer's business, not the run's — they must
// not end up in RunSettings, or reopening someone's saved run would silently
// rewrite how they see it. Module-level store + useSyncExternalStore, the same
// shape as i18n.ts, so no Context provider and tests stay provider-free.

interface Pref<T> {
  get: () => T
  set: (v: T) => void
  use: () => T
}

// Each pref closes over its OWN listener set. Sharing one set across prefs
// would wake every subscriber on every unrelated change — invisible in behaviour
// but it makes each pref's cost grow with how many others exist.
// Scalars only: the equality guard is Object.is.
function makePref<T>(key: string, parse: (raw: string | null) => T, serialize: (v: T) => string): Pref<T> {
  const listeners = new Set<() => void>()

  let value: T = (() => {
    try { return parse(localStorage.getItem(key)) } catch { return parse(null) }
  })()

  const get = () => value

  const set = (v: T) => {
    if (Object.is(v, value)) return
    value = v
    try { localStorage.setItem(key, serialize(v)) } catch { /* ignore */ }
    listeners.forEach(fn => fn())
  }

  const subscribe = (fn: () => void) => {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }

  return { get, set, use: () => useSyncExternalStore(subscribe, get, get) }
}

// ─── showReasoning ────────────────────────────────────────────────────────
// Default-true, and only the literal 'off' turns it off — an absent or garbled
// value keeps the reasoning block visible rather than silently hiding it.

const showReasoningPref = makePref<boolean>(
  'benchy-show-reasoning',
  raw => raw !== 'off',
  v => v ? 'on' : 'off',
)
export const getShowReasoning = showReasoningPref.get
export const setShowReasoning = showReasoningPref.set
export const useShowReasoning = showReasoningPref.use

// ─── monoAnswers ──────────────────────────────────────────────────────────
// Whether model answers render in the monospace face. Off by default: prose is
// the common case and reads better in sans. Code blocks stay mono regardless.

const monoAnswersPref = makePref<boolean>(
  'benchy-mono-answers',
  raw => raw === 'on',
  v => v ? 'on' : 'off',
)
export const getMonoAnswers = monoAnswersPref.get
export const setMonoAnswers = monoAnswersPref.set
export const useMonoAnswers = monoAnswersPref.use

// ─── startView ────────────────────────────────────────────────────────────
// Which page "/" lands on. Read back through the whitelist, not trusted raw:
// Dashboard and Models are disabled nav items with no route, so a stale or
// hand-edited value would drop the user on a blank page with no way back.

export const START_VIEWS = ['/run', '/results', '/history', '/datasets', '/library', '/providers'] as const
export type StartView = typeof START_VIEWS[number]

function isStartView(raw: string | null): raw is StartView {
  return START_VIEWS.includes(raw as StartView)
}

const startViewPref = makePref<StartView>(
  'benchy-start-view',
  raw => isStartView(raw) ? raw : '/run',
  v => v,
)
export const getStartView = startViewPref.get
export const setStartView = startViewPref.set
export const useStartView = startViewPref.use

// ─── defaultMode ──────────────────────────────────────────────────────────
// Which test mode the header selector opens on. 0: one prompt → all models ·
// 1: prompt per model · 2: many prompts → all models.

export type PromptMode = 0 | 1 | 2

const defaultModePref = makePref<PromptMode>(
  'benchy-default-mode',
  raw => raw === '1' ? 1 : raw === '2' ? 2 : 0,
  v => String(v),
)
export const getDefaultMode = defaultModePref.get
export const setDefaultMode = defaultModePref.set
export const useDefaultMode = defaultModePref.use
