import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { providersApi, benchmarkApi } from '../api'
import { extractHtmlArtifact } from '../lib/artifact'
import { ArtifactPreview } from '../components/ArtifactPreview'
import type { Provider, RunSettings, RunSettingsOverrides } from '../../../src/types'

const RUN_DEFAULTS: Required<RunSettingsOverrides> = {
  temperature: 0.7,
  topP: 1.0,
  topK: null,
  maxOutputTokens: 2048,
  contextBudget: null,
  truncation: 'auto',
  timeoutMs: 60000,
  retries: 2,
  streaming: true,
}

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
  .settings-tab { background: none; border: 0.5px solid transparent; border-radius: 5px; padding: 3px 8px; font-size: 11px; font-family: var(--font-mono); cursor: pointer; color: var(--text-muted); white-space: nowrap; max-width: 100px; overflow: hidden; text-overflow: ellipsis; }
  .settings-tab:hover { color: var(--text-secondary); border-color: var(--border); }
  .settings-tab.active { color: var(--accent); background: var(--accent-bg); border-color: var(--accent-dim); }
`

// ─── ChipsRow ─────────────────────────────────────────────────────────────

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
  runSettings: RunSettings
  onRunSettingsChange: (rs: RunSettings) => void
  providerDefaultsByModel: Record<string, RunSettingsOverrides>
}

export function Promptbox({
  simplified, mode, onModeChange, selectedCount, selectedModels,
  prompt, onPromptChange, perModelPrompts, onPerModelPromptChange,
  callCount, isRunning, onRun,
  runSettings, onRunSettingsChange, providerDefaultsByModel,
}: PromptboxProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('all')
  const settingsRef = useRef<HTMLDivElement>(null)
  const disabled = callCount === 0 || isRunning

  // Clamp active tab to valid options
  const validTab = activeTab === 'all' || selectedModels.includes(activeTab) ? activeTab : 'all'

  // Count overrides per tab for badge display
  const globalCount = Object.values(runSettings.global ?? {}).filter(v => v != null).length
  const perModelCounts: Record<string, number> = {}
  for (const [mk, ov] of Object.entries(runSettings.perModel ?? {})) {
    perModelCounts[mk] = Object.values(ov).filter(v => v != null).length
  }
  const activeCount = globalCount + Object.values(perModelCounts).reduce((s, n) => s + n, 0)

  // Current tab's overrides and inherited base
  const currentTabOverrides: RunSettingsOverrides = validTab === 'all'
    ? (runSettings.global ?? {})
    : (runSettings.perModel?.[validTab] ?? {})

  const currentTabInherited: RunSettingsOverrides = validTab === 'all'
    ? RUN_DEFAULTS
    : { ...RUN_DEFAULTS, ...(providerDefaultsByModel[validTab] ?? {}), ...(runSettings.global ?? {}) }

  function updateTabOverrides(o: RunSettingsOverrides) {
    if (validTab === 'all') {
      onRunSettingsChange({ ...runSettings, global: o })
    } else {
      onRunSettingsChange({
        ...runSettings,
        perModel: { ...(runSettings.perModel ?? {}), [validTab]: o },
      })
    }
  }

  function resetOverride(key: keyof RunSettingsOverrides) {
    const next = { ...currentTabOverrides }
    delete next[key]
    updateTabOverrides(next)
  }

  function resetAllOverrides() {
    onRunSettingsChange({})
  }

  useEffect(() => {
    if (!settingsOpen) return
    function onDown(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [settingsOpen])

  function numField(
    key: keyof RunSettingsOverrides,
    label: string,
    displayFn: (v: RunSettingsOverrides[keyof RunSettingsOverrides]) => string,
    inputProps: { min?: number; max?: number; step?: number; placeholder?: string; toStore?: (n: number) => number; fromStore?: (n: number) => number },
  ) {
    const isSet = key in currentTabOverrides && currentTabOverrides[key] != null
    const storedVal = isSet ? currentTabOverrides[key] as number : null
    const displayVal = storedVal != null && inputProps.fromStore ? inputProps.fromStore(storedVal) : storedVal
    const inheritedVal = currentTabInherited[key as keyof typeof currentTabInherited]

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        {isSet ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input
              type="number" min={inputProps.min} max={inputProps.max} step={inputProps.step ?? 1}
              placeholder={inputProps.placeholder}
              value={displayVal ?? ''}
              onChange={e => {
                if (e.target.value === '') { resetOverride(key); return }
                const n = Number(e.target.value)
                updateTabOverrides({ ...currentTabOverrides, [key]: inputProps.toStore ? inputProps.toStore(n) : n })
              }}
              style={{ width: 64, background: 'var(--bg-base)', border: '0.5px solid var(--accent-dim)', borderRadius: 5, padding: '4px 6px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', outline: 'none' }}
            />
            <button onClick={() => resetOverride(key)} title="Reset" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>↺</button>
          </div>
        ) : (
          <button
            onClick={() => updateTabOverrides({ ...currentTabOverrides, [key]: inheritedVal as number })}
            style={{ textAlign: 'left', background: 'none', border: '0.5px solid var(--border)', borderRadius: 5, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', width: 64 }}
          >
            {displayFn(inheritedVal)}
          </button>
        )}
      </div>
    )
  }

  const showTabs = selectedModels.length > 1 || Object.keys(runSettings.perModel ?? {}).length > 0

  return (
    <div style={{ position: 'relative', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'visible', flexShrink: 0 }}>

      {/* Settings popover */}
      {settingsOpen && (
        <div ref={settingsRef} style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0,
          background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
          borderRadius: 10, padding: '14px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)', zIndex: 50,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>Run settings</span>
            {activeCount > 0 && (
              <button onClick={resetAllOverrides} style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                reset all
              </button>
            )}
          </div>

          {/* Model tabs */}
          {showTabs && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button
                className={`settings-tab${validTab === 'all' ? ' active' : ''}`}
                onClick={() => setActiveTab('all')}
              >
                All models{globalCount > 0 ? ` · ${globalCount}` : ''}
              </button>
              {selectedModels.map(modelKey => {
                const label = modelKey.split(':').slice(1).join(':')
                const cnt = perModelCounts[modelKey] ?? 0
                return (
                  <button
                    key={modelKey}
                    className={`settings-tab${validTab === modelKey ? ' active' : ''}`}
                    onClick={() => setActiveTab(modelKey)}
                    title={label}
                  >
                    {label}{cnt > 0 ? ` · ${cnt}` : ''}
                  </button>
                )
              })}
            </div>
          )}

          {/* Inherited note for per-model tabs */}
          {validTab !== 'all' && globalCount > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: -8 }}>
              ↑ inherits {globalCount} global override{globalCount !== 1 ? 's' : ''}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Generation</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {numField('temperature', 'Temp', v => String(v ?? 0.7), { min: 0, max: 2, step: 0.1 })}
              {numField('topP', 'Top P', v => String(v ?? 1.0), { min: 0, max: 1, step: 0.05 })}
              {numField('topK', 'Top K', v => v != null ? String(v) : 'Auto', { min: 1, step: 1, placeholder: 'Auto' })}
              {numField('maxOutputTokens', 'Max tokens', v => String(v ?? 2048), { min: 1, step: 1 })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Reliability</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {numField('timeoutMs', 'Timeout (s)', v => v != null ? `${Math.round((v as number) / 1000)}s` : '60s', {
                min: 1, max: 600, step: 1,
                toStore: n => n * 1000,
                fromStore: n => Math.round(n / 1000),
              })}
              {numField('retries', 'Retries', v => String(v ?? 2), { min: 0, max: 10, step: 1 })}
            </div>
          </div>
        </div>
      )}

      <div style={{ borderRadius: 10, overflow: 'hidden' }}>
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
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!disabled) onRun()
              }
            }}
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
        <button
          onClick={() => setSettingsOpen(v => !v)}
          title="Run settings"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: settingsOpen || activeCount > 0 ? 'var(--accent-bg)' : 'none',
            border: settingsOpen || activeCount > 0 ? '0.5px solid var(--accent-dim)' : '0.5px solid transparent',
            borderRadius: 6, padding: '3px 6px', cursor: 'pointer', gap: 4,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ display: 'block' }}>
            <line x1="2" y1="4" x2="14" y2="4" stroke={activeCount > 0 ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth="1.2" strokeLinecap="round"/>
            <circle cx="5" cy="4" r="1.5" fill={activeCount > 0 ? 'var(--accent)' : 'var(--text-muted)'}/>
            <line x1="2" y1="8" x2="14" y2="8" stroke={activeCount > 0 ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth="1.2" strokeLinecap="round"/>
            <circle cx="10" cy="8" r="1.5" fill={activeCount > 0 ? 'var(--accent)' : 'var(--text-muted)'}/>
            <line x1="2" y1="12" x2="14" y2="12" stroke={activeCount > 0 ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth="1.2" strokeLinecap="round"/>
            <circle cx="6" cy="12" r="1.5" fill={activeCount > 0 ? 'var(--accent)' : 'var(--text-muted)'}/>
          </svg>
          {activeCount > 0 && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{activeCount}</span>
          )}
        </button>
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

  const [runSettings, setRunSettings] = useState<RunSettings>({})

  const [screenState, setScreenState] = useState<ScreenState>('idle')
  const [results, setResults] = useState<Map<string, UIResult>>(new Map())
  const [vote, setVote] = useState<string | null>(null)
  const [expandedCol, setExpandedCol] = useState<string | null>(null)
  const [copiedCol, setCopiedCol] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [previewNonce, setPreviewNonce] = useState<Record<string, number>>({})

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

    const hasGlobal = Object.values(runSettings.global ?? {}).some(v => v != null)
    const hasPerModel = Object.values(runSettings.perModel ?? {}).some(m => Object.values(m).some(v => v != null))
    const effectiveRunSettings = (hasGlobal || hasPerModel) ? runSettings : undefined

    const req = effectiveMode === 0
      ? { prompts: [prompt.trim()], models: activeModels, runSettings: effectiveRunSettings }
      : { pairs: filledPairs, runSettings: effectiveRunSettings }

    try {
      const { runId } = await benchmarkApi.start(req)
      const initial = new Map<string, UIResult>(activeModels.map(key => [key, {
        text: '', ttfs: null, totalTime: null,
        inputTokens: null, outputTokens: null, status: 'pending',
      }]))
      setResults(initial)
      setScreenState('running')
      if (effectiveMode === 0) setPrompt('')
      else setPerModelPrompts({})
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

  function handleCloseColumn(modelKey: string) {
    setResults(prev => {
      if (!prev.has(modelKey)) return prev
      const next = new Map(prev)
      next.delete(modelKey)
      return next
    })
    setExpandedCol(prev => prev === modelKey ? null : prev)
    setVote(prev => prev === modelKey ? null : prev)
  }

  function handleRestartPreview(modelKey: string) {
    setPreviewNonce(prev => ({ ...prev, [modelKey]: (prev[modelKey] ?? 0) + 1 }))
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
    const artifactHtml = isDone ? extractHtmlArtifact(r.text) : null
    const showPreview = previewMode && isDone

    const dotBg = isDone ? 'var(--success)' : isError ? 'var(--error)' : isStreaming ? 'var(--accent)' : 'var(--border-hover)'

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: '1 1 auto', minHeight: 0,
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
          {showPreview && artifactHtml && (
            <button onClick={() => handleRestartPreview(key)} title="Restart preview" className="nr-head-btn">▶</button>
          )}
          <button onClick={() => setExpandedCol(expandedCol === key ? null : key)} title="Expand" className="nr-head-btn">⤢</button>
          <button onClick={() => handleCloseColumn(key)} title="Close" className="nr-head-btn">✕</button>
        </div>

        <div style={{ height: 38, display: 'flex', borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
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
        ) : showPreview && artifactHtml ? (
          <ArtifactPreview html={artifactHtml} reloadKey={previewNonce[key] ?? 0} />
        ) : (
          <div
            className="col-body"
            style={{ flex: 1, overflowY: 'auto', padding: 12, fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {showPreview && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>No HTML artifact detected — showing text</div>
            )}
            {r.text || (r.status === 'pending' && <span style={{ color: 'var(--border-hover)' }}>Waiting…</span>)}
            {isStreaming && <span className="bb" style={{ color: 'var(--accent)' }}>▋</span>}
          </div>
        )}
      </div>
    )
  }

  // Build per-model provider defaults map
  const providerDefaultsByModel: Record<string, RunSettingsOverrides> = {}
  for (const modelKey of [...selectedModels]) {
    const providerId = modelKey.split(':')[0]
    const provider = providers.find(p => p.id === providerId)
    if (provider?.defaults) providerDefaultsByModel[modelKey] = provider.defaults
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
    runSettings,
    onRunSettingsChange: setRunSettings,
    providerDefaultsByModel,
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>View:</span>
        <button
          onClick={() => setPreviewMode(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: previewMode ? 'var(--accent)' : 'var(--bg-base)',
            border: '0.5px solid var(--border)', borderRadius: 20,
            padding: '4px 10px', cursor: 'pointer',
            fontSize: 12, fontFamily: 'var(--font-mono)',
            color: previewMode ? '#fff' : 'var(--text-muted)',
            transition: 'background 0.15s',
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: previewMode ? '#fff' : 'var(--text-muted)' }} />
          {previewMode ? 'Preview' : 'Text'}
        </button>
      </div>

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
