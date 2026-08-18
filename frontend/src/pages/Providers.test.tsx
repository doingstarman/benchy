import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Providers } from './Providers'

// One connected provider (OpenAI, has a key + models → "ready"); every preset
// that isn't in this list renders as an unconnected stub → "needs setup".
vi.mock('../api', () => ({
  providersApi: {
    list: vi.fn().mockResolvedValue([
      { id: 'p-openai', name: 'OpenAI', type: 'openai', apiKeyMask: 'sk-…7t2q', models: ['gpt-4o', 'gpt-4o-mini'], enabled: true },
    ]),
    upsert: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    test: vi.fn().mockResolvedValue({ ok: true, ttfs: 284 }),
    fetchModels: vi.fn().mockResolvedValue(['claude-opus-4-5']),
  },
}))

const view = () => render(<MemoryRouter><Providers /></MemoryRouter>)

describe('Providers — status board (providers 2.0)', () => {
  it('renders the rail, the connect button, and rows for connected + preset providers', async () => {
    view()
    expect(await screen.findByText('OpenAI')).toBeTruthy()        // connected
    expect(screen.getByText('Anthropic')).toBeTruthy()            // unconnected preset stub
    expect(screen.getByText('All')).toBeTruthy()                  // rail category
    expect(screen.getByRole('button', { name: /Connect/ })).toBeTruthy()
  })

  it('filters rows by the search box, and shows an empty state when nothing matches', async () => {
    view()
    await screen.findByText('OpenAI')
    const search = screen.getByPlaceholderText(/Search a provider/)
    fireEvent.change(search, { target: { value: 'anthr' } })
    expect(screen.getByText('Anthropic')).toBeTruthy()
    expect(screen.queryByText('OpenAI')).toBeNull()
    fireEvent.change(search, { target: { value: 'zzz-nope' } })
    expect(screen.getByText(/No providers match/)).toBeTruthy()
  })

  it('opens the connection wizard for an unconnected provider and advances the steps', async () => {
    view()
    fireEvent.click(await screen.findByText('Anthropic'))
    const next1 = screen.getByText(/Next.*models/)               // step 1 → 2
    fireEvent.click(next1)
    const next2 = screen.getByText(/Next.*test/)                 // step 2 → 3
    fireEvent.click(next2)
    expect(screen.getByText('Connect provider')).toBeTruthy()    // step 3 CTA
  })

  it('gives a new custom endpoint (+ Connect) a base-URL field in the wizard', async () => {
    view()
    await screen.findByText('OpenAI')                            // page loaded
    fireEvent.click(screen.getByRole('button', { name: /Connect/ })) // + Connect → custom wizard
    expect(screen.getByText('BASE URL')).toBeTruthy()            // must be able to set the endpoint URL
  })

  it('opens tabbed settings for a connected provider and switches Main → Advanced', async () => {
    view()
    // Wait for the list to resolve — OpenAI is a preset, so it renders as a stub
    // first; only once connected (models present) does clicking it open settings.
    await screen.findByText('2 models')
    fireEvent.click(screen.getByText('OpenAI'))
    // The tabbed modal opened (Main tab active) — its key section offers "Replace key".
    expect(await screen.findByText('Main')).toBeTruthy()
    expect(screen.getByText('Replace key')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Advanced')[0])          // the tab
    // Advanced tab drops the key/models sections.
    expect(screen.queryByText('Replace key')).toBeNull()
    // …and offers a per-model price override.
    expect(screen.getByText('Pricing')).toBeTruthy()
  })

  it('exposes a per-model price input in the Advanced tab', async () => {
    view()
    await screen.findByText('2 models')
    fireEvent.click(screen.getByText('OpenAI'))
    await screen.findByText('Main')
    fireEvent.click(screen.getAllByText('Advanced')[0])
    fireEvent.click(screen.getByText('Pricing'))                 // expand the section
    // One row per connected model, each addressable for a price.
    expect(screen.getByTitle('gpt-4o')).toBeTruthy()
    expect(screen.getByTitle('gpt-4o-mini')).toBeTruthy()
  })
})
