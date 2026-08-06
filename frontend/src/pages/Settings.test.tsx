import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Settings } from './Settings'
import { settingsApi, runsApi, versionApi } from '../api'

// Half the rows here are localStorage and cannot fail; the other half are a
// server round-trip that can. These cases are about that seam — the page must
// not claim a value is stored when the write was refused, and must not queue a
// config write per slider tick.

vi.mock('../api', () => ({
  settingsApi: { get: vi.fn(), update: vi.fn() },
  runsApi: { clearAll: vi.fn() },
  versionApi: { get: vi.fn() },
}))

const SAVE_DEBOUNCE_MS = 250

const SERVER_DEFAULTS = { codeExecution: false, codeExecTimeoutMs: 10_000, runDefaults: {} }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // jsdom implements neither of these, and both are reached by ordinary clicks.
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(settingsApi.get).mockResolvedValue({ ...SERVER_DEFAULTS })
  vi.mocked(settingsApi.update).mockResolvedValue({ ...SERVER_DEFAULTS })
  vi.mocked(versionApi.get).mockResolvedValue({
    current: { sha: 'dev', commitDate: null, builtAt: null },
    latest: null, hasUpdate: false, changes: [], checkError: null, checkedAt: 0,
    repoUrl: 'https://github.com/x/y',
    runtime: { port: 4243, configPath: 'C:\\cfg.json', dbPath: 'C:\\benchy.db' },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderSettings() {
  return render(<MemoryRouter initialEntries={['/settings']}><Settings /></MemoryRouter>)
}

// Waits for the two boot fetches so assertions don't race the loading state.
async function ready() {
  await screen.findByText('4243')
}

// Several rows share the labels On/Off, so queries have to be scoped to the
// card under test rather than matching the first one on the page.
function rowFor(label: string): HTMLElement {
  return screen.getByText(label).closest('div')!.parentElement!
}

describe('Settings — sections', () => {
  it('renders every section on one scrolling page', async () => {
    renderSettings()
    await ready()

    // The design puts all six under one nav, so a nav anchor only means
    // something if its section is on the page to be scrolled to.
    for (const heading of ['General', 'Appearance', 'Models', 'Code execution', 'Server', 'About benchy']) {
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('Start view')).toBeInTheDocument()
    expect(screen.getByText('Clear run history')).toBeInTheDocument()
  })

  it('scrolls to a section when its nav item is clicked', async () => {
    const user = userEvent.setup()
    renderSettings()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Models' }))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })
})

describe('Settings — preferences', () => {
  it('persists a preference under its own key, without touching the server', async () => {
    const user = userEvent.setup()
    renderSettings()
    await ready()

    await user.click(within(rowFor('Monospace answers')).getByRole('button', { name: 'On' }))

    expect(localStorage.getItem('benchy-mono-answers')).toBe('on')
    expect(settingsApi.update).not.toHaveBeenCalled()
  })

  it('writes show-reasoning back to the key it has always used', async () => {
    // The key predates the pref factory and is already on disk for every user;
    // renaming it in the refactor would have silently reset everyone's choice.
    // (Reading it back is pinned in prefs.test.tsx, which can reset the module —
    // a pref is read from localStorage once, at module evaluation, so seeding it
    // after the import here would change nothing.)
    const user = userEvent.setup()
    renderSettings()
    await ready()

    await user.click(within(rowFor('Show reasoning')).getByRole('button', { name: 'Off' }))
    expect(localStorage.getItem('benchy-show-reasoning')).toBe('off')
  })
})

describe('Settings — server-backed rows', () => {
  it('debounces a dragged slider into a single write', async () => {
    vi.useFakeTimers()
    renderSettings()

    // The execution-timeout slider, not temperature: temperature is allowAuto
    // and unset by default, and SliderField disables itself while a value is
    // Auto — so the enabled one is the only one a drag can reach.
    const slider = await vi.waitFor(() => {
      const found = [...document.querySelectorAll('input[type="range"]')]
        .find((el): el is HTMLInputElement => !(el as HTMLInputElement).disabled)
      if (!found) throw new Error('no enabled slider yet')
      return found
    })

    // Every setter is serialized behind an atomic config write with a sleeping
    // Windows retry loop, so one write per tick backs the queue up for seconds.
    for (const v of ['20', '30', '40', '50', '60']) {
      fireEvent.change(slider, { target: { value: v } })
    }
    expect(settingsApi.update).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50) })

    expect(settingsApi.update).toHaveBeenCalledTimes(1)
    // …and it carries the value the drag ended on, not the one it started from.
    expect(settingsApi.update).toHaveBeenCalledWith({ codeExecTimeoutMs: 60_000 })
  })

  it('snaps back to the server value when a write is refused', async () => {
    vi.mocked(settingsApi.update).mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    renderSettings()
    await ready()

    const row = rowFor('Run code datasets')
    await user.click(within(row).getByRole('button', { name: 'On' }))

    await waitFor(() => expect(settingsApi.update).toHaveBeenCalled())
    // The server kept it off; the optimistic On must not survive the refusal.
    await waitFor(() => {
      expect(within(row).getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true')
    })
    // And the page says so, instead of leaving "saved automatically" standing.
    expect(screen.getByText(/Could not save/)).toBeInTheDocument()
  })
})

describe('Settings — clear run history', () => {
  it('takes two clicks, and the first one calls nothing', async () => {
    vi.mocked(runsApi.clearAll).mockResolvedValue({ deleted: 12, skipped: 0 })
    const user = userEvent.setup()
    renderSettings()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Clear…' }))
    expect(runsApi.clearAll).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete everything' }))
    await waitFor(() => expect(runsApi.clearAll).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Cleared 12 runs/)).toBeInTheDocument()
  })

  it('cancelling arms nothing', async () => {
    const user = userEvent.setup()
    renderSettings()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Clear…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Clear…' })).toBeInTheDocument()
    expect(runsApi.clearAll).not.toHaveBeenCalled()
  })

  it('reports a run it could not delete rather than claiming a clean sweep', async () => {
    vi.mocked(runsApi.clearAll).mockResolvedValue({ deleted: 3, skipped: 1 })
    const user = userEvent.setup()
    renderSettings()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Clear…' }))
    await user.click(screen.getByRole('button', { name: 'Delete everything' }))

    expect(await screen.findByText(/still running was kept/)).toBeInTheDocument()
  })
})
