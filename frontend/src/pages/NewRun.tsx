import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { providersApi, benchmarkApi } from '../api'
import type { Provider } from '../../../src/types'

interface UIResult {
  text: string
  ttfs: number | null
  totalTime: number | null
  inputTokens: number | null
  outputTokens: number | null
  status: 'pending' | 'streaming' | 'done' | 'error'
  error?: string
}

type ScreenState = 'idle' | 'running' | 'done'

const ANIM_CSS = `
  @keyframes benchy-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes benchy-blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .bp { animation: benchy-pulse 1s infinite }
  .bb { animation: benchy-blink .7s infinite; display:inline-block }
  .chips-row::-webkit-scrollbar { display: none }
  .col-body::-webkit-scrollbar { width: 4px }
  .col-body::-webkit-scrollbar-track { background: transparent }
  .col-body::-webkit-scrollbar-thumb { background: var(--border-hover); border-radius: 2px }
  .nr-ta::placeholder { color: var(--text-muted); }
  .nr-head-btn { background: none; border: 0.5px solid var(--border); border-radius: 5px; padding: 3px 7px; color: var(--text-secondary); font-size: 13px; cursor: pointer; line-height: 1; }
  .nr-head-btn:hover { color: var(--text-primary); border-color: var(--border-hover); }
`

// ─── ChipsRow ─────────────────────────────────────────────────────────────
// Defined at module level — must NOT be inside NewRun or React will remount
// on every state change (new function reference = new component type).

interface ChipsRowProps {
  models: { key: string; label: string }[]
  selectedModels: Set<string>
  onToggle: (key: string) => void
  onAdd: () => void
  wrap: boolean
}

export function ChipsRow({ models, selectedModels, onToggle, onAdd, wrap }: ChipsRowProps) {
  return (
    <div
      className="chips-row"
      style={{
        display: 'flex',
        flexWrap: wrap ? 'wrap' : 'nowrap',
        gap: 6,
        overflowX: wrap ? 'visible' : 'auto',
        scrollbarWidth: 'none',
        ...(wrap ? { justifyContent: 'center', maxWidth: 640 } : {}),
      }}
    >
      {models.map(({ key, label }) => {
        const active = selectedModels.has(key)
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              padding: '5px 11px',
              border: `0.5px solid ${active ? 'var(--accent-dim)' : 'var(--border)'}`,
              borderRadius: 20,
              background: active ? 'var(--accent-bg)' : 'var(--bg-elevated)',
              cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: active ? 'var(--accent)' : 'var(--border-hover)' }} />
            {label}
          </button>
        )
      })}
      {models.length === 0 && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>No providers —</span>
      )}
      <button
        onClick={onAdd}
        style={{
          padding: '5px 11px', border: '0.5px dashed var(--border)', borderRadius: 20, flexShrink: 0,
          background: 'transparent', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--border-hover)',
        }}
      >
        + add
      </button>
    </div>
  )
}

// ─── Promptbox ────────────────────────────────────────────────────────────
// Defined at module level — same reason as ChipsRow above.

interface PromptboxProps {
  simplified: boolean
  mode: 0 | 1
  onModeChange: (m: 0 | 1) => void
  selectedCount: number
  selectedModels: string[]
  prompt: string
  onPromptChange: (v: string) => void
  perModelPrompts: Record<string, string>
  onPerModelPromptChange: (key: string, v: string) => void
  callCount: number
  isRunning: boolean
  onRun: () => void
}

