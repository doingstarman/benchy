import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { providersApi, benchmarkApi, runsApi } from '../api'
import { extractHtmlArtifact } from '../lib/artifact'
import { ArtifactPreview } from '../components/ArtifactPreview'
import { SliderField } from '../components/SliderField'
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

interface Turn {
  promptIndex: number
  prompt: string
  // false only for a "prompt per model" initial turn, where there's no single
  // shared prompt text to show as a chat bubble — every continuation turn is
  // always a shared prompt, so this is only ever false on turn 0.
  showPromptBubble: boolean
  results: Map<string, UIResult>
}

function pendingResults(models: string[]): Map<string, UIResult> {
  return new Map(models.map(key => [key, {
    text: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null, status: 'pending',
  }]))
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
  onToggleAll: () => void
  onAdd: () => void
  wrap: boolean
}

export function ChipsRow({ models, selectedModels, onToggle, onToggleAll, onAdd, wrap }: ChipsRowProps) {
  const allSelected = models.length > 0 && models.every(m => selectedModels.has(m.key))
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
      {models.length > 1 && (
        <button
          onClick={onToggleAll}
          title={allSelected ? 'Deselect all models' : 'Select all models'}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            padding: '5px 11px',
            border: `0.5px solid ${allSelected ? 'var(--accent-dim)' : 'var(--border)'}`,
            borderRadius: 20,
            background: allSelected ? 'var(--accent-bg)' : 'var(--bg-elevated)',
            cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)',
            color: allSelected ? 'var(--accent)' : 'var(--text-secondary)',
          }}
        >
          {allSelected ? '✓ all' : 'all'}
        </button>
      )}
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

// 0: one prompt → all models · 1: prompt per model · 2: many prompts → all models
type PromptMode = 0 | 1 | 2

interface PromptboxProps {
  simplified: boolean
  mode: PromptMode
  onModeChange: (m: PromptMode) => void
  selectedCount: number
  selectedModels: string[]
  prompt: string
  onPromptChange: (v: string) => void
  perModelPrompts: Record<string, string>
  onPerModelPromptChange: (key: string, v: string) => void
  batchPrompts: string[]
  onBatchPromptsChange: (prompts: string[]) => void
  // Rendered inside the box in multi-prompt mode — the "send to" model picker
  // moves in here and the external chips row is hidden.
  modelsSlot?: React.ReactNode
  callCount: number
  isRunning: boolean
  onRun: () => void
  onStop: () => void
  runSettings: RunSettings
  onRunSettingsChange: (rs: RunSettings) => void
  providerDefaultsByModel: Record<string, RunSettingsOverrides>
}

