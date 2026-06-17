import { useState, useEffect } from 'react'
import { getTheme, setTheme, watchSystem, type Theme } from '../theme'

const SEGMENT_CSS = `
  .seg-btn {
    padding: 5px 14px;
    font-size: 11px;
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: calc(var(--radius-sm) - 1px);
    transition: color 0.15s, background 0.15s;
  }
  .seg-btn:hover { color: var(--text-secondary); }
  .seg-btn.active {
    background: var(--bg-base);
    color: var(--text-bright);
    box-shadow: 0 0 0 0.5px var(--border-hover);
  }
`

export function Settings() {
  const [theme, setThemeState] = useState<Theme>(getTheme)

  useEffect(() => {
    if (theme === 'system') {
      return watchSystem(() => setTheme('system'))
    }
  }, [theme])

  function applyTheme(t: Theme) {
    setTheme(t)
    setThemeState(t)
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 480 }}>
      <style>{SEGMENT_CSS}</style>
      <h1 style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-bright)' }}>Настройки</h1>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel>Внешний вид</SectionLabel>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          background: 'var(--bg-elevated)',
          border: '0.5px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Тема</span>
          <div style={{
            display: 'inline-flex',
            background: 'var(--bg-elevated)',
            border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 2,
            gap: 1,
          }}>
            {(['dark', 'light', 'system'] as const).map(t => (
              <button
                key={t}
                className={`seg-btn${theme === t ? ' active' : ''}`}
                onClick={() => applyTheme(t)}
              >
                {t === 'dark' ? 'Тёмная' : t === 'light' ? 'Светлая' : 'Система'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel>Сервер</SectionLabel>
        <Row label="Порт" value="4242" mono />
        <Row label="Конфиг" value="~/.benchy/config.json" mono />
        <Row label="База данных" value="~/.benchy/benchy.db" mono />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionLabel>О приложении</SectionLabel>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          benchy — self-hosted инструмент для бенчмаркинга LLM-моделей.
          {' '}<a href="https://github.com/benchyhq/benchy" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>GitHub →</a>
        </div>
      </section>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
      {children}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 12px',
      background: 'var(--bg-elevated)',
      border: '0.5px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit', fontSize: 11, color: 'var(--text-muted)' }}>{value}</span>
    </div>
  )
}
