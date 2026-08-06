import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Each case needs a pristine module: the prefs read localStorage once, at module
// evaluation. resetModules + a dynamic import is the only way to exercise the
// "what does an empty/garbled localStorage give you" branch more than once.
async function freshPrefs(seed: Record<string, string> = {}) {
  localStorage.clear()
  for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v)
  vi.resetModules()
  return import('./prefs')
}

describe('prefs — showReasoning storage contract', () => {
  beforeEach(() => localStorage.clear())

  // These three cases are the whole reason the pref survived being moved onto a
  // factory: the key and the default-true semantics are what an existing
  // install already has on disk, and a migration that changed either would
  // silently flip the reasoning block for everyone who had set it.
  it('defaults to on when nothing is stored', async () => {
    const { getShowReasoning } = await freshPrefs()
    expect(getShowReasoning()).toBe(true)
  })

  it('is off only for the literal "off"', async () => {
    expect((await freshPrefs({ 'benchy-show-reasoning': 'off' })).getShowReasoning()).toBe(false)
    expect((await freshPrefs({ 'benchy-show-reasoning': 'nonsense' })).getShowReasoning()).toBe(true)
  })

  it('writes back under the same key', async () => {
    const { setShowReasoning } = await freshPrefs()
    setShowReasoning(false)
    expect(localStorage.getItem('benchy-show-reasoning')).toBe('off')
  })
})

describe('prefs — validated values', () => {
  beforeEach(() => localStorage.clear())

  // Dashboard and Models are disabled nav items with no route. A stored value
  // pointing at one would land the user on a blank page with no way back, so
  // the whitelist has to be applied on READ, not just when writing.
  it('falls back to /run for a start view that is not a real route', async () => {
    expect((await freshPrefs({ 'benchy-start-view': '/dashboard' })).getStartView()).toBe('/run')
    expect((await freshPrefs({ 'benchy-start-view': '/datasets' })).getStartView()).toBe('/datasets')
  })

  it('falls back to mode 0 for an unparseable default mode', async () => {
    expect((await freshPrefs({ 'benchy-default-mode': '2' })).getDefaultMode()).toBe(2)
    expect((await freshPrefs({ 'benchy-default-mode': '9' })).getDefaultMode()).toBe(0)
  })
})

describe('prefs — independence', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  // Four prefs now share one factory. What must hold is that they stay four
  // separate values under four separate keys — a factory that leaked state
  // between instances would show up here first.
  // (The per-pref listener Set is deliberately NOT asserted: useSyncExternalStore
  // bails out when the snapshot is unchanged, so a shared Set is invisible from
  // the outside. It stays a cost property, not a behavioural one.)
  it('setting one pref leaves the others and their keys alone', async () => {
    const { setMonoAnswers, getShowReasoning, getStartView, getDefaultMode } = await freshPrefs()

    setMonoAnswers(true)

    expect(getShowReasoning()).toBe(true)
    expect(getStartView()).toBe('/run')
    expect(getDefaultMode()).toBe(0)
    expect(localStorage.getItem('benchy-mono-answers')).toBe('on')
    expect(localStorage.getItem('benchy-show-reasoning')).toBeNull()
    expect(localStorage.getItem('benchy-start-view')).toBeNull()
  })

  it('each hook tracks its own pref', async () => {
    const { useShowReasoning, useMonoAnswers, setMonoAnswers } = await freshPrefs()
    function Both() {
      return (
        <>
          <span data-testid="reasoning">{String(useShowReasoning())}</span>
          <span data-testid="mono">{String(useMonoAnswers())}</span>
        </>
      )
    }
    render(<Both />)
    expect(screen.getByTestId('mono')).toHaveTextContent('false')

    act(() => setMonoAnswers(true))

    expect(screen.getByTestId('mono')).toHaveTextContent('true')
    expect(screen.getByTestId('reasoning')).toHaveTextContent('true')
  })
})
