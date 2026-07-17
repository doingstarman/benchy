import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { NewRun, __resetNewRunSessionForTests } from './NewRun'

// NewRun persists its session in a module-level variable so it survives
// React Router navigation (only resets on an actual page reload) — tests
// import the module once, so each case must reset it manually.
beforeEach(() => __resetNewRunSessionForTests())

// Mock the API layer — tests don't need real HTTP
vi.mock('../api', () => ({
  providersApi: {
    list: vi.fn().mockResolvedValue([
      {
        id: 'mock-p1',
        name: 'Test Provider',
        type: 'openai',
        baseUrl: 'http://localhost/mock',
        apiKey: 'test-key',
        models: ['gpt-4o', 'gpt-4o-mini'],
        enabled: true,
      },
    ]),
  },
  benchmarkApi: {
    start: vi.fn().mockResolvedValue({ runId: 'run-test-1' }),
  },
  runsApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: 'x', prompts: [], models: [], results: [] }),
  },
}))

// EventSource is not available in jsdom — stub it so run flow doesn't throw
const mockEs = {
  addEventListener: vi.fn(),
  close: vi.fn(),
  onerror: null as ((e: Event) => void) | null,
}
vi.stubGlobal('EventSource', vi.fn(() => mockEs))

function renderNewRun() {
  return render(
    <MemoryRouter>
      <NewRun />
    </MemoryRouter>
  )
}

// History's fork navigates here with the run in router state. Nothing read that
// state, so the button silently did nothing (while leaving a 'pending' run
// behind on the server).
function renderForkedFrom(run: Record<string, unknown>) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/run', state: { forkFrom: run } }]}>
      <NewRun />
    </MemoryRouter>
  )
}

// Wait for async providers.list() to resolve and re-render
async function waitForProviders() {
  return screen.findByPlaceholderText('Ask anything…')
}

describe('Fork from history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEs.addEventListener.mockReset()
    mockEs.close.mockReset()
  })

  it('loads a chat run back into the composer, ready to re-run', async () => {
    renderForkedFrom({
      id: 'r1', kind: 'chat', prompts: ['explain quantum tunnelling'], models: ['mock-p1:gpt-4o'],
    })
    // The prompt is actually there — the button used to be inert.
    expect(await screen.findByDisplayValue('explain quantum tunnelling')).toBeInTheDocument()
    // …and it is a fresh, unstarted run: the composer, not a results view.
    expect(screen.getByRole('button', { name: /^run$/i })).toBeInTheDocument()
  })

  it('rebuilds a batch run as a prompt list, not a single box', async () => {
    renderForkedFrom({
      id: 'r2', kind: 'batch', prompts: ['first', 'second'], models: ['mock-p1:gpt-4o'],
    })
    expect(await screen.findByDisplayValue('first')).toBeInTheDocument()
    expect(screen.getByDisplayValue('second')).toBeInTheDocument()
  })

  it('rebuilds a pairs run with each prompt pinned back to its own model', async () => {
    renderForkedFrom({
      id: 'r3', kind: 'pairs',
      prompts: ['ask-4o', 'ask-mini'],
      models: ['mock-p1:gpt-4o', 'mock-p1:gpt-4o-mini'],
    })
    expect(await screen.findByDisplayValue('ask-4o')).toBeInTheDocument()
    expect(screen.getByDisplayValue('ask-mini')).toBeInTheDocument()
    // The pairing is what this mode IS — each prompt sits in its model's box.
    expect(screen.getByPlaceholderText(/Prompt for gpt-4o…/)).toHaveValue('ask-4o')
    expect(screen.getByPlaceholderText(/Prompt for gpt-4o-mini…/)).toHaveValue('ask-mini')
  })
})

