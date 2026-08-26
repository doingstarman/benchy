import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ParticipantCompare, type CompareParticipant } from './ParticipantCompare'
import { setLang } from '../i18n'
import type { MetricDef, MetricFormat, MetricDirection, MetricScope, TargetKind } from '../../../src/types'

beforeAll(() => setLang('en'))

const def = (key: string, over: Partial<MetricDef> = {}): MetricDef => ({
  key, name: key, kind: 'builtin', expression: null, unit: null,
  format: 'raw' as MetricFormat, direction: 'neutral' as MetricDirection,
  scope: 'answer' as MetricScope, aggregate: null, nullable: true, enabled: true,
  appliesTo: ['model', 'agent'] as TargetKind[], ...over,
})

const DEFS: MetricDef[] = [
  def('ttfs', { format: 'ms', direction: 'lower', appliesTo: ['model'] }),
  def('total_time', { format: 's', appliesTo: ['model', 'agent'] }),
  def('score', { format: 'pct', direction: 'higher', scope: 'run', aggregate: 'mean', appliesTo: ['model', 'agent'] }),
  def('steps', { appliesTo: ['agent'] }),
]

const PARTICIPANTS: CompareParticipant[] = [
  { key: 'openai:gpt', label: 'gpt', kind: 'model', processError: false,
    values: { ttfs: 150, total_time: 1.5, score: 1, steps: null } },
  { key: 'agent-1', label: 'my agent', kind: 'agent', processError: true,
    values: { ttfs: null, total_time: null, score: 0, steps: 4 } },
]

describe('ParticipantCompare', () => {
  it('renders a shared row per metric and one column per participant', () => {
    render(<ParticipantCompare defs={DEFS} participants={PARTICIPANTS} />)
    expect(screen.getByText('gpt')).toBeInTheDocument()
    expect(screen.getByText('my agent')).toBeInTheDocument()
    expect(screen.getByText('150ms')).toBeInTheDocument()   // model ttfs value
    expect(screen.getByText('4')).toBeInTheDocument()        // agent steps value
  })

  it('hatches a cell whose metric does not apply to the column kind (agent ttfs, model steps)', () => {
    render(<ParticipantCompare defs={DEFS} participants={PARTICIPANTS} />)
    // one hatch for agent×ttfs, one for model×steps
    expect(screen.getAllByTitle('Not applicable to this participant kind')).toHaveLength(2)
  })

  it('a not-applicable cell is distinct from a null value: the agent total_time reports — , not a hatch', () => {
    render(<ParticipantCompare defs={DEFS} participants={PARTICIPANTS} />)
    // total_time applies to both; the agent value is null → em-dash, never hatched
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('groups agent-only metrics under a trajectory sub-header', () => {
    render(<ParticipantCompare defs={DEFS} participants={PARTICIPANTS} />)
    expect(screen.getByText('Trajectory metrics — agents only')).toBeInTheDocument()
  })

  it('renders below two participants only (a single column shows nothing)', () => {
    const { container } = render(<ParticipantCompare defs={DEFS} participants={[PARTICIPANTS[0]]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
