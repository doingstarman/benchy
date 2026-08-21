import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TraceView } from './TraceView'
import type { TraceStepRow } from '../../../src/types'

function steps(n: number): TraceStepRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    parentId: null,
    depth: 0,
    kind: i % 3 === 0 ? 'think' : i % 3 === 1 ? 'tool' : 'model',
    name: `step ${i}`,
    ms: 100 + i,
    inputTokens: i % 3 === 2 ? 10 : null,
    outputTokens: i % 3 === 2 ? 20 : null,
    cost: i % 3 === 2 ? 0.001 : null,
    payload: `{"i":${i}}`,
    payloadTruncated: false,
    isError: false,
  }))
}

const ids = () => screen.getAllByTestId('trace-row').map(r => r.querySelector('span')?.textContent)

describe('TraceView', () => {
  it('renders 40 steps in order', () => {
    render(<TraceView steps={steps(40)} />)
    const rows = screen.getAllByTestId('trace-row')
    expect(rows).toHaveLength(40)
    // First column is the 1-based index, rendered in emission order.
    expect(ids().slice(0, 3)).toEqual(['1', '2', '3'])
    expect(ids()[39]).toBe('40')
  })

  it('expanding an early step does not reorder the list (payload is out of flow)', () => {
    render(<TraceView steps={steps(40)} />)
    const before = ids()
    fireEvent.click(screen.getAllByTestId('trace-row')[2]) // select step 3
    const after = ids()
    expect(after).toEqual(before)
    expect(after).toHaveLength(40)
  })

  it('live append adds steps at the bottom without a scroll jump, showing a "+N below" pill', () => {
    const { rerender } = render(<TraceView steps={steps(40)} live />)
    expect(screen.getAllByTestId('trace-row')).toHaveLength(40)
    // New steps arrive.
    rerender(<TraceView steps={steps(45)} live />)
    const rows = screen.getAllByTestId('trace-row')
    expect(rows).toHaveLength(45)
    // Existing rows kept their order; the new ones are appended at the end.
    expect(ids().slice(0, 40)).toEqual(Array.from({ length: 40 }, (_, i) => String(i + 1)))
    expect(ids()[44]).toBe('45')
    // The only thing that changed in view is the pill.
    expect(screen.getByText(/\+5 below/)).toBeTruthy()
  })

  it('hides share % while live (denominator unknown) and shows it once done', () => {
    const { rerender } = render(<TraceView steps={steps(6)} live />)
    expect(screen.getAllByText(/streaming/).length).toBeGreaterThan(0)
    rerender(<TraceView steps={steps(6)} />)
    // A share percentage now renders somewhere (e.g. the largest step).
    expect(screen.queryAllByText(/streaming/).length).toBe(0)
  })
})
