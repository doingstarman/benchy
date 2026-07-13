import { useEffect, useState } from 'react'
import { versionApi, type VersionInfo } from '../api'
import { IconCopy, IconCheck, IconClose } from './icons'
import { IconButton } from './ui'
import { useT } from '../i18n'

const UPDATE_CMD = 'benchy update'
const DISMISSED_KEY = 'benchy-update-dismissed'

// Passive discovery: on load the server tells us (from its 30-min cache) whether
// a newer build is installable. Dismissal is keyed by the latest build's id, so
// the banner returns when a *different* update lands — not for the same one.
export function UpdateBanner() {
  const { t } = useT()
  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return localStorage.getItem(DISMISSED_KEY) } catch { return null }
  })
  const [showChanges, setShowChanges] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    versionApi.get().then(setInfo).catch(() => {})
  }, [])

  if (!info?.hasUpdate || !info.latest) return null
  const buildId = info.latest.builtAt ?? info.latest.sha
  if (dismissed === buildId) return null

  function dismiss() {
    setDismissed(buildId)
    try { localStorage.setItem(DISMISSED_KEY, buildId) } catch { /* ignore */ }
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(UPDATE_CMD).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{
      flexShrink: 0, margin: '10px 16px 0', padding: '9px 12px',
      background: 'var(--accent-bg)', border: '0.5px solid var(--accent-dim)',
      borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: 'var(--accent)', flexShrink: 0, fontSize: 13 }}>⬆</span>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)' }}>
          {t('update.available')}
          {info.latest.sha && info.latest.sha !== 'unknown' && (
            <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              {info.latest.sha}
            </span>
          )}
        </span>
        {info.changes.length > 0 && (
          <button
            onClick={() => setShowChanges(v => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
          >
            {showChanges ? t('update.hideChanges') : t('update.showChanges')}
          </button>
        )}
        <IconButton onClick={dismiss} title={t('update.dismiss')} style={{ width: 22, height: 22, border: 'none' }}>
          <IconClose size={11} />
        </IconButton>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 23 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('update.runCommand')}</span>
        <code style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-bright)',
          background: 'var(--bg-base)', border: '0.5px solid var(--border)',
          borderRadius: 5, padding: '2px 7px',
        }}>
          {UPDATE_CMD}
        </code>
        <IconButton onClick={copyCommand} title={copied ? t('update.copied') : t('update.copyCommand')} style={{ width: 22, height: 22, border: 'none' }}>
          {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
        </IconButton>
      </div>

      {showChanges && info.changes.length > 0 && (
        <div style={{ paddingLeft: 23, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {info.changes.map(c => (
            <div key={c.sha} style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flexShrink: 0 }}>{c.sha}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
