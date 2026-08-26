import type { CSSProperties } from 'react'
import { useT } from '../i18n'
import { formatCost } from '../../../src/pricing'

interface MetricsBarProps {
  ttfs: number | null
  totalTime: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens?: number | null
  reasoningMs?: number | null
  isFastest?: boolean
}

export function MetricsBar({ ttfs, totalTime, inputTokens, outputTokens, reasoningTokens, reasoningMs, isFastest }: MetricsBarProps) {
  const { t } = useT()
  return (
    <div style={{
      display: 'flex',
      gap: 16,
      alignItems: 'center',
      padding: '8px 0',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-secondary)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {isFastest && <span title={t('title.fastestTtfs')} style={{ color: 'var(--warning)' }}>★</span>}
        <span style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>ttfs</span>
        <span style={{ color: ttfs != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {ttfs != null ? `${ttfs}ms` : '—'}
        </span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>time</span>
        <span>{totalTime != null ? `${(totalTime / 1000).toFixed(2)}s` : '—'}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>in</span>
        <span>{inputTokens ?? '—'}</span>
      </span>
      {reasoningTokens != null && reasoningTokens > 0 && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>think</span>
          <span style={{ color: 'var(--info)' }}>{reasoningTokens}</span>
        </span>
      )}
      {/* Shown independently of the token count: a provider can stream the
          thinking text without ever reporting how many tokens it cost. */}
      {reasoningMs != null && reasoningMs > 0 && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>think&nbsp;time</span>
          <span style={{ color: 'var(--info)' }}>{(reasoningMs / 1000).toFixed(1)}s</span>
        </span>
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>out</span>
        <span>{outputTokens ?? '—'}</span>
      </span>
    </div>
  )
}

const barStyle: CSSProperties = {
  display: 'flex', gap: 16, alignItems: 'center', padding: '8px 0',
  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)',
}
const labelStyle: CSSProperties = {
  color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
}

// An agent participant measures its trajectory, not model pricing: steps, tool calls
// and its own reported cost — the same headline the /run agent cell shows. Same
// visual grammar as MetricsBar so a mixed Results view reads consistently.
export function AgentMetricsBar({ steps, tools, agentCost, totalTime }: {
  steps: number | null; tools: number | null; agentCost: number | null; totalTime: number | null
}) {
  const cell = (label: string, value: string) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ color: 'var(--text-primary)' }}>{value}</span>
    </span>
  )
  return (
    <div style={barStyle}>
      {cell('steps', steps != null ? String(steps) : '—')}
      {cell('tools', tools != null ? String(tools) : '—')}
      {cell('cost', formatCost(agentCost))}
      {cell('time', totalTime != null ? `${(totalTime / 1000).toFixed(2)}s` : '—')}
    </div>
  )
}
