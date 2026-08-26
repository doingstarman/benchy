import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentMetricsBar } from './MetricsBar'

describe('AgentMetricsBar', () => {
  it('shows the trajectory headline: steps, tools, cost, time', () => {
    render(<AgentMetricsBar steps={5} tools={2} agentCost={0.0123} totalTime={3400} />)
    expect(screen.getByText('steps')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('tools')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('$0.012')).toBeInTheDocument()   // formatCost: <$1 → 3 decimals
    expect(screen.getByText('3.40s')).toBeInTheDocument()
  })

  it('renders em-dashes when the trajectory has no values (never 0)', () => {
    render(<AgentMetricsBar steps={null} tools={null} agentCost={null} totalTime={null} />)
    // steps —, tools —, cost —, time — : four em-dashes
    expect(screen.getAllByText('—')).toHaveLength(4)
  })
})