export function Promptbox({
  simplified, mode, onModeChange, selectedCount, selectedModels,
  prompt, onPromptChange, perModelPrompts, onPerModelPromptChange,
  batchPrompts, onBatchPromptsChange, modelsSlot,
  callCount, isRunning, onRun, onStop,
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

  function overrideSlider(
    key: keyof RunSettingsOverrides,
    label: string,
    opts: { min: number; max: number; step: number; unit?: string; allowAuto?: boolean; toStore?: (n: number) => number; fromStore?: (n: number) => number },
  ) {
    const isSet = key in currentTabOverrides && currentTabOverrides[key] != null
    const storedVal = isSet ? currentTabOverrides[key] as number : null
    const displayVal = storedVal != null && opts.fromStore ? opts.fromStore(storedVal) : storedVal
    const inheritedRaw = currentTabInherited[key as keyof typeof currentTabInherited] as number | null
    const inheritedDisplay = inheritedRaw != null && opts.fromStore ? opts.fromStore(inheritedRaw) : inheritedRaw

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SliderField
            label={label}
            min={opts.min}
            max={opts.max}
            step={opts.step}
            unit={opts.unit}
            allowAuto={opts.allowAuto}
            accent={isSet}
            value={isSet ? displayVal : inheritedDisplay}
            onChange={v => {
              const stored = v == null ? null : (opts.toStore ? opts.toStore(v) : v)
              updateTabOverrides({ ...currentTabOverrides, [key]: stored })
            }}
          />
        </div>
        {/* Slot is always reserved so rows don't reflow when an override appears */}
        <button
          onClick={() => resetOverride(key)}
          title="Reset to inherited"
          style={{
            visibility: isSet ? 'visible' : 'hidden',
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0,
          }}
        >
          ↺
        </button>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: 28, rowGap: 12 }}>
              {overrideSlider('temperature', 'Temperature', { min: 0, max: 2, step: 0.1 })}
              {overrideSlider('topP', 'Top P', { min: 0, max: 1, step: 0.05 })}
              {overrideSlider('topK', 'Top K', { min: 1, max: 100, step: 1, allowAuto: true })}
              {overrideSlider('maxOutputTokens', 'Max tokens', { min: 1, max: 32000, step: 64 })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Reliability</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: 28, rowGap: 12 }}>
              {overrideSlider('timeoutMs', 'Timeout', {
                min: 1, max: 120, step: 1, unit: 's',
                toStore: n => n * 1000,
                fromStore: n => Math.round(n / 1000),
              })}
              {overrideSlider('retries', 'Retries', { min: 0, max: 10, step: 1 })}
            </div>
          </div>
        </div>
      )}

      <div style={{ borderRadius: 10, overflow: 'hidden' }}>
      {!simplified && (
        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
          {(['one prompt → all models', 'prompt per model', 'many prompts → all models'] as const).map((label, i, arr) => (
            <button
              key={i}
              onClick={() => onModeChange(i as PromptMode)}
              style={{
                flex: 1, padding: '9px 14px', fontSize: 11, fontFamily: 'var(--font-mono)',
                cursor: 'pointer', textAlign: 'left', background: 'none', border: 'none',
                borderRight: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none',
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
      ) : !simplified && mode === 2 ? (
        <div>
          {batchPrompts.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', borderBottom: '0.5px solid var(--border)' }}>
              <div style={{ padding: '10px 0 0 14px', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0, width: 26 }}>
                {i + 1}
              </div>
              <textarea
                className="nr-ta"
                value={p}
                onChange={e => onBatchPromptsChange(batchPrompts.map((bp, bi) => bi === i ? e.target.value : bp))}
                placeholder={`Prompt ${i + 1}…`}
                rows={2}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)', resize: 'none', lineHeight: 1.65, padding: '8px 8px 10px 0' }}
              />
              {batchPrompts.length > 1 && (
                <button
                  onClick={() => onBatchPromptsChange(batchPrompts.filter((_, bi) => bi !== i))}
                  title="Remove prompt"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: '10px 14px 0 4px', lineHeight: 1 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => onBatchPromptsChange([...batchPrompts, ''])}
            style={{
              margin: '8px 14px', padding: '4px 10px',
              background: 'none', border: '0.5px dashed var(--border)', borderRadius: 6,
              fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            + add prompt
          </button>
          {modelsSlot && (
            <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px 2px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                Send to
              </span>
              {modelsSlot}
            </div>
          )}
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
        {isRunning ? (
          <button
            onClick={onStop}
            title="Stop run"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, border: 'none', borderRadius: 7,
              background: 'var(--accent)', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <span style={{ width: 10, height: 10, background: '#fff', borderRadius: 2 }} />
          </button>
        ) : (
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
            ▶ run
          </button>
        )}
      </div>
      </div>
    </div>
  )
}

// ─── NewRun ───────────────────────────────────────────────────────────────

// Module-scoped (not component-scoped) on purpose: React Router unmounts
// this component when you navigate to another page, which would otherwise
// wipe all state. Living here means the conversation survives navigating
// away and back, and only resets on an actual page reload (fresh module
// evaluation), matching "clear only on refresh."
interface SavedSession {
  screenState: ScreenState
  turns: Turn[]
  sessionModels: string[]
  runId: string | null
  selectedModels: Set<string>
  mode: PromptMode
  prompt: string
  perModelPrompts: Record<string, string>
  batchPrompts: string[]
  runSettings: RunSettings
  vote: string | null
  previewCells: Set<string>
}

let savedSession: SavedSession | null = null

// Exposed for tests only — in a real page load this module only ever
// re-initializes on an actual reload, but a test file imports it once and
// renders <NewRun/> many times, so tests must reset the module-level state
// themselves between cases.
export function __resetNewRunSessionForTests(): void {
  savedSession = null
}

// Whether a conversation is in progress on /run — lets the app shell offer a
// way back to it when the user has navigated elsewhere.
export function hasActiveNewRunSession(): boolean {
  return savedSession != null && savedSession.turns.length > 0
}

// The run currently open on /run — lets the sidebar highlight it in the
// recent-dialogs list.
export function getActiveNewRunRunId(): string | null {
  return savedSession?.runId ?? null
}

// Sidebar listens for this to refresh its recent-dialogs list without polling.
export const RUNS_CHANGED_EVENT = 'benchy:runs-changed'
function notifyRunsChanged() {
  window.dispatchEvent(new Event(RUNS_CHANGED_EVENT))
}

export function NewRun() {
  const navigate = useNavigate()
  const location = useLocation()

  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(() => savedSession?.selectedModels ?? new Set())
  const [mode, setMode] = useState<PromptMode>(() => savedSession?.mode ?? 0)
  const [prompt, setPrompt] = useState(() => savedSession?.prompt ?? '')
  const [perModelPrompts, setPerModelPrompts] = useState<Record<string, string>>(() => savedSession?.perModelPrompts ?? {})
  const [batchPrompts, setBatchPrompts] = useState<string[]>(() => savedSession?.batchPrompts ?? [''])

  const [runSettings, setRunSettings] = useState<RunSettings>(() => savedSession?.runSettings ?? {})

  const [screenState, setScreenState] = useState<ScreenState>(() => savedSession?.screenState ?? 'idle')
  const [turns, setTurns] = useState<Turn[]>(() => savedSession?.turns ?? [])
  const [sessionModels, setSessionModels] = useState<string[]>(() => savedSession?.sessionModels ?? [])
  const [runId, setRunId] = useState<string | null>(() => savedSession?.runId ?? null)
  const [vote, setVote] = useState<string | null>(() => savedSession?.vote ?? null)
  // expandedCol / copiedCol / previewNonce / previewCells are keyed by `${promptIndex}:${modelKey}`
  const [expandedCol, setExpandedCol] = useState<string | null>(null)
  const [copiedCol, setCopiedCol] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewCells, setPreviewCells] = useState<Set<string>>(() => savedSession?.previewCells ?? new Set())
  const [previewNonce, setPreviewNonce] = useState<Record<string, number>>({})

  const esRef = useRef<EventSource | null>(null)
  const regenEsRef = useRef<EventSource | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    savedSession = {
      screenState, turns, sessionModels, runId, selectedModels,
      mode, prompt, perModelPrompts, batchPrompts, runSettings, vote, previewCells,
    }
  })

  // Streams are tied to this component instance's closures — don't let them
  // keep writing into a stale instance after navigating away.
  useEffect(() => () => {
    esRef.current?.close()
    regenEsRef.current?.close()
  }, [])

  // Opening a past dialog from the sidebar: /run?session=<runId> rebuilds the
  // whole conversation from the stored run and makes it the active session.
  useEffect(() => {
    const sessionId = new URLSearchParams(location.search).get('session')
    if (!sessionId) return
    navigate('/run', { replace: true })
    if (sessionId === runId) return
    runsApi.get(sessionId).then(run => {
      const restored: Turn[] = run.prompts.map((p, i) => ({
        promptIndex: i,
        prompt: p,
        showPromptBubble: true,
        results: new Map(run.results.filter(res => res.promptIndex === i).map(res => [res.model, {
          text: res.text,
          ttfs: res.metrics.ttfs,
          totalTime: res.metrics.totalTime,
          inputTokens: res.metrics.inputTokens,
          outputTokens: res.metrics.outputTokens,
          status: (res.error ? 'error' : 'done') as UIResult['status'],
          ...(res.error ? { error: res.error } : {}),
        }])),
      }))
      esRef.current?.close()
      regenEsRef.current?.close()
      setTurns(restored)
      setSessionModels(run.models)
      setRunId(run.id)
      setScreenState('done')
      setVote(null)
      setExpandedCol(null)
      setPreviewCells(new Set())
      setError(null)
    }).catch(() => setError('Failed to load dialog'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

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
    // Batch runs stream several turns concurrently, so "run finished" means
    // every cell in every turn has settled — not just the last turn's.
    const all = turns.flatMap(t => [...t.results.values()])
    if (all.length > 0 && all.every(r => r.status === 'done' || r.status === 'error')) {
      setScreenState('done')
    }
  }, [turns, screenState])

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [turns.length])

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

  function toggleAllModels() {
    const allKeys = connectedModels.map(m => m.key)
    setSelectedModels(prev =>
      // All already selected → collapse back to the minimum (first model),
      // mirroring the "at least one stays selected" rule of toggleModel.
      prev.size === allKeys.length ? new Set(allKeys.slice(0, 1)) : new Set(allKeys)
    )
  }

  const filledPairs = [...selectedModels]
    .filter(k => perModelPrompts[k]?.trim())
    .map(k => ({ prompt: perModelPrompts[k].trim(), model: k }))

  const filledBatchPrompts = batchPrompts.map(p => p.trim()).filter(Boolean)

  const effectiveMode = screenState === 'idle' ? mode : 0
  const callCount = effectiveMode === 0
    ? (prompt.trim() ? selectedModels.size : 0)
    : effectiveMode === 1
      ? filledPairs.length
      : filledBatchPrompts.length * selectedModels.size

  function updateTurnResult(promptIndex: number, model: string, updater: (r: UIResult) => UIResult) {
    setTurns(prev => prev.map(turn => {
      if (turn.promptIndex !== promptIndex || !turn.results.has(model)) return turn
      const next = new Map(turn.results)
      next.set(model, updater(next.get(model)!))
      return { ...turn, results: next }
    }))
  }

  function wireSSE(es: EventSource) {
    es.addEventListener('cell_start', e => {
      const { promptIndex, model } = JSON.parse((e as MessageEvent).data) as { promptIndex: number; model: string }
      updateTurnResult(promptIndex, model, r => ({ ...r, status: 'streaming' }))
    })
    es.addEventListener('cell_token', e => {
      const { promptIndex, model, text } = JSON.parse((e as MessageEvent).data) as { promptIndex: number; model: string; text: string }
      updateTurnResult(promptIndex, model, r => ({ ...r, text: r.text + text, status: 'streaming' }))
    })
    es.addEventListener('cell_done', e => {
      const { promptIndex, model, ttfs, totalTime, usage } = JSON.parse((e as MessageEvent).data) as {
        promptIndex: number; model: string; ttfs: number; totalTime: number
        usage: { inputTokens: number; outputTokens: number }
      }
      updateTurnResult(promptIndex, model, r => ({
        ...r, status: 'done', ttfs, totalTime,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      }))
    })
    es.addEventListener('cell_error', e => {
      const { promptIndex, model, error: msg } = JSON.parse((e as MessageEvent).data) as { promptIndex: number; model: string; error: string }
      updateTurnResult(promptIndex, model, r => ({ ...r, status: 'error', error: msg }))
    })
    es.addEventListener('run_done', () => es.close())
    es.onerror = () => es.close()
  }

  async function handleRun() {
    setError(null)
    setVote(null)
    setExpandedCol(null)

    const activeModels = effectiveMode === 1
      ? filledPairs.map(p => p.model)
      : [...selectedModels]
    if (!activeModels.length) return
    if (effectiveMode === 0 && !prompt.trim()) return
    if (effectiveMode === 2 && filledBatchPrompts.length === 0) return

    const sharedPrompt = prompt.trim()

    const hasGlobal = Object.values(runSettings.global ?? {}).some(v => v != null)
    const hasPerModel = Object.values(runSettings.perModel ?? {}).some(m => Object.values(m).some(v => v != null))
    const effectiveRunSettings = (hasGlobal || hasPerModel) ? runSettings : undefined

    const req = effectiveMode === 0
      ? { prompts: [sharedPrompt], models: activeModels, runSettings: effectiveRunSettings }
      : effectiveMode === 1
        ? { pairs: filledPairs, runSettings: effectiveRunSettings }
        : { prompts: filledBatchPrompts, models: activeModels, runSettings: effectiveRunSettings }

    try {
      const { runId: newRunId } = await benchmarkApi.start(req)
      // Batch prompts land as one turn per prompt — the backend already keys
      // each prompt by its own promptIndex, so SSE events route themselves.
      const initialTurns: Turn[] = effectiveMode === 2
        ? filledBatchPrompts.map((p, i) => ({
            promptIndex: i,
            prompt: p,
            showPromptBubble: true,
            results: pendingResults(activeModels),
          }))
        : [{
            promptIndex: 0,
            prompt: sharedPrompt,
            showPromptBubble: effectiveMode === 0,
            results: pendingResults(activeModels),
          }]
      setTurns(initialTurns)
      setSessionModels(activeModels)
      setRunId(newRunId)
      setScreenState('running')
      notifyRunsChanged()
      if (effectiveMode === 0) setPrompt('')
      else if (effectiveMode === 1) setPerModelPrompts({})
      else setBatchPrompts([''])
      esRef.current?.close()
      const es = new EventSource(`/api/benchmark/stream/${newRunId}`)
      esRef.current = es
      wireSSE(es)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run')
    }
  }

  // Client-side stop: close the streams and freeze cells with whatever text
  // has arrived. The server finishes its calls in the background (there's no
  // abort endpoint) — we just stop listening.
  function handleStop() {
    esRef.current?.close()
    regenEsRef.current?.close()
    setTurns(prev => prev.map(turn => {
      const hasLive = [...turn.results.values()].some(r => r.status === 'pending' || r.status === 'streaming')
      if (!hasLive) return turn
      const next = new Map(turn.results)
      for (const [k, r] of next) {
        if (r.status === 'pending' || r.status === 'streaming') next.set(k, { ...r, status: 'done' })
      }
      return { ...turn, results: next }
    }))
    setScreenState('done')
  }

  async function handleContinue() {
    if (!runId) return
    const trimmed = prompt.trim()
    if (!trimmed) return

    setError(null)
    setVote(null)
    setExpandedCol(null)

    const hasGlobal = Object.values(runSettings.global ?? {}).some(v => v != null)
    const hasPerModel = Object.values(runSettings.perModel ?? {}).some(m => Object.values(m).some(v => v != null))
    const effectiveRunSettings = (hasGlobal || hasPerModel) ? runSettings : undefined
    const newPromptIndex = turns.length

    setTurns(prev => [...prev, {
      promptIndex: newPromptIndex,
      prompt: trimmed,
      showPromptBubble: true,
      results: pendingResults(sessionModels),
    }])
    setScreenState('running')
    setPrompt('')

    try {
      await benchmarkApi.continue(runId, trimmed, effectiveRunSettings)
      esRef.current?.close()
      const es = new EventSource(`/api/benchmark/stream/${runId}`)
      esRef.current = es
      wireSSE(es)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue')
    }
  }

  async function handleRegenerate(promptIndex: number, modelKey: string) {
    const turn = turns.find(t => t.promptIndex === promptIndex)
    if (!turn) return
    const savedPrompt = turn.prompt
    setTurns(prev => prev.map(t => t.promptIndex !== promptIndex ? t : {
      ...t,
      results: new Map(t.results).set(modelKey, { text: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null, status: 'pending' }),
    }))
    try {
      const { runId: regenRunId } = await benchmarkApi.start({ prompts: [savedPrompt], models: [modelKey] })
      regenEsRef.current?.close()
      const es = new EventSource(`/api/benchmark/stream/${regenRunId}`)
      regenEsRef.current = es
      // Regenerate results land on a throwaway run with its own promptIndex 0 —
      // remap it onto this turn's promptIndex so wireSSE finds the right cell.
      es.addEventListener('cell_start', e => {
        const { model } = JSON.parse((e as MessageEvent).data) as { model: string }
        updateTurnResult(promptIndex, model, r => ({ ...r, status: 'streaming' }))
      })
      es.addEventListener('cell_token', e => {
        const { model, text } = JSON.parse((e as MessageEvent).data) as { model: string; text: string }
        updateTurnResult(promptIndex, model, r => ({ ...r, text: r.text + text, status: 'streaming' }))
      })
      es.addEventListener('cell_done', e => {
        const { model, ttfs, totalTime, usage } = JSON.parse((e as MessageEvent).data) as {
          model: string; ttfs: number; totalTime: number
          usage: { inputTokens: number; outputTokens: number }
        }
        updateTurnResult(promptIndex, model, r => ({
          ...r, status: 'done', ttfs, totalTime,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        }))
      })
      es.addEventListener('cell_error', e => {
        const { model, error: msg } = JSON.parse((e as MessageEvent).data) as { model: string; error: string }
        updateTurnResult(promptIndex, model, r => ({ ...r, status: 'error', error: msg }))
      })
      es.addEventListener('run_done', () => es.close())
      es.onerror = () => es.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
    }
  }

  async function handleCopy(cellKey: string, text: string) {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopiedCol(cellKey)
    setTimeout(() => setCopiedCol(prev => prev === cellKey ? null : prev), 1200)
  }

  function handleCloseColumn(promptIndex: number, modelKey: string) {
    setTurns(prev => prev.map(t => {
      if (t.promptIndex !== promptIndex || !t.results.has(modelKey)) return t
      const next = new Map(t.results)
      next.delete(modelKey)
      return { ...t, results: next }
    }))
    const cellKey = `${promptIndex}:${modelKey}`
    setExpandedCol(prev => prev === cellKey ? null : prev)
  }

  function handleRestartPreview(cellKey: string) {
    setPreviewNonce(prev => ({ ...prev, [cellKey]: (prev[cellKey] ?? 0) + 1 }))
  }

  function togglePreviewCell(cellKey: string) {
    setPreviewCells(prev => {
      const next = new Set(prev)
      next.has(cellKey) ? next.delete(cellKey) : next.add(cellKey)
      return next
    })
  }

  // renderCell is a function call (not JSX component) — no remount problem
  function renderCell(turn: Turn, key: string, isExpanded = false) {
    const r = turn.results.get(key)
    if (!r) return null
    const cellKey = `${turn.promptIndex}:${key}`
    const label = key.split(':').slice(1).join(':')
    const isStreaming = r.status === 'streaming'
    const isDone = r.status === 'done'
    const isError = r.status === 'error'
    const turnTtfs = [...turn.results.values()].map(x => x.ttfs).filter((t): t is number => t !== null)
    const minTtfs = turnTtfs.length > 1 ? Math.min(...turnTtfs) : null
    const isFastest = isDone && r.ttfs !== null && minTtfs !== null && r.ttfs === minTtfs
    const artifactHtml = isDone ? extractHtmlArtifact(r.text) : null
    const showPreview = previewCells.has(cellKey) && artifactHtml != null

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
          <button onClick={() => handleRegenerate(turn.promptIndex, key)} title="Regenerate" className="nr-head-btn">↺</button>
          <button onClick={() => handleCopy(cellKey, r.text)} title="Copy" className="nr-head-btn">{copiedCol === cellKey ? '✓' : '⧉'}</button>
          {artifactHtml && (
            <button
              onClick={() => togglePreviewCell(cellKey)}
              title={showPreview ? 'Show text' : 'Show preview'}
              className="nr-head-btn"
              style={showPreview ? { background: 'var(--accent-bg)', borderColor: 'var(--accent-dim)', color: 'var(--accent)' } : undefined}
            >
              {showPreview ? '📝' : '🖼'}
            </button>
          )}
          {showPreview && (
            <button onClick={() => handleRestartPreview(cellKey)} title="Restart preview" className="nr-head-btn">▶</button>
          )}
          {isExpanded ? (
            <button onClick={() => setExpandedCol(null)} title="Collapse" className="nr-head-btn">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                <path d="M14 2L9.5 6.5M9.5 6.5V3.5M9.5 6.5h3" />
                <path d="M2 14l4.5-4.5M6.5 9.5v3M6.5 9.5h-3" />
              </svg>
            </button>
          ) : (
            <>
              <button onClick={() => setExpandedCol(cellKey)} title="Expand" className="nr-head-btn">⤢</button>
              <button onClick={() => handleCloseColumn(turn.promptIndex, key)} title="Close" className="nr-head-btn">✕</button>
            </>
          )}
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
          <ArtifactPreview html={artifactHtml} reloadKey={previewNonce[cellKey] ?? 0} />
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

  // Build per-model provider defaults map
  const providerDefaultsByModel: Record<string, RunSettingsOverrides> = {}
  for (const modelKey of [...selectedModels]) {
    const providerId = modelKey.split(':')[0]
    const provider = providers.find(p => p.id === providerId)
    if (provider?.defaults) providerDefaultsByModel[modelKey] = provider.defaults
  }

  const chipsRowProps: Omit<ChipsRowProps, 'wrap'> = {
    models: connectedModels,
    selectedModels,
    onToggle: toggleModel,
    onToggleAll: toggleAllModels,
    onAdd: () => navigate('/providers'),
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
    batchPrompts,
    onBatchPromptsChange: setBatchPrompts,
    modelsSlot: <ChipsRow {...chipsRowProps} wrap={false} />,
    callCount,
    isRunning: screenState === 'running',
    onRun: handleRun,
    onStop: handleStop,
    runSettings,
    onRunSettingsChange: setRunSettings,
    providerDefaultsByModel,
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
          {mode !== 2 && <ChipsRow {...chipsRowProps} wrap />}
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

      {expandedCol && (() => {
        const [expandedPromptIndex, expandedModel] = [expandedCol.slice(0, expandedCol.indexOf(':')), expandedCol.slice(expandedCol.indexOf(':') + 1)]
        const expandedTurn = turns.find(t => t.promptIndex === Number(expandedPromptIndex))
        if (!expandedTurn || !expandedTurn.results.has(expandedModel)) return null
        return (
          <div
            style={{
              position: 'fixed', top: 20, left: 20, right: 20, bottom: 20, zIndex: 200,
              background: 'var(--bg-elevated)', border: '0.5px solid var(--accent)',
              borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}
            onClick={e => { if (e.target === e.currentTarget) setExpandedCol(null) }}
          >
            {renderCell(expandedTurn, expandedModel, true)}
          </div>
        )
      })()}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {turns.map(turn => (
          <div key={turn.promptIndex} style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            {turn.showPromptBubble && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  maxWidth: '70%', background: 'var(--accent-bg)', border: '0.5px solid var(--accent-dim)',
                  borderRadius: 10, padding: '8px 14px', fontSize: 13, color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {turn.prompt}
                </div>
              </div>
            )}
            <div style={{
              minHeight: 360, display: 'grid', gap: 10,
              gridTemplateColumns: `repeat(${sessionModels.length || 1}, minmax(0, 1fr))`,
            }}>
              {sessionModels.map(key => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                  {renderCell(turn, key)}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {screenState === 'done' && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'nowrap', flexShrink: 0, overflowX: 'auto' }}>
          {sessionModels.map(key => {
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
        <Promptbox {...promptboxProps} onRun={handleContinue} simplified />
        {error && <div style={{ fontSize: 12, color: 'var(--error)', textAlign: 'center' }}>{error}</div>}
      </div>
    </div>
  )
}
