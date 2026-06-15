import { useState } from 'react'
import { MetricsBar } from './MetricsBar'
import { runsApi } from '../api'

interface ResponseCardProps {
  runId: string
  resultId?: string
  model: string
  text: string
  ttfs: number | null
  totalTime: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens?: number | null
  feedback?: 'up' | 'down' | null
  isFastest?: boolean
  isStreaming?: boolean
  error?: string | null
}

export function ResponseCard({
  runId, resultId, model, text, ttfs, totalTime,
  inputTokens, outputTokens, reasoningTokens,
  feedback: initialFeedback, isFastest, isStreaming, error,
}: ResponseCardProps) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(initialFeedback ?? null)
  const [modelName, providerId] = (() => {
    const idx = model.indexOf(':')
    return idx >= 0 ? [model.slice(idx + 1), model.slice(0, idx)] : [model, '']
  })()

  async function vote(v: 'up' | 'down') {
    if (!resultId) return
    const next = feedback === v ? null : v
    setFeedback(next)
    await runsApi.setFeedback(runId, resultId, next)
  }

  return (
    <div style={{
      flex: 1,
      minWidth: 280,
      background: 'var(--bg-elevated)',
      border: '0.5px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '0.5px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-bright)' }}>
            {modelName}
          </div>
          {providerId && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
              {providerId}
            </div>
          )}
        </div>
        {resultId && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => vote('up')}
              style={{
                background: 'none',
                border: '0.5px solid',
                borderColor: feedback === 'up' ? 'var(--success)' : 'var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '3px 8px',
                fontSize: 12,
                color: feedback === 'up' ? 'var(--success)' : 'var(--text-muted)',
              }}
            >↑</button>
            <button
              onClick={() => vote('down')}
              style={{
                background: 'none',
                border: '0.5px solid',
                borderColor: feedback === 'down' ? 'var(--error)' : 'var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '3px 8px',
                fontSize: 12,
                color: feedback === 'down' ? 'var(--error)' : 'var(--text-muted)',
              }}
            >↓</button>
          </div>
        )}
      </div>

      {/* Metrics */}
      <div style={{ padding: '0 14px', borderBottom: '0.5px solid var(--border)' }}>
        <MetricsBar
          ttfs={ttfs} totalTime={totalTime}
          inputTokens={inputTokens} outputTokens={outputTokens}
          reasoningTokens={reasoningTokens} isFastest={isFastest}
        />
      </div>

      {/* Response */}
      <div style={{
        flex: 1,
        padding: 14,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.7,
        color: error ? 'var(--error)' : 'var(--text-primary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflowY: 'auto',
        maxHeight: 600,
      }}>
        {error ?? text}
        {isStreaming && !error && (
          <span style={{ display: 'inline-block', width: 8, height: 14, background: 'var(--accent)', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
        )}
      </div>
    </div>
  )
}
