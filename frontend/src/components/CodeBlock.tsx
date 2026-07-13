import { useState } from 'react'
import { ArtifactPreview } from './ArtifactPreview'
import { IconButton } from './ui'
import { IconCopy, IconCheck, IconPlay, IconRefresh, IconText } from './icons'
import { isRunnableCode, type CodeSegment } from '../lib/artifact'
import { useT } from '../i18n'

interface CodeBlockProps {
  segment: CodeSegment
}

// ChatGPT-style windowed code block: header with language + actions, body
// toggles between the code listing and a sandboxed live preview.
export function CodeBlock({ segment }: CodeBlockProps) {
  const { t } = useT()
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [nonce, setNonce] = useState(0)
  const runnable = isRunnableCode(segment)

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
            <IconButton onClick={() => setRunning(false)} title={t('code.showCode')} active><IconText /></IconButton>
          </>
        )}
      </div>
      {running ? (
        <div style={{ height: 360, display: 'flex' }}>
          <ArtifactPreview html={segment.content} reloadKey={nonce} />
        </div>
      ) : (
        <pre style={{
          margin: 0, padding: 12, overflow: 'auto', maxHeight: 280,
          fontSize: 'var(--fs-md)', fontFamily: 'var(--font-mono)', lineHeight: 1.6,
          color: 'var(--text-secondary)', whiteSpace: 'pre',
        }}>
          {segment.content}
        </pre>
      )}
    </div>
  )
}
