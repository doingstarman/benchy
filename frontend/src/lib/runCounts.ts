import { useEffect, useState } from 'react'
import { runsApi } from '../api'

// How many runs each participant (target id) took part in — one fetch, shared by the
// participant lists so a row can show "N runs →" that opens its filtered runs. The
// count is already a filter: clicking it is the participant → its-runs transition.
export function useRunCounts(): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    runsApi.list().then(runs => {
      const m = new Map<string, number>()
      for (const r of runs) for (const id of r.models) m.set(id, (m.get(id) ?? 0) + 1)
      setCounts(m)
    }).catch(() => {})
  }, [])
  return counts
}
