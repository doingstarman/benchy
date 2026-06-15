import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { providersApi, benchmarkApi } from '../api'
import type { Provider } from '../../../src/types'

export function NewRun() {
  const navigate = useNavigate()
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [prompts, setPrompts] = useState<string[]>([''])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    providersApi.list().then(setProviders).catch(() => {})
  }, [])

  function toggleModel(key: string) {
    setSelectedModels(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function updatePrompt(i: number, val: string) {
    setPrompts(prev => prev.map((p, idx) => idx === i ? val : p))
  }

  function addPrompt() { setPrompts(prev => [...prev, '']) }
  function removePrompt(i: number) { setPrompts(prev => prev.filter((_, idx) => idx !== i)) }

  async function handleRun() {
    setError(null)
    const filledPrompts = prompts.filter(p => p.trim())
    if (!filledPrompts.length) { setError('Add at least one prompt'); return }
    if (!selectedModels.size) { setError('Select at least one model'); return }

    setRunning(true)
    try {
      const { runId } = await benchmarkApi.start({ prompts: filledPrompts, models: [...selectedModels] })
      navigate(`/results/${runId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run')
      setRunning(false)
    }
  }

  const totalCalls = selectedModels.size * prompts.filter(p => p.trim()).length

  const connectedProviders = providers.filter(p => p.enabled && (p.apiKey || p.baseUrl))

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Left: model selector */}
      <div style={{
        width: 240,
        minWidth: 240,
        borderRight: '0.5px solid var(--border)',
        padding: '24px 0',
        overflowY: 'auto',
      }}>
        <div style={{ padding: '0 16px 12px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Models
        </div>
        {connectedProviders.length === 0 && (
          <div style={{ padding: '0 16px', color: 'var(--text-muted)', fontSize: 12 }}>
            No providers connected.{' '}
            <a href="/providers" style={{ color: 'var(--accent)' }}>Add one →</a>
          </div>
        )}
        {connectedProviders.map(provider => (
          <div key={provider.id}>
            <div style={{ padding: '8px 16px 4px', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
              {provider.name}
            </div>
            {provider.models.map(model => {
              const key = `${provider.id}:${model}`
              const selected = selectedModels.has(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleModel(key)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '5px 16px',
                    background: selected ? 'var(--accent-bg)' : 'none',
                    border: 'none',
                    color: selected ? 'var(--accent)' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {selected ? '✓ ' : '  '}{model}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* Right: prompts + run */}
      <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-bright)' }}>New Run</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              {selectedModels.size} × {prompts.filter(p => p.trim()).length} = {totalCalls} calls
            </span>
            <button
              onClick={handleRun}
              disabled={running || totalCalls === 0}
              style={{
                background: running || totalCalls === 0 ? 'var(--accent-dim)' : 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '7px 18px',
                fontSize: 13,
                fontWeight: 500,
                cursor: running || totalCalls === 0 ? 'not-allowed' : 'pointer',
                opacity: running || totalCalls === 0 ? 0.6 : 1,
              }}
            >
              {running ? 'Starting…' : 'Run'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', background: 'var(--error-bg)', border: '0.5px solid var(--error)', borderRadius: 'var(--radius-sm)', color: 'var(--error)', fontSize: 12 }}>
            {error}
          </div>
        )}

        {prompts.map((prompt, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                Prompt {i + 1}
              </span>
              {prompts.length > 1 && (
                <button
                  onClick={() => removePrompt(i)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
                >
                  remove
                </button>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={e => updatePrompt(i, e.target.value)}
              placeholder="Enter your prompt…"
              rows={6}
              style={{
                width: '100%',
                background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
              }}
              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border)')}
            />
          </div>
        ))}

        <button
          onClick={addPrompt}
          style={{
            background: 'none',
            border: '0.5px dashed var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px',
            color: 'var(--text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            textAlign: 'center',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          + add prompt
        </button>
      </div>
    </div>
  )
}
