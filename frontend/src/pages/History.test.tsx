import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { History } from './History'

// A run is a dialog wherever you open it from. Clicking one in History used to
// land on the read-only results view — a dead end with no way to continue,
// while the very same dialog in the sidebar reopened as a conversation.

// Built inside the factory: vi.mock is hoisted above any const here.
vi.mock('../api', () => ({
  runsApi: {
    list: vi.fn().mockResolvedValue([{
      id: 'run-abc12345',
      prompts: ['explain quantum tunnelling'],
      models: ['p1:gpt-4o'],
      status: 'done',
      saved: false,
      totalCalls: 1,
      completedCalls: 1,
      createdAt: 1700000000000,
      kind: 'chat',
    }]),
    remove: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn(),
    fork: vi.fn(),
  },
}))

// Stand-ins so we can assert where a click actually lands.
function renderHistory() {
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <Routes>
        <Route path="/history" element={<History />} />
        <Route path="/run" element={<div>DIALOG — you can continue here</div>} />
        <Route path="/results/:runId" element={<div>SCORES — read only</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('opening a run from History', () => {
  it('opens the dialog, not the read-only dead end', async () => {
    const user = userEvent.setup()
    renderHistory()

    await user.click(await screen.findByText('explain quantum tunnelling'))

    expect(await screen.findByText(/DIALOG/)).toBeInTheDocument()
    expect(screen.queryByText(/SCORES/)).not.toBeInTheDocument()
  })

  it('still reaches the scoring view — the only place per-answer feedback lives', async () => {
    const user = userEvent.setup()
    renderHistory()

    await screen.findByText('explain quantum tunnelling')
    await user.click(screen.getByRole('button', { name: /scores/i }))

    expect(await screen.findByText(/SCORES/)).toBeInTheDocument()
  })

  it('the scores button does not also trigger the row underneath it', async () => {
    const user = userEvent.setup()
    renderHistory()

    await screen.findByText('explain quantum tunnelling')
    await user.click(screen.getByRole('button', { name: /scores/i }))

    // Row click and button click both navigate; without stopPropagation the row
    // would win and swallow the button entirely.
    await waitFor(() => expect(screen.queryByText(/DIALOG/)).not.toBeInTheDocument())
  })
})
