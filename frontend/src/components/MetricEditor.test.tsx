import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MetricEditor } from './MetricEditor'
import { metricsApi } from '../api'

vi.mock('../api', () => ({
  metricsApi: {
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    preview: vi.fn().mockResolvedValue({
      ok: true,
      coverage: { have: 1, total: 2 },
      rows: [
        { item: 'gpt-4o · answer one', inputs: 'output_tokens=800 total_time=2000', value: 400, note: 'ok' },
        { item: 'gpt-4o · answer two', inputs: 'output_tokens=— total_time=3000', value: null, note: 'no output_tokens' },
      ],
    }),
  },
}))

beforeEach(() => vi.clearAllMocks())

const render_ = () => render(<MetricEditor metric={null} registry={[]} onClose={vi.fn()} onSaved={vi.fn()} />)

describe('MetricEditor', () => {
  it('auto-slugs the key and validates a good expression', () => {
    render_()
    fireEvent.change(screen.getByPlaceholderText('Tokens per second'), { target: { value: 'Tokens per sec' } })
    expect(screen.getByPlaceholderText('tokens_per_sec')).toHaveValue('tokens_per_sec')

    fireEvent.change(screen.getByPlaceholderText('output_tokens / total_time * 1000'), { target: { value: 'output_tokens / total_time * 1000' } })
    expect(screen.getByText('Valid — ready to save')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save metric/i })).not.toBeDisabled()
  })

  it('reports an unknown key and blocks save', () => {
    render_()
    fireEvent.change(screen.getByPlaceholderText('Tokens per second'), { target: { value: 'Bad' } })
    fireEvent.change(screen.getByPlaceholderText('output_tokens / total_time * 1000'), { target: { value: 'output_tokens / nope' } })
    expect(screen.getByText(/No metric named nope/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save metric/i })).toBeDisabled()
  })

  it('the fix chip replaces the flagged identifier, not the last one', () => {
    render_()
    fireEvent.change(screen.getByPlaceholderText('Tokens per second'), { target: { value: 'X' } })
    const expr = screen.getByPlaceholderText('output_tokens / total_time * 1000')
    fireEvent.change(expr, { target: { value: 'outpt_tokens / total_time' } }) // typo is NOT at the end
    fireEvent.click(screen.getByRole('button', { name: /Use output_tokens/i }))
    expect(expr).toHaveValue('output_tokens / total_time') // total_time preserved
  })

  it('previews recent results, rendering a null value as an em-dash (never 0)', async () => {
    render_()
    fireEvent.change(screen.getByPlaceholderText('Tokens per second'), { target: { value: 'TPS' } })
    fireEvent.change(screen.getByPlaceholderText('output_tokens / total_time * 1000'), { target: { value: 'output_tokens / total_time * 1000' } })
    await waitFor(() => expect(metricsApi.preview).toHaveBeenCalled())
    expect(await screen.findByText('—')).toBeInTheDocument()
    expect(screen.getByText(/value for 1 \/ 2/)).toBeInTheDocument()
  })

  it('saves via metricsApi.create', async () => {
    render_()
    fireEvent.change(screen.getByPlaceholderText('Tokens per second'), { target: { value: 'Tokens per sec' } })
    fireEvent.change(screen.getByPlaceholderText('output_tokens / total_time * 1000'), { target: { value: 'output_tokens / total_time * 1000' } })
    fireEvent.click(screen.getByRole('button', { name: /Save metric/i }))
    await waitFor(() => expect(metricsApi.create).toHaveBeenCalledWith(expect.objectContaining({
      key: 'tokens_per_sec', expression: 'output_tokens / total_time * 1000', scope: 'answer',
    })))
  })
})
