import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { runsApi, useSSE } from '../api'
import type { SSEEvent } from '../api'
import { ResponseCard } from '../components/ResponseCard'
import type { Run, Result } from '../../../src/types'

interface CellState {
  text: string
  ttfs: number | null
  totalTime: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  done: boolean
  error: string | null
}

function cellKey(promptIndex: number, model: string) {
  return `${promptIndex}:${model}`
}

export function Results() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [cells, setCells] = useState<Record<string, CellState>>({})
  const [promptIndex, setPromptIndex] = useState(0)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isLive, setIsLive] = useState(true)

  useEffect(() => {
    if (!runId) return
    runsApi.get(runId).then(data => {
      setRun(data)
      setSaved(data.saved)
      setResults(data.results)
      if (data.status === 'done' || data.status === 'error') {
        setIsLive(false)
        // Populate cells from existing results
        const initial: Record<string, CellState> = {}
        for (const r of data.results) {
          initial[cellKey(r.promptIndex, r.model)] = {
            text: r.text,
            ttfs: r.metrics.ttfs,
            totalTime: r.metrics.totalTime,
            inputTokens: r.metrics.inputTokens,
            outputTokens: r.metrics.outputTokens,
            reasoningTokens: r.metrics.reasoningTokens,
            done: true,
            error: r.error,
          }
        }
        setCells(initial)
      }
    }).catch(() => navigate('/history'))
  }, [runId, navigate])

  const handleSSE = useCallback((e: SSEEvent) => {
    if (e.event === 'cell_token') {
      setCells(prev => {
        const k = cellKey(e.promptIndex, e.model)
        const existing = prev[k] ?? { text: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null, reasoningTokens: null, done: false, error: null }
        return { ...prev, [k]: { ...existing, text: existing.text + e.text } }
      })
    } else if (e.event === 'cell_done') {
      setCells(prev => {
        const k = cellKey(e.promptIndex, e.model)
        return {
          ...prev,
          [k]: {
            ...(prev[k] ?? {}),
            ttfs: e.ttfs,
            totalTime: e.totalTime,
            inputTokens: e.usage.inputTokens,
            outputTokens: e.usage.outputTokens,
            reasoningTokens: e.usage.reasoningTokens ?? null,
            done: true,
            error: null,
          },
        }
      })
    } else if (e.event === 'cell_error') {
      setCells(prev => {
        const k = cellKey(e.promptIndex, e.model)
        return { ...prev, [k]: { ...(prev[k] ?? { text: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null, reasoningTokens: null }), done: true, error: e.error } }
      })
    } else if (e.event === 'run_done') {
      setIsLive(false)
      // Refresh to get result IDs for feedback
      if (runId) runsApi.get(runId).then(data => setResults(data.results)).catch(() => {})
    }
  }, [runId])

  const { done: sseStreamDone } = useSSE(isLive && runId ? runId : null, handleSSE)

  useEffect(() => {
    if (sseStreamDone) setIsLive(false)
  }, [sseStreamDone])

  async function handleSave() {
    if (!runId) return
    setSaving(true)
    try {
      await runsApi.save(runId, !saved)
      setSaved(s => !s)
    } finally {
      setSaving(false)
    }
  }

  if (!run) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        Loading…
      </div>
    )
  }

  const models = run.models
  const currentModels = models
  const modelsWithTtfs = currentModels
    .map(m => cells[cellKey(promptIndex, m)]?.ttfs)
    .filter((t): t is number => t != null)
  const minTtfs = modelsWithTtfs.length ? Math.min(...modelsWithTtfs) : null

  const resultMap = new Map(results.map(r => [cellKey(r.promptIndex, r.model), r]))

  const prompt = run.prompts[promptIndex]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderBottom: '0.5px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => navigate('/history')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
            ← history
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            {run.id.slice(0, 8)}
          </span>
          {isLive && (
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
              live
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {minTtfs != null && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              best ttfs <span style={{ color: 'var(--warning)' }}>{minTtfs}ms</span>
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: saved ? 'var(--accent-bg)' : 'none',
              border: '0.5px solid',
              borderColor: saved ? 'var(--accent)' : 'var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 12px',
              color: saved ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {saved ? 'saved' : 'save'}
          </button>
        </div>
      </div>

      {/* Prompt tabs */}
      {run.prompts.length > 1 && (
        <div style={{
          display: 'flex', gap: 4, padding: '8px 24px',
          borderBottom: '0.5px solid var(--border)', flexShrink: 0,
        }}>
          {run.prompts.map((_, i) => (
            <button
              key={i}
              onClick={() => setPromptIndex(i)}
              style={{
                background: i === promptIndex ? 'var(--accent-bg)' : 'none',
                border: '0.5px solid',
                borderColor: i === promptIndex ? 'var(--accent)' : 'var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 10px',
                color: i === promptIndex ? 'var(--accent)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              #{i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Prompt text */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '0.5px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--text-secondary)',
        background: 'var(--bg-elevated)',
        flexShrink: 0,
        maxHeight: 100,
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
      }}>
        {prompt}
      </div>

      {/* Run settings summary */}
      {run.runSettings?.global && Object.values(run.runSettings.global).some(v => v != null) && (() => {
        const global = run.runSettings!.global!
        const entries = Object.entries(global).filter(([, v]) => v != null) as [string, number | string | boolean][]
        const labels: Record<string, string> = {
          temperature: 'temp', topP: 'top_p', topK: 'top_k',
          maxOutputTokens: 'max_tokens', timeoutMs: 'timeout',
          retries: 'retries', streaming: 'stream',
        }
        const perModelKeys = Object.keys(run.runSettings?.perModel ?? {})
        return (
          <div style={{
            padding: '7px 24px', borderBottom: '0.5px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              ⚙ {perModelKeys.length > 0 ? 'Custom settings (global)' : 'Custom settings'}
            </span>
            {entries.map(([key, val]) => (
              <span key={key} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {labels[key] ?? key}: <span style={{ color: 'var(--text-secondary)' }}>
                  {key === 'timeoutMs' ? `${Math.round((val as number) / 1000)}s` : String(val)}
                </span>
              </span>
            ))}
            {perModelKeys.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                + {perModelKeys.length} model override{perModelKeys.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )
      })()}

      {/* Response columns */}
      <div style={{
        flex: 1, padding: 24, display: 'flex', gap: 12,
        overflowX: 'auto', overflowY: 'hidden', alignItems: 'flex-start',
      }}>
        {currentModels.map(model => {
          const cell = cells[cellKey(promptIndex, model)]
          const result = resultMap.get(cellKey(promptIndex, model))
          const isFastest = cell?.ttfs != null && cell.ttfs === minTtfs && minTtfs != null && modelsWithTtfs.length > 1

          return (
            <ResponseCard
              key={model}
              runId={run.id}
              resultId={result?.id}
              model={model}
              text={cell?.text ?? ''}
              ttfs={cell?.ttfs ?? null}
              totalTime={cell?.totalTime ?? null}
              inputTokens={cell?.inputTokens ?? null}
              outputTokens={cell?.outputTokens ?? null}
              reasoningTokens={cell?.reasoningTokens}
              feedback={result?.feedback}
              isFastest={isFastest}
              isStreaming={isLive && !(cell?.done)}
              error={cell?.error}
            />
          )
        })}
      </div>
    </div>
  )
}
