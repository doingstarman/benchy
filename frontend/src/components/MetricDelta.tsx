// A signed delta of a metric against a baseline (e.g. a variant vs its base
// model). Green when the change is an improvement, red when a regression —
// direction depends on the metric, so the caller passes `lowerIsBetter`.
// Presentational; wired once metric values exist (stage 2).
export function MetricDelta({ value, lowerIsBetter = true, format = String }: {
  value: number | null
  lowerIsBetter?: boolean
  format?: (v: number) => string
}) {
  if (value == null || value === 0) {
    return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>—</span>
  }
  const improved = lowerIsBetter ? value < 0 : value > 0
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
      color: improved ? 'var(--success)' : 'var(--error)',
    }}>{value > 0 ? '+' : ''}{format(value)}</span>
  )
}
