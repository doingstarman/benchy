import { useEffect, useState } from 'react'
import { MetricsBar, AgentMetricsBar } from './MetricsBar'
import { ActivityTrace, ActivityTraceStyles } from './ActivityTrace'
import { TraceView } from './TraceView'
import { useShowReasoning, useMonoAnswers } from '../prefs'
import { runsApi, traceApi } from '../api'
import type { TraceStepRow } from '../../../src/types'

interface ResponseCardProps {
  runId: string
  resultId?: string
  model: string
  text: string
  reasoning?: string
  ttfs: number | null
  totalTime: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens?: number | null
  reasoningMs?: number | null
  feedback?: 'up' | 'down' | null
  isFastest?: boolean
  isStreaming?: boolean
  error?: string | null
}

export function ResponseCard({
  runId, resultId, model, text, reasoning, ttfs, totalTime,
  inputTokens, outputTokens, reasoningTokens, reasoningMs,
  feedback: initialFeedback, isFastest, isStreaming, error,
}: ResponseCardProps) {
  const showReasoning = useShowReasoning()
  const monoAnswers = useMonoAnswers()
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(initialFeedback ?? null)
  const [modelName, providerId] = (() => {
    const idx = model.indexOf(':')
    return idx >= 0 ? [model.slice(idx + 1), model.slice(0, idx)] : [model, '']
  })()

  // An agent participant carries a trajectory, not just an answer. Fetch it once the
  // result has settled (steps are persisted when the cell finishes).
  const hasTrajectory = providerId === 'agent' || providerId === 'pipeline'
  const [trace, setTrace] = useState<TraceStepRow[] | null>(null)
  useEffect(() => {
    if (!hasTrajectory || !resultId || isStreaming) return
    let live = true
    traceApi.get(resultId).then(t => { if (live) setTrace(t) }).catch(() => {})
    return () => { live = false }
  }, [hasTrajectory, resultId, isStreaming])

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

      {/* Metrics — an agent shows its trajectory (steps/tools/cost), a model its
          latency + tokens. Agent trajectory metrics come from the fetched trace. */}
      <div style={{ padding: '0 14px', borderBottom: '0.5px solid var(--border)' }}>
        {hasTrajectory ? (
          <AgentMetricsBar
            steps={trace ? trace.length : null}
            tools={trace ? trace.filter(s => s.kind === 'tool').length : null}
            agentCost={trace ? trace.reduce<number | null>((a, s) => s.cost != null ? (a ?? 0) + s.cost : a, null) : null}
            totalTime={totalTime}
          />
        ) : (
          <MetricsBar
            ttfs={ttfs} totalTime={totalTime}
            inputTokens={inputTokens} outputTokens={outputTokens}
            reasoningTokens={reasoningTokens} reasoningMs={reasoningMs} isFastest={isFastest}
          />
        )}
      </div>

      {/* Response */}
      <div style={{
        flex: 1,
        padding: 14,
        // Follows the Settings toggle so the two places an answer is read agree.
        // Default off means this view is sans now, where it used to be mono.
        fontFamily: monoAnswers ? 'var(--font-mono)' : 'var(--font-sans)',
        fontSize: 12,
        lineHeight: 1.7,
        color: error ? 'var(--error)' : 'var(--text-primary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflowY: 'auto',
        maxHeight: 600,
      }}>
        <ActivityTraceStyles />
        {showReasoning && !error && (
          <ActivityTrace
            reasoning={reasoning ?? ''}
            reasoningMs={reasoningMs ?? null}
            reasoningTokens={reasoningTokens ?? null}
            status={isStreaming ? 'streaming' : 'done'}
            answerStarted={text.length > 0}
          />
        )}
        {hasTrajectory && trace && trace.length > 0 && (
          <div style={{ marginBottom: 10 }}><TraceView steps={trace} layout="narrow" /></div>
        )}
        {error ?? text}
        {isStreaming && !error && (
          <span style={{ display: 'inline-block', width: 8, height: 14, background: 'var(--accent)', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
        )}
      </div>
    </div>
  )
}
