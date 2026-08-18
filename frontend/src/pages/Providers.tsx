import { useState, useEffect, Fragment } from 'react'
import { providersApi } from '../api'
import { Button, PillToggle } from '../components/ui'
import { SliderField } from '../components/SliderField'
import { IconChevron, IconSliders } from '../components/icons'
import { useT, t } from '../i18n'
import type { ProviderDraft, ProviderUpsert } from '../api'
import type { ProviderView, ProviderType, ProviderDefaults } from '../../../src/types'
import { FACTORY_RUN_DEFAULTS } from '../runDefaults'

// Deliberately the FACTORY values, not the app defaults from Settings: this
// seeds what gets PERSISTED onto a provider, and writing the app default in
// here would bake it into config.json where it could never be inherited from
// again.
const DEFAULT_DEFAULTS: Required<ProviderDefaults> = FACTORY_RUN_DEFAULTS

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ─── Static data ──────────────────────────────────────────────────────────────

const MODEL_CAPABILITIES: Record<string, string[]> = {
  'gpt-4o': ['chat', 'vision'],
  'gpt-4o-mini': ['fast', 'cheap'],
  'gpt-4.1': ['chat'],
  'gpt-4.1-mini': ['fast', 'cheap'],
  'o3': ['reasoning'],
  'o3-mini': ['reasoning'],
  'o1': ['reasoning'],
  'text-embedding-3-large': ['embeddings'],
  'text-embedding-3-small': ['embeddings'],
  'claude-opus-4-5': ['flagship'],
  'claude-sonnet-4-5': ['chat'],
  'claude-haiku-4-5': ['fast', 'cheap'],
  'claude-3-5-haiku-20241022': ['fast', 'cheap'],
  'gemini-2.5-pro': ['chat', 'vision'],
  'gemini-2.5-flash': ['fast'],
  'gemini-2.0-flash': ['fast'],
  'gemini-2.0-flash-lite': ['fast', 'cheap'],
  'mistral-large-latest': ['chat', 'flagship'],
  'mistral-small-latest': ['fast', 'cheap'],
  'open-mixtral-8x22b': ['open weights'],
  'codestral-latest': ['code'],
  'deepseek-chat': ['chat'],
  'deepseek-reasoner': ['reasoning'],
  'grok-4': ['chat', 'flagship'],
  'grok-3': ['chat'],
  'llama-3.3-70b-versatile': ['chat'],
  'llama-3.1-8b-instant': ['fast', 'cheap'],
}

interface PresetProvider {
  name: string
  type: ProviderType
  baseUrl?: string
  placeholderKey?: string
  docsUrl?: string
  subtitle: string
}

