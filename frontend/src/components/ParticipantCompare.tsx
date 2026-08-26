import type { CSSProperties } from 'react'
import type { MetricDef, MetricDirection, TargetKind } from '../../../src/types'
import { bestValue, appliesToKind } from '../lib/metricsView'
import { formatValue } from '../lib/metricFormat'
import { useT } from '../i18n'

const DIR: Record<MetricDirection, string> = { lower: '↓', higher: '↑', neutral: '·' }

// 135° hatch = "not applicable to this participant kind". A texture, never a value —
// it must not read as `—` (didn't report) or 0. The em-dash is a symbol; this is a fill.
const HATCH =
  'repeating-linear-gradient(135deg, var(--border) 0, var(--border) 0.5px, transparent 0.5px, transparent 5px)'

export interface CompareParticipant {
  key: string
  label: string
  kind: TargetKind
  values: Record<string, number | null>
  // Process axis (distinct from correctness): the participant's run errored / a trace
  // step crashed. A wrong answer is NEVER a process error — it lives in the score chip.
  processError: boolean
}

const caption: CSSProperties = {
  fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)',
}

// A metric that measures only the agent trajectory (agent in appliesTo, model out).
function isTrajectory(d: MetricDef): boolean {
  return d.appliesTo.includes('agent') && !d.appliesTo.includes('model')
}

// rows = metrics (registry order, grouped), columns = the run's participants. Asymmetry
// is a cell state: a metric a kind can't have is hatched, not null and not 0. Values are
// computed client-side (metricsView.participantValues) so it works for any finished run.
export function ParticipantCompare({ defs, participants }: { defs: MetricDef[]; participants: CompareParticipant[] }) {
  const { t } = useT()
  if (defs.length === 0 || participants.length < 2) return null

  const general = defs.filter(d => !isTrajectory(d))
  const trajectory = defs.filter(isTrajectory)
  const hasTrajectoryParticipant = participants.some(p => p.kind === 'agent' || p.kind === 'pipeline')
  const grid = `168px repeat(${participants.length}, minmax(88px, 1fr))`

  const row = (d: MetricDef) => {
    const cells = participants.map(p => ({ p, applies: appliesToKind(d, p.kind), v: p.values[d.key] ?? null }))
    const best = bestValue(cells.map(c => (c.applies ? c.v : null)), d.direction)
    const missing = cells.filter(c => c.applies && c.v == null).length
    const applicable = cells.filter(c => c.applies).length

    return (
      <div key={d.key} style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: '8px 12px', borderTop: '0.5px solid var(--border)', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.key}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{DIR[d.direction]} {d.unit ?? ''}</span>
          {applicable > 1 && missing > 0 && (
            <span title={t('compare.coverage')} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--warning)', border: '0.5px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '0 4px' }}>
              {applicable - missing}/{applicable}
            </span>
          )}
        </span>
        {cells.map(({ p, applies, v }) => {
          if (!applies) {
            return <span key={p.key} title={t('compare.notApplicable')} style={{ height: 16, borderRadius: 2, background: HATCH, opacity: 0.7 }} />
          }
          if (d.key === 'score') return <ScoreChip key={p.key} value={v} format={d.format} />
          return (
            <span key={p.key} style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: v == null ? 'var(--text-muted)' : best != null && v === best ? 'var(--accent)' : 'var(--text-secondary)' }}>
              {formatValue(v, d.format)}
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-elevated)', flexShrink: 0 }}>
      <div style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--border)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{t('compare.title')}</div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 168 + participants.length * 88 }}>
          {/* header: metric col + per-participant process dot + label */}
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: '7px 12px', borderBottom: '0.5px solid var(--border)' }}>
            <span style={caption}>{t('metrics.colMetric')}</span>
            {participants.map(p => (
              <span key={p.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, minWidth: 0 }}>
                <span
                  title={p.processError ? t('compare.processError') : t('compare.processOk')}
                  style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: p.processError ? 'var(--error)' : 'var(--success)' }}
                />
                <span style={{ ...caption, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
              </span>
            ))}
          </div>
          {general.map(row)}
          {trajectory.length > 0 && hasTrajectoryParticipant && (
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: '6px 12px', borderTop: '0.5px solid var(--border)', background: 'var(--bg)' }}>
              <span style={{ ...caption, color: 'var(--text-secondary)', gridColumn: `1 / span ${participants.length + 1}` }}>{t('compare.trajectoryHeader')}</span>
            </div>
          )}
          {trajectory.map(row)}
        </div>
      </div>
    </div>
  )
}

// Correctness axis: a score reads as a chip, --error-bg when the answer is wrong (0%).
// Never rendered in the process column, never merged with the process dot.
function ScoreChip({ value, format }: { value: number | null; format: MetricDef['format'] }) {
  const pct = value == null ? null : value <= 1 ? Math.round(value * 100) : Math.round(value)
  const wrong = pct != null && pct === 0
  return (
    <span style={{ justifySelf: 'end', display: 'inline-flex', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', padding: '1px 7px', borderRadius: 'var(--radius-sm)', background: wrong ? 'var(--error-bg)' : pct === 100 ? 'var(--success-bg)' : 'transparent', color: value == null ? 'var(--text-muted)' : wrong ? 'var(--error)' : pct === 100 ? 'var(--success)' : 'var(--text-secondary)' }}>
      {formatValue(value, format)}
    </span>
  )
}
