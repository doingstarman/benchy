import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dashboardApi, type DashboardData } from '../api'
import { formatCost } from '../../../src/pricing'
import { TypeBadge } from '../components/TypeBadge'
import { useT } from '../i18n'
import type { TargetKind } from '../../../src/types'

function fmtTokens(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }
function fmtPct(v: number | null): string { return v == null ? '—' : `${v <= 1 ? Math.round(v * 100) : Math.round(v)}%` }
function fmtDur(ms: number | null): string { return ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms` }
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export function Dashboard() {
  const { t } = useT()
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => { dashboardApi.get().then(setData).catch(() => setError(true)) }, [])

  if (error) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>{t('dashboard.error')}</div>
  if (!data) return <div style={{ padding: 24, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{t('common.loading')}</div>

  const { totals, recentRuns, leaderboard, activity } = data
  const maxRuns = Math.max(1, ...activity.map(a => a.runs))

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)', color: 'var(--text-bright)' }}>{t('dashboard.title')}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('dashboard.subtitle')}</p>
        </div>

        {/* Stat tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
          <Tile label={t('dashboard.runs')} value={String(totals.runs)} sub={t('dashboard.savedN', { n: totals.savedRuns })} />
          <Tile label={t('dashboard.results')} value={String(totals.results)} sub={fmtTokens(totals.totalTokens) + ' tok'} />
          <Tile label={t('dashboard.totalCost')} value={formatCost(totals.totalCostUsd)} accent />
          <Tile label={t('dashboard.participants')} value={String(totals.models + totals.agents + totals.pipelines)}
            sub={`${totals.models}m · ${totals.agents}a · ${totals.pipelines}p`} />
        </div>

        {/* Activity sparkline */}
        <div style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 20 }}>
          <div style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>{t('dashboard.activity')}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 56 }}>
            {activity.map(a => (
              <div key={a.day} title={`${a.day}: ${a.runs}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ height: `${Math.round((a.runs / maxRuns) * 100)}%`, minHeight: a.runs > 0 ? 3 : 0, background: a.runs > 0 ? 'var(--accent)' : 'transparent', borderRadius: 2 }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            <span>{activity[0]?.day.slice(5)}</span>
            <span>{t('dashboard.runsPerDay')}</span>
            <span>{activity[activity.length - 1]?.day.slice(5)}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {/* Recent runs */}
          <Panel label={t('dashboard.recentRuns')}>
            {recentRuns.length === 0 ? <Empty text={t('dashboard.noRuns')} /> : recentRuns.map(r => (
              <button key={r.id} onClick={() => navigate(`/results/${r.id}`)} style={rowBtn}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || r.id.slice(0, 8)}</span>
                    {r.saved && <span style={{ fontSize: 9, color: 'var(--accent)' }}>★</span>}
                  </div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {t('dashboard.partN', { n: r.participantCount })} · {ago(r.createdAt)} · {r.status}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
                  <div>{fmtPct(r.avgScore)}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{fmtTokens(r.tokens)} · {fmtDur(r.durationMs)}</div>
                </div>
              </button>
            ))}
          </Panel>

          {/* Participant leaderboard */}
          <Panel label={t('dashboard.leaderboard')}>
            {leaderboard.length === 0 ? <Empty text={t('dashboard.noRuns')} /> : leaderboard.map(p => (
              <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderTop: '0.5px solid var(--border)' }}>
                <TypeBadge kind={p.kind as TargetKind} />
                <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('dashboard.resultsN', { n: p.results })}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', width: 44, textAlign: 'right' }}>{fmtPct(p.avgScore)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', width: 60, textAlign: 'right' }}>{formatCost(p.costUsd)}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  )
}

const rowBtn: React.CSSProperties = {
  all: 'unset', cursor: 'pointer', boxSizing: 'border-box', width: '100%',
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', borderTop: '0.5px solid var(--border)',
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
      <div style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xl)', color: accent ? 'var(--accent)' : 'var(--text-bright)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ padding: '0 14px 8px' }}>{children}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{text}</div>
}
