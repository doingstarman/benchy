import type { MetricFormat } from '../../../src/types'

// One place to render a metric value per its format. null → em-dash ("no value"),
// a real 0 stays "0" — the two must never look the same (registry-wide rule).
// Shared by the editor preview and the participant comparison table.
export function formatValue(v: number | null, format: MetricFormat): string {
  if (v == null) return '—'
  switch (format) {
    case 'ms': return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`
    case 's': return `${v.toFixed(2)}s`
    case 'pct': return `${v <= 1 ? Math.round(v * 100) : Math.round(v)}%`
    case 'usd': return `$${v.toFixed(4)}`
    case 'tokens': return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))
    default: return Number.isInteger(v) ? String(v) : v.toFixed(2)
  }
}
