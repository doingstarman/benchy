import { useEffect, useState } from 'react'
import { versionApi, type VersionInfo } from '../api'
import { IconCopy, IconCheck, IconClose, IconCollapse, IconArrowUp } from './icons'
import { IconButton } from './ui'
import { useT } from '../i18n'

const UPDATE_CMD = 'benchy update'
// The latest build the user dismissed the "update available" banner for — the
// banner returns only when a *different* update lands, not for the same one.
const DISMISSED_KEY = 'benchy-update-dismissed'
// The running build the user last acknowledged — a later change to it is what
// the post-update "benchy updated" note keys off.
const SEEN_KEY = 'benchy-version-seen'

const read = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

function shortDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// Passive discovery: on load the server tells us (from its 30-min cache) whether
// a newer build is installable, and whether the running build changed since the
// user last saw it. Two states, one banner: purple "update available" (compact,
// expands to a changelog card) and green "benchy updated".
export function UpdateBanner() {
  const { t } = useT()
  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(() => read(DISMISSED_KEY))
  const [ackUpdated, setAckUpdated] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => { versionApi.get().then(setInfo).catch(() => {}) }, [])

  // Record the running build on the first ever load, so the post-update note only
  // fires on a LATER change — never the very first time the app is opened.
  useEffect(() => {
    if (!info || info.current.builtAt == null || info.current.sha === 'dev') return
    if (read(SEEN_KEY) == null) write(SEEN_KEY, info.current.builtAt)
  }, [info])

  if (!info) return null

  async function copyCommand() {
    await navigator.clipboard.writeText(UPDATE_CMD).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const glyph = (color: string, node: React.ReactNode) => (
    <span style={{ color, flexShrink: 0, display: 'flex' }}>{node}</span>
  )
  const command = (
    <code style={{
      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-bright)',
      background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 5, padding: '2px 7px',
    }}>{UPDATE_CMD}</code>
  )

  // ── Update available — purple ──────────────────────────────────────────────
  if (info.hasUpdate && info.latest) {
    const buildId = info.latest.builtAt ?? info.latest.sha
    if (dismissedUpdate !== buildId) {
      const sha = info.latest.sha && info.latest.sha !== 'unknown' ? info.latest.sha : null
      const date = shortDate(info.latest.commitDate)
      const dismiss = () => { setDismissedUpdate(buildId); write(DISMISSED_KEY, buildId) }

      const shell = (children: React.ReactNode, gap: number, padding: string): React.ReactElement => (
        <div style={{
          flexShrink: 0, margin: '10px 16px 0', padding,
          background: 'var(--accent-bg)', border: '0.5px solid var(--accent-dim)',
          borderRadius: 8, display: 'flex', flexDirection: 'column', gap,
        }}>{children}</div>
      )

      if (!expanded) {
        // 1b — compact one-liner: nothing below it moves.
        return shell(
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {glyph('var(--accent)', <IconArrowUp size={13} />)}
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('update.available')}
              {sha && <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{sha}</span>}
            </span>
            {command}
            <IconButton onClick={copyCommand} title={copied ? t('update.copied') : t('update.copyCommand')} style={{ width: 22, height: 22, border: 'none' }}>
              {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
            </IconButton>
            {info.changes.length > 0 && (
              <>
                <div style={{ width: 0.5, height: 14, background: 'var(--accent-dim)', flexShrink: 0 }} />
                <button onClick={() => setExpanded(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {t('update.changesN', { n: info.changes.length })}
                </button>
              </>
            )}
            <IconButton onClick={dismiss} title={t('update.dismiss')} style={{ width: 22, height: 22, border: 'none' }}>
              <IconClose size={11} />
            </IconButton>
          </div>, 8, '9px 12px',
        )
      }

      // 1c — expanded card: versions, changelog, copy, GitHub link.
      return shell(
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
            {glyph('var(--accent)', <span style={{ marginTop: 2, display: 'flex' }}><IconArrowUp size={13} /></span>)}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 13, color: 'var(--text-bright)' }}>{t('update.available')}</span>
              {(sha || date) && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  {[sha, date].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
            <IconButton onClick={() => setExpanded(false)} title={t('update.collapse')} style={{ width: 22, height: 22, border: 'none' }}>
              <IconCollapse size={11} />
            </IconButton>
            <IconButton onClick={dismiss} title={t('update.dismiss')} style={{ width: 22, height: 22, border: 'none' }}>
              <IconClose size={11} />
            </IconButton>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 24 }}>
            {info.changes.map(c => (
              <div key={c.sha} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 9 }}>
                <span style={{ color: 'var(--accent)', flexShrink: 0 }}>·</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message}</span>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: 'var(--hairline-accent)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 24, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('update.runCommand')}</span>
            {command}
            <button onClick={copyCommand} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 7,
              fontSize: 12, fontFamily: 'var(--font-mono)', padding: '5px 12px',
              background: 'var(--accent)', border: '0.5px solid transparent', color: 'var(--on-accent)', cursor: 'pointer',
            }}>
              {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
              {copied ? t('update.copied') : t('update.copyShort')}
            </button>
            <div style={{ flex: 1 }} />
            <a href={info.repoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
              {t('update.releaseNotes')}
            </a>
          </div>
        </>, 12, '12px 14px',
      )
    }
  }

  // ── Just updated — green ────────────────────────────────────────────────────
  const builtAt = info.current.builtAt
  if (!info.hasUpdate && builtAt != null && info.current.sha !== 'dev' && !ackUpdated) {
    const seen = read(SEEN_KEY)
    if (seen != null && seen !== builtAt) {
      const sha = info.current.sha && info.current.sha !== 'unknown' ? info.current.sha : null
      const ack = () => { setAckUpdated(true); write(SEEN_KEY, builtAt) }
      return (
        <div style={{
          flexShrink: 0, margin: '10px 16px 0', padding: '9px 12px',
          background: 'var(--success-bg)', border: '0.5px solid var(--success-dim)',
          borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {glyph('var(--success)', <IconCheck size={13} />)}
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('update.updated')}
              {sha && <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{sha}</span>}
            </span>
            <button onClick={ack} style={{ background: 'none', border: 'none', color: 'var(--success)', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>
              {t('update.dismiss')}
            </button>
            <IconButton onClick={ack} title={t('update.dismiss')} style={{ width: 22, height: 22, border: 'none' }}>
              <IconClose size={11} />
            </IconButton>
          </div>
          {info.changes.length > 0 && (
            <div style={{ paddingLeft: 23, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{t('update.whatsAdded')}</div>
              {info.changes.slice(0, 4).map(c => (
                <div key={c.sha} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 9 }}>
                  <span style={{ color: 'var(--success)', flexShrink: 0 }}>·</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.message}</span>
                </div>
              ))}
              <a href={info.repoUrl} target="_blank" rel="noreferrer" style={{ marginTop: 3, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>
                {t('update.fullChangelog')}
              </a>
            </div>
          )}
        </div>
      )
    }
  }

  return null
}
