import type { ReactNode } from 'react'
import { IconButton } from './ui'
import { IconRefresh } from './icons'
import { useT } from '../i18n'

// One override row in the participant editor: a field control (the child, e.g. a
// SliderField) plus a badge saying whether the value is inherited from the
// connection or overridden here, and a revert-to-inherited action when it is
// overridden. Shared so agent/pipeline editors get the same affordance.
export function InheritedField({ overridden, onRevert, children }: {
  overridden: boolean
  onRevert: () => void
  children: ReactNode
}) {
  const { t } = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <span style={{
        fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
        color: overridden ? 'var(--accent)' : 'var(--text-muted)',
      }}>{overridden ? t('models.overridden') : t('models.inherited')}</span>
      <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}>
        {overridden && (
          <IconButton onClick={onRevert} title={t('models.revert')}><IconRefresh size={12} /></IconButton>
        )}
      </span>
    </div>
  )
}