const PRESET_PROVIDERS: PresetProvider[] = [
  { name: 'OpenAI', type: 'openai', placeholderKey: 'sk-…', subtitle: 'Official provider · OpenAI API', docsUrl: 'https://platform.openai.com/docs/overview' },
  { name: 'Anthropic', type: 'anthropic', placeholderKey: 'sk-ant-…', subtitle: 'Official provider · Anthropic API', docsUrl: 'https://docs.anthropic.com/' },
  { name: 'Google', type: 'google', placeholderKey: 'AIza…', subtitle: 'Official provider · Google AI', docsUrl: 'https://ai.google.dev/gemini-api/docs' },
  { name: 'Mistral', type: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', subtitle: 'Custom endpoint · OpenAI-style API', docsUrl: 'https://docs.mistral.ai/' },
  { name: 'DeepSeek', type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', subtitle: 'Custom endpoint · OpenAI-style API', docsUrl: 'https://api-docs.deepseek.com/' },
  { name: 'xAI', type: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', subtitle: 'Custom endpoint · OpenAI-style API', docsUrl: 'https://docs.x.ai/' },
  { name: 'Groq', type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', subtitle: 'Fast inference · OpenAI-style API', docsUrl: 'https://console.groq.com/docs/openai' },
  { name: 'Together AI', type: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', subtitle: 'Fast inference · OpenAI-style API', docsUrl: 'https://docs.together.ai/' },
  { name: 'OpenRouter', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', subtitle: 'Model aggregator · OpenAI-style API', docsUrl: 'https://openrouter.ai/docs' },
  { name: 'Ollama', type: 'local', baseUrl: 'http://localhost:11434/v1', subtitle: 'Local provider · OpenAI-style API', docsUrl: 'https://ollama.com/library' },
  { name: 'LM Studio', type: 'local', baseUrl: 'http://localhost:1234/v1', subtitle: 'Local provider · OpenAI-style API', docsUrl: 'https://lmstudio.ai/docs' },
  { name: 'HTTP JSON', type: 'http-json', placeholderKey: 'Bearer token (optional)', subtitle: 'Custom HTTP endpoint · JSON or SSE response' },
  { name: 'Script', type: 'script', subtitle: 'Local script · JSON messages on stdin' },
  { name: 'Webhook', type: 'webhook', placeholderKey: 'Webhook secret (optional)', subtitle: 'Webhook · POST with JSON payload' },
]

function isProviderActive(provider: ProviderView): boolean {
  return provider.enabled && (!!provider.apiKeyMask || !!provider.baseUrl)
}

// Config-derived status for the board — a live health check (key error / server
// offline) would need probing + persistence; that's a later stage. Here: ready =
// connected with at least one model; nomodels = connected but empty; setup = not
// yet connected.
type ProvStatus = 'ready' | 'nomodels' | 'setup'
function providerStatus(p: ProviderView): ProvStatus {
  if (!isProviderActive(p)) return 'setup'
  return p.models.length > 0 ? 'ready' : 'nomodels'
}
const STATUS_ORDER: ProvStatus[] = ['ready', 'nomodels', 'setup']
const STATUS_TONE: Record<ProvStatus, { color: string; bg: string }> = {
  ready: { color: 'var(--success)', bg: 'var(--success-bg)' },
  nomodels: { color: 'var(--warning)', bg: 'var(--warning-bg)' },
  setup: { color: 'var(--text-muted)', bg: 'var(--bg-base)' },
}

// Rail categories, by provider type. 'custom' catches http-json/script/webhook
// and any user endpoint that isn't a known preset.
type ProvCat = 'official' | 'compatible' | 'local' | 'custom'
const CAT_ORDER: ProvCat[] = ['official', 'compatible', 'local', 'custom']
function typeCategory(type: ProviderType): ProvCat {
  if (type === 'openai' || type === 'anthropic' || type === 'google') return 'official'
  if (type === 'openai-compatible') return 'compatible'
  if (type === 'local') return 'local'
  return 'custom'
}

// Two-letter mark for the logo placeholder — first letters of the first two
// words, else the first two characters.
function providerMark(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  const s = words.length >= 2 ? words[0][0] + words[1][0] : name.trim().slice(0, 2)
  return s.toUpperCase()
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestResult {
  ok: boolean
  ttfs?: number
  message?: string
  error?: string
}

interface ModalState {
  provider: ProviderView
  preset?: PresetProvider
  // Connection wizard step for a NEW provider (1 key · 2 models · 3 test). Ignored
  // when editing an already-connected provider (that uses the tabbed modal).
  step?: 1 | 2 | 3
  // Which tab the edit modal shows for a connected provider.
  tab?: 'main' | 'advanced'
  selectedModels: Set<string>
  availableModels: string[]
  manualMode: boolean
  manualText: string
  modelSearch: string
  replacingKey: boolean
  newKey: string
  testModelId: string
  testing: boolean
  fetchingModels: boolean
  testResult: TestResult | null
  advancedOpen: boolean
  defaults: ProviderDefaults
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const MODAL_CSS = `
  .prov-checkbox { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; flex-shrink: 0; }
  .prov-model-row { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-bottom: 0.5px solid var(--border); }
  .prov-model-row:last-child { border-bottom: none; }
  .prov-model-row:hover { background: var(--bg-base); }
  .prov-tag { display: inline-block; font-size: 10px; font-family: var(--font-mono); color: var(--text-muted); padding: 1px 5px; border-radius: 3px; background: var(--bg-base); border: 0.5px solid var(--border); }
  .prov-group { width: 100%; display: flex; align-items: center; gap: 7px; padding: 7px 14px; background: none; border: none; border-bottom: 0.5px solid var(--border); cursor: pointer; font-size: 12px; font-family: var(--font-mono); color: var(--text-secondary); }
  .prov-group:hover { background: var(--bg-base); color: var(--text-primary); }
  .prov-group-label { padding: 6px 14px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); background: var(--accent-bg); border-bottom: 0.5px solid var(--border); }
  .prov-icon-btn { background: none; border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 4px 10px; font-size: 11px; font-family: var(--font-mono); color: var(--text-secondary); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
  .prov-icon-btn:hover:not(:disabled) { border-color: var(--border-hover); color: var(--text-primary); }
  .prov-icon-btn:disabled { opacity: .45; cursor: default; }
  .prov-select { background: var(--bg-base); border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 6px 10px; color: var(--text-primary); font-size: 12px; font-family: var(--font-mono); cursor: pointer; flex: 1; }
  .prov-select:focus { outline: 1.5px solid var(--accent); }
  .prov-input { background: var(--bg-base); border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; color: var(--text-primary); font-size: 12px; font-family: var(--font-mono); width: 100%; box-sizing: border-box; }
  .prov-input:focus { outline: 1.5px solid var(--accent); border-color: transparent; }
  .prov-spinner { display: inline-block; width: 10px; height: 10px; border: 1.5px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: prov-spin .6s linear infinite; }
  @keyframes prov-spin { to { transform: rotate(360deg) } }
`

const BOARD_CSS = `
  .pb-rail-cat { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 18px; font-size: 12px; color: var(--text-secondary); cursor: pointer; border: none; border-left: 2px solid transparent; background: none; width: 100%; text-align: left; font-family: inherit; }
  .pb-rail-cat:hover { color: var(--text-primary); }
  .pb-rail-cat.on { color: var(--text-bright); border-left-color: var(--accent); background: var(--accent-bg); }
  .pb-rail-cat .cnt { font: 10.5px var(--font-mono); color: var(--text-muted); }
  .pb-row { display: flex; align-items: center; gap: 14px; padding: 11px 14px; border: none; border-bottom: 0.5px solid var(--border); background: none; width: 100%; text-align: left; cursor: pointer; }
  .pb-row:last-child { border-bottom: none; }
  .pb-row:hover { background: var(--bg-base); }
  .pb-mark { width: 30px; height: 30px; border-radius: 7px; border: 1px dashed var(--border-hover); background: var(--bg-base); display: flex; align-items: center; justify-content: center; font: 500 11px var(--font-mono); color: var(--text-muted); flex-shrink: 0; }
  .pb-seg { display: inline-flex; background: var(--bg-elevated); border: 0.5px solid var(--border); border-radius: 7px; padding: 3px; gap: 2px; flex-shrink: 0; }
  .pb-seg > button { padding: 5px 12px; border-radius: 5px; border: none; background: none; font: 11px var(--font-mono); letter-spacing: 0.04em; color: var(--text-muted); cursor: pointer; }
  .pb-seg > button.on { background: var(--bg-base); color: var(--text-bright); box-shadow: 0 0 0 0.5px var(--border-hover); }
  .pb-search { flex: 1; min-width: 0; background: var(--bg-elevated); border: 0.5px solid var(--border); border-radius: 7px; padding: 8px 12px; color: var(--text-primary); font: 12px var(--font-mono); outline: none; }
  .pb-search:focus { border-color: var(--accent-dim); }
`

// ─── Sub-components (module-level — must NOT be defined inside Providers) ─────

interface ProviderHeaderProps {
  name: string
  subtitle: string
  connected: boolean
  docsUrl?: string
}

function ProviderHeader({ name, subtitle, connected, docsUrl }: ProviderHeaderProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-bright)', letterSpacing: -0.3 }}>{name}</div>
        <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</span>
          {docsUrl && (
            <a href={docsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', opacity: 0.85 }}>
              docs ↗
            </a>
          )}
        </div>
      </div>
      {connected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: 'var(--success-bg)', border: '0.5px solid var(--success)', flexShrink: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          <span style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{t('providers.connected')}</span>
        </div>
      )}
    </div>
  )
}

interface SectionLabelProps { children: string; actions?: React.ReactNode }

function SectionLabel({ children, actions }: SectionLabelProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{children}</span>
      {actions && <div style={{ display: 'flex', gap: 6 }}>{actions}</div>}
    </div>
  )
}

interface ApiKeySectionProps {
  // Null when no key is stored. This is a display string from the backend —
  // the page has no way to obtain the key itself, which is the point.
  apiKeyMask: string | null
  replacingKey: boolean
  newKey: string
  placeholder: string
  onStartReplace: () => void
  onNewKeyChange: (v: string) => void
}

function ApiKeySection({ apiKeyMask, replacingKey, newKey, placeholder, onStartReplace, onNewKeyChange }: ApiKeySectionProps) {
  return (
    <div>
      <SectionLabel>{t('providers.apiKey')}</SectionLabel>
      {!replacingKey && apiKeyMask ? (
        <div style={{ background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
            {apiKeyMask}
          </span>
          <button onClick={onStartReplace} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', padding: '0 0 0 12px' }}>
            {t('providers.replaceKey')}
          </button>
        </div>
      ) : (
        <input
          className="prov-input"
          type="password"
          value={newKey}
          onChange={e => onNewKeyChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={replacingKey}
        />
      )}
      {!replacingKey && apiKeyMask && (
        <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>{t('providers.storedLocally')}</div>
      )}
    </div>
  )
}

interface BaseUrlSectionProps { baseUrl: string; onChange: (v: string) => void; label?: string; placeholder?: string }

function BaseUrlSection({ baseUrl, onChange, label = 'BASE URL', placeholder = 'https://api.example.com/v1' }: BaseUrlSectionProps) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <input className="prov-input" type="text" value={baseUrl} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

interface ModelsSectionProps {
  available: string[]
  selected: Set<string>
  search: string
  manualMode: boolean
  manualText: string
  fetchingModels: boolean
  onToggle: (id: string) => void
  onSearchChange: (v: string) => void
  onManualModeToggle: () => void
  onManualTextChange: (v: string) => void
  onFetchModels: () => void
}

// Aggregators namespace their ids as "vendor/model" — OpenRouter ships 344 of
// them across 56 vendors. A flat list of 344 checkboxes is not a chooser, so
// once it gets big we collapse by vendor and pin what's already selected.
const GROUPING_THRESHOLD = 20
const vendorOf = (id: string) => (id.includes('/') ? id.split('/')[0] : '')

// Tags are keyed by bare model name, but an aggregator's id carries a vendor
// prefix — so "openai/gpt-4o" found nothing. Fall back to the last segment.
const capsOf = (id: string) => MODEL_CAPABILITIES[id] ?? MODEL_CAPABILITIES[id.split('/').pop() ?? ''] ?? []

function ModelRow({ id, checked, onToggle, indent }: { id: string; checked: boolean; onToggle: () => void; indent?: boolean }) {
  const caps = capsOf(id)
  return (
    <div className="prov-model-row" style={indent ? { paddingLeft: 28 } : undefined}>
      <input type="checkbox" className="prov-checkbox" checked={checked} onChange={onToggle} id={`model-${id}`} />
      <label htmlFor={`model-${id}`} style={{ flex: 1, fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {id}
      </label>
      {caps.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {caps.map(c => <span key={c} className="prov-tag">{c}</span>)}
        </div>
      )}
    </div>
  )
}

function ModelsSection({ available, selected, search, manualMode, manualText, fetchingModels, onToggle, onSearchChange, onManualModeToggle, onManualTextChange, onFetchModels }: ModelsSectionProps) {
  const [openVendors, setOpenVendors] = useState<Set<string>>(new Set())

  const q = search.trim().toLowerCase()
  const filtered = available.filter(id => id.toLowerCase().includes(q))
  const selectedList = filtered.filter(id => selected.has(id))
  const rest = filtered.filter(id => !selected.has(id))

  const grouped = available.length > GROUPING_THRESHOLD && available.filter(id => id.includes('/')).length > available.length / 2
  const vendors = new Map<string, string[]>()
  if (grouped) {
    for (const id of rest) {
      const v = vendorOf(id) || '·'
      if (!vendors.has(v)) vendors.set(v, [])
      vendors.get(v)!.push(id)
    }
  }
  // A search is a request to see matches, not to go hunting through folders.
  const isOpen = (v: string) => q.length > 0 || openVendors.has(v)
  const toggleVendor = (v: string) => setOpenVendors(prev => {
    const next = new Set(prev)
    next.has(v) ? next.delete(v) : next.add(v)
    return next
  })

  return (
    <div>
      <SectionLabel actions={
        <>
          <button className="prov-icon-btn" onClick={onFetchModels} disabled={fetchingModels}>
            {fetchingModels ? <span className="prov-spinner" /> : '⟳'} {t('providers.fetchModels')}
          </button>
          <button className="prov-icon-btn" onClick={onManualModeToggle}>
            ✎ {manualMode ? t('providers.listMode') : t('providers.manualMode')}
          </button>
        </>
      }>{t('providers.models')}</SectionLabel>

      <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
        {manualMode ? (
          <textarea
            className="prov-input"
            value={manualText}
            onChange={e => onManualTextChange(e.target.value)}
            placeholder="model-1, model-2, model-3"
            rows={4}
            style={{ borderRadius: 0, border: 'none', resize: 'vertical' }}
          />
        ) : (
          <>
            <div style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>⌕</span>
              <input
                type="text"
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={t('providers.searchModels')}
                style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', flex: 1 }}
              />
              {available.length > 0 && (
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {t('providers.ofTotal', { shown: filtered.length, total: available.length })}
                </span>
              )}
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {filtered.length === 0 && (
                <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {available.length === 0 ? t('providers.clickFetch') : t('providers.noModelsMatch')}
                </div>
              )}

              {/* What you picked stays in sight — in a list of 344 it was gone. */}
              {selectedList.length > 0 && (
                <>
                  <div className="prov-group-label">
                    {t('providers.selectedGroup')} · {selectedList.length}
                  </div>
                  {selectedList.map(id => (
                    <ModelRow key={id} id={id} checked onToggle={() => onToggle(id)} />
                  ))}
                </>
              )}

              {grouped
                ? [...vendors.entries()].map(([vendor, ids]) => (
                    <div key={vendor}>
                      <button className="prov-group" onClick={() => toggleVendor(vendor)}>
                        <IconChevron open={isOpen(vendor)} size={11} />
                        <span style={{ flex: 1, textAlign: 'left' }}>{vendor || '·'}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{ids.length}</span>
                      </button>
                      {isOpen(vendor) && ids.map(id => (
                        <ModelRow key={id} id={id} checked={false} onToggle={() => onToggle(id)} indent />
                      ))}
                    </div>
                  ))
                : rest.map(id => (
                    <ModelRow key={id} id={id} checked={false} onToggle={() => onToggle(id)} />
                  ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface TestSectionProps {
  models: string[]
  testModelId: string
  testing: boolean
  result: TestResult | null
  onModelChange: (id: string) => void
  onTest: () => void
}

function TestSection({ models, testModelId, testing, result, onModelChange, onTest }: TestSectionProps) {
  const disabled = testing || models.length === 0
  return (
    <div>
      <SectionLabel>{t('providers.test')}</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t('providers.testModel')}</span>
        <select className="prov-select" value={testModelId} onChange={e => onModelChange(e.target.value)}>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
          {models.length === 0 && <option value="">{t('providers.selectModel')}</option>}
        </select>
        <Button variant="primary" small onClick={onTest} disabled={disabled} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          {testing ? <><span className="prov-spinner" />{t('providers.testing')}</> : t('providers.testConnection')}
        </Button>
      </div>
      {result && (
        <div style={{
          marginTop: 10, padding: '9px 12px', borderRadius: 'var(--radius-sm)',
          background: result.ok ? 'var(--success-bg)' : 'var(--error-bg)',
          border: `0.5px solid ${result.ok ? 'var(--success)' : 'var(--error)'}`,
          fontSize: 12, fontFamily: 'var(--font-mono)',
          color: result.ok ? 'var(--success)' : 'var(--error)',
        }}>
          {result.ok
            ? `✓ ${t('providers.connectionOk')} · ${result.ttfs ?? '?'}ms · ${result.message ?? t('providers.streamedResponse')}`
            : `✗ ${result.error}`}
        </div>
      )}
    </div>
  )
}

interface AdvancedDefaultsSectionProps {
  open: boolean
  onToggle: () => void
  baseUrl: string
  onBaseUrlChange: (v: string) => void
  showBaseUrl: boolean
  defaults: ProviderDefaults
  onChange: (patch: Partial<ProviderDefaults>) => void
}

function AdvancedDefaultsSection({ open, onToggle, baseUrl, onBaseUrlChange, showBaseUrl, defaults, onChange }: AdvancedDefaultsSectionProps) {
  const d = { ...DEFAULT_DEFAULTS, ...defaults }
  const fieldLabel = { fontSize: 11, color: 'var(--text-muted)' }
  const groupLabel = { fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 10, marginTop: 4 }
  const fieldGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: 28, rowGap: 12, alignItems: 'center' }
  // Same row shape as SliderField: label (88px) | control — keeps non-slider
  // controls (select, toggle) on the same visual rhythm as the sliders.
  const inlineLabel = { ...fieldLabel, width: 88, flexShrink: 0 }

  return (
    <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <span style={{ color: open ? 'var(--accent)' : 'var(--text-secondary)', display: 'flex', flexShrink: 0 }}>
            <IconSliders size={14} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            {t('providers.advancedDefaults')}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t('providers.appliedToRuns')}
          </span>
        </div>
        <span style={{ color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}>
          <IconChevron open={open} size={13} />
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 16px', display: 'flex', flexDirection: 'column', gap: 0, borderTop: '0.5px solid var(--border)' }}>

          {showBaseUrl && (
            <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: '0.5px solid var(--border)' }}>
              <div style={fieldLabel as React.CSSProperties}>{t('providers.baseUrl')}</div>
              <input className="prov-input" type="text" value={baseUrl} onChange={e => onBaseUrlChange(e.target.value)} style={{ marginTop: 5 }} />
            </div>
          )}

          {/* Generation */}
          <div style={{ paddingTop: 14 }}>
            <div style={groupLabel}>{t('providers.generation')}</div>
            <div style={fieldGrid}>
              <SliderField label="Temperature" min={0} max={2} step={0.1}
                value={d.temperature ?? null}
                onChange={v => onChange({ temperature: v })} />
              <SliderField label="Top P" min={0} max={1} step={0.05}
                value={d.topP ?? null}
                onChange={v => onChange({ topP: v })} />
              <SliderField label="Top K" min={1} max={100} step={1}
                value={d.topK ?? null}
                onChange={v => onChange({ topK: v })}
                allowAuto />
              <SliderField label="Max tokens" min={1} max={32000} step={64}
                value={d.maxOutputTokens ?? null}
                onChange={v => onChange({ maxOutputTokens: v })} />
            </div>
          </div>

          {/* Context */}
          <div style={{ paddingTop: 18 }}>
            <div style={groupLabel}>{t('providers.context')}</div>
            <div style={fieldGrid}>
              <SliderField label="Context budget" min={1} max={200000} step={1000}
                value={d.contextBudget ?? null}
                onChange={v => onChange({ contextBudget: v })}
                allowAuto />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={inlineLabel}>{t('providers.truncation')}</span>
                <select className="prov-select"
                  value={d.truncation ?? 'auto'}
                  onChange={e => onChange({ truncation: e.target.value as ProviderDefaults['truncation'] })}
                  style={{ flex: 'none', width: 110 }}>
                  <option value="auto">auto</option>
                  <option value="start">start</option>
                  <option value="middle">middle</option>
                  <option value="end">end</option>
                </select>
              </div>
            </div>
          </div>

          {/* Reliability */}
          <div style={{ paddingTop: 18 }}>
            <div style={groupLabel}>{t('providers.reliability')}</div>
            <div style={fieldGrid}>
              <SliderField label="Timeout" min={1} max={120} step={1}
                value={d.timeoutMs != null ? Math.round(d.timeoutMs / 1000) : null}
                onChange={v => onChange({ timeoutMs: v == null ? null : v * 1000 })}
                unit="s" />
              <SliderField label="Retries" min={0} max={10} step={1}
                value={d.retries ?? null}
                onChange={v => onChange({ retries: v })} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={inlineLabel}>{t('providers.streaming')}</span>
                <PillToggle
                  on={!!d.streaming}
                  onToggle={() => onChange({ streaming: !d.streaming })}
                  labelOn={t('common.on')}
                  labelOff={t('common.off')}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface ModalFooterProps {
  onCancel: () => void
  onSave: () => void
  saving: boolean
}

function ModalFooter({ onCancel, onSave, saving }: ModalFooterProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Button onClick={onCancel}>{t('common.cancel')}</Button>
      <Button variant="primary" onClick={onSave} disabled={saving}>
        {saving ? t('providers.saving') : t('providers.saveProvider')}
      </Button>
    </div>
  )
}

interface DangerZoneProps { onDisconnect: () => void }

function DangerZone({ onDisconnect }: DangerZoneProps) {
  return (
    <div style={{ border: '0.5px solid var(--error)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--error)', marginBottom: 3 }}>{t('providers.dangerZone')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('providers.dangerText')}</div>
      </div>
      <Button variant="danger" small onClick={onDisconnect} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        {t('providers.disconnect')}
      </Button>
    </div>
  )
}

// The connection wizard's progress: 1 Key · 2 Models · 3 Test. Done steps show a
// check, the current one the accent, upcoming ones are dimmed.
function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const labels = [t('providers.stepKey'), t('providers.stepModels'), t('providers.stepTest')]
  return (
    <div style={{ padding: '14px 24px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3
        const done = n < step
        const cur = n === step
        return (
          <Fragment key={n}>
            {i > 0 && <span style={{ flex: 1, height: 1, background: n <= step ? 'var(--accent-dim)' : 'var(--border)' }} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: cur || done ? 1 : 0.55 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontFamily: 'var(--font-mono)',
                background: done ? 'var(--success-bg)' : cur ? 'var(--accent)' : 'transparent',
                border: done ? '0.5px solid var(--success)' : cur ? 'none' : '0.5px solid var(--border-hover)',
                color: done ? 'var(--success)' : cur ? 'var(--on-accent)' : 'var(--text-muted)',
              }}>{done ? '✓' : n}</span>
              <span style={{ fontSize: 12, color: cur ? 'var(--text-bright)' : done ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{label}</span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Providers() {
  useT() // subscribe: a language switch re-renders this tree (sub-components use module t())
  const [providers, setProviders] = useState<ProviderView[]>([])
  const [modal, setModal] = useState<ModalState | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'status' | 'type'>('status')
  const [cat, setCat] = useState<ProvCat | 'all'>('all')

  useEffect(() => {
    providersApi.list().then(setProviders).catch(() => {})
  }, [])

  const CUSTOM_INTEGRATION_TYPES: string[] = ['http-json', 'script', 'webhook']

  function buildModal(preset: PresetProvider, existing?: ProviderView): ModalState {
    const isCustomIntegration = CUSTOM_INTEGRATION_TYPES.includes(preset.type)
    if (existing) {
      return {
        provider: existing,
        preset,
        selectedModels: new Set(existing.models),
        availableModels: existing.models,
        manualMode: isCustomIntegration || existing.models.length > 0,
        manualText: existing.models.join(', '),
        modelSearch: '',
        replacingKey: !existing.apiKeyMask,
        newKey: '',
        testModelId: existing.models[0] ?? '',
        testing: false,
        fetchingModels: false,
        testResult: null,
        // Tuning is the rare case; opening it by default buried Save below a wall
      // of sliders nobody asked for.
      advancedOpen: false,
        defaults: existing.defaults ?? { ...DEFAULT_DEFAULTS },
      }
    }
    const p: ProviderView = {
      id: uid(),
      name: preset.name,
      type: preset.type,
      apiKeyMask: null,
      baseUrl: preset.baseUrl,
      models: [],
      enabled: true,
    }
    return {
      provider: p,
      preset,
      selectedModels: new Set(),
      availableModels: [],
      manualMode: isCustomIntegration,
      manualText: '',
      modelSearch: '',
      replacingKey: true,
      newKey: '',
      testModelId: '',
      testing: false,
      fetchingModels: false,
      testResult: null,
      // Tuning is the rare case; opening it by default buried Save below a wall
      // of sliders nobody asked for.
      advancedOpen: false,
      defaults: { ...DEFAULT_DEFAULTS },
    }
  }

  function openPreset(preset: PresetProvider) {
    const existing = providers.find(p => p.name === preset.name)
    setModal(buildModal(preset, existing))
  }

  function openCustom() {
    const p: ProviderView = { id: uid(), name: '', type: 'openai-compatible', apiKeyMask: null, baseUrl: '', models: [], enabled: true }
    setModal({
      provider: p,
      selectedModels: new Set(),
      availableModels: [],
      manualMode: true,
      manualText: '',
      modelSearch: '',
      replacingKey: true,
      newKey: '',
      testModelId: '',
      testing: false,
      fetchingModels: false,
      testResult: null,
      // Tuning is the rare case; opening it by default buried Save below a wall
      // of sliders nobody asked for.
      advancedOpen: false,
      defaults: { ...DEFAULT_DEFAULTS },
    })
  }

  function openExistingCustom(p: ProviderView) {
    setModal({
      provider: p,
      selectedModels: new Set(p.models),
      availableModels: p.models,
      manualMode: true,
      manualText: p.models.join(', '),
      modelSearch: '',
      replacingKey: !p.apiKeyMask,
      newKey: '',
      testModelId: p.models[0] ?? '',
      testing: false,
      fetchingModels: false,
      testResult: null,
      // Tuning is the rare case; opening it by default buried Save below a wall
      // of sliders nobody asked for.
      advancedOpen: false,
      defaults: p.defaults ?? { ...DEFAULT_DEFAULTS },
    })
  }

  function updateModal(patch: Partial<ModalState>) {
    setModal(m => m ? { ...m, ...patch } : m)
  }

  function updateProvider(patch: Partial<ProviderView>) {
    setModal(m => m ? { ...m, provider: { ...m.provider, ...patch } } : m)
  }

  function getFinalModels(m: ModalState): string[] {
    if (m.manualMode) return m.manualText.split(',').map(s => s.trim()).filter(Boolean)
    return [...m.selectedModels]
  }

  // Only send apiKey when the user actually typed one. Omitting it means
  // "leave the stored key alone" — which is what an ordinary edit (a rename, a
  // model list change) now is, since the page has no key to send back.
  function getFinalProvider(m: ModalState): ProviderUpsert {
    const { apiKeyMask: _mask, ...rest } = m.provider
    return {
      ...rest,
      ...(m.replacingKey ? { apiKey: m.newKey } : {}),
      models: getFinalModels(m),
      defaults: m.defaults,
    }
  }

  function syncProviders(saved: ProviderView) {
    setProviders(prev => {
      const idx = prev.findIndex(p => p.id === saved.id)
      return idx >= 0 ? prev.map((p, i) => i === idx ? saved : p) : [...prev, saved]
    })
  }

  async function handleSave() {
    if (!modal) return
    setSaving(true)
    try {
      const saved = await providersApi.upsert(getFinalProvider(modal))
      syncProviders(saved)
      setModal(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    if (!modal) return
    await providersApi.remove(modal.provider.id)
    setProviders(prev => prev.filter(p => p.id !== modal.provider.id))
    setModal(null)
  }

  // What the form currently holds — testing and listing act on this, never on
  // whatever happens to be saved. Both used to upsert first, which meant
  // clicking Test quietly wrote the provider and Cancel could no longer undo it.
  // A probe carries the typed key if there is one; otherwise it names the saved
  // provider and lets the backend supply the key. An unsaved draft has neither,
  // which is correct — there is nothing to authenticate with yet.
  function getDraft(m: ModalState): ProviderDraft {
    const final = getFinalProvider(m)
    const saved = providers.some(p => p.id === m.provider.id)
    return {
      type: final.type,
      baseUrl: final.baseUrl,
      ...(m.replacingKey ? { apiKey: m.newKey } : saved ? { providerId: m.provider.id } : {}),
    }
  }

  async function handleTest() {
    if (!modal) return
    updateModal({ testing: true, testResult: null })
    try {
      const model = modal.testModelId || getFinalModels(modal)[0]
      const result = await providersApi.test({ ...getDraft(modal), model })
      updateModal({ testing: false, testResult: result })
    } catch (err) {
      updateModal({ testing: false, testResult: { ok: false, error: err instanceof Error ? err.message : String(err) } })
    }
  }

  async function handleFetchModels() {
    if (!modal) return
    updateModal({ fetchingModels: true })
    try {
      const fetched = await providersApi.fetchModels(getDraft(modal))
      setModal(m => {
        if (!m) return m
        const merged = [...new Set([...fetched, ...m.availableModels])]
        return { ...m, availableModels: merged, fetchingModels: false, manualMode: false }
      })
    } catch (err) {
      // Silently swallowing this left the button spinning and the user guessing.
      updateModal({
        fetchingModels: false,
        testResult: { ok: false, error: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  function toggleModelSelection(id: string) {
    setModal(m => {
      if (!m) return m
      const next = new Set(m.selectedModels)
      next.has(id) ? next.delete(id) : next.add(id)
      const firstSelected = next.values().next().value ?? ''
      return { ...m, selectedModels: next, testModelId: m.testModelId || firstSelected }
    })
  }

  const providerMap = new Map(providers.map(p => [p.name, p]))
  const presetNames = new Set(PRESET_PROVIDERS.map(p => p.name))


  function stub(preset: PresetProvider): ProviderView {
    return { id: '', name: preset.name, type: preset.type, apiKeyMask: null, models: [], enabled: false }
  }

  const customProviders = providers.filter(p => !presetNames.has(p.name))

  const isConnected = modal ? !!providers.find(p => p.id === modal.provider.id) : false
  const wizardStep: 1 | 2 | 3 = modal?.step ?? 1
  const settingsTab: 'main' | 'advanced' = modal?.tab ?? 'main'
  const isLocal = modal?.provider.type === 'local'
  const isScript = modal?.provider.type === 'script'
  const isCustom = !modal?.preset
  const isCompatible = modal ? (modal.provider.type === 'openai-compatible' || modal.provider.type === 'local' || isCustom) : false
  const isCustomIntegration = modal ? CUSTOM_INTEGRATION_TYPES.includes(modal.provider.type) : false
  const showBaseUrlAbove = (isCompatible && !isCustom) || isCustomIntegration
  const currentSelectedList = modal ? getFinalModels(modal) : []

  function baseUrlLabel(type: string): string {
    if (type === 'script') return 'COMMAND'
    if (type === 'http-json') return 'ENDPOINT URL'
    if (type === 'webhook') return 'WEBHOOK URL'
    return 'BASE URL'
  }
  function baseUrlPlaceholder(type: string): string {
    if (type === 'script') return 'python /path/to/script.py'
    if (type === 'http-json') return 'https://my-server.com/chat'
    if (type === 'webhook') return 'https://my-server.com/webhook'
    return 'https://api.example.com/v1'
  }

  // ── Status board ──
  interface BoardRow { key: string; name: string; type: ProviderType; provider: ProviderView; place: string; onClick: () => void }
  const boardRows: BoardRow[] = [
    ...PRESET_PROVIDERS.map(preset => {
      const connected = providerMap.get(preset.name)
      return { key: preset.name, name: preset.name, type: preset.type, provider: connected ?? stub(preset), place: preset.subtitle, onClick: () => openPreset(preset) }
    }),
    ...customProviders.map(p => ({ key: p.id, name: p.name, type: p.type, provider: p, place: t('providers.customProvider'), onClick: () => openExistingCustom(p) })),
  ]
  const sq = search.trim().toLowerCase()
  const visibleRows = boardRows.filter(r =>
    (cat === 'all' || typeCategory(r.type) === cat) &&
    (!sq || `${r.name} ${r.provider.models.join(' ')}`.toLowerCase().includes(sq)))
  const statusLabel: Record<ProvStatus, string> = { ready: t('providers.statusReady'), nomodels: t('providers.statusNoModels'), setup: t('providers.statusSetup') }
  const catLabel: Record<ProvCat, string> = { official: t('providers.catOfficial'), compatible: t('providers.catCompatible'), local: t('providers.catLocal'), custom: t('providers.catCustom') }
  const groups = groupBy === 'status'
    ? STATUS_ORDER.map(s => ({ id: s, tone: STATUS_TONE[s].color, title: statusLabel[s], rows: visibleRows.filter(r => providerStatus(r.provider) === s) })).filter(g => g.rows.length > 0)
    : CAT_ORDER.map(c => ({ id: c, tone: 'var(--text-muted)', title: catLabel[c], rows: visibleRows.filter(r => typeCategory(r.type) === c) })).filter(g => g.rows.length > 0)

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <style>{BOARD_CSS}</style>

      <aside style={{ width: 212, minWidth: 212, flexShrink: 0, background: 'var(--bg-sidebar)', borderRight: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '22px 0', overflowY: 'auto' }}>
        <div style={{ padding: '0 18px 14px', fontSize: 15, fontWeight: 600, color: 'var(--text-bright)', letterSpacing: '-0.2px' }}>{t('providers.title')}</div>
        <button className={`pb-rail-cat${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>
          <span>{t('providers.catAll')}</span><span className="cnt">{boardRows.length}</span>
        </button>
        {CAT_ORDER.map(c => {
          const n = boardRows.filter(r => typeCategory(r.type) === c).length
          return n === 0 ? null : (
            <button key={c} className={`pb-rail-cat${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>
              <span>{catLabel[c]}</span><span className="cnt">{n}</span>
            </button>
          )
        })}
        <div style={{ height: 1, background: 'var(--hairline)', margin: '14px 12px' }} />
        <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{t('providers.availability')}</div>
          {STATUS_ORDER.map(s => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)', color: STATUS_TONE[s].color }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_TONE[s].color, flexShrink: 0 }} />
              <span>{statusLabel[s]} · {boardRows.filter(r => providerStatus(r.provider) === s).length}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ margin: '0 14px', padding: '12px 14px', border: '0.5px solid var(--border)', borderRadius: 8, background: 'var(--bg-base)', fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t('providers.keysLocal')}</div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 26px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <input className="pb-search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('providers.searchPlaceholder')} />
          <div className="pb-seg">
            <button className={groupBy === 'status' ? 'on' : ''} onClick={() => setGroupBy('status')}>{t('providers.byStatus')}</button>
            <button className={groupBy === 'type' ? 'on' : ''} onClick={() => setGroupBy('type')}>{t('providers.byType')}</button>
          </div>
          <button onClick={openCustom} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', flexShrink: 0 }}>+ {t('providers.connect')}</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {groups.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('providers.searchEmpty')}</div>
          ) : groups.map(g => (
            <div key={g.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: g.tone, flexShrink: 0 }} />
                <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>{g.title}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>{g.rows.length}</span>
                <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,var(--border),transparent)' }} />
              </div>
              <div style={{ border: '0.5px solid var(--border)', borderRadius: 9, overflow: 'hidden', background: 'var(--bg-elevated)' }}>
                {g.rows.map(r => {
                  const st = providerStatus(r.provider)
                  const tone = STATUS_TONE[st]
                  const models = r.provider.models.length
                  return (
                    <button key={r.key} className="pb-row" onClick={r.onClick}>
                      <span className="pb-mark">{providerMark(r.name)}</span>
                      <span style={{ width: 150, flexShrink: 0, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      <span style={{ width: 210, flexShrink: 0, fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.place}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 10px', borderRadius: 20, background: tone.bg, flexShrink: 0 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.color }} />
                        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: tone.color }}>{statusLabel[st]}</span>
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{models > 0 ? t('providers.modelsN', { n: models }) : (r.provider.apiKeyMask ?? t('providers.noModels'))}</span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', flexShrink: 0 }}>{t('providers.configure')} →</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Modal */}
      {modal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setModal(null) }}
          style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}
        >
          <div style={{
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 660,
            maxHeight: 'calc(100vh - 40px)', overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}>
            <style>{MODAL_CSS}</style>

            {isConnected ? (
              <>
                {/* Edit a connected provider — tabbed: Main (key/models/test) · Advanced (defaults) */}
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <ProviderHeader
                    name={modal.provider.name || t('providers.customProvider')}
                    subtitle={modal.preset?.subtitle ?? 'Custom endpoint · OpenAI-style API'}
                    connected={isConnected}
                    docsUrl={modal.preset?.docsUrl}
                  />
                  <div style={{ display: 'flex', gap: 20, borderBottom: '0.5px solid var(--border)' }}>
                    {(['main', 'advanced'] as const).map(tb => (
                      <button key={tb} onClick={() => updateModal({ tab: tb })}
                        style={{ background: 'none', border: 'none', paddingBottom: 10, fontSize: 12.5, cursor: 'pointer',
                          color: settingsTab === tb ? 'var(--text-bright)' : 'var(--text-muted)',
                          borderBottom: settingsTab === tb ? '2px solid var(--accent)' : '2px solid transparent' }}>
                        {tb === 'main' ? t('providers.tabMain') : t('providers.tabAdvanced')}
                      </button>
                    ))}
                  </div>

                  {settingsTab === 'main' ? (
                    <>
                      {!isLocal && !isScript && (
                        <ApiKeySection apiKeyMask={modal.provider.apiKeyMask} replacingKey={modal.replacingKey} newKey={modal.newKey}
                          placeholder={modal.preset?.placeholderKey ?? 'sk-…'}
                          onStartReplace={() => updateModal({ replacingKey: true })} onNewKeyChange={v => updateModal({ newKey: v })} />
                      )}
                      {isCustom && (
                        <div>
                          <SectionLabel>{t('providers.providerName')}</SectionLabel>
                          <input className="prov-input" type="text" value={modal.provider.name} onChange={e => updateProvider({ name: e.target.value })} placeholder={t('providers.myProvider')} />
                        </div>
                      )}
                      {showBaseUrlAbove && (
                        <BaseUrlSection baseUrl={modal.provider.baseUrl ?? ''} onChange={v => updateProvider({ baseUrl: v })} label={baseUrlLabel(modal.provider.type)} placeholder={baseUrlPlaceholder(modal.provider.type)} />
                      )}
                      <ModelsSection available={modal.availableModels} selected={modal.selectedModels} search={modal.modelSearch}
                        manualMode={modal.manualMode} manualText={modal.manualText} fetchingModels={modal.fetchingModels}
                        onToggle={toggleModelSelection} onSearchChange={v => updateModal({ modelSearch: v })}
                        onManualModeToggle={() => updateModal({ manualMode: !modal.manualMode })} onManualTextChange={v => updateModal({ manualText: v })} onFetchModels={handleFetchModels} />
                      <TestSection models={currentSelectedList} testModelId={modal.testModelId} testing={modal.testing} result={modal.testResult}
                        onModelChange={v => updateModal({ testModelId: v })} onTest={handleTest} />
                      <button onClick={() => updateModal({ tab: 'advanced' })}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 14px', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>{t('providers.tabAdvanced')}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('providers.advancedHint')}</span>
                        </span>
                        <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--accent)', flexShrink: 0 }}>{t('providers.open')} →</span>
                      </button>
                    </>
                  ) : (
                    <AdvancedDefaultsSection open onToggle={() => {}}
                      baseUrl={modal.provider.baseUrl ?? ''} onBaseUrlChange={v => updateProvider({ baseUrl: v })} showBaseUrl={!showBaseUrlAbove}
                      defaults={modal.defaults} onChange={patch => updateModal({ defaults: { ...modal.defaults, ...patch } })} />
                  )}
                </div>
                <div style={{ padding: '16px 24px', borderTop: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <ModalFooter onCancel={() => setModal(null)} onSave={handleSave} saving={saving} />
                  <DangerZone onDisconnect={handleDisconnect} />
                </div>
              </>
            ) : (
              <>
                {/* Connection wizard — key → models → test */}
                <div style={{ padding: '20px 24px 16px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <span className="pb-mark" style={{ width: 42, height: 42, borderRadius: 10, fontSize: 13 }}>{providerMark(modal.provider.name || '?')}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-bright)', letterSpacing: '-0.3px' }}>{modal.provider.name || t('providers.customProvider')}</div>
                    <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{modal.preset?.subtitle ?? t('providers.customEndpointSub')}</span>
                      {modal.preset?.docsUrl && <a href={modal.preset.docsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>docs ↗</a>}
                    </div>
                  </div>
                  <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>✕</button>
                </div>

                <Stepper step={wizardStep} />

                <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {wizardStep === 1 && (
                    <>
                      {isCustom && (
                        <div>
                          <SectionLabel>{t('providers.providerName')}</SectionLabel>
                          <input className="prov-input" type="text" value={modal.provider.name} onChange={e => updateProvider({ name: e.target.value })} placeholder={t('providers.myProvider')} />
                        </div>
                      )}
                      {showBaseUrlAbove && (
                        <BaseUrlSection baseUrl={modal.provider.baseUrl ?? ''} onChange={v => updateProvider({ baseUrl: v })} label={baseUrlLabel(modal.provider.type)} placeholder={baseUrlPlaceholder(modal.provider.type)} />
                      )}
                      {!isLocal && !isScript && (
                        <ApiKeySection apiKeyMask={modal.provider.apiKeyMask} replacingKey={modal.replacingKey} newKey={modal.newKey}
                          placeholder={modal.preset?.placeholderKey ?? 'sk-…'}
                          onStartReplace={() => updateModal({ replacingKey: true })} onNewKeyChange={v => updateModal({ newKey: v })} />
                      )}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px', borderRadius: 6, background: 'var(--info-bg)', border: '0.5px solid var(--border)' }}>
                        <span style={{ color: 'var(--info)', flexShrink: 0, marginTop: 1 }}>ⓘ</span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t('providers.wizardKeyNote')}</span>
                      </div>
                    </>
                  )}
                  {wizardStep === 2 && (
                    <ModelsSection available={modal.availableModels} selected={modal.selectedModels} search={modal.modelSearch}
                      manualMode={modal.manualMode} manualText={modal.manualText} fetchingModels={modal.fetchingModels}
                      onToggle={toggleModelSelection} onSearchChange={v => updateModal({ modelSearch: v })}
                      onManualModeToggle={() => updateModal({ manualMode: !modal.manualMode })} onManualTextChange={v => updateModal({ manualText: v })} onFetchModels={handleFetchModels} />
                  )}
                  {wizardStep === 3 && (
                    <>
                      <TestSection models={currentSelectedList} testModelId={modal.testModelId} testing={modal.testing} result={modal.testResult}
                        onModelChange={v => updateModal({ testModelId: v })} onTest={handleTest} />
                      <div style={{ border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{t('providers.wizardSummary')}</div>
                        {[
                          { k: t('providers.providerName'), v: modal.provider.name || t('providers.customProvider') },
                          { k: t('providers.sumType'), v: modal.preset?.subtitle ?? t('providers.customEndpointSub') },
                          { k: t('providers.sumModels'), v: String(currentSelectedList.length) },
                          { k: t('providers.apiKey'), v: modal.newKey ? '••••' + modal.newKey.slice(-4) : (modal.provider.apiKeyMask ?? '—') },
                        ].map(s => (
                          <div key={s.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 14px', borderBottom: '0.5px solid var(--border)' }}>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.k}</span>
                            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.v}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t('providers.wizardTuneLater')}</div>
                    </>
                  )}
                </div>

                <div style={{ padding: '16px 24px', borderTop: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {wizardStep === 1
                    ? <Button onClick={() => setModal(null)}>{t('common.cancel')}</Button>
                    : <Button onClick={() => updateModal({ step: (wizardStep - 1) as 1 | 2 | 3 })}>{t('providers.back')}</Button>}
                  {wizardStep < 3
                    ? <Button variant="primary" onClick={() => updateModal({ step: (wizardStep + 1) as 1 | 2 | 3 })}>{wizardStep === 1 ? t('providers.nextModels') : t('providers.nextTest')}</Button>
                    : <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? t('providers.saving') : t('providers.connectProvider')}</Button>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
