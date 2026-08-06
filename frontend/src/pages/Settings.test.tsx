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

function renderSettings(hash = '') {
  return render(<MemoryRouter initialEntries={[`/settings${hash}`]}><Settings /></MemoryRouter>)
}

// Both boot fetches resolved and flushed into state. Can't key off a rendered
// value: the panes are separate now, so nothing from /api/settings is on screen
// until the pane holding it is opened.
async function ready() {
  await screen.findByText('Start view')
  await waitFor(() => expect(settingsApi.get).toHaveBeenCalled())
  await act(async () => {})
}

async function openPane(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('tab', { name }))
}

// Several rows share the labels On/Off, so queries have to be scoped to the
// card under test rather than matching the first one in the pane.
function rowFor(label: string): HTMLElement {
  return screen.getByText(label).closest('div')!.parentElement!
}

describe('Settings — panes', () => {
  it('opens on General and shows only that pane', async () => {
    renderSettings()
    await ready()

    expect(screen.getByText('Start view')).toBeInTheDocument()
    // Rows from the other panes are not merely off-screen — they are not
    // mounted, so they stay out of the tab order and out of Ctrl-F.
    expect(screen.queryByText('Clear run history')).not.toBeInTheDocument()
    expect(screen.queryByText('Run code datasets')).not.toBeInTheDocument()
  })

  it('swaps panes when a nav item is picked', async () => {
    const user = userEvent.setup()
    renderSettings()
    await ready()

    await openPane(user, 'Code execution')

    expect(screen.getByText('Run code datasets')).toBeInTheDocument()
    expect(screen.queryByText('Start view')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Code execution' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'false')
  })

  it('reaches every pane, so no row is stranded', async () => {
    const user = userEvent.setup()
    renderSettings()
    await ready()

    const panes: [string, string][] = [
      ['General', 'Start view'],
      ['Appearance', 'Accent'],
      ['Models', 'Show reasoning'],
      ['Code execution', 'Run code datasets'],
      ['Server', 'Clear run history'],
      ['About benchy', 'Build'],
    ]
    for (const [tab, row] of panes) {
      await openPane(user, tab)
      expect(screen.getByText(row), `${tab} pane is missing "${row}"`).toBeInTheDocument()
    }
  })

  // The dataset-run error tells people to "enable it in Settings"; a link
  // carrying that hash has to land on the pane with the toggle, not on General.
  it('opens the pane named in the URL hash', async () => {
    renderSettings('#code')
    await screen.findByText('Run code datasets')
    expect(screen.queryByText('Start view')).not.toBeInTheDocument()
  })
})

describe('Settings — preferences', () => {
  it('persists a preference under its own key, without touching the server', async () => {
    const user = userEvent.setup()
    renderSettings()
    await ready()
    await openPane(user, 'Appearance')

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
    await openPane(user, 'Models')

    await user.click(within(rowFor('Show reasoning')).getByRole('button', { name: 'Off' }))
    expect(localStorage.getItem('benchy-show-reasoning')).toBe('off')
  })
})

describe('Settings — server-backed rows', () => {
  it('debounces a dragged slider into a single write', async () => {
    vi.useFakeTimers()
    // userEvent needs the real clock, so the pane is opened by hash instead.
    renderSettings('#code')

    // The execution-timeout slider: temperature is allowAuto and unset by
    // default, and SliderField disables itself while a value is Auto.
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
    await openPane(user, 'Code execution')

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

  it('keeps the failure notice visible across a pane switch', async () => {
    // The notice lives in the nav, not the pane, so it must not vanish the
    // moment you go looking at another section.
    vi.mocked(settingsApi.update).mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    renderSettings()
    await ready()
    await openPane(user, 'Code execution')

    await user.click(within(rowFor('Run code datasets')).getByRole('button', { name: 'On' }))
    await waitFor(() => expect(screen.getByText(/Could not save/)).toBeInTheDocument())

    await openPane(user, 'General')
    expect(screen.getByText(/Could not save/)).toBeInTheDocument()
  })
})

describe('Settings — clear run history', () => {
  async function openServer(user: ReturnType<typeof userEvent.setup>) {
    renderSettings()
    await ready()
    await openPane(user, 'Server')
  }

  it('takes two clicks, and the first one calls nothing', async () => {
    vi.mocked(runsApi.clearAll).mockResolvedValue({ deleted: 12, skipped: 0 })
    const user = userEvent.setup()
    await openServer(user)

    await user.click(screen.getByRole('button', { name: 'Clear…' }))
    expect(runsApi.clearAll).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete everything' }))
    await waitFor(() => expect(runsApi.clearAll).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Cleared 12 runs/)).toBeInTheDocument()
  })

  it('cancelling arms nothing', async () => {
    const user = userEvent.setup()
    await openServer(user)

    await user.click(screen.getByRole('button', { name: 'Clear…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Clear…' })).toBeInTheDocument()
    expect(runsApi.clearAll).not.toHaveBeenCalled()
  })

  // Leaving a half-armed button behind would mean one stray click on return
  // wipes the history, with the confirmation step already spent.
  it('disarms when the pane is left and re-entered', async () => {
    const user = userEvent.setup()
    await openServer(user)

    await user.click(screen.getByRole('button', { name: 'Clear…' }))
    expect(screen.getByRole('button', { name: 'Delete everything' })).toBeInTheDocument()

    await openPane(user, 'General')
    await openPane(user, 'Server')

    expect(screen.getByRole('button', { name: 'Clear…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete everything' })).not.toBeInTheDocument()
  })

  it('reports a run it could not delete rather than claiming a clean sweep', async () => {
    vi.mocked(runsApi.clearAll).mockResolvedValue({ deleted: 3, skipped: 1 })
    const user = userEvent.setup()
    await openServer(user)

    await user.click(screen.getByRole('button', { name: 'Clear…' }))
    await user.click(screen.getByRole('button', { name: 'Delete everything' }))

    expect(await screen.findByText(/still running was kept/)).toBeInTheDocument()
  })
})
