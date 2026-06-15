import { useState, useEffect } from 'react'
import { providersApi } from '../api'
import { ProviderTile } from '../components/ProviderTile'
import type { Provider, ProviderType } from '../../../src/types'

// Browser-safe UUID
function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const PRESET_PROVIDERS: Array<{ name: string; type: ProviderType; baseUrl?: string; placeholderKey?: string; defaultModels: string[] }> = [
  { name: 'OpenAI', type: 'openai', placeholderKey: 'sk-…', defaultModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
  { name: 'Anthropic', type: 'anthropic', placeholderKey: 'sk-ant-…', defaultModels: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'] },
  { name: 'Google', type: 'google', placeholderKey: 'AIza…', defaultModels: ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'] },
  { name: 'Mistral', type: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', defaultModels: ['mistral-large-latest', 'mistral-small-latest'] },
  { name: 'DeepSeek', type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', defaultModels: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'xAI', type: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', defaultModels: ['grok-4', 'grok-3'] },
  { name: 'Groq', type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', defaultModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  { name: 'Together AI', type: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', defaultModels: [] },
  { name: 'OpenRouter', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModels: [] },
  { name: 'Ollama', type: 'local', baseUrl: 'http://localhost:11434/v1', defaultModels: [] },
  { name: 'LM Studio', type: 'local', baseUrl: 'http://localhost:1234/v1', defaultModels: [] },
]

const SECTIONS = [
  { title: 'Frontier', names: ['OpenAI', 'Anthropic', 'Google', 'Mistral', 'DeepSeek', 'xAI'] },
  { title: 'Fast inference', names: ['Groq', 'Together AI', 'OpenRouter'] },
  { title: 'Local', names: ['Ollama', 'LM Studio'] },
]

interface ModalState {
  provider: Provider
  preset?: typeof PRESET_PROVIDERS[0]
  modelsText: string
  testing: boolean
  testResult: { ok: boolean; error?: string } | null
}

export function Providers() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [modal, setModal] = useState<ModalState | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    providersApi.list().then(setProviders).catch(() => {})
  }, [])

  function openPreset(preset: typeof PRESET_PROVIDERS[0]) {
    const existing = providers.find(p => p.name === preset.name)
    const p: Provider = existing ?? {
      id: uid(),
      name: preset.name,
      type: preset.type,
      apiKey: '',
      baseUrl: preset.baseUrl,
      models: preset.defaultModels,
      enabled: true,
    }
    setModal({ provider: p, preset, modelsText: p.models.join(', '), testing: false, testResult: null })
  }

  function openCustom() {
    const p: Provider = { id: uid(), name: '', type: 'custom', apiKey: '', baseUrl: '', models: [], enabled: true }
    setModal({ provider: p, modelsText: '', testing: false, testResult: null })
  }

  async function handleSave() {
    if (!modal) return
    setSaving(true)
    const models = modal.modelsText.split(',').map(m => m.trim()).filter(Boolean)
    try {
      const saved = await providersApi.upsert({ ...modal.provider, models })
      setProviders(prev => {
        const idx = prev.findIndex(p => p.id === saved.id)
        return idx >= 0 ? prev.map((p, i) => i === idx ? saved : p) : [...prev, saved]
      })
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
    setModal(m => m ? { ...m, testing: true, testResult: null } : m)
    // Save first, then test
    const models = modal.modelsText.split(',').map(m => m.trim()).filter(Boolean)
    const saved = await providersApi.upsert({ ...modal.provider, models })
    const result = await providersApi.test(saved.id)
    setProviders(prev => {
      const idx = prev.findIndex(p => p.id === saved.id)
      return idx >= 0 ? prev.map((p, i) => i === idx ? saved : p) : [...prev, saved]
    })
    setModal(m => m ? { ...m, provider: saved, testing: false, testResult: result } : m)
  }

  function updateModal(patch: Partial<Provider>) {
    setModal(m => m ? { ...m, provider: { ...m.provider, ...patch } } : m)
  }

  const providerMap = new Map(providers.map(p => [p.name, p]))

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h1 style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-bright)' }}>Providers</h1>

      {SECTIONS.map(section => (
        <div key={section.title}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
            {section.title}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {section.names.map(name => {
              const preset = PRESET_PROVIDERS.find(p => p.name === name)!
              const connected = providerMap.get(name)
              return (
                <ProviderTile
                  key={name}
                  provider={connected ?? { id: '', name, type: preset.type, models: preset.defaultModels, enabled: false }}
                  onClick={() => openPreset(preset)}
                />
              )
            })}
          </div>
        </div>
      ))}

      {/* Custom */}
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
          Custom
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {providers.filter(p => !SECTIONS.flatMap(s => s.names).includes(p.name)).map(p => (
            <ProviderTile key={p.id} provider={p} onClick={() => setModal({ provider: p, modelsText: p.models.join(', '), testing: false, testResult: null })} />
          ))}
          <button
            onClick={openCustom}
            style={{
              background: 'none', border: '0.5px dashed var(--border)',
              borderRadius: 'var(--radius-md)', padding: 16, cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 12, textAlign: 'center',
            }}
          >
            + custom endpoint
          </button>
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setModal(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
        >
          <div style={{
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: 24, width: 440, display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-bright)' }}>
              {modal.provider.name || 'Custom provider'}
            </div>

            {!modal.preset && (
              <>
                <Field label="Name" value={modal.provider.name} onChange={v => updateModal({ name: v })} />
                <Field label="Base URL" value={modal.provider.baseUrl ?? ''} onChange={v => updateModal({ baseUrl: v })} placeholder="https://api.example.com/v1" />
              </>
            )}

            {modal.preset?.type !== 'local' && (
              <Field
                label="API Key"
                value={modal.provider.apiKey ?? ''}
                onChange={v => updateModal({ apiKey: v })}
                type="password"
                placeholder={modal.preset?.placeholderKey ?? 'sk-…'}
              />
            )}

            {modal.preset?.baseUrl && (
              <Field label="Base URL" value={modal.provider.baseUrl ?? modal.preset.baseUrl} onChange={v => updateModal({ baseUrl: v })} />
            )}

            <Field label="Models (comma separated)" value={modal.modelsText} onChange={v => setModal(m => m ? { ...m, modelsText: v } : m)} placeholder="model-1, model-2" />

            {modal.testResult && (
              <div style={{
                padding: '7px 10px', borderRadius: 'var(--radius-sm)',
                background: modal.testResult.ok ? 'var(--success-bg)' : 'var(--error-bg)',
                color: modal.testResult.ok ? 'var(--success)' : 'var(--error)',
                fontSize: 12, fontFamily: 'var(--font-mono)',
              }}>
                {modal.testResult.ok ? '✓ connection ok' : `✗ ${modal.testResult.error}`}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    background: 'var(--accent)', color: '#fff', border: 'none',
                    borderRadius: 'var(--radius-sm)', padding: '7px 16px', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={handleTest}
                  disabled={modal.testing}
                  style={{
                    background: 'none', border: '0.5px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', padding: '7px 16px', fontSize: 12,
                    color: 'var(--text-secondary)', cursor: 'pointer',
                  }}
                >
                  {modal.testing ? 'Testing…' : 'Test'}
                </button>
              </div>
              {providers.find(p => p.id === modal.provider.id) && (
                <button
                  onClick={handleDisconnect}
                  style={{
                    background: 'none', border: '0.5px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', padding: '7px 12px', fontSize: 12,
                    color: 'var(--error)', cursor: 'pointer',
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: 'var(--bg-base)', border: '0.5px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: '8px 10px',
          color: 'var(--text-primary)', outline: 'none',
          fontFamily: 'var(--font-mono)', fontSize: 12,
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
        onBlur={e => (e.target.style.borderColor = 'var(--border)')}
      />
    </div>
  )
}
