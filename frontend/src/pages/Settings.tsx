import { useState, useEffect } from 'react'
import { getTheme, setTheme, watchSystem, type Theme } from '../theme'
import { useT, type Lang } from '../i18n'
import { useShowReasoning, setShowReasoning } from '../prefs'
import { versionApi, type VersionInfo } from '../api'
import { Button } from '../components/ui'

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
  const { t, lang, setLang } = useT()
  const showReasoning = useShowReasoning()
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const [info, setInfo] = useState<VersionInfo | null>(null)

  useEffect(() => {
    versionApi.get().then(setInfo).catch(() => {})
  }, [])

  useEffect(() => {
    if (theme === 'system') {
      return watchSystem(() => setTheme('system'))
    }
  }, [theme])

  function applyTheme(th: Theme) {
    setTheme(th)
    setThemeState(th)
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 480 }}>
      <style>{SEGMENT_CSS}</style>
      <h1 style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-bright)' }}>{t('settings.title')}</h1>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel>{t('settings.appearance')}</SectionLabel>
        <SegmentRow label={t('settings.theme')}>
          {(['dark', 'light', 'system'] as const).map(th => (
            <button
              key={th}
              className={`seg-btn${theme === th ? ' active' : ''}`}
              onClick={() => applyTheme(th)}
            >
              {th === 'dark' ? t('settings.themeDark') : th === 'light' ? t('settings.themeLight') : t('settings.themeSystem')}
            </button>
          ))}
        </SegmentRow>
        <SegmentRow label={t('settings.language')}>
          {(['en', 'ru'] as const).map(l => (
            <button
              key={l}
              className={`seg-btn${lang === l ? ' active' : ''}`}
              onClick={() => setLang(l as Lang)}
            >
              {l === 'en' ? 'English' : 'Русский'}
            </button>
          ))}
        </SegmentRow>
        <SegmentRow label={t('settings.showReasoning')}>
          {([true, false] as const).map(on => (
            <button
              key={String(on)}
              className={`seg-btn${showReasoning === on ? ' active' : ''}`}
              onClick={() => setShowReasoning(on)}
              title={t('settings.showReasoningHint')}
            >
              {on ? t('common.on') : t('common.off')}
            </button>
          ))}
        </SegmentRow>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel>{t('settings.server')}</SectionLabel>
        <Row label={t('settings.port')} value={info?.runtime.port != null ? String(info.runtime.port) : '…'} mono />
        <Row label={t('settings.config')} value={info?.runtime.configPath ?? '…'} mono />
        <Row label={t('settings.database')} value={info?.runtime.dbPath ?? '…'} mono />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionLabel>{t('settings.about')}</SectionLabel>
        <UpdateRow info={info} onChecked={setInfo} />
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {t('settings.aboutText')}
          {info?.repoUrl && (
            <>{' '}<a href={info.repoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>GitHub →</a></>
          )}
        </div>
      </section>
    </div>
  )
}

function UpdateRow({ info, onChecked }: { info: VersionInfo | null; onChecked: (v: VersionInfo) => void }) {
  const { t } = useT()
  const [checking, setChecking] = useState(false)

  async function check() {
    setChecking(true)
    try {
      onChecked(await versionApi.get(true))
    } catch {
      if (info) onChecked({ ...info, checkError: 'network' })
    } finally {
      setChecking(false)
    }
  }

  const isDev = info?.current.builtAt == null
  // 'network' (couldn't reach GitHub) and 'missing' (GitHub has nothing to
  // compare against yet) are different truths — never report one as the other.
  const status = !info ? ''
    : isDev ? t('settings.devBuild')
    : info.checkError === 'network' ? t('settings.checkFailed')
    : info.checkError === 'missing' ? t('settings.noPublished')
    : info.hasUpdate ? `${t('update.available')} — \`benchy update\``
    : t('settings.upToDate')
  const statusColor = !info || isDev || info.checkError === 'missing' ? 'var(--text-muted)'
    : info.checkError === 'network' ? 'var(--warning)'
    : info.hasUpdate ? 'var(--accent)'
    : 'var(--success)'

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      padding: '8px 12px', background: 'var(--bg-elevated)',
      border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('settings.build')}
          <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            {info?.current.sha ?? '…'}
          </span>
        </span>
        {status && (
          <span style={{ fontSize: 11, color: statusColor, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {status}
          </span>
        )}
      </div>
      <Button small onClick={check} disabled={checking || isDev} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        {checking ? t('settings.checking') : t('settings.checkUpdates')}
      </Button>
    </div>
  )
}

function SegmentRow({ label, children }: { label: string; children: React.ReactNode }) {
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
      <div style={{
        display: 'inline-flex',
        background: 'var(--bg-elevated)',
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: 2,
        gap: 1,
      }}>
        {children}
      </div>
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
