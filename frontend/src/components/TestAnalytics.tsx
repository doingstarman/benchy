import { useEffect, useState } from 'react'
import { resultsApi } from '../api'
import type { AnalyticsSummary } from '../api'
import { useT } from '../i18n'

const CSS = `
  .ta { --p: #7F77DD; --p-bg: rgba(127,119,221,0.12); --p-bd: rgba(127,119,221,0.45); --ok: #5ab87a; --mid: #d8a24a; --bad: #e05c5c; }
  .ta-sec { border: 0.5px solid var(--border); background: var(--bg-elevated); border-radius: var(--radius-md); padding: 14px; }
  .ta-lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); font-weight: 600; }
  .ta-big { font-size: 22px; font-family: var(--font-mono); color: var(--text-bright); font-weight: 600; }
  .ta-bar { flex: 1; height: 16px; border-radius: 4px; background: var(--bg-base); border: 0.5px solid var(--border); overflow: hidden; }
  .ta-bar > i { display: block; height: 100%; }
  .ta-exp { border: 0.5px solid var(--border); background: var(--bg-base); color: var(--text-secondary); border-radius: var(--radius-sm); padding: 6px 11px; font-size: 11px; font-family: var(--font-mono); cursor: pointer; text-decoration: none; }
  .ta-exp:hover { border-color: var(--p-bd); color: var(--p); }
`

const modelLabel = (k: string) => k.split(':').slice(1).join(':') || k
const fmtTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
const fmtDur = (ms: number | null) => ms == null ? '—' : (ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`)

function Bars({ title, rows }: { title: string; rows: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="ta-sec" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="ta-lbl">{title}</span>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', width: 108, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <span className="ta-bar"><i style={{ width: `${Math.round((r.value / max) * 100)}%`, background: 'var(--p)' }} /></span>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', width: 40, flex: 'none', textAlign: 'right' }}>{r.display}</span>
        </div>
      ))}
    </div>
  )
}

export function TestAnalytics({ runId }: { runId: string }) {
  const { t } = useT()
  const [s, setS] = useState<AnalyticsSummary | null>(null)
  const [notTest, setNotTest] = useState(false)

  useEffect(() => {
    let live = true
    resultsApi.summary(runId).then(d => live && setS(d)).catch(() => live && setNotTest(true))
    return () => { live = false }
  }, [runId])

  if (notTest || !s) return null

  const arena = s.mode === 'arena'
  const winnerLabel = s.winner ? modelLabel(s.winner) : '—'
  const winStanding = arena && s.winner ? s.standings?.find(x => x.model === s.winner) : null
  const winMatrix = !arena && s.winner ? s.matrix?.find(x => x.model === s.winner) : null
  const winnerSub = arena
    ? (winStanding ? `${winStanding.wins}/${s.coverage} · ${t('results.anBy')}` : '—')
    : (winMatrix?.overall != null ? `${Math.round(winMatrix.overall * 100)}%` : '—')

  const leftBars = arena
    ? (s.standings ?? []).map(x => ({ label: modelLabel(x.model), value: x.wins, display: String(x.wins) }))
    : (s.matrix ?? []).map(x => ({ label: modelLabel(x.model), value: x.overall ?? 0, display: x.overall == null ? '—' : `${Math.round(x.overall * 100)}%` }))
  const latBars = s.perModelLatency.map(l => ({ label: modelLabel(l.model), value: l.ms ?? 0, display: l.ms == null ? '—' : String(l.ms) }))

  return (
    <div className="ta" style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-bright)' }}>{t('results.anTitle')} · {s.datasetName}</span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s.itemCount} {t('results.items')} · {s.modelCount} {t('dataset.models').toLowerCase()} · {arena ? t('dataset.modeArena') : t('dataset.modeScore')}</span>
        <div style={{ flex: 1 }} />
        <a className="ta-exp" href={resultsApi.exportUrl(runId, 'csv')}>↓ CSV</a>
        <a className="ta-exp" href={resultsApi.exportUrl(runId, 'json')}>↓ JSON</a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <div className="ta-sec" style={{ display: 'flex', flexDirection: 'column', gap: 5, borderColor: 'var(--p-bd)', background: 'var(--p-bg)' }}>
          <span className="ta-lbl" style={{ color: 'var(--p)' }}>{t('results.anWinner')}</span>
          <span className="ta-big">{winnerLabel}</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{winnerSub}</span>
        </div>
        <div className="ta-sec" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="ta-lbl">{t('results.anTokens')}</span>
          <span className="ta-big">{fmtTokens(s.tokens)}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDur(s.durationMs)}</span>
        </div>
        <div className="ta-sec" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="ta-lbl">{t('results.anCoverage')}</span>
          <span className="ta-big">{s.coverage} / {s.itemCount}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{arena && s.skipped ? `${s.skipped} ${t('results.skipped')}` : ''}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Bars title={arena ? t('results.anChartWins') : t('results.anChartField')} rows={leftBars} />
        <Bars title={t('results.anChartLat')} rows={latBars} />
      </div>

      {s.weak.length > 0 && (
        <div className="ta-sec" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span className="ta-lbl">{t('results.anItems')}</span>
          {s.weak.map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--text-secondary)', width: 150, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.file}</span>
              <span style={{ color: 'var(--bad)' }}>{w.why}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
