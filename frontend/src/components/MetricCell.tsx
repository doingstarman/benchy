// A single labelled metric readout: a muted caption over a monospace value.
// Presentational only — the participant list feeds it pricing today and real
// latency/throughput once the metrics registry lands (stage 2). A `null` value
// renders as an em dash, so "no data yet" reads the same everywhere.
export function MetricCell({ label, value, title }: { label: string; value: string | null; title?: string }) {
  return (
    <div title={title} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 52 }}>
      <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: value == null ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {value ?? '—'}
      </span>
    </div>
  )
}
