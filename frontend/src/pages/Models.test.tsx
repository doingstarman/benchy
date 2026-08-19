import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Models } from './Models'
import { targetsApi, providersApi } from '../api'
import type { Target } from '../../../src/types'

vi.mock('../api', () => ({
  targetsApi: {
    list: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    duplicate: vi.fn(),
    remove: vi.fn(),
    create: vi.fn(),
  },
  providersApi: { list: vi.fn() },
}))

const target: Target = {
  id: 'openai:gpt-4o', kind: 'model', name: 'gpt-4o strict',
  config: { providerId: 'openai', model: 'gpt-4o', defaults: { temperature: 0.2 } },
  tags: ['json'], enabled: true, createdAt: 1, updatedAt: 1,
}
const provider = {
  id: 'openai', name: 'OpenAI', type: 'openai' as const, models: ['gpt-4o', 'gpt-4o-mini'],
  enabled: true, apiKeyMask: '…4f2a', defaults: { temperature: 0.7 },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(targetsApi.list).mockResolvedValue([target])
  vi.mocked(providersApi.list).mockResolvedValue([provider as never])
})

const renderPage = () => render(<MemoryRouter><Models /></MemoryRouter>)

describe('Models page', () => {
  it('lists participants grouped by their connection', async () => {
    renderPage()
    expect(await screen.findByText('gpt-4o strict')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    // group subtitle only appears in grouped mode
    expect(screen.getByText(/from 1 base models/)).toBeInTheDocument()
  })

  it('flat toggle drops the connection grouping', async () => {
    renderPage()
    await screen.findByText('gpt-4o strict')
    fireEvent.click(screen.getByRole('button', { name: 'Flat' }))
    expect(screen.queryByText(/from 1 base models/)).not.toBeInTheDocument()
    expect(screen.getByText('gpt-4o strict')).toBeInTheDocument()
  })

  it('shows override state in the editor and reverts a field to inherited', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'gpt-4o strict' }))

    // temperature overridden (1 of 4), the other three inherited
    expect(await screen.findByText(/1 of 4 differ/)).toBeInTheDocument()
    expect(screen.getAllByText('overridden')).toHaveLength(1)
    expect(screen.getAllByText('inherited')).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Revert to inherited' }))

    await waitFor(() => expect(screen.getByText(/0 of 4 differ/)).toBeInTheDocument())
    expect(screen.queryByText('overridden')).not.toBeInTheDocument()
  })

  it('deletes via an in-app confirm dialog, not window.confirm', async () => {
    renderPage()
    await screen.findByText('gpt-4o strict')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/History keeps its results/)).toBeInTheDocument()
    expect(targetsApi.remove).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(targetsApi.remove).toHaveBeenCalledWith('openai:gpt-4o'))
  })
})
