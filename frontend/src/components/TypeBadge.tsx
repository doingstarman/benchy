import type { TargetKind } from '../../../src/types'
import { useT } from '../i18n'

const LABEL: Record<TargetKind, string> = {
  model: 'models.kindModel', agent: 'models.kindAgent', pipeline: 'models.kindPipeline',
}

// Shape carries the meaning, not colour: model = solid border, agent = dashed,
// pipeline = a barred left edge. Kept greyscale so it never competes with the
// accent (rules/ui.md).
export function TypeBadge({ kind }: { kind: TargetKind }) {
  const { t } = useT()
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--text-secondary)', padding: '1px 6px',
      borderRadius: 'var(--radius-sm)',
      border: `1px ${kind === 'agent' ? 'dashed' : 'solid'} var(--border-hover)`,
      borderLeftWidth: kind === 'pipeline' ? 3 : 1,
    }}>{t(LABEL[kind])}</span>
  )
}
