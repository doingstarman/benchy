import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { providersApi, benchmarkApi, runsApi, uploadsApi } from '../api'
import { splitFencedSegments } from '../lib/artifact'
import { CodeBlock } from '../components/CodeBlock'
import { SliderField } from '../components/SliderField'
import { Button, IconButton, PillToggle } from '../components/ui'
import {
  IconRefresh, IconCopy, IconCheck, IconExpand, IconCollapse, IconClose,
  IconPlay, IconStop, IconPaperclip, IconPencil, IconFile, IconChevron,
} from '../components/icons'
import { ActivityTrace, ActivityTraceStyles } from '../components/ActivityTrace'
import { useShowReasoning } from '../prefs'
import { useT, t } from '../i18n'
import type { Provider, RunSettings, RunSettingsOverrides, AttachmentMeta, RunKind, Run } from '../../../src/types'

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
  extendedThinking: false,
}

interface UIResult {
  text: string
  reasoning: string
  ttfs: number | null
  totalTime: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  reasoningMs: number | null
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
  attachments?: AttachmentMeta[]
}

// Shared chip/thumbnail strip for attachments — used both in the promptbox
// (pending, removable) and in the user bubble (read-only, clickable).
// The question above a batch column. Deliberately NOT a chat bubble: these
// prompts were never addressed to each other, and dressing them as a dialogue
// is what made the whole mode read wrong.
interface BatchPromptHeaderProps {
  turn: Turn
  index: number
  editing: string | null
  busy: boolean
  copied: boolean
  onEditStart: () => void
  onEditChange: (v: string) => void
  onEditCancel: () => void
  onEditSend: () => void
  onCopy: () => void
}

function BatchPromptHeader({
  turn, index, editing, busy, copied,
  onEditStart, onEditChange, onEditCancel, onEditSend, onCopy,
}: BatchPromptHeaderProps) {
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
      borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1,
        }}>
          {t('run.promptLabel', { n: index + 1 })}
        </span>
        <IconButton title={t('title.copyMessage')} onClick={onCopy} style={{ width: 20, height: 20, border: 'none' }}>
          {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
        </IconButton>
        <IconButton
          title={t('title.editMessage')}
          onClick={onEditStart}
          disabled={busy}
          style={{ width: 20, height: 20, border: 'none', opacity: busy ? 0.4 : undefined }}
        >
          <IconPencil size={10} />
        </IconButton>
      </div>

      {editing !== null ? (
        <>
          <textarea
            autoFocus
            value={editing}
            onChange={e => onEditChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSend() }
              if (e.key === 'Escape') onEditCancel()
            }}
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)',
              border: '0.5px solid var(--accent-dim)', borderRadius: 6, padding: '6px 8px',
              fontSize: 13, color: 'var(--text-primary)', outline: 'none', resize: 'vertical', lineHeight: 1.55,
            }}
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', flex: 1 }}>
              {t('run.editHintBatch')}
            </span>
            <Button small onClick={onEditCancel}>{t('common.cancel')}</Button>
            <Button variant="primary" small onClick={onEditSend}>{t('common.send')}</Button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {turn.attachments && turn.attachments.length > 0 && (
            <div style={{ marginBottom: turn.prompt ? 8 : 0 }}>
              <AttachmentStrip attachments={turn.attachments} />
            </div>
          )}
          {turn.prompt}
        </div>
      )}
    </div>
  )
}

