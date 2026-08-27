import type { ReactNode } from 'react'
import { Button } from './ui'

// One empty-state schema (empty-states.dc.html): a muted 18px entity icon, a
// one-line definition (what it is), a reason it's empty (≤90 chars), and exactly one
// primary action — plus an optional "where to get it" hint as text, never a second
// button. Left-aligned in a 460px column: centred text on an empty screen reads as an
// error, not a working state.
export function EmptyState({ icon, title, description, actionLabel, onAction, hint, onHint }: {
  icon?: ReactNode
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  hint?: string
  onHint?: () => void
}) {
  return (
    <div style={{ maxWidth: 460, padding: '40px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {icon && <div style={{ color: 'var(--text-muted)', display: 'flex' }}>{icon}</div>}
      <div style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-bright)', fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{description}</div>
      {(actionLabel || hint) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
          {actionLabel && <Button variant="primary" small onClick={onAction}>{actionLabel}</Button>}
          {hint && (
            onHint
              ? <button onClick={onHint} style={{ all: 'unset', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--accent)' }}>{hint} →</button>
              : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{hint}</span>
          )}
        </div>
      )}
    </div>
  )
}
