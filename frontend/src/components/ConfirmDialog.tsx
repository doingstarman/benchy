import { useEffect } from 'react'
import { Button } from './ui'
import { useT } from '../i18n'

// In-app replacement for window.confirm — styled to benchy's UI (native confirm
// also can't be themed and isn't implemented in jsdom, so it was untestable).
// Backdrop click and Escape cancel; Enter confirms.
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, padding: 20,
        background: 'var(--overlay, rgba(0,0,0,0.5))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{
          width: 380, maxWidth: '92vw', background: 'var(--bg-elevated)',
          border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)',
          padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-bright)' }}>{title}</div>
        {message && <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{message}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <Button small onClick={onCancel}>{cancelLabel ?? t('common.cancel')}</Button>
          <Button small variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel ?? t('common.save')}</Button>
        </div>
      </div>
    </div>
  )
}
