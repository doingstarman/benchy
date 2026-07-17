import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Providers } from './Providers'

// OpenRouter ships 344 models across 56 vendors. A flat list of 344 checkboxes
// is not a chooser: what you picked scrolls away and every id looks alike.
const CATALOGUE = [
  ...Array.from({ length: 40 }, (_, i) => `openai/gpt-model-${i}`),
  ...Array.from({ length: 30 }, (_, i) => `qwen/qwen-${i}`),
  'anthropic/claude-sonnet-4-5',
  'moonshotai/kimi-k3',
]

vi.mock('../api', () => ({
  providersApi: {
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(async (p: Record<string, unknown>) => ({ ...p, id: 'p1' })),
    remove: vi.fn(),
    test: vi.fn().mockResolvedValue({ ok: true, ttfs: 12 }),
    fetchModels: vi.fn().mockResolvedValue([
      ...Array.from({ length: 40 }, (_, i) => `openai/gpt-model-${i}`),
      ...Array.from({ length: 30 }, (_, i) => `qwen/qwen-${i}`),
      'anthropic/claude-sonnet-4-5',
      'moonshotai/kimi-k3',
    ]),
  },
}))

function openCustomProvider() {
  render(
    <MemoryRouter>
      <Providers />
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())

async function loadCatalogue(user: ReturnType<typeof userEvent.setup>) {
  openCustomProvider()
  await user.click(await screen.findByText('+ custom endpoint'))
  await user.click(screen.getByRole('button', { name: /Fetch models/i }))
  await screen.findByRole('button', { name: /^openai/ })
}

describe('choosing among hundreds of models', () => {
  it('collapses into vendor groups instead of listing every id', async () => {
    const user = userEvent.setup()
    await loadCatalogue(user)

    // Vendors are visible; their contents are not, until asked for.
    expect(screen.getByRole('button', { name: /^openai/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^qwen/ })).toBeInTheDocument()
    expect(screen.queryByText('openai/gpt-model-0')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^openai/ }))
    expect(screen.getByText('openai/gpt-model-0')).toBeInTheDocument()
    // Opening one vendor doesn't dump the others.
    expect(screen.queryByText('qwen/qwen-0')).not.toBeInTheDocument()
  })

  it('shows how much of the catalogue you are looking at', async () => {
    const user = userEvent.setup()
    await loadCatalogue(user)
    expect(screen.getByText(`${CATALOGUE.length} of ${CATALOGUE.length}`)).toBeInTheDocument()
  })

  it('searching reveals matches without making you open folders', async () => {
    const user = userEvent.setup()
    await loadCatalogue(user)

    await user.type(screen.getByPlaceholderText(/Search models/i), 'kimi')
    expect(await screen.findByText('moonshotai/kimi-k3')).toBeInTheDocument()
    expect(screen.getByText(`1 of ${CATALOGUE.length}`)).toBeInTheDocument()
    // Non-matching vendors are gone entirely, not merely collapsed.
    expect(screen.queryByRole('button', { name: /^qwen/ })).not.toBeInTheDocument()
  })

  it('keeps what you picked in sight instead of losing it in the list', async () => {
    const user = userEvent.setup()
    await loadCatalogue(user)

    await user.type(screen.getByPlaceholderText(/Search models/i), 'kimi')
    await user.click(await screen.findByLabelText('moonshotai/kimi-k3'))
    await user.clear(screen.getByPlaceholderText(/Search models/i))

    // Pinned at the top under its own heading, even though its vendor group is
    // collapsed and 70 other models sit below.
    expect(await screen.findByText(/Selected · 1/)).toBeInTheDocument()
    expect(screen.getByLabelText('moonshotai/kimi-k3')).toBeChecked()
  })
})
