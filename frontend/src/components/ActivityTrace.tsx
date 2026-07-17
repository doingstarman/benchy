import { useState, useRef, useEffect } from 'react'
import { useT } from '../i18n'
import { IconChevron } from './icons'

// What the model did before answering. Live it reads as a running commentary;
// once the answer lands it folds into one line, because nobody rereads a
// finished train of thought by default — but losing it entirely would throw
// away the most interesting half of a reasoning-model benchmark.
//
// Only three providers even offer this, and they disagree on how: OpenRouter
// and DeepSeek stream it as a field, qwen-style endpoints inline it as
// <think> tags, and OpenAI's chat/completions gives a token count and no text
// at all. That last case is why `thinking` exists separately from `text`: an
// empty trace during a 20s wait is not "no reasoning", it is "reasoning we are
// not allowed to see", and a shimmer says so honestly without inventing words.

const TRACE_CSS = `
  @keyframes at-shimmer {
    0%   { background-position: 200% 0 }
    100% { background-position: -200% 0 }
  }
  .at-shimmer {
    background: linear-gradient(90deg, var(--text-muted) 25%, var(--text-secondary) 50%, var(--text-muted) 75%);
    background-size: 200% 100%;
    -webkit-background-clip: text; background-clip: text; color: transparent;
    animation: at-shimmer 2s linear infinite;
  }
  @keyframes at-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
  .at-pulse { animation: at-pulse 1.4s ease-in-out infinite; }
`

export function ActivityTraceStyles() {
  return <style>{TRACE_CSS}</style>
}

interface ActivityTraceProps {
  reasoning: string
  reasoningMs: number | null
  reasoningTokens: number | null
  // 'streaming' drives the live view; anything else renders the folded summary.
  status: 'pending' | 'streaming' | 'done' | 'error'
  // The answer has begun, so thinking is over even while the cell still streams.
  answerStarted: boolean
}

function secs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function ActivityTrace({ reasoning, reasoningMs, reasoningTokens, status, answerStarted }: ActivityTraceProps) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const thinking = status === 'streaming' && !answerStarted
  const hasText = reasoning.length > 0

  // Follow the thought as it streams, but stop fighting the user once they
  // open a finished trace and scroll it themselves.
  useEffect(() => {
    if (thinking && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [reasoning, thinking])

  // Nothing to say: no text, not thinking, and no count to report.
  if (!hasText && !thinking && !reasoningTokens) return null

  // Thinking with nothing to show — the provider withheld the text.
  if (thinking && !hasText) {
    return (
      <div style={{ padding: '6px 2px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
        <span className="at-shimmer">{t('trace.thinking')}</span>
      </div>
    )
  }

  if (thinking) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0 8px' }}>
        <span className="at-shimmer" style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{t('trace.thinking')}</span>
        <div
          ref={bodyRef}
          style={{
            maxHeight: 120, overflowY: 'auto',
            borderLeft: '2px solid var(--accent-dim)', paddingLeft: 10,
            fontSize: 11, lineHeight: 1.6, fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {reasoning}
        </div>
      </div>
    )
  }

  const bits = [
    reasoningMs != null ? secs(reasoningMs) : null,
    reasoningTokens ? t('trace.tokens', { n: reasoningTokens }) : null,
  ].filter(Boolean)

  return (
    <div style={{ padding: '4px 0 8px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={!hasText}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 0, padding: 0,
          cursor: hasText ? 'pointer' : 'default',
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
        }}
      >
        {hasText && <IconChevron open={open} size={11} />}
        <span>{t('trace.reasoned')}</span>
        {bits.length > 0 && <span style={{ opacity: 0.75 }}>· {bits.join(' · ')}</span>}
      </button>
      {open && hasText && (
        <div
          style={{
            marginTop: 6, maxHeight: 260, overflowY: 'auto',
            borderLeft: '2px solid var(--border)', paddingLeft: 10,
            fontSize: 11, lineHeight: 1.6, fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {reasoning}
        </div>
      )}
    </div>
  )
}
