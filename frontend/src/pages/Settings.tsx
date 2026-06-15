export function Settings() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 480 }}>
      <h1 style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-bright)' }}>Settings</h1>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Server
        </div>
        <Row label="Port" value="4242" mono />
        <Row label="Config file" value="~/.benchy/config.json" mono />
        <Row label="Database" value="~/.benchy/benchy.db" mono />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          About
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          benchy is an open-source self-hosted AI model benchmarking tool.
          {' '}<a href="https://github.com/benchyhq/benchy" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>GitHub →</a>
        </div>
      </section>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit', fontSize: 11, color: 'var(--text-muted)' }}>{value}</span>
    </div>
  )
}