describe('Promptbox — text input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEs.addEventListener.mockReset()
    mockEs.close.mockReset()
  })

  it('retains focus and accumulates text across keystrokes', async () => {
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()

    await user.click(textarea)
    await user.type(textarea, 'Hello world')

    // If Promptbox were defined inside NewRun, each keystroke would cause a
    // remount (new function reference = new component type for React), losing
    // focus after every character. With module-level definition this must hold.
    expect(textarea).toHaveFocus()
    expect(textarea).toHaveValue('Hello world')
  })

  it('updates value on each keystroke without losing intermediate chars', async () => {
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()

    await user.type(textarea, 'abc')
    expect(textarea).toHaveValue('abc')
  })

  it('clears value correctly after user deletes all text', async () => {
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()

    await user.type(textarea, 'hello')
    await user.clear(textarea)
    expect(textarea).toHaveValue('')
  })
})

describe('Promptbox — run button state', () => {
  beforeEach(() => vi.clearAllMocks())

  it('run button is disabled when prompt is empty', async () => {
    renderNewRun()
    await waitForProviders()
    const btn = screen.getByRole('button', { name: /^run$/i })
    expect(btn).toBeDisabled()
  })

  it('run button becomes enabled once prompt has text and a model is selected', async () => {
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()

    await user.type(textarea, 'test prompt')

    const btn = screen.getByRole('button', { name: /^run$/i })
    expect(btn).not.toBeDisabled()
  })

  it('run button stays disabled when only whitespace is entered', async () => {
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()

    await user.type(textarea, '   ')

    const btn = screen.getByRole('button', { name: /^run$/i })
    expect(btn).toBeDisabled()
  })
})

describe('Promptbox — run trigger', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clicking run button calls benchmarkApi.start with the prompt', async () => {
    const { benchmarkApi } = await import('../api')
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()

    await user.type(textarea, 'explain transformers')
    await user.click(screen.getByRole('button', { name: /^run$/i }))

    expect(benchmarkApi.start).toHaveBeenCalledOnce()
    expect(benchmarkApi.start).toHaveBeenCalledWith(
      expect.objectContaining({ prompts: ['explain transformers'] })
    )
  })

  it('Ctrl+Enter triggers run when prompt is non-empty', async () => {
    const { benchmarkApi } = await import('../api')
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()

    await user.click(textarea)
    await user.type(textarea, 'test query')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(benchmarkApi.start).toHaveBeenCalledOnce()
  })

  it('Ctrl+Enter does nothing when prompt is empty', async () => {
    const { benchmarkApi } = await import('../api')
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()

    await user.click(textarea)
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(benchmarkApi.start).not.toHaveBeenCalled()
  })
})

describe('Promptbox — mode switching', () => {
  beforeEach(() => vi.clearAllMocks())

  it('switches to "prompt per model" mode when that tab is clicked', async () => {
    const user = userEvent.setup()
    renderNewRun()
    await waitForProviders()

    await user.click(screen.getByText('prompt per model'))

    // In per-model mode, there's no single "Ask anything…" textarea
    expect(screen.queryByPlaceholderText('Ask anything…')).not.toBeInTheDocument()
    // Instead there's a per-model textarea for the selected model
    expect(screen.getByPlaceholderText(/Prompt for gpt-4o/)).toBeInTheDocument()
  })

  it('switching back to "one prompt" mode restores the single textarea', async () => {
    const user = userEvent.setup()
    renderNewRun()
    await waitForProviders()

    await user.click(screen.getByText('prompt per model'))
    await user.click(screen.getByText('one prompt → all models'))

    expect(screen.getByPlaceholderText('Ask anything…')).toBeInTheDocument()
  })

  it('"many prompts" mode shows a prompt list and runs all filled prompts', async () => {
    const { benchmarkApi } = await import('../api')
    const user = userEvent.setup()
    renderNewRun()
    await waitForProviders()

    await user.click(screen.getByText('many prompts → all models'))
    expect(screen.getByPlaceholderText('Prompt 1…')).toBeInTheDocument()

    await user.click(screen.getByText('+ add prompt'))
    await user.type(screen.getByPlaceholderText('Prompt 1…'), 'first')
    await user.type(screen.getByPlaceholderText('Prompt 2…'), 'second')
    await user.click(screen.getByRole('button', { name: /^run$/i }))

    expect(benchmarkApi.start).toHaveBeenCalledWith(
      expect.objectContaining({ prompts: ['first', 'second'] })
    )
  })
})

