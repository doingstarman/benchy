import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../i18n'
import { resultsApi } from '../api'
import type { ResultsRow } from '../api'

const CSS = `
  .rdb { --p: var(--accent); --p-bg: var(--accent-bg); --p-bd: var(--accent-dim); --ok: var(--success); }
  .rdb-row { cursor: pointer; }
  .rdb-row:hover td { background: rgba(127,119,221,0.05); }
  .rdb-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .rdb-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; padding: 9px 10px; border-bottom: 0.5px solid var(--border); white-space: nowrap; }
  .rdb-table td { padding: 11px 10px; border-bottom: 0.5px solid var(--hairline); font-family: var(--font-mono); color: var(--text-secondary); white-space: nowrap; }
  .rdb-mode { font-size: 10px; color: var(--p); border: 0.5px solid var(--p-bd); background: var(--p-bg); border-radius: 4px; padding: 2px 6px; }
`

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
}
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
}
function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

function downloadListCsv(rows: ResultsRow[]) {
  const cols = ['datasetName', 'itemCount', 'modelCount', 'mode', 'winner', 'avgScore', 'tokens', 'durationMs', 'createdAt']
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // neutralize spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc((r as unknown as Record<string, unknown>)[c])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = 'results.csv'; a.click()
  URL.revokeObjectURL(url)
}

export function ResultsDb() {
  const { t } = useT()
  const nav = useNavigate()
  const [rows, setRows] = useState<ResultsRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    resultsApi.list().then(setRows).finally(() => setLoading(false))
  }, [])

  return (
    <div className="rdb" style={{ flex: 1, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: '28px 32px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 1080 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 600, color: 'var(--text-bright)', margin: '0 0 3px' }}>{t('results.title')}</h1>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>{t('results.sub')}</p>
          </div>
          <div style={{ flex: 1 }} />
          {rows.length > 0 && (
            <button onClick={() => downloadListCsv(rows)}
              style={{ border: '0.5px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)', padding: '7px 13px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>
              ↓ {t('results.export')}
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div style={{ border: '0.5px dashed var(--border)', borderRadius: 'var(--radius-md)', padding: 40, textAlign: 'center', background: 'var(--bg-elevated)', fontSize: 13, color: 'var(--text-muted)' }}>
            {t('results.empty')}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)' }}>
            <table className="rdb-table">
              <thead><tr>
                <th>{t('results.cDataset')}</th>
                <th>{t('results.cItems')}</th>
                <th>{t('results.cModels')}</th>
                <th>{t('results.cMode')}</th>
                <th>{t('results.cWinner')}</th>
                <th style={{ textAlign: 'right' }}>{t('results.cScore')}</th>
                <th style={{ textAlign: 'right' }}>{t('results.cTokens')}</th>
                <th style={{ textAlign: 'right' }}>{t('results.cTime')}</th>
                <th style={{ textAlign: 'right' }}>{t('results.cDate')}</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.runId} className="rdb-row" onClick={() => nav(`/results/${r.runId}`)}>
                    <td style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>{r.datasetName}</td>
                    <td>{r.itemCount}</td>
                    <td>{r.modelCount}</td>
                    <td><span className="rdb-mode">{r.mode === 'arena' ? t('dataset.modeArena') : t('dataset.modeScore')}</span></td>
                    <td style={{ color: r.winner ? 'var(--p)' : 'var(--text-muted)' }}>{r.winner ? r.winner.split(':').slice(1).join(':') || r.winner : '—'}</td>
                    <td style={{ textAlign: 'right', color: r.avgScore != null ? 'var(--ok)' : 'var(--text-muted)' }}>{pct(r.avgScore)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtTokens(r.tokens)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtDuration(r.durationMs)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