export function Promptbox({
  simplified, mode, onModeChange, selectedCount, selectedModels,
  prompt, onPromptChange, perModelPrompts, onPerModelPromptChange,
  callCount, isRunning, onRun,
}: PromptboxProps) {
  const disabled = callCount === 0 || isRunning
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
      {!simplified && (
        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
          {(['one prompt → all models', 'prompt per model'] as const).map((label, i) => (
            <button
              key={i}
              onClick={() => onModeChange(i as 0 | 1)}
              style={{
                flex: 1, padding: '9px 14px', fontSize: 11, fontFamily: 'var(--font-mono)',
                cursor: 'pointer', textAlign: 'left', background: 'none', border: 'none',
                borderRight: i === 0 ? '0.5px solid var(--border)' : 'none',
                borderBottom: mode === i ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                marginBottom: -0.5,
                color: mode === i ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {label}
            </button>
          ))}
          <div style={{ padding: '9px 14px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
            {selectedCount} selected
          </div>
        </div>
      )}

      {!simplified && mode === 1 ? (
        <div>
          {selectedModels.map((key, i, arr) => (
            <div key={key} style={{ borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
              <div style={{ padding: '8px 14px 2px', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {key.split(':').slice(1).join(':')}
              </div>
              <textarea
                className="nr-ta"
                value={perModelPrompts[key] ?? ''}
                onChange={e => onPerModelPromptChange(key, e.target.value)}
                placeholder={`Prompt for ${key.split(':').slice(1).join(':')}…`}
                rows={2}
                style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)', resize: 'none', lineHeight: 1.65, padding: '4px 14px 10px' }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '12px 14px 0' }}>
          <textarea
            className="nr-ta"
            value={prompt}
            onChange={e => onPromptChange(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !disabled) onRun() }}
            placeholder={simplified ? 'Follow-up or new prompt…' : 'Ask anything…'}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              fontSize: 14, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)',
              resize: 'none', lineHeight: 1.65, minHeight: 48, maxHeight: 120, overflowY: 'auto',
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 8 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}>📎</span>
        <div style={{ flex: 1 }} />
        {callCount > 0 && !isRunning && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginRight: 6 }}>
            <span style={{ color: 'var(--accent)' }}>{callCount}</span> call{callCount !== 1 ? 's' : ''}
          </span>
        )}
        <button
          onClick={onRun}
          disabled={disabled}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 16px', border: 'none', borderRadius: 7,
            background: disabled ? 'var(--accent-bg)' : 'var(--accent)',
            color: disabled ? 'var(--text-muted)' : '#fff',
            fontSize: 13, fontFamily: 'var(--font-mono)',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {isRunning ? '⏸ running' : '▶ run'}
        </button>
      </div>
    </div>
  )
}

// ─── NewRun ───────────────────────────────────────────────────────────────

export function NewRun() {
  const navigate = useNavigate()

  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<0 | 1>(0)
  const [prompt, setPrompt] = useState('')
  const [perModelPrompts, setPerModelPrompts] = useState<Record<string, string>>({})

  const [screenState, setScreenState] = useState<ScreenState>('idle')
  const [results, setResults] = useState<Map<string, UIResult>>(new Map())
  const [vote, setVote] = useState<string | null>(null)
  const [expandedCol, setExpandedCol] = useState<string | null>(null)
  const [copiedCol, setCopiedCol] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const esRef = useRef<EventSource | null>(null)
  const regenEsRef = useRef<EventSource | null>(null)
  const currentPromptRef = useRef('')

  useEffect(() => {
    providersApi.list().then(ps => {
      setProviders(ps)
      setSelectedModels(prev => {
        if (prev.size > 0) return prev
        const all = ps
          .filter(p => p.enabled && (p.apiKey || p.baseUrl))
          .flatMap(p => p.models.map(m => `${p.id}:${m}`))
        return all.length > 0 ? new Set([all[0]]) : prev
      })
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedCol(null) }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  useEffect(() => {
    if (screenState !== 'running') return
    const all = [...results.values()]
    if (all.length > 0 && all.every(r => r.status === 'done' || r.status === 'error')) {
      setScreenState('done')
    }
  }, [results, screenState])

  const connectedModels = providers
    .filter(p => p.enabled && (p.apiKey || p.baseUrl))
    .flatMap(p => p.models.map(m => ({ key: `${p.id}:${m}`, label: m })))

  function toggleModel(key: string) {
    setSelectedModels(prev => {
      if (prev.has(key) && prev.size === 1) return prev
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const activeRunModels = [...results.keys()]

  const filledPairs = [...selectedModels]
    .filter(k => perModelPrompts[k]?.trim())
    .map(k => ({ prompt: perModelPrompts[k].trim(), model: k }))

  const effectiveMode = screenState === 'idle' ? mode : 0
  const callCount = effectiveMode === 0
    ? (prompt.trim() ? selectedModels.size : 0)
    : filledPairs.length

  const allTtfs = [...results.values()].map(r => r.ttfs).filter((t): t is number => t !== null)
  const minTtfs = allTtfs.length > 1 ? Math.min(...allTtfs) : null

  function wireSSE(es: EventSource) {
    es.addEventListener('cell_start', e => {
      const { model } = JSON.parse((e as MessageEvent).data) as { model: string }
      setResults(prev => {
        if (!prev.has(model)) return prev
        const next = new Map(prev)
        next.set(model, { ...next.get(model)!, status: 'streaming' })
        return next
      })
    })
    es.addEventListener('cell_token', e => {
      const { model, text } = JSON.parse((e as MessageEvent).data) as { model: string; text: string }
      setResults(prev => {
        if (!prev.has(model)) return prev
        const next = new Map(prev)
        const r = next.get(model)!
        next.set(model, { ...r, text: r.text + text, status: 'streaming' })
        return next
      })
    })
    es.addEventListener('cell_done', e => {
      const { model, ttfs, totalTime, usage } = JSON.parse((e as MessageEvent).data) as {
        model: string; ttfs: number; totalTime: number
        usage: { inputTokens: number; outputTokens: number }
      }
      setResults(prev => {
        if (!prev.has(model)) return prev
        const next = new Map(prev)
        next.set(model, {
          ...next.get(model)!, status: 'done', ttfs, totalTime,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        })
        return next
      })
    })
    es.addEventListener('cell_error', e => {
      const { model, error: msg } = JSON.parse((e as MessageEvent).data) as { model: string; error: string }
      setResults(prev => {
        if (!prev.has(model)) return prev
        const next = new Map(prev)
        next.set(model, { ...next.get(model)!, status: 'error', error: msg })
        return next
      })
    })
    es.addEventListener('run_done', () => es.close())
    es.onerror = () => es.close()
  }

  async function handleRun() {
    setError(null)
    setVote(null)
    setExpandedCol(null)

    const activeModels = effectiveMode === 0
      ? [...selectedModels]
      : filledPairs.map(p => p.model)
    if (!activeModels.length || (effectiveMode === 0 && !prompt.trim())) return

    currentPromptRef.current = prompt.trim()

    const req = effectiveMode === 0
      ? { prompts: [prompt.trim()], models: activeModels }
      : { pairs: filledPairs }

    try {
      const { runId } = await benchmarkApi.start(req)
      const initial = new Map<string, UIResult>(activeModels.map(key => [key, {
        text: '', ttfs: null, totalTime: null,
        inputTokens: null, outputTokens: null, status: 'pending',
      }]))
      setResults(initial)
      setScreenState('running')
      esRef.current?.close()
      const es = new EventSource(`/api/benchmark/stream/${runId}`)
      esRef.current = es
      wireSSE(es)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run')
    }
  }

  async function handleRegenerate(modelKey: string) {
    const savedPrompt = currentPromptRef.current
    setResults(prev => {
      const next = new Map(prev)
      next.set(modelKey, { text: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null, status: 'pending' })
      return next
    })
    setScreenState('running')
    try {
      const { runId } = await benchmarkApi.start({ prompts: [savedPrompt], models: [modelKey] })
      regenEsRef.current?.close()
      const es = new EventSource(`/api/benchmark/stream/${runId}`)
      regenEsRef.current = es
      wireSSE(es)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
    }
  }

  async function handleCopy(modelKey: string) {
    const r = results.get(modelKey)
    if (!r) return
    await navigator.clipboard.writeText(r.text).catch(() => {})
    setCopiedCol(modelKey)
    setTimeout(() => setCopiedCol(prev => prev === modelKey ? null : prev), 1200)
  }

  // renderColumn is a function call (not JSX component) — no remount problem
  function renderColumn(key: string) {
    const r = results.get(key)
    if (!r) return null
    const label = key.split(':').slice(1).join(':')
    const isStreaming = r.status === 'streaming'
    const isDone = r.status === 'done'
    const isError = r.status === 'error'
    const isFastest = isDone && r.ttfs !== null && minTtfs !== null && r.ttfs === minTtfs

    const dotBg = isDone ? 'var(--success)' : isError ? 'var(--error)' : isStreaming ? 'var(--accent)' : 'var(--border-hover)'

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 10,
      }}>
        <div style={{
          height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
          borderBottom: '0.5px solid var(--border)', background: 'var(--bg-base)', flexShrink: 0,
        }}>
          <span className={isStreaming ? 'bp' : undefined} style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: dotBg }} />
          <span style={{ flex: 1, fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-bright)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
          <button onClick={() => handleRegenerate(key)} title="Regenerate" className="nr-head-btn">↺</button>
          <button onClick={() => handleCopy(key)} title="Copy" className="nr-head-btn">{copiedCol === key ? '✓' : '⧉'}</button>
          <button onClick={() => setExpandedCol(expandedCol === key ? null : key)} title="Expand" className="nr-head-btn">⤢</button>
        </div>

        <div style={{ height: 32, display: 'flex', borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
          {[
            { l: 'TTFS', v: r.ttfs !== null ? `${r.ttfs}ms` : '—', best: isFastest },
            { l: 'TOTAL', v: r.totalTime !== null ? `${(r.totalTime / 1000).toFixed(1)}s` : '—', best: false },
            { l: 'IN / OUT', v: r.inputTokens !== null ? `${r.inputTokens} / ${r.outputTokens}` : '—', best: false },
          ].map(({ l, v, best }, i) => (
            <div key={l} style={{ flex: 1, padding: '0 10px', borderRight: i < 2 ? '0.5px solid var(--border)' : 'none', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-sans)', marginBottom: 1 }}>{l}</div>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: best ? 'var(--accent)' : v === '—' ? 'var(--border-hover)' : 'var(--text-secondary)' }}>{v}</div>
            </div>
          ))}
        </div>

        {isError ? (
          <div style={{ flex: 1, padding: 12, overflowY: 'auto' }}>
            <div style={{
              background: 'var(--error-bg)', border: '0.5px solid var(--border)', borderRadius: 6,
              padding: '10px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--error)',
            }}>
              {r.error ?? 'Error'}
            </div>
          </div>
        ) : (
          <div
            className="col-body"
            style={{ flex: 1, overflowY: 'auto', padding: 12, fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {r.text || (r.status === 'pending' && <span style={{ color: 'var(--border-hover)' }}>Waiting…</span>)}
            {isStreaming && <span className="bb" style={{ color: 'var(--accent)' }}>▋</span>}
          </div>
        )}
      </div>
    )
  }

  const promptboxProps: Omit<PromptboxProps, 'simplified'> = {
    mode,
    onModeChange: setMode,
    selectedCount: selectedModels.size,
    selectedModels: [...selectedModels],
    prompt,
    onPromptChange: setPrompt,
    perModelPrompts,
    onPerModelPromptChange: (key, v) => setPerModelPrompts(prev => ({ ...prev, [key]: v })),
    callCount,
    isRunning: screenState === 'running',
    onRun: handleRun,
  }

  const chipsRowProps: Omit<ChipsRowProps, 'wrap'> = {
    models: connectedModels,
    selectedModels,
    onToggle: toggleModel,
    onAdd: () => navigate('/providers'),
  }

  // ─── Idle state ───────────────────────────────────────────────────────────

  if (screenState === 'idle') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
        <style>{ANIM_CSS}</style>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16, padding: '24px',
        }}>
          <div style={{ fontSize: 24, color: 'var(--text-primary)', fontWeight: 400, letterSpacing: -0.4, textAlign: 'center' }}>
            What would you like to benchmark?
          </div>
          <ChipsRow {...chipsRowProps} wrap />
          <div style={{ width: '100%', maxWidth: 640 }}>
            <Promptbox {...promptboxProps} simplified={false} />
          </div>
          {error && <div style={{ fontSize: 12, color: 'var(--error)', maxWidth: 640, textAlign: 'center' }}>{error}</div>}
        </div>
      </div>
    )
  }

  // ─── Active state ─────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: 16, gap: 12 }}>
      <style>{ANIM_CSS}</style>

      {expandedCol && results.has(expandedCol) && (
        <div
          style={{
            position: 'fixed', top: 20, left: 20, right: 20, bottom: 20, zIndex: 200,
            background: 'var(--bg-elevated)', border: '0.5px solid var(--accent)',
            borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}
          onClick={e => { if (e.target === e.currentTarget) setExpandedCol(null) }}
        >
          {renderColumn(expandedCol)}
        </div>
      )}

      <div style={{
        flex: 1, minHeight: 0, display: 'grid', gap: 10,
        gridTemplateColumns: `repeat(${activeRunModels.length || 1}, minmax(0, 1fr))`,
        overflow: 'hidden',
      }}>
        {activeRunModels.map(key => (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {renderColumn(key)}
          </div>
        ))}
      </div>

      {screenState === 'done' && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'nowrap', flexShrink: 0, overflowX: 'auto' }}>
          {activeRunModels.map(key => {
            const label = key.split(':').slice(1).join(':')
            const selected = vote === key
            return (
              <button
                key={key}
                onClick={() => setVote(selected ? null : key)}
                style={{
                  flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px',
                  background: selected ? 'var(--accent-bg)' : 'transparent',
                  border: `0.5px solid ${selected ? 'var(--accent-dim)' : 'var(--border)'}`,
                  borderRadius: 7,
                  color: selected ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer',
                }}
              >
                👍 {label} is better
              </button>
            )
          })}
          {(['both-good', 'both-bad'] as const).map(id => {
            const isGood = id === 'both-good'
            const selected = vote === id
            return (
              <button
                key={id}
                onClick={() => setVote(selected ? null : id)}
                style={{
                  flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px',
                  background: selected ? (isGood ? 'var(--success-bg)' : 'var(--error-bg)') : 'transparent',
                  border: `0.5px solid ${selected ? (isGood ? 'var(--success)' : 'var(--error)') : 'var(--border)'}`,
                  borderRadius: 7,
                  color: selected ? (isGood ? 'var(--success)' : 'var(--error)') : 'var(--text-muted)',
                  fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer',
                }}
              >
                {isGood ? '✓ both good' : '✕ both bad'}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ChipsRow {...chipsRowProps} wrap={false} />
        <Promptbox {...promptboxProps} simplified />
        {error && <div style={{ fontSize: 12, color: 'var(--error)', textAlign: 'center' }}>{error}</div>}
      </div>
    </div>
  )
}
