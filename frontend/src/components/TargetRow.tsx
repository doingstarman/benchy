import type { Target, ProviderView, ProviderDefaults } from '../../../src/types'
import { resolvePricing } from '../../../src/pricing'
import { IconButton, PillToggle } from './ui'
import { IconPencil, IconCopy, IconTrash } from './icons'
import { TypeBadge } from './TypeBadge'
import { MetricCell } from './MetricCell'
import { useT } from '../i18n'

function overrideSummary(d: ProviderDefaults | undefined, inheritedText: string): string {
  if (!d) return inheritedText
  const parts: string[] = []
  if (d.temperature != null) parts.push(`temp ${d.temperature}`)
  if (d.topP != null) parts.push(`top_p ${d.topP}`)
  if (d.topK != null) parts.push(`top_k ${d.topK}`)
  if (d.maxOutputTokens != null) parts.push(`max ${d.maxOutputTokens}`)
  if (d.streaming === false) parts.push('no stream')
  return parts.length ? parts.join(' · ') : inheritedText
}

// One participant in the list. Presentational: pricing is real (config today),
// latency/throughput are placeholders until the metrics registry (stage 2).
export function TargetRow({ target, provider, orphaned, note, onEdit, onToggle, onDuplicate, onDelete }: {
  target: Target
  provider?: ProviderView
  orphaned: boolean
  note?: string
  onEdit: () => void
  onToggle: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t } = useT()
  const price = target.config.pricing ?? resolvePricing(target.config.model, provider?.pricing) ?? null
  const connName = provider?.name ?? target.config.providerId
  const lineage = `${connName} → ${target.config.model} → ${overrideSummary(target.config.defaults, t('models.inherited'))}`

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
      background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
      border: '0.5px solid var(--border)', opacity: target.enabled ? 1 : 0.55,
    }}>
      <TypeBadge kind={target.kind} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onEdit} style={{
            all: 'unset', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-base)',
            color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{target.name}</button>
          {note && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{note}</span>}
          {orphaned && (
            <span title={t('models.orphanHint')} style={{
              fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--warning)', border: '0.5px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '0 5px',
            }}>{t('models.orphan')}</span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lineage}
        </div>
        {target.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 1 }}>
            {target.tags.map(tag => (
              <span key={tag} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 5px' }}>{tag}</span>
            ))}
          </div>
        )}
      </div>

      <MetricCell label="ttfs" value={null} />
      <MetricCell label="total" value={null} />
      <MetricCell label={t('models.priceHint')} value={price ? `${price.inputPer1M} / ${price.outputPer1M}` : null} />

      <PillToggle on={target.enabled} onToggle={onToggle} labelOn={t('models.enabled')} labelOff={t('models.disabled')} />
      <IconButton onClick={onEdit} title={t('models.edit')}><IconPencil size={13} /></IconButton>
      <IconButton onClick={onDuplicate} title={t('models.duplicate')}><IconCopy size={13} /></IconButton>
      <IconButton onClick={onDelete} title={t('models.delete')}><IconTrash size={13} /></IconButton>
    </div>
  )
}
