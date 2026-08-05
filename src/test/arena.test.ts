import { describe, it, expect } from 'vitest'
import { computeStandings } from '../arena.js'
import type { ArenaVerdict } from '../types.js'

const v = (promptIndex: number, bestModel: string | null, worstModel: string | null = null, skipped = false): ArenaVerdict =>
  ({ promptIndex, bestModel, worstModel, skipped })

describe('computeStandings', () => {
  it('ranks a consistent best above the field and a consistent worst below it', () => {
    const s = computeStandings(['A', 'B', 'C'], [v(0, 'A', 'C'), v(1, 'A', 'C'), v(2, 'A', 'C')])
    expect(s.map(x => x.model)).toEqual(['A', 'B', 'C'])
    expect(s[0].elo).toBeGreaterThan(s[1].elo)
    expect(s[1].elo).toBeGreaterThan(s[2].elo)
    // wins = times best, losses = times worst.
    expect(s.find(x => x.model === 'A')).toMatchObject({ wins: 3, losses: 0 })
    expect(s.find(x => x.model === 'C')).toMatchObject({ wins: 0, losses: 3 })
    expect(s.find(x => x.model === 'B')).toMatchObject({ wins: 0, losses: 0 })
  })

  it('a lone best pick lifts the winner and leaves the untouched pair equal', () => {
    // Only a best (no worst): B and C both just lost to A once → still tied, A up.
    const s = computeStandings(['A', 'B', 'C'], [v(0, 'A')])
    expect(s.find(x => x.model === 'B')!.elo).toBe(s.find(x => x.model === 'C')!.elo)
    expect(s.find(x => x.model === 'A')!.elo).toBeGreaterThan(s.find(x => x.model === 'B')!.elo)
  })

  it('skipped items and two-middle pairs move nothing', () => {
    expect(computeStandings(['A', 'B', 'C'], [v(0, null, null, true)])).toEqual([
      { model: 'A', elo: 1000, wins: 0, losses: 0 },
      { model: 'B', elo: 1000, wins: 0, losses: 0 },
      { model: 'C', elo: 1000, wins: 0, losses: 0 },
    ])
    // best=A, worst=B leaves C and D as undecided middles — their pair is a no-op,
    // so C and D stay tied at 1000.
    const s = computeStandings(['A', 'B', 'C', 'D'], [v(0, 'A', 'B')])
    expect(s.find(x => x.model === 'C')!.elo).toBe(1000)
    expect(s.find(x => x.model === 'D')!.elo).toBe(1000)
  })

  it('is deterministic regardless of verdict insertion order', () => {
    const a = computeStandings(['A', 'B'], [v(0, 'A'), v(1, 'B')])
    const b = computeStandings(['A', 'B'], [v(1, 'B'), v(0, 'A')])
    expect(a).toEqual(b)
  })
})