function AttachmentStrip({ attachments, onRemove }: { attachments: AttachmentMeta[]; onRemove?: (id: string) => void }) {
  if (attachments.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {attachments.map(a => (
        <div
          key={a.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-base)', padding: 4, maxWidth: 220,
          }}
        >
          {a.mimeType.startsWith('image/') ? (
            <a href={uploadsApi.url(a.id)} target="_blank" rel="noreferrer" style={{ display: 'flex' }}>
              <img
                src={uploadsApi.url(a.id)}
                alt={a.name}
                style={{ height: 44, maxWidth: 88, objectFit: 'cover', borderRadius: 4, display: 'block' }}
              />
            </a>
          ) : (
            <a href={uploadsApi.url(a.id)} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', padding: '0 2px' }}>
              <IconFile size={14} />
              <span style={{ fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                {a.name}
              </span>
            </a>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(a.id)}
              title={t('title.remove')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}
            >
              <IconClose size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── MetricsStrip ─────────────────────────────────────────────────────────
//
// Three headline numbers stay on screen; the rest live one click away. TTFS
// deliberately still means "time to first ANSWER token" — a thinking model's
// TTFS therefore includes its think time, and THINK TIME is what splits that
// number apart.
function MetricsStrip({ result: r, isFastest }: { result: UIResult; isFastest: boolean }) {
  const [open, setOpen] = useState(false)
  const { t } = useT()

  const headline = [
    { l: 'TTFS', v: r.ttfs !== null ? `${r.ttfs}ms` : '—', best: isFastest },
    { l: 'TOTAL', v: r.totalTime !== null ? `${(r.totalTime / 1000).toFixed(1)}s` : '—', best: false },
    { l: 'IN / OUT', v: r.inputTokens !== null ? `${r.inputTokens} / ${r.outputTokens}` : '—', best: false },
  ]
  const extra = [
    { l: 'THINK', v: r.reasoningTokens != null ? `${r.reasoningTokens}` : '—' },
    { l: 'THINK TIME', v: r.reasoningMs != null ? `${(r.reasoningMs / 1000).toFixed(1)}s` : '—' },
  ]

  const cell = (l: string, v: string, best: boolean, last: boolean) => (
    <div key={l} style={{ flex: 1, padding: '0 10px', borderRight: last ? 'none' : '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-sans)', marginBottom: 1 }}>{l}</div>
      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: best ? 'var(--accent)' : v === '—' ? 'var(--border-hover)' : 'var(--text-secondary)' }}>{v}</div>
    </div>
  )

  return (
    <div style={{ borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
      <div style={{ height: 38, display: 'flex' }}>
        {headline.map(({ l, v, best }) => cell(l, v, best, false))}
        <button
          onClick={() => setOpen(o => !o)}
          title={open ? t('common.collapse') : t('metrics.more')}
          style={{
            width: 28, flexShrink: 0, background: 'none', border: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: open ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          <IconChevron open={open} size={11} />
        </button>
      </div>
      {open && (
        <div style={{ height: 38, display: 'flex', borderTop: '0.5px solid var(--border)' }}>
          {extra.map(({ l, v }, i) => cell(l, v, false, i === extra.length - 1))}
          <div style={{ width: 28, flexShrink: 0 }} />
        </div>
      )}
    </div>
  )
}

function pendingResults(models: string[]): Map<string, UIResult> {
  return new Map(models.map(key => [key, {
    text: '', reasoning: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null,
    reasoningTokens: null, reasoningMs: null, status: 'pending',
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
  .settings-tab { background: none; border: 0.5px solid transparent; border-radius: 5px; padding: 3px 8px; font-size: 11px; font-family: var(--font-mono); cursor: pointer; color: var(--text-muted); white-space: nowrap; max-width: 100px; overflow: hidden; text-overflow: ellipsis; }
  .settings-tab:hover { color: var(--text-secondary); border-color: var(--border); }
  .settings-tab.active { color: var(--accent); background: var(--accent-bg); border-color: var(--accent-dim); }
`

// ─── ChipsRow ─────────────────────────────────────────────────────────────

export interface ProviderGroup {
  id: string
  name: string
  models: { key: string; label: string }[]
  // Enabled, has models, but no key and no base URL — nothing here is runnable
  // yet. One chip that routes to Providers, never one dead chip per model.
  needsKey: boolean
}

interface ChipsRowProps {
  groups: ProviderGroup[]
  selectedModels: Set<string>
  onToggle: (key: string) => void
  onToggleProvider: (id: string) => void
  onAdd: () => void
  wrap: boolean
}

const POPOVER_W = 280
// Below this a search field costs more attention than it saves.
const SEARCH_FROM = 8

// One chip per provider, not per model. The two jobs — "what am I about to run?"
// and "pick from everything I have" — look identical at three models and fall
// apart at nineteen (six rows of chips) or at OpenRouter's three hundred. The
// chip answers the first at a glance; its popover answers the second.
export function ChipsRow({ groups, selectedModels, onToggle, onToggleProvider, onAdd, wrap }: ChipsRowProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [anchorLeft, setAnchorLeft] = useState(0)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const open = groups.find(g => g.id === openId) ?? null

  useEffect(() => {
    if (!openId) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpenId(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openId])

  function onChipClick(g: ProviderGroup, el: HTMLElement) {
    if (g.needsKey) { onAdd(); return }
    if (openId === g.id) { setOpenId(null); return }
    const wrapEl = wrapRef.current
    if (wrapEl) {
      const raw = el.getBoundingClientRect().left - wrapEl.getBoundingClientRect().left
      setAnchorLeft(Math.max(0, Math.min(raw, wrapEl.clientWidth - POPOVER_W)))
    }
    setQuery('')
    setOpenId(g.id)
  }

  const q = query.trim().toLowerCase()
  const shown = open ? open.models.filter(m => !q || m.label.toLowerCase().includes(q)) : []
  const openAllSelected = !!open && open.models.length > 0 && open.models.every(m => selectedModels.has(m.key))

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...(wrap ? { maxWidth: 640 } : { minWidth: 0 }) }}>
      <div
        className="chips-row"
        style={{
          display: 'flex',
          flexWrap: wrap ? 'wrap' : 'nowrap',
          gap: 6,
          overflowX: wrap ? 'visible' : 'auto',
          scrollbarWidth: 'none',
          ...(wrap ? { justifyContent: 'center' } : {}),
        }}
      >
        {groups.map(g => {
          const count = g.models.filter(m => selectedModels.has(m.key)).length
          const active = count > 0
          return (
            <button
              key={g.id}
              onClick={e => onChipClick(g, e.currentTarget)}
              title={g.needsKey ? t('run.needsKeyHint') : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                padding: '5px 11px',
                border: g.needsKey
                  ? '0.5px dashed var(--border)'
                  : `0.5px solid ${active ? 'var(--accent-dim)' : 'var(--border)'}`,
                borderRadius: 20,
                background: g.needsKey ? 'transparent' : active ? 'var(--accent-bg)' : 'var(--bg-elevated)',
                cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)',
                color: g.needsKey ? 'var(--border-hover)' : active ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {g.needsKey
                ? <span style={{ flexShrink: 0, fontSize: 10 }}>🔑</span>
                : <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: active ? 'var(--accent)' : 'var(--border-hover)' }} />}
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
              {g.needsKey
                ? <span style={{ fontSize: 10, opacity: 0.8 }}>· {t('run.needsKey')}</span>
                : g.models.length > 1 && (
                  <span style={{ fontSize: 11, opacity: 0.75, flexShrink: 0 }}>{count}/{g.models.length}</span>
                )}
            </button>
          )
        })}
        {groups.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{t('run.noProviders')}</span>
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

      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: anchorLeft, marginTop: 6, width: POPOVER_W, zIndex: 30,
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)', padding: 8, textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {open.name}
            </span>
            {open.models.length > 1 && (
              <button
                onClick={() => onToggleProvider(open.id)}
                style={{
                  background: 'none', border: 0, padding: 0, cursor: 'pointer', flexShrink: 0,
                  fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)',
                }}
              >
                {openAllSelected ? t('run.clearAll') : t('run.selectAll')}
              </button>
            )}
          </div>
          {open.models.length > SEARCH_FROM && (
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('run.searchModels')}
              autoFocus
              style={{
                width: '100%', marginBottom: 6, padding: '5px 8px', boxSizing: 'border-box',
                background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)', outline: 'none',
              }}
            />
          )}
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {shown.map(m => {
              const on = selectedModels.has(m.key)
              return (
                <button
                  key={m.key}
                  onClick={() => onToggle(m.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    padding: '5px 6px', border: 0, borderRadius: 'var(--radius-sm)',
                    background: on ? 'var(--accent-bg)' : 'transparent', cursor: 'pointer',
                    fontSize: 12, fontFamily: 'var(--font-mono)',
                    color: on ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  <span
                    style={{
                      width: 12, height: 12, flexShrink: 0, borderRadius: 3, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 9, lineHeight: 1,
                      border: `0.5px solid ${on ? 'var(--accent)' : 'var(--border-hover)'}`,
                      background: on ? 'var(--accent)' : 'transparent',
                      color: 'var(--bg-base)',
                    }}
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                </button>
              )
            })}
            {shown.length === 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '5px 6px' }}>
                {t('run.noMatch')}
              </span>
            )}
          </div>
        </div>
      )}
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
  // In a batch, the follow-up box adds another independent prompt — it is not a
  // reply to anything, and must not invite the user to treat it as one.
  isBatch?: boolean
  // Attachments — only offered in single-prompt flows (mode 0 and follow-ups)
  pendingAttachments: AttachmentMeta[]
  uploading: boolean
  onFilesPicked: (files: File[]) => void
  onRemoveAttachment: (id: string) => void
}

export function Promptbox({
  simplified, mode, onModeChange, selectedCount, selectedModels,
  prompt, onPromptChange, perModelPrompts, onPerModelPromptChange,
  batchPrompts, onBatchPromptsChange, modelsSlot,
  callCount, isRunning, onRun, onStop,
  runSettings, onRunSettingsChange, providerDefaultsByModel,
  isBatch,
  pendingAttachments, uploading, onFilesPicked, onRemoveAttachment,
}: PromptboxProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('all')
  const [dragOver, setDragOver] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachEnabled = simplified || mode === 0
  const disabled = callCount === 0 || isRunning || uploading

  function handlePaste(e: React.ClipboardEvent) {
    if (!attachEnabled) return
    const images = [...e.clipboardData.items]
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((f): f is File => f != null)
    if (images.length) onFilesPicked(images)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (!attachEnabled) return
    const files = [...e.dataTransfer.files]
    if (files.length) onFilesPicked(files)
  }

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

  // Boolean twin of overrideSlider: same set / inherited / reset semantics, so a
  // per-model tab can turn thinking on for one model without touching the rest.
  function overrideToggle(key: keyof RunSettingsOverrides, label: string, hint: string) {
    const isSet = key in currentTabOverrides && currentTabOverrides[key] != null
    const inherited = currentTabInherited[key as keyof typeof currentTabInherited] === true
    const on = isSet ? currentTabOverrides[key] === true : inherited

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <PillToggle
            on={on}
            onToggle={() => updateTabOverrides({ ...currentTabOverrides, [key]: !on })}
            labelOn={label}
            labelOff={label}
            title={hint}
          />
          <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 0 }}>{hint}</span>
        </div>
        <button
          onClick={() => resetOverride(key)}
          title={t('title.resetInherited')}
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
          title={t('title.resetInherited')}
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
    <div
      onDragOver={e => { if (attachEnabled) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        position: 'relative', background: 'var(--bg-elevated)', borderRadius: 10, overflow: 'visible', flexShrink: 0,
        border: `0.5px solid ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
        transition: 'border-color 0.15s',
      }}
    >

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
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>{t('run.runSettings')}</span>
            {activeCount > 0 && (
              <button onClick={resetAllOverrides} style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                {t('run.resetAll')}
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
                {t('run.allModelsTab')}{globalCount > 0 ? ` · ${globalCount}` : ''}
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
              {t('run.inheritsGlobal', { n: globalCount })}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{t('providers.generation')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: 28, rowGap: 12 }}>
              {overrideSlider('temperature', 'Temperature', { min: 0, max: 2, step: 0.1 })}
              {overrideSlider('topP', 'Top P', { min: 0, max: 1, step: 0.05 })}
              {overrideSlider('topK', 'Top K', { min: 1, max: 100, step: 1, allowAuto: true })}
              {overrideSlider('maxOutputTokens', 'Max tokens', { min: 1, max: 32000, step: 64 })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{t('run.reasoningSection')}</div>
            {overrideToggle('extendedThinking', t('run.extendedThinking'), t('run.extendedThinkingHint'))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{t('providers.reliability')}</div>
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
          {([0, 1, 2] as const).map(i => (
            <button
              key={i}
              onClick={() => onModeChange(i as PromptMode)}
              style={{
                flex: 1, padding: '9px 14px', fontSize: 11, fontFamily: 'var(--font-mono)',
                cursor: 'pointer', textAlign: 'left', background: 'none', border: 'none',
                borderRight: i < 2 ? '0.5px solid var(--border)' : 'none',
                borderBottom: mode === i ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                marginBottom: -0.5,
                color: mode === i ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {t(`run.mode${i}`)}
            </button>
          ))}
          <div style={{ padding: '9px 14px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
            {t('run.selected', { n: selectedCount })}
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
                placeholder={t('run.promptForModel', { model: key.split(':').slice(1).join(':') })}
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
                placeholder={t('run.promptN', { n: i + 1 })}
                rows={2}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)', resize: 'none', lineHeight: 1.65, padding: '8px 8px 10px 0' }}
              />
              {batchPrompts.length > 1 && (
                <button
                  onClick={() => onBatchPromptsChange(batchPrompts.filter((_, bi) => bi !== i))}
                  title={t('title.removePrompt')}
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
            {t('run.addPrompt')}
          </button>
          {modelsSlot && (
            <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px 2px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                {t('run.sendTo')}
              </span>
              {modelsSlot}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '12px 14px 0' }}>
          {attachEnabled && pendingAttachments.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <AttachmentStrip attachments={pendingAttachments} onRemove={onRemoveAttachment} />
            </div>
          )}
          <textarea
            className="nr-ta"
            value={prompt}
            onChange={e => onPromptChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!disabled) onRun()
              }
            }}
            placeholder={simplified ? (isBatch ? t('run.addAnotherPrompt') : t('run.followup')) : t('run.ask')}
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              fontSize: 14, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)',
              resize: 'none', lineHeight: 1.65, minHeight: 48, maxHeight: 120, overflowY: 'auto',
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 8 }}>
        {attachEnabled ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.gif,.pdf"
              style={{ display: 'none' }}
              onChange={e => {
                if (e.target.files?.length) onFilesPicked([...e.target.files])
                e.target.value = ''
              }}
            />
            <IconButton onClick={() => fileInputRef.current?.click()} title={t('title.attach')}>
              {uploading ? <span className="ui-spinner" /> : <IconPaperclip size={14} />}
            </IconButton>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)', display: 'flex', opacity: 0.4 }} title={t('title.attachSingle')}><IconPaperclip size={15} /></span>
        )}
        <button
          onClick={() => setSettingsOpen(v => !v)}
          title={t('title.runSettings')}
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
            <span style={{ color: 'var(--accent)' }}>{callCount}</span> {t('run.callsWord')}
          </span>
        )}
        {isRunning ? (
          <button
            onClick={onStop}
            title={t('title.stopRun')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, border: 'none', borderRadius: 7,
              background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <IconStop size={12} />
          </button>
        ) : (
          <Button variant="primary" onClick={onRun} disabled={disabled}>
            <IconPlay size={11} /> {t('run.run')}
          </Button>
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
  runKind: RunKind
  runId: string | null
  selectedModels: Set<string>
  mode: PromptMode
  prompt: string
  perModelPrompts: Record<string, string>
  batchPrompts: string[]
  runSettings: RunSettings
  vote: string | null
  pendingAttachments: AttachmentMeta[]
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
  const { t } = useT()
  const showReasoning = useShowReasoning()
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
  // What this run's prompts mean. A batch is a set of independent questions, so
  // it must not be laid out — or continued — as a conversation.
  const [runKind, setRunKind] = useState<RunKind>(() => savedSession?.runKind ?? 'chat')
  const [runId, setRunId] = useState<string | null>(() => savedSession?.runId ?? null)
  const [vote, setVote] = useState<string | null>(() => savedSession?.vote ?? null)
  // expandedCol / copiedCol are keyed by `${promptIndex}:${modelKey}`
  const [expandedCol, setExpandedCol] = useState<string | null>(null)
  const [copiedCol, setCopiedCol] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Inline edit of a past user message: which turn and the draft text
  const [editingTurn, setEditingTurn] = useState<{ promptIndex: number; value: string } | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentMeta[]>(() => savedSession?.pendingAttachments ?? [])
  const [uploading, setUploading] = useState(false)

  const esRef = useRef<EventSource | null>(null)
  const regenEsRef = useRef<EventSource | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    savedSession = {
      screenState, turns, sessionModels, runKind, runId, selectedModels,
      mode, prompt, perModelPrompts, batchPrompts, runSettings, vote, pendingAttachments,
    }
  })

  async function handleFilesPicked(files: File[]) {
    setError(null)
    setUploading(true)
    try {
      for (const file of files) {
        const meta = await uploadsApi.upload(file)
        setPendingAttachments(prev => [...prev, meta])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function handleRemoveAttachment(id: string) {
    setPendingAttachments(prev => prev.filter(a => a.id !== id))
    // Drop the still-unbound file server-side too, so removing a chip doesn't
    // leak it on disk until the startup sweep.
    void uploadsApi.remove(id).catch(() => {})
  }

  // Streams are tied to this component instance's closures — don't let them
  // keep writing into a stale instance after navigating away.
  useEffect(() => () => {
    esRef.current?.close()
    regenEsRef.current?.close()
  }, [])

  // History's "fork": load a past run back into the composer, laid out the way
  // it was built, so it can be tweaked and run again. Nothing is sent until the
  // user hits Run — forking is not itself a run.
  useEffect(() => {
    const forkFrom = (location.state as { forkFrom?: Run } | null)?.forkFrom
    if (!forkFrom) return
    navigate('/run', { replace: true, state: null })

    esRef.current?.close()
    regenEsRef.current?.close()
    setTurns([])
    setSessionModels([])
    setRunId(null)
    setScreenState('idle')
    setVote(null)
    setExpandedCol(null)
    setEditingTurn(null)
    setError(null)
    setPendingAttachments([])

    const kind = forkFrom.kind ?? 'chat'
    setSelectedModels(new Set(forkFrom.models))
    setRunKind(kind)
    // Each kind lives in its own composer: pairs pins a prompt to each model,
    // a batch is a prompt list, a chat starts from its opening message.
    if (kind === 'pairs') {
      setMode(1)
      setPerModelPrompts(Object.fromEntries(forkFrom.models.map((m, i) => [m, forkFrom.prompts[i] ?? ''])))
      setPrompt('')
      setBatchPrompts([''])
    } else if (kind === 'batch') {
      setMode(2)
      setBatchPrompts(forkFrom.prompts.length ? forkFrom.prompts : [''])
      setPrompt('')
      setPerModelPrompts({})
    } else {
      setMode(0)
      setPrompt(forkFrom.prompts[0] ?? '')
      setBatchPrompts([''])
      setPerModelPrompts({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  // /run?new=1 (the sidebar's Тест item) drops the current session and starts
  // a fresh dialog; model selection and mode are preferences and survive.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('new')) return
    navigate('/run', { replace: true })
    esRef.current?.close()
    regenEsRef.current?.close()
    setTurns([])
    setSessionModels([])
    setRunId(null)
    setScreenState('idle')
    setPrompt('')
    setPerModelPrompts({})
    setBatchPrompts([''])
    setVote(null)
    setExpandedCol(null)
    setEditingTurn(null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

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
        ...(run.attachments?.some(a => a.promptIndex === i)
          ? { attachments: run.attachments.filter(a => a.promptIndex === i).map(({ promptIndex: _, ...meta }) => meta) }
          : {}),
        results: new Map(run.results.filter(res => res.promptIndex === i).map(res => [res.model, {
          text: res.text,
          reasoning: res.reasoning ?? '',
          ttfs: res.metrics.ttfs,
          totalTime: res.metrics.totalTime,
          inputTokens: res.metrics.inputTokens,
          outputTokens: res.metrics.outputTokens,
          reasoningTokens: res.metrics.reasoningTokens,
          reasoningMs: res.metrics.reasoningMs,
          status: (res.error ? 'error' : 'done') as UIResult['status'],
          ...(res.error ? { error: res.error } : {}),
        }])),
      }))
      esRef.current?.close()
      regenEsRef.current?.close()
      setTurns(restored)
      setSessionModels(run.models)
      setRunKind(run.kind ?? 'chat')
      setRunId(run.id)
      setScreenState('done')
      setVote(null)
      setExpandedCol(null)
      setEditingTurn(null)
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

  const providerGroups: ProviderGroup[] = providers
    .filter(p => p.enabled && p.models.length > 0)
    .map(p => ({
      id: p.id,
      name: p.name,
      needsKey: !p.apiKey && !p.baseUrl,
      models: p.models.map(m => ({ key: `${p.id}:${m}`, label: m })),
    }))

  function toggleModel(key: string) {
    setSelectedModels(prev => {
      if (prev.has(key) && prev.size === 1) return prev
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleProviderModels(id: string) {
    const keys = providerGroups.find(g => g.id === id)?.models.map(m => m.key) ?? []
    setSelectedModels(prev => {
      const next = new Set(prev)
      if (keys.every(k => prev.has(k))) {
        for (const k of keys) next.delete(k)
        // Same "at least one stays selected" rule as toggleModel — clearing the
        // only provider must not leave the Run button permanently dead.
        if (next.size === 0 && keys.length > 0) next.add(keys[0])
      } else for (const k of keys) next.add(k)
      return next
    })
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

  // Both live streams need identical cell handling and differ only in which turn
  // an event belongs to: the run's own stream trusts the event, while the
  // throwaway regenerate run always reports promptIndex 0 and must be remapped
  // onto the visible turn. These used to be two hand-copied blocks, so every new
  // event had to be remembered twice — and whatever was forgotten went missing
  // on regenerate only, which is the kind of bug nobody reports.
  function wireCellEvents(es: EventSource, indexOf: (eventIndex: number) => number) {
    const on = <T,>(type: string, fn: (data: T & { promptIndex: number; model: string }) => void) =>
      es.addEventListener(type, e => {
        const data = JSON.parse((e as MessageEvent).data) as T & { promptIndex: number; model: string }
        fn(data)
      })

    on('cell_start', ({ promptIndex, model }) =>
      updateTurnResult(indexOf(promptIndex), model, r => ({ ...r, status: 'streaming' })))

    on<{ text: string }>('cell_token', ({ promptIndex, model, text }) =>
      updateTurnResult(indexOf(promptIndex), model, r => ({ ...r, text: r.text + text, status: 'streaming' })))

    on<{ text: string }>('cell_reasoning', ({ promptIndex, model, text }) =>
      updateTurnResult(indexOf(promptIndex), model, r => ({ ...r, reasoning: r.reasoning + text, status: 'streaming' })))

    on<{ ttfs: number; totalTime: number; reasoningMs: number | null; usage: { inputTokens: number; outputTokens: number; reasoningTokens?: number } }>(
      'cell_done',
      ({ promptIndex, model, ttfs, totalTime, reasoningMs, usage }) =>
        updateTurnResult(indexOf(promptIndex), model, r => ({
          ...r, status: 'done', ttfs, totalTime, reasoningMs,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens ?? null,
        })),
    )

    on<{ error: string }>('cell_error', ({ promptIndex, model, error: msg }) =>
      updateTurnResult(indexOf(promptIndex), model, r => ({ ...r, status: 'error', error: msg })))
  }

  function wireSSE(es: EventSource) {
    wireCellEvents(es, i => i)
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

    const turnAttachments = effectiveMode === 0 && pendingAttachments.length ? pendingAttachments : undefined
    const req = effectiveMode === 0
      ? { prompts: [sharedPrompt], models: activeModels, runSettings: effectiveRunSettings, attachments: turnAttachments?.map(a => a.id) }
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
            ...(turnAttachments ? { attachments: turnAttachments } : {}),
          }]
      setTurns(initialTurns)
      setSessionModels(activeModels)
      // Mirrors the server's derivation from the request shape.
      setRunKind(effectiveMode === 1 ? 'pairs' : (effectiveMode === 2 && filledBatchPrompts.length > 1) ? 'batch' : 'chat')
      setRunId(newRunId)
      setScreenState('running')
      notifyRunsChanged()
      if (effectiveMode === 0) { setPrompt(''); setPendingAttachments([]) }
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

    const turnAttachments = pendingAttachments.length ? pendingAttachments : undefined
    setTurns(prev => [...prev, {
      promptIndex: newPromptIndex,
      prompt: trimmed,
      showPromptBubble: true,
      results: pendingResults(sessionModels),
      ...(turnAttachments ? { attachments: turnAttachments } : {}),
    }])
    setScreenState('running')
    setPrompt('')
    setPendingAttachments([])

    try {
      await benchmarkApi.continue(runId, trimmed, effectiveRunSettings, turnAttachments?.map(a => a.id))
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
      results: new Map(t.results).set(modelKey, { text: '', reasoning: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null, reasoningTokens: null, reasoningMs: null, status: 'pending' }),
    }))
    try {
      // Carry the turn's attachments onto the throwaway regenerate run so a
      // vision cell re-runs with its image instead of a blank prompt.
      const cloneAttachmentsFrom = runId && turn.attachments?.length ? { runId, promptIndex } : undefined
      const { runId: regenRunId } = await benchmarkApi.start({ prompts: [savedPrompt], models: [modelKey], cloneAttachmentsFrom })
      regenEsRef.current?.close()
      const es = new EventSource(`/api/benchmark/stream/${regenRunId}`)
      regenEsRef.current = es
      // Regenerate results land on a throwaway run with its own promptIndex 0 —
      // ignore it and pin every event to the turn being regenerated.
      wireCellEvents(es, () => promptIndex)
      // The regenerate run is a throwaway — its tokens are already remapped onto
      // the visible turn. Reap it on clean completion (row + any cloned
      // attachment files, via the delete cascade) so repeated regeneration
      // doesn't leak runs and disk. Only on run_done: on a transient onerror the
      // run may still be completing server-side, so deleting it then would drop
      // in-flight results.
      es.addEventListener('run_done', () => {
        es.close()
        void runsApi.remove(regenRunId).then(() => notifyRunsChanged()).catch(() => {})
      })
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

  // Closing a column drops the model from the whole session, not from one turn.
  //
  // It used to delete a single cell, which was wrong three ways over: the grid
  // still reserved a track for it so the space stayed empty, the very next
  // follow-up rebuilt cells from sessionModels and brought the model straight
  // back, and the server — which fans out over run.models and was never told —
  // kept calling it on every turn for the rest of the session. You paid for
  // answers you had explicitly closed and never saw.
  function handleCloseColumn(modelKey: string) {
    // Closing the last column would leave a chat with nothing in it and no way
    // to get anything back.
    if (sessionModels.length <= 1) return

    const remaining = sessionModels.filter(k => k !== modelKey)
    setSessionModels(remaining)
    setTurns(prev => prev.map(t => {
      if (!t.results.has(modelKey)) return t
      const next = new Map(t.results)
      next.delete(modelKey)
      return { ...t, results: next }
    }))
    setExpandedCol(prev => prev?.endsWith(`:${modelKey}`) ? null : prev)

    // A pairs run pairs each model to its own prompt, so its model list is not
    // a set and the server refuses to narrow it; the column just hides.
    if (runId && runKind !== 'pairs') {
      void runsApi.setModels(runId, remaining).catch(() => {})
    }
  }

  async function handleEditTurn(promptIndex: number) {
    if (!runId || !editingTurn) return
    const trimmed = editingTurn.value.trim()
    if (!trimmed) return
    setEditingTurn(null)
    setError(null)
    setVote(null)
    setExpandedCol(null)

    // Fork semantics — everything after the edited turn is discarded.
    // The edited turn keeps its own attachments (ids re-sent so the backend
    // doesn't garbage-collect them).
    const keptAttachments = turns.find(t => t.promptIndex === promptIndex)?.attachments
    setTurns(prev => [...prev.slice(0, promptIndex), {
      promptIndex,
      prompt: trimmed,
      showPromptBubble: true,
      results: pendingResults(sessionModels),
      ...(keptAttachments?.length ? { attachments: keptAttachments } : {}),
    }])
    setScreenState('running')

    try {
      await benchmarkApi.editTurn(runId, promptIndex, trimmed, keptAttachments?.map(a => a.id))
      esRef.current?.close()
      const es = new EventSource(`/api/benchmark/stream/${runId}`)
      esRef.current = es
      wireSSE(es)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to edit message')
    }
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

    const dotBg = isDone ? 'var(--success)' : isError ? 'var(--error)' : isStreaming ? 'var(--accent)' : 'var(--border-hover)'

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: '1 1 auto', minHeight: 0,
        background: 'var(--bg-elevated)', borderRadius: 10,
        border: `0.5px solid ${isFastest ? 'var(--accent-dim)' : 'var(--border)'}`,
      }}>
        <div style={{
          height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
          borderBottom: '0.5px solid var(--border)', background: 'var(--bg-base)', flexShrink: 0,
        }}>
          <span className={isStreaming ? 'bp' : undefined} style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: dotBg }} />
          <span style={{ flex: 1, fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-bright)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            {isFastest && (
              <span style={{
                flexShrink: 0, fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)',
                color: 'var(--accent)', background: 'var(--accent-bg)',
                border: '0.5px solid var(--accent-dim)', borderRadius: 8, padding: '1px 6px',
              }}>
                ⚡ {t('run.fastest')}
              </span>
            )}
          </span>
          <IconButton onClick={() => handleRegenerate(turn.promptIndex, key)} title={t('title.regenerate')}><IconRefresh /></IconButton>
          <IconButton onClick={() => handleCopy(cellKey, r.text)} title={t('common.copy')}>
            {copiedCol === cellKey ? <IconCheck /> : <IconCopy />}
          </IconButton>
          {isExpanded ? (
            <IconButton onClick={() => setExpandedCol(null)} title={t('common.collapse')}><IconCollapse /></IconButton>
          ) : (
            <>
              <IconButton onClick={() => setExpandedCol(cellKey)} title={t('common.expand')}><IconExpand /></IconButton>
              {/* Nothing to close down to — a chat with zero columns is a dead end. */}
              {sessionModels.length > 1 && (
                <IconButton onClick={() => handleCloseColumn(key)} title={t('title.closeModel')}><IconClose /></IconButton>
              )}
            </>
          )}
        </div>

        <MetricsStrip result={r} isFastest={isFastest} />

        {isError ? (
          <div style={{ flex: 1, padding: 12, overflowY: 'auto' }}>
            <div style={{
              background: 'var(--error-bg)', border: '0.5px solid var(--border)', borderRadius: 6,
              padding: '10px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--error)',
            }}>
              {r.error ?? t('common.error')}
            </div>
          </div>
        ) : (
          <div
            className="col-body"
            style={{ flex: 1, overflowY: 'auto', padding: 12, fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1.7, wordBreak: 'break-word' }}
          >
            {showReasoning && (
              <ActivityTrace
                reasoning={r.reasoning}
                reasoningMs={r.reasoningMs}
                reasoningTokens={r.reasoningTokens}
                status={r.status}
                answerStarted={r.text.length > 0}
              />
            )}
            {r.text
              ? splitFencedSegments(r.text).map((seg, si) =>
                  seg.type === 'code'
                    ? <CodeBlock key={`${cellKey}:${si}`} segment={seg} />
                    : <span key={`${cellKey}:${si}`} style={{ whiteSpace: 'pre-wrap' }}>{seg.content}</span>
                )
              : (r.status === 'pending' && <span style={{ color: 'var(--border-hover)' }}>{t('run.waiting')}</span>)}
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
    groups: providerGroups,
    selectedModels,
    onToggle: toggleModel,
    onToggleProvider: toggleProviderModels,
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
    isBatch: runKind === 'batch',
    pendingAttachments,
    uploading,
    onFilesPicked: handleFilesPicked,
    onRemoveAttachment: handleRemoveAttachment,
  }

  // ─── Idle state ───────────────────────────────────────────────────────────

  if (screenState === 'idle') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
        <style>{ANIM_CSS}</style><ActivityTraceStyles />
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16, padding: '24px',
        }}>
          <div style={{ fontSize: 24, color: 'var(--text-primary)', fontWeight: 400, letterSpacing: -0.4, textAlign: 'center' }}>
            {t('run.title')}
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
      <style>{ANIM_CSS}</style><ActivityTraceStyles />

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

      {/* A batch is a set of independent questions, so it reads across, not down:
          one column per prompt, its answer(s) underneath. Laying it out as a
          vertical stack made it look like a conversation, which it never was. */}
      {runKind === 'batch' ? (
        <div style={{
          flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gap: 12, alignItems: 'start',
          gridTemplateColumns: `repeat(${turns.length || 1}, minmax(320px, 1fr))`,
        }}>
          {turns.map(turn => (
            <div key={turn.promptIndex} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <BatchPromptHeader
                turn={turn}
                index={turn.promptIndex}
                editing={editingTurn?.promptIndex === turn.promptIndex ? editingTurn.value : null}
                busy={screenState === 'running'}
                copied={copiedCol === `prompt:${turn.promptIndex}`}
                onEditStart={() => setEditingTurn({ promptIndex: turn.promptIndex, value: turn.prompt })}
                onEditChange={v => setEditingTurn({ promptIndex: turn.promptIndex, value: v })}
                onEditCancel={() => setEditingTurn(null)}
                onEditSend={() => void handleEditTurn(turn.promptIndex)}
                onCopy={() => void handleCopy(`prompt:${turn.promptIndex}`, turn.prompt)}
              />
              {sessionModels.map(key => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', minHeight: 320, overflow: 'hidden' }}>
                  {renderCell(turn, key)}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {turns.map((turn, ti) => (
          <div key={turn.promptIndex} style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            {ti > 0 && <div style={{ height: 1, background: 'var(--hairline)', margin: '4px 24px' }} />}
            {turn.showPromptBubble && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                {editingTurn?.promptIndex === turn.promptIndex ? (
                  <div style={{ width: '70%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <textarea
                      autoFocus
                      value={editingTurn.value}
                      onChange={e => setEditingTurn({ promptIndex: turn.promptIndex, value: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleEditTurn(turn.promptIndex) }
                        if (e.key === 'Escape') setEditingTurn(null)
                      }}
                      rows={3}
                      style={{
                        width: '100%', background: 'var(--bg-elevated)', border: '0.5px solid var(--accent-dim)',
                        borderRadius: 10, padding: '8px 14px', fontSize: 13, color: 'var(--text-primary)',
                        outline: 'none', resize: 'vertical', lineHeight: 1.6,
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginRight: 4 }}>
                        {t('run.editHint')}
                      </span>
                      <Button small onClick={() => setEditingTurn(null)}>{t('common.cancel')}</Button>
                      <Button variant="primary" small onClick={() => void handleEditTurn(turn.promptIndex)}>{t('common.send')}</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{
                      maxWidth: '70%', background: 'var(--accent-bg)', border: '0.5px solid var(--accent-dim)',
                      borderRadius: 10, padding: '8px 14px', fontSize: 13, color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {turn.attachments && turn.attachments.length > 0 && (
                        <div style={{ marginBottom: turn.prompt ? 8 : 0 }}>
                          <AttachmentStrip attachments={turn.attachments} />
                        </div>
                      )}
                      {turn.prompt}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <IconButton
                        title={t('title.copyMessage')}
                        onClick={() => void handleCopy(`prompt:${turn.promptIndex}`, turn.prompt)}
                        style={{ width: 22, height: 22, border: 'none' }}
                      >
                        {copiedCol === `prompt:${turn.promptIndex}` ? <IconCheck size={11} /> : <IconCopy size={11} />}
                      </IconButton>
                      <IconButton
                        title={t('title.editMessage')}
                        onClick={() => setEditingTurn({ promptIndex: turn.promptIndex, value: turn.prompt })}
                        disabled={screenState === 'running'}
                        style={{ width: 22, height: 22, border: 'none', opacity: screenState === 'running' ? 0.4 : undefined }}
                      >
                        <IconPencil size={11} />
                      </IconButton>
                    </div>
                  </>
                )}
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
      )}

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
