import { useState, useEffect } from 'react'
import { providersApi } from '../api'
import { ProviderTile } from '../components/ProviderTile'
import { Button, PillToggle } from '../components/ui'
import { SliderField } from '../components/SliderField'
import type { Provider, ProviderType, ProviderDefaults } from '../../../src/types'

const DEFAULT_DEFAULTS: Required<ProviderDefaults> = {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function maskKey(key: string): string {
  if (key.length < 8) return '•'.repeat(key.length)
  return key.slice(0, 3) + '•'.repeat(16) + key.slice(-4)
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

function isProviderActive(provider: Provider): boolean {
  return provider.enabled && (!!provider.apiKey || !!provider.baseUrl)
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestResult {
  ok: boolean
  ttfs?: number
  message?: string
  error?: string
}

interface ModalState {
  provider: Provider
  preset?: PresetProvider
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
          <span style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>Connected</span>
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
  apiKey: string
  replacingKey: boolean
  newKey: string
  placeholder: string
  onStartReplace: () => void
  onNewKeyChange: (v: string) => void
}

function ApiKeySection({ apiKey, replacingKey, newKey, placeholder, onStartReplace, onNewKeyChange }: ApiKeySectionProps) {
  return (
    <div>
      <SectionLabel>API KEY</SectionLabel>
      {!replacingKey && apiKey ? (
        <div style={{ background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
            {maskKey(apiKey)}
          </span>
          <button onClick={onStartReplace} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', padding: '0 0 0 12px' }}>
            Replace key
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
      {!replacingKey && apiKey && (
        <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>Stored locally</div>
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

function ModelsSection({ available, selected, search, manualMode, manualText, fetchingModels, onToggle, onSearchChange, onManualModeToggle, onManualTextChange, onFetchModels }: ModelsSectionProps) {
  const filtered = available.filter(id => id.toLowerCase().includes(search.toLowerCase()))
  return (
    <div>
      <SectionLabel actions={
        <>
          <button className="prov-icon-btn" onClick={onFetchModels} disabled={fetchingModels}>
            {fetchingModels ? <span className="prov-spinner" /> : '⟳'} Fetch models
          </button>
          <button className="prov-icon-btn" onClick={onManualModeToggle}>
            ✎ {manualMode ? 'List' : 'Manual'}
          </button>
        </>
      }>MODELS</SectionLabel>

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
                placeholder="Search models..."
                style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', flex: 1 }}
              />
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {filtered.length === 0 && (
                <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {available.length === 0 ? 'Click "Fetch models" to load available models' : 'No models match'}
                </div>
              )}
              {filtered.map(id => {
                const caps = MODEL_CAPABILITIES[id] ?? []
                return (
                  <div key={id} className="prov-model-row">
                    <input
                      type="checkbox"
                      className="prov-checkbox"
                      checked={selected.has(id)}
                      onChange={() => onToggle(id)}
                      id={`model-${id}`}
                    />
                    <label htmlFor={`model-${id}`} style={{ flex: 1, fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                      {id}
                    </label>
                    {caps.length > 0 && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        {caps.map(c => <span key={c} className="prov-tag">{c}</span>)}
                      </div>
                    )}
                  </div>
                )
              })}
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
      <SectionLabel>TEST</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Test model</span>
        <select className="prov-select" value={testModelId} onChange={e => onModelChange(e.target.value)}>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
          {models.length === 0 && <option value="">— select a model —</option>}
        </select>
        <Button variant="primary" small onClick={onTest} disabled={disabled} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          {testing ? <><span className="prov-spinner" />Testing…</> : 'Test connection'}
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
            ? `✓ Connection OK · ${result.ttfs ?? '?'}ms · ${result.message ?? 'streamed response received'}`
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Advanced Defaults</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7 }}>Applied to new runs unless overridden</span>
        </div>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{open ? '∧' : '∨'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 16px', display: 'flex', flexDirection: 'column', gap: 0, borderTop: '0.5px solid var(--border)' }}>

          {showBaseUrl && (
            <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: '0.5px solid var(--border)' }}>
              <div style={fieldLabel as React.CSSProperties}>Base URL</div>
              <input className="prov-input" type="text" value={baseUrl} onChange={e => onBaseUrlChange(e.target.value)} style={{ marginTop: 5 }} />
            </div>
          )}

          {/* Generation */}
          <div style={{ paddingTop: 14 }}>
            <div style={groupLabel}>Generation</div>
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
            <div style={groupLabel}>Context</div>
            <div style={fieldGrid}>
              <SliderField label="Context budget" min={1} max={200000} step={1000}
                value={d.contextBudget ?? null}
                onChange={v => onChange({ contextBudget: v })}
                allowAuto />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={inlineLabel}>Truncation</span>
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
            <div style={groupLabel}>Reliability</div>
            <div style={fieldGrid}>
              <SliderField label="Timeout" min={1} max={120} step={1}
                value={d.timeoutMs != null ? Math.round(d.timeoutMs / 1000) : null}
                onChange={v => onChange({ timeoutMs: v == null ? null : v * 1000 })}
                unit="s" />
              <SliderField label="Retries" min={0} max={10} step={1}
                value={d.retries ?? null}
                onChange={v => onChange({ retries: v })} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={inlineLabel}>Streaming</span>
                <PillToggle
                  on={!!d.streaming}
                  onToggle={() => onChange({ streaming: !d.streaming })}
                  labelOn="On"
                  labelOff="Off"
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
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save provider'}
      </Button>
    </div>
  )
}

interface DangerZoneProps { onDisconnect: () => void }

function DangerZone({ onDisconnect }: DangerZoneProps) {
  return (
    <div style={{ border: '0.5px solid var(--error)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--error)', marginBottom: 3 }}>Danger zone</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Disconnecting will remove this provider and stop any in-flight requests.</div>
      </div>
      <Button variant="danger" small onClick={onDisconnect} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        Disconnect provider
      </Button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Providers() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [modal, setModal] = useState<ModalState | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    providersApi.list().then(setProviders).catch(() => {})
  }, [])

  const CUSTOM_INTEGRATION_TYPES: string[] = ['http-json', 'script', 'webhook']

  function buildModal(preset: PresetProvider, existing?: Provider): ModalState {
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
        replacingKey: !existing.apiKey,
        newKey: '',
        testModelId: existing.models[0] ?? '',
        testing: false,
        fetchingModels: false,
        testResult: null,
        advancedOpen: true,
        defaults: existing.defaults ?? { ...DEFAULT_DEFAULTS },
      }
    }
    const p: Provider = {
      id: uid(),
      name: preset.name,
      type: preset.type,
      apiKey: '',
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
      advancedOpen: true,
      defaults: { ...DEFAULT_DEFAULTS },
    }
  }

  function openPreset(preset: PresetProvider) {
    const existing = providers.find(p => p.name === preset.name)
    setModal(buildModal(preset, existing))
  }

  function openCustom() {
    const p: Provider = { id: uid(), name: '', type: 'openai-compatible', apiKey: '', baseUrl: '', models: [], enabled: true }
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
      advancedOpen: true,
      defaults: { ...DEFAULT_DEFAULTS },
    })
  }

  function openExistingCustom(p: Provider) {
    setModal({
      provider: p,
      selectedModels: new Set(p.models),
      availableModels: p.models,
      manualMode: true,
      manualText: p.models.join(', '),
      modelSearch: '',
      replacingKey: !p.apiKey,
      newKey: '',
      testModelId: p.models[0] ?? '',
      testing: false,
      fetchingModels: false,
      testResult: null,
      advancedOpen: true,
      defaults: p.defaults ?? { ...DEFAULT_DEFAULTS },
    })
  }

  function updateModal(patch: Partial<ModalState>) {
    setModal(m => m ? { ...m, ...patch } : m)
  }

  function updateProvider(patch: Partial<Provider>) {
    setModal(m => m ? { ...m, provider: { ...m.provider, ...patch } } : m)
  }

  function getFinalModels(m: ModalState): string[] {
    if (m.manualMode) return m.manualText.split(',').map(s => s.trim()).filter(Boolean)
    return [...m.selectedModels]
  }

  function getFinalProvider(m: ModalState): Provider {
    return {
      ...m.provider,
      apiKey: m.replacingKey ? m.newKey : (m.provider.apiKey ?? ''),
      models: getFinalModels(m),
      defaults: m.defaults,
    }
  }

  function syncProviders(saved: Provider) {
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

  async function handleTest() {
    if (!modal) return
    updateModal({ testing: true, testResult: null })
    try {
      const saved = await providersApi.upsert(getFinalProvider(modal))
      syncProviders(saved)
      const result = await providersApi.test(saved.id, modal.testModelId || undefined)
      updateModal({ testing: false, testResult: result, provider: saved })
    } catch (err) {
      updateModal({ testing: false, testResult: { ok: false, error: err instanceof Error ? err.message : String(err) } })
    }
  }

  async function handleFetchModels() {
    if (!modal) return
    updateModal({ fetchingModels: true })
    try {
      const saved = await providersApi.upsert(getFinalProvider(modal))
      syncProviders(saved)
      const fetched = await providersApi.fetchModels(saved.id)
      setModal(m => {
        if (!m) return m
        const merged = [...new Set([...fetched, ...m.availableModels])]
        return { ...m, provider: saved, availableModels: merged, fetchingModels: false, manualMode: false }
      })
    } catch {
      updateModal({ fetchingModels: false })
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

  interface Tile { key: string; provider: Provider; onClick: () => void }

  function stub(preset: PresetProvider): Provider {
    return { id: '', name: preset.name, type: preset.type, models: [], enabled: false }
  }

  const presetTiles = PRESET_PROVIDERS.map(preset => {
    const connected = providerMap.get(preset.name)
    return { preset, connected, active: !!connected && isProviderActive(connected) }
  })
  const customProviders = providers.filter(p => !presetNames.has(p.name))

  const activeTiles: Tile[] = [
    ...presetTiles.filter(t => t.active).map(t => ({ key: t.preset.name, provider: t.connected!, onClick: () => openPreset(t.preset) })),
    ...customProviders.filter(isProviderActive).map(p => ({ key: p.id, provider: p, onClick: () => openExistingCustom(p) })),
  ]
  const localTiles: Tile[] = presetTiles
    .filter(t => !t.active && t.preset.type === 'local')
    .map(t => ({ key: t.preset.name, provider: t.connected ?? stub(t.preset), onClick: () => openPreset(t.preset) }))
  const otherTiles: Tile[] = presetTiles
    .filter(t => !t.active && t.preset.type !== 'local')
    .map(t => ({ key: t.preset.name, provider: t.connected ?? stub(t.preset), onClick: () => openPreset(t.preset) }))
  const inactiveCustomProviders = customProviders.filter(p => !isProviderActive(p))

  function TileGrid({ title, tiles, trailingButton }: { title: string; tiles: Tile[]; trailingButton?: React.ReactNode }) {
    if (tiles.length === 0 && !trailingButton) return null
    return (
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {tiles.map(tile => (
            <ProviderTile key={tile.key} provider={tile.provider} onClick={tile.onClick} />
          ))}
          {trailingButton}
        </div>
      </div>
    )
  }

  const isConnected = modal ? !!providers.find(p => p.id === modal.provider.id) : false
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

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h1 style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-bright)' }}>Providers</h1>

      <TileGrid title="Active" tiles={activeTiles} />
      <TileGrid title="Local" tiles={localTiles} />
      <TileGrid
        title="Custom"
        tiles={inactiveCustomProviders.map(p => ({ key: p.id, provider: p, onClick: () => openExistingCustom(p) }))}
        trailingButton={
          <button
            onClick={openCustom}
            style={{ background: 'none', border: '0.5px dashed var(--border)', borderRadius: 'var(--radius-md)', padding: 16, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}
          >
            + custom endpoint
          </button>
        }
      />
      <TileGrid title="Other" tiles={otherTiles} />

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

            {/* Scrollable content */}
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <ProviderHeader
                name={modal.provider.name || 'Custom provider'}
                subtitle={modal.preset?.subtitle ?? 'Custom endpoint · OpenAI-style API'}
                connected={isConnected}
                docsUrl={modal.preset?.docsUrl}
              />

              {!isLocal && !isScript && (
                <ApiKeySection
                  apiKey={modal.provider.apiKey ?? ''}
                  replacingKey={modal.replacingKey}
                  newKey={modal.newKey}
                  placeholder={modal.preset?.placeholderKey ?? 'sk-…'}
                  onStartReplace={() => updateModal({ replacingKey: true })}
                  onNewKeyChange={v => updateModal({ newKey: v })}
                />
              )}

              {isCustom && (
                <div>
                  <SectionLabel>PROVIDER NAME</SectionLabel>
                  <input className="prov-input" type="text" value={modal.provider.name} onChange={e => updateProvider({ name: e.target.value })} placeholder="My Provider" />
                </div>
              )}

              {showBaseUrlAbove && (
                <BaseUrlSection
                  baseUrl={modal.provider.baseUrl ?? ''}
                  onChange={v => updateProvider({ baseUrl: v })}
                  label={baseUrlLabel(modal.provider.type)}
                  placeholder={baseUrlPlaceholder(modal.provider.type)}
                />
              )}

              <ModelsSection
                available={modal.availableModels}
                selected={modal.selectedModels}
                search={modal.modelSearch}
                manualMode={modal.manualMode}
                manualText={modal.manualText}
                fetchingModels={modal.fetchingModels}
                onToggle={toggleModelSelection}
                onSearchChange={v => updateModal({ modelSearch: v })}
                onManualModeToggle={() => updateModal({ manualMode: !modal.manualMode })}
                onManualTextChange={v => updateModal({ manualText: v })}
                onFetchModels={handleFetchModels}
              />

              <TestSection
                models={currentSelectedList}
                testModelId={modal.testModelId}
                testing={modal.testing}
                result={modal.testResult}
                onModelChange={v => updateModal({ testModelId: v })}
                onTest={handleTest}
              />

              <AdvancedDefaultsSection
                open={modal.advancedOpen}
                onToggle={() => updateModal({ advancedOpen: !modal.advancedOpen })}
                baseUrl={modal.provider.baseUrl ?? ''}
                onBaseUrlChange={v => updateProvider({ baseUrl: v })}
                showBaseUrl={!showBaseUrlAbove}
                defaults={modal.defaults}
                onChange={patch => updateModal({ defaults: { ...modal.defaults, ...patch } })}
              />
            </div>

            {/* Sticky footer */}
            <div style={{ padding: '16px 24px', borderTop: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ModalFooter onCancel={() => setModal(null)} onSave={handleSave} saving={saving} />
              {isConnected && <DangerZone onDisconnect={handleDisconnect} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