describe('ChipsRow — model selection', () => {
  beforeEach(() => vi.clearAllMocks())

  // One chip per provider, not per model: nineteen models across three providers
  // used to mean nineteen chips over six rows on the start screen.
  it('renders one chip per provider with a selected/total count, and no model chips', async () => {
    renderNewRun()
    await waitForProviders()

    // The idle screen and the promptbox each render a row, hence getAllByText.
    expect(screen.getAllByText('Test Provider').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1/2').length).toBeGreaterThan(0)
    expect(screen.queryByText('gpt-4o-mini')).not.toBeInTheDocument()
  })

  it('opens the provider popover on click and lists its models', async () => {
    const user = userEvent.setup()
    renderNewRun()
    await waitForProviders()

    await user.click(screen.getAllByText('Test Provider')[0])

    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument()
  })

  it('ticking a model in the popover adds it to the selection', async () => {
    const user = userEvent.setup()
    renderNewRun()
    await waitForProviders()

    // Type something so callCount can reflect selection changes
    const textarea = screen.getByPlaceholderText('Ask anything…')
    await user.type(textarea, 'q')

    // gpt-4o is selected by default — add gpt-4o-mini from the popover
    await user.click(screen.getAllByText('Test Provider')[0])
    await user.click(screen.getByText('gpt-4o-mini'))

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText('2/2').length).toBeGreaterThan(0)
  })

  it('cannot deselect the last remaining model', async () => {
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()
    await user.type(textarea, 'q')

    await user.click(screen.getAllByText('Test Provider')[0])
    await user.click(screen.getByText('gpt-4o'))

    // callCount stays 1 (still one model selected)
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('clearing a provider that holds the whole selection keeps one model', async () => {
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()
    await user.type(textarea, 'q')

    await user.click(screen.getAllByText('Test Provider')[0])
    await user.click(screen.getByText('select all'))
    expect(screen.getByText('2')).toBeInTheDocument()

    // "clear" would empty the picker and leave Run permanently dead.
    await user.click(screen.getByText('clear'))
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})

describe('Session persistence across navigation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('survives unmount/remount (simulating navigating away and back)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderNewRun()
    const textarea = await waitForProviders()

    await user.type(textarea, 'explain transformers')
    await user.click(screen.getByRole('button', { name: /^run$/i }))

    // Run started — screen should have left the idle "Ask anything…" view
    expect(screen.queryByPlaceholderText('Ask anything…')).not.toBeInTheDocument()

    unmount()
    renderNewRun()

    // Re-rendered "in place" (as if navigating back to /run) — still shows
    // the active session, not a fresh idle screen.
    expect(screen.queryByPlaceholderText('Ask anything…')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Follow-up or new prompt…')).toBeInTheDocument()
  })
})

describe('Promptbox — textarea resize behaviour', () => {
  beforeEach(() => vi.clearAllMocks())

  it('textarea value persists across multiple re-renders triggered by other state changes', async () => {
    const user = userEvent.setup()
    renderNewRun()
    const textarea = await waitForProviders()

    await user.type(textarea, 'first part')

    // Trigger a re-render by toggling a model (changes selectedModels state)
    fireEvent.click(screen.getAllByText('Test Provider')[0])
    fireEvent.click(screen.getByText('gpt-4o-mini'))

    // Value must survive the re-render — would fail if Promptbox remounts
    expect(textarea).toHaveValue('first part')
    expect(textarea).toHaveFocus()
  })
})
