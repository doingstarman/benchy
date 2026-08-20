import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MetricsRegistry } from './MetricsRegistry'
import { metricsApi } from '../api'
import type { MetricDef } from '../../../src/types'

const b = (key: string, name: string, over: Partial<MetricDef> = {}): MetricDef => ({
  key, name, kind: 'builtin', expression: null, unit: 'ms', format: 'ms', direction: 'lower', scope: 'answer', aggregate: null, nullable: true, enabled: true, ...over,
})
const REGISTRY: MetricDef[] = [
  b('ttfs', 'Time to first token'),
  b('reasoning_ms', 'Reasoning time', { enabled: false }),
  b('cost', 'Cost', { unit: 'USD', direction: 'lower' }),
  { key: 'tokens_per_sec', name: 'Tokens / second', kind: 'custom', expression: 'output_tokens / total_time * 1000', unit: 'tok/s', format: 'raw', direction: 'higher', scope: 'answer', aggregate: null, nullable: true, enabled: true },
]

vi.mock('../api', () => ({
  metricsApi: {
    list: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    preview: vi.fn().mockResolvedValue({ ok: true, rows: [], coverage: { have: 0, total: 0 } }),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(metricsApi.list).mockResolvedValue(REGISTRY)
})

describe('MetricsRegistry', () => {
  it('lists built-ins and customs grouped by source', async () => {
    render(<MetricsRegistry />)
    expect(await screen.findByText('Time to first token')).toBeInTheDocument()
    expect(screen.getByText('Tokens / second')).toBeInTheDocument()
    expect(screen.getByText('Built-in')).toBeInTheDocument()
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('toggles a built-in via the enabled switch', async () => {
    render(<MetricsRegistry />)
    await screen.findByText('Time to first token')
    fireEvent.click(screen.getAllByTitle('Enabled')[0]) // ttfs, currently enabled
    await waitFor(() => expect(metricsApi.update).toHaveBeenCalledWith('ttfs', { enabled: false }))
  })

  it('filters by search', async () => {
    render(<MetricsRegistry />)
    await screen.findByText('Time to first token')
    fireEvent.change(screen.getByPlaceholderText(/Search name/i), { target: { value: 'tokens_per_sec' } })
    expect(screen.getByText('Tokens / second')).toBeInTheDocument()
    expect(screen.queryByText('Time to first token')).not.toBeInTheDocument()
  })

  it('opens the editor on New metric', async () => {
    render(<MetricsRegistry />)
    await screen.findByText('Time to first token')
    fireEvent.click(screen.getByRole('button', { name: /New metric/i }))
    expect(await screen.findByText('New custom metric')).toBeInTheDocument()
  })
})
