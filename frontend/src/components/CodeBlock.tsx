import { useState, useEffect } from 'react'
import { ArtifactPreview } from './ArtifactPreview'
import { IconButton } from './ui'
import { IconCopy, IconCheck, IconPlay, IconRefresh, IconText, IconExpand, IconCollapse, IconClose } from './icons'
import { isRunnableCode, type CodeSegment } from '../lib/artifact'
import { useT } from '../i18n'

interface CodeBlockProps {
  segment: CodeSegment
  // In a fullscreen cell the fixed 280px window wastes most of the screen —
  // let the block grow to fill instead.
  fill?: boolean
}

// ChatGPT-style windowed code block: header with language + actions, body
// toggles between the code listing and a sandboxed live preview.
export function CodeBlock({ segment, fill }: CodeBlockProps) {
  const { t } = useT()
  const [running, setRunning] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [copied, setCopied] = useState(false)
  const [nonce, setNonce] = useState(0)
  const runnable = isRunnableCode(segment)

  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaximized(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [maximized])

  async function copyCode() {
    await navigator.clipboard.writeText(segment.content).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div style={{
      border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)',
      overflow: 'hidden', margin: '10px 0', background: 'var(--bg-base)',
      display: 'flex', flexDirection: 'column',
      ...(fill ? { flex: 1, minHeight: 200 } : {}),
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 12px',
        borderBottom: '0.5px solid var(--border)', background: 'var(--bg-elevated)',
      }}>
        <span style={{ flex: 1, fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {segment.lang}{segment.open ? ` · ${t('code.streaming')}` : ''}
        </span>
        <IconButton onClick={copyCode} title={t('code.copyCode')}>
          {copied ? <IconCheck /> : <IconCopy />}
        </IconButton>
        {runnable && !running && (
          <IconButton onClick={() => setRunning(true)} title={t('code.run')}><IconPlay /></IconButton>
        )}
        {running && (
          <>
            <IconButton onClick={() => setNonce(n => n + 1)} title={t('code.restart')}><IconRefresh /></IconButton>
            <IconButton onClick={() => setMaximized(true)} title={t('code.fullscreen')}><IconExpand /></IconButton>
            <IconButton onClick={() => setRunning(false)} title={t('code.showCode')} active><IconText /></IconButton>
          </>
        )}
      </div>
      {running ? (
        <div style={{ display: 'flex', ...(fill ? { flex: 1, minHeight: 0 } : { height: 360 }) }}>
          {/* While maximized the iframe lives in the overlay below — an iframe
              can't be mounted in two places, and remounting would restart the
              program. Keep the inline slot sized but empty. */}
          {!maximized && <ArtifactPreview html={segment.content} reloadKey={nonce} />}
        </div>
      ) : (
        <pre style={{
          margin: 0, padding: 12, overflow: 'auto',
          ...(fill ? { flex: 1, minHeight: 0 } : { maxHeight: 280 }),
          fontSize: 'var(--fs-md)', fontFamily: 'var(--font-mono)', lineHeight: 1.6,
          color: 'var(--text-secondary)', whiteSpace: 'pre',
        }}>
          {segment.content}
        </pre>
      )}

      {maximized && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)',
            display: 'flex', flexDirection: 'column', padding: 20,
          }}
          onClick={() => setMaximized(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
              border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden',
              background: 'var(--bg-base)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 12px',
              borderBottom: '0.5px solid var(--border)', background: 'var(--bg-elevated)',
            }}>
              <span style={{ flex: 1, fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {segment.lang}
              </span>
              <IconButton onClick={() => setNonce(n => n + 1)} title={t('code.restart')}><IconRefresh /></IconButton>
              <IconButton onClick={() => setMaximized(false)} title={t('code.exitFullscreen')} active><IconCollapse /></IconButton>
              <IconButton onClick={() => setMaximized(false)} title={t('common.close')}><IconClose /></IconButton>
            </div>
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <ArtifactPreview html={segment.content} reloadKey={nonce} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
