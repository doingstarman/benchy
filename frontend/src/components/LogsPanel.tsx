import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logsApi, type LogEntry, type LogQueryParams } from '../api'
import { Button, Input } from './ui'
import { ConfirmDialog } from './ConfirmDialog'
import { useT } from '../i18n'

const RANGES: { key: string; ms: number | null }[] = [
  { key: '15m', ms: 15 * 60_000 },
  { key: '1h', ms: 60 * 60_000 },
  { key: '24h', ms: 24 * 60 * 60_000 },
  { key: '7d', ms: 7 * 24 * 60 * 60_000 },
  { key: 'all', ms: null },
]
const LEVELS = ['', 'debug', 'info', 'warn', 'error']
const CATEGORIES = ['', 'api', 'run', 'cell', 'agent', 'pipeline', 'system']
const FORMATS = ['json', 'ndjson', 'csv', 'txt']

const levelColor: Record<string, string> = {
  error: 'var(--error)', warn: 'var(--warning)', info: 'var(--text-secondary)', debug: 'var(--text-muted)',
}

function ts(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function LogsPanel() {
  const { t } = useT()
  const [rangeKey, setRangeKey] = useState('1h')
  const [level, setLevel] = useState('')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [live, setLive] = useState(false)
  const [rows, setRows] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const qDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [qLive, setQLive] = useState('')

  const params: LogQueryParams = useMemo(() => {
    const ms = RANGES.find(r => r.key === rangeKey)?.ms ?? null
    return { ...(ms != null ? { since: Date.now() - ms } : {}), ...(level ? { level } : {}), ...(category ? { category } : {}), ...(qLive ? { q: qLive } : {}), limit: 1000 }
  }, [rangeKey, level, category, qLive])

  const load = useCallback(() => {
    logsApi.list(params).then(d => { setRows(d.rows); setTotal(d.total) }).catch(() => {})
  }, [params])

  useEffect(() => { load() }, [load])

  // Debounce the search box so each keystroke isn't a request.
  useEffect(() => {
    if (qDebounce.current) clearTimeout(qDebounce.current)
    qDebounce.current = setTimeout(() => setQLive(q.trim()), 300)
    return () => { if (qDebounce.current) clearTimeout(qDebounce.current) }
  }, [q])

  // Live tail: re-poll while enabled.
  useEffect(() => {
    if (!live) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [live, load])

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '3px 9px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-xs)',
    fontFamily: 'var(--font-mono)', border: '0.5px solid', whiteSpace: 'nowrap',
    borderColor: active ? 'var(--accent)' : 'var(--border)', background: active ? 'var(--accent-bg)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
  })

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {RANGES.map(r => <button key={r.key} onClick={() => setRangeKey(r.key)} style={chip(rangeKey === r.key)}>{r.key === 'all' ? t('logs.all') : r.key}</button>)}
        </div>
        <select value={level} onChange={e => setLevel(e.target.value)} style={selectStyle}>
          {LEVELS.map(l => <option key={l} value={l}>{l || t('logs.anyLevel')}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} style={selectStyle}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c || t('logs.anyCategory')}</option>)}
        </select>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t('logs.search')} style={{ flex: 1, minWidth: 120 }} />
        <button onClick={() => setLive(v => !v)} style={chip(live)}>{live ? `● ${t('logs.live')}` : t('logs.live')}</button>
        <Button small onClick={load}>{t('logs.refresh')}</Button>
      </div>

      {/* Export + clear */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
        <span>{t('logs.export')}:</span>
        {FORMATS.map(f => (
          <a key={f} href={logsApi.exportUrl(params, f)} style={{ ...chip(false), textDecoration: 'none' }}>{f}</a>
        ))}
        <div style={{ flex: 1 }} />
        <span>{t('logs.showingN', { n: rows.length, total })}</span>
        <Button small onClick={() => setConfirmClear(true)}>{t('logs.clear')}</Button>
      </div>

      {/* Log stream */}
      <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-base)', maxHeight: 480, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{t('logs.empty')}</div>
        ) : rows.map(r => (
          <div key={r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)}
            style={{ display: 'flex', gap: 10, padding: '4px 12px', borderTop: '0.5px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', cursor: r.meta != null ? 'pointer' : 'default', alignItems: 'baseline' }}>
            <span title={new Date(r.ts).toISOString()} style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{ts(r.ts)}</span>
            <span style={{ color: levelColor[r.level] ?? 'var(--text-muted)', width: 42, flexShrink: 0, textTransform: 'uppercase', fontSize: 'var(--fs-xs)' }}>{r.level}</span>
            <span style={{ color: 'var(--text-muted)', width: 64, flexShrink: 0 }}>{r.category}</span>
            <span style={{ color: r.level === 'error' ? 'var(--error)' : 'var(--text-primary)', flex: 1, minWidth: 0, whiteSpace: expanded === r.id ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-word' }}>
              {r.message}
              {expanded === r.id && r.meta != null && (
                <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>{JSON.stringify(r.meta, null, 2)}</div>
              )}
            </span>
          </div>
        ))}
      </div>

      {confirmClear && (
        <ConfirmDialog title={t('logs.clear')} message={t('logs.clearConfirm')} confirmLabel={t('logs.clear')} danger
          onConfirm={() => { setConfirmClear(false); void logsApi.clear().then(load) }} onCancel={() => setConfirmClear(false)} />
      )}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '5px 8px', background: 'var(--bg-base)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
}
