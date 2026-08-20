import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MetricDef, MetricDirection } from '../../../src/types'
import { metricsApi } from '../api'
import { Button, IconButton, Input, Segmented } from './ui'
import { IconPlus, IconPencil, IconCopy, IconTrash } from './icons'
import { ConfirmDialog } from './ConfirmDialog'
import { MetricEditor } from './MetricEditor'
import { useT, t as tt } from '../i18n'

const DIR_GLYPH: Record<MetricDirection, string> = { lower: '↓ lower', higher: '↑ higher', neutral: '·  none' }

// The registry lives as a Settings subsection (design v1 choice): built-ins are
// fixed (enable/disable + duplicate-as-custom), customs are fully editable.
export function MetricsRegistry() {
  const { t } = useT()
  const [metrics, setMetrics] = useState<MetricDef[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [grouped, setGrouped] = useState(true)
  const [editing, setEditing] = useState<MetricDef | 'new' | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MetricDef | null>(null)

  const load = useCallback(async () => { setMetrics(await metricsApi.list()); setLoading(false) }, [])
  useEffect(() => { void load() }, [load])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => metrics.filter(m => !q || `${m.name} ${m.key} ${m.expression ?? ''}`.toLowerCase().includes(q)),
    [metrics, q],
  )
  const builtins = filtered.filter(m => m.kind === 'builtin')
  const customs = filtered.filter(m => m.kind === 'custom')

  async function toggle(m: MetricDef) { await metricsApi.update(m.key, { enabled: !m.enabled }); await load() }
  function duplicate(m: MetricDef) {
    const taken = new Set(metrics.map(x => x.key))
    let key = `${m.key}_copy`
    for (let n = 2; taken.has(key); n++) key = `${m.key}_copy_${n}`
    setEditing({ ...m, kind: 'custom', key, name: `${m.name} copy`, expression: m.expression ?? m.key })
  }
  async function confirmDelete() {
    if (!pendingDelete) return
    const k = pendingDelete.key
    setPendingDelete(null)
    await metricsApi.remove(k)
    await load()
  }

  const row = (m: MetricDef) => (
    <div key={m.key} style={{
      display: 'grid', gridTemplateColumns: '180px 140px 1fr 84px 110px 118px 60px 76px', alignItems: 'center', gap: 10,
      padding: '9px 14px', borderTop: '0.5px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)',
    }}>
      <span style={{ color: 'var(--text-bright)', fontFamily: m.kind === 'custom' ? 'var(--font-mono)' : 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.key}</span>
      <span style={{ color: m.kind === 'custom' ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {m.kind === 'custom' ? m.expression : `${t('metrics.builtinExpr')}${m.nullable ? ` · ${t('metrics.nullableNote')}` : ''}`}
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>{m.unit ?? '—'}</span>
      <span style={{ color: m.direction === 'neutral' ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>{DIR_GLYPH[m.direction]}</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>{m.scope === 'run' ? `${t('metrics.perRun')}${m.aggregate ? ` · ${m.aggregate}` : ''}` : t('metrics.perAnswer')}</span>
      <button onClick={() => void toggle(m)} title={t('metrics.colEnabled')} style={{
        width: 30, height: 17, borderRadius: 10, padding: 2, cursor: 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: m.enabled ? 'flex-end' : 'flex-start',
        border: `0.5px solid ${m.enabled ? 'var(--accent-dim)' : 'var(--border)'}`,
        background: m.enabled ? 'var(--accent-bg)' : 'var(--bg-base)',
      }}><span style={{ width: 11, height: 11, borderRadius: '50%', background: m.enabled ? 'var(--accent)' : 'var(--text-muted)' }} /></button>
      <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {m.kind === 'custom' && <IconButton onClick={() => setEditing(m)} title={t('metrics.edit')}><IconPencil size={12} /></IconButton>}
        <IconButton onClick={() => duplicate(m)} title={t('metrics.duplicate')}><IconCopy size={12} /></IconButton>
        {m.kind === 'custom' && <IconButton onClick={() => setPendingDelete(m)} title={t('metrics.delete')}><IconTrash size={12} /></IconButton>}
      </span>
    </div>
  )

  const header = (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 140px 1fr 84px 110px 118px 60px 76px', gap: 10, padding: '9px 14px', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
      <span>{t('metrics.colMetric')}</span><span>{t('metrics.colKey')}</span><span>{t('metrics.colExpression')}</span>
      <span>{t('metrics.colUnit')}</span><span>{t('metrics.colDirection')}</span><span>{t('metrics.colScope')}</span><span>{t('metrics.colEnabled')}</span><span />
    </div>
  )
  const sectionHead = (title: string, count: number, contract: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 14px', background: 'var(--bg-base)', borderTop: '0.5px solid var(--border)' }}>
      <span style={{ fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', color: 'var(--text-bright)', textTransform: 'uppercase' }}>{title}</span>
      <span style={{ fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{count}</span>
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{contract}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ width: 260 }}><Input value={query} placeholder={t('metrics.search')} onChange={e => setQuery(e.target.value)} /></div>
        <Segmented value={grouped} onChange={setGrouped}
          options={[{ value: true, label: t('metrics.bySource') }, { value: false, label: t('metrics.flat') }]} />
        <span style={{ fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {tt('metrics.count', { n: metrics.length, b: metrics.filter(m => m.kind === 'builtin' && m.enabled).length, c: metrics.filter(m => m.kind === 'custom').length })}
        </span>
        <div style={{ flex: 1 }} />
        <Button variant="primary" small onClick={() => setEditing('new')}><IconPlus size={13} /> {t('metrics.new')}</Button>
      </div>

      {loading ? <div style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</div> : (
        <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-elevated)' }}>
          {header}
          {grouped ? (
            <>
              {builtins.length > 0 && sectionHead(t('metrics.builtin'), builtins.length, t('metrics.builtinContract'))}
              {builtins.map(row)}
              {sectionHead(t('metrics.custom'), customs.length, t('metrics.customContract'))}
              {customs.length > 0 ? customs.map(row) : (
                <div style={{ borderTop: '0.5px solid var(--border)', padding: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-primary)' }}>{t('metrics.emptyCustom')}</span>
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', maxWidth: 440 }}>{t('metrics.emptyHint')}</span>
                </div>
              )}
            </>
          ) : (
            filtered.length > 0 ? filtered.map(row) : <div style={{ borderTop: '0.5px solid var(--border)', padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>{t('metrics.noResults')}</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
        <span>↓ {t('metrics.legendLower')}</span>
        <span>↑ {t('metrics.legendHigher')}</span>
        <span>· {t('metrics.legendNeutral')}</span>
        <span>{t('metrics.nullableNote')} — {t('metrics.legendNullable')}</span>
      </div>

      {editing && (
        <MetricEditor
          metric={editing === 'new' ? null : editing}
          registry={metrics}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load() }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog title={t('metrics.delete')} message={t('metrics.deleteConfirm')} confirmLabel={t('metrics.delete')} danger
          onConfirm={() => void confirmDelete()} onCancel={() => setPendingDelete(null)} />
      )}
    </div>
  )
}
