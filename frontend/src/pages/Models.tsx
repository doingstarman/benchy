import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Target, ProviderView, ProviderDefaults, ModelTargetConfig } from '../../../src/types'
import { targetsApi, providersApi } from '../api'
import { UiStyles, Button, IconButton, Input, PillToggle, Segmented } from '../components/ui'
import { SliderField } from '../components/SliderField'
import { TargetRow } from '../components/TargetRow'
import { InheritedField } from '../components/InheritedField'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { IconPlus, IconClose } from '../components/icons'
import { useT, t as tt } from '../i18n'

// Which ProviderDefaults an editor exposes as override rows. Labels stay literal
// (universal generation-param jargon, per rules/ui.md / the i18n DICT note).
const FIELDS: { key: keyof ProviderDefaults; label: string; min: number; max: number; step: number; allowAuto?: boolean }[] = [
  { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1 },
  { key: 'topP', label: 'Top P', min: 0, max: 1, step: 0.05, allowAuto: true },
  { key: 'topK', label: 'Top K', min: 1, max: 100, step: 1, allowAuto: true },
  { key: 'maxOutputTokens', label: 'Max tokens', min: 256, max: 32768, step: 256, allowAuto: true },
]

const isOrphan = (t: Target, byId: Map<string, ProviderView>): boolean => {
  const p = byId.get(t.config.providerId)
  return !p || !p.models.includes(t.config.model)
}

export function Models() {
  const { t } = useT()
  const [targets, setTargets] = useState<Target[]>([])
  const [providers, setProviders] = useState<ProviderView[]>([])
  const [loading, setLoading] = useState(true)
  const [grouped, setGrouped] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Target | null>(null)

  const load = useCallback(async () => {
    const [ts, ps] = await Promise.all([targetsApi.list('model'), providersApi.list()])
    setTargets(ts)
    setProviders(ps)
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const byId = useMemo(() => new Map(providers.map(p => [p.id, p])), [providers])
  const editing = targets.find(t => t.id === editingId) ?? null

  // "variant i of n" for base models that have more than one participant.
  const variantNote = useMemo(() => {
    const byBase = new Map<string, Target[]>()
    for (const tgt of targets) {
      const base = `${tgt.config.providerId}:${tgt.config.model}`
      const list = byBase.get(base) ?? []
      list.push(tgt)
      byBase.set(base, list)
    }
    const note = new Map<string, string>()
    for (const list of byBase.values()) {
      if (list.length > 1) list.forEach((tgt, i) => note.set(tgt.id, tt('models.variant', { i: i + 1, n: list.length })))
    }
    return note
  }, [targets])

  const groups = useMemo(() => {
    const m = new Map<string, Target[]>()
    for (const tgt of targets) {
      const list = m.get(tgt.config.providerId) ?? []
      list.push(tgt)
      m.set(tgt.config.providerId, list)
    }
    // Live connections first (in provider order), then gone-connection buckets.
    const live = providers.filter(p => m.has(p.id)).map(p => p.id)
    const gone = [...m.keys()].filter(id => !byId.has(id))
    return [...live, ...gone].map(id => ({ providerId: id, provider: byId.get(id), items: m.get(id)! }))
  }, [targets, providers, byId])

  async function patch(id: string, body: Parameters<typeof targetsApi.update>[1]) {
    await targetsApi.update(id, body)
    await load()
  }
  async function duplicate(id: string) {
    const created = await targetsApi.duplicate(id)
    await load()
    setEditingId(created.id)
  }
  const requestDelete = (tgt: Target) => setPendingDelete(tgt)
  async function confirmDelete() {
    const tgt = pendingDelete
    if (!tgt) return
    setPendingDelete(null)
    await targetsApi.remove(tgt.id)
    if (editingId === tgt.id) setEditingId(null)
    await load()
  }

  const row = (tgt: Target) => (
    <TargetRow
      key={tgt.id}
      target={tgt}
      provider={byId.get(tgt.config.providerId)}
      orphaned={isOrphan(tgt, byId)}
      note={variantNote.get(tgt.id)}
      onEdit={() => setEditingId(tgt.id)}
      onToggle={() => void patch(tgt.id, { enabled: !tgt.enabled })}
      onDuplicate={() => void duplicate(tgt.id)}
      onDelete={() => requestDelete(tgt)}
    />
  )

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: 24 }}>
      <UiStyles />
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)', color: 'var(--text-bright)' }}>{t('models.title')}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', maxWidth: 620 }}>{t('models.subtitle')}</p>
        </div>
        <Segmented
          value={grouped}
          options={[{ value: true, label: t('models.grouped') }, { value: false, label: t('models.flat') }]}
          onChange={setGrouped}
        />
        <Button variant="primary" small onClick={() => setCreating(true)}><IconPlus size={13} /> {t('models.new')}</Button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</div>
      ) : targets.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>{t('models.empty')}</div>
      ) : grouped ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {groups.map(g => {
            const bases = new Set(g.items.map(i => i.config.model)).size
            const gone = !g.provider
            return (
              <div key={g.providerId}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-base)', color: gone ? 'var(--warning)' : 'var(--text-bright)' }}>
                    {g.provider?.name ?? g.providerId}
                  </span>
                  {gone
                    ? <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)' }}>{t('models.orphanHint')}</span>
                    : <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                        {g.provider?.apiKeyMask ? `${g.provider.apiKeyMask} · ` : ''}{tt('models.fromModels', { n: g.items.length, m: bases })}
                      </span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{g.items.map(row)}</div>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{targets.map(row)}</div>
      )}

      {targets.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {tt('models.count', { n: targets.length, c: new Set(targets.map(x => x.config.providerId)).size, m: new Set(targets.map(x => `${x.config.providerId}:${x.config.model}`)).size })}
        </div>
      )}

      </div>

      {editing && (
        <TargetEditor
          target={editing}
          provider={byId.get(editing.config.providerId)}
          onClose={() => setEditingId(null)}
          onSave={async body => { await patch(editing.id, body); setEditingId(null) }}
          onDuplicate={() => void duplicate(editing.id)}
          onDelete={() => requestDelete(editing)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t('models.delete')}
          message={t('models.deleteConfirm')}
          confirmLabel={t('models.delete')}
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {creating && (
        <CreateParticipant
          providers={providers}
          onClose={() => setCreating(false)}
          onCreated={async id => { setCreating(false); await load(); setEditingId(id) }}
        />
      )}
    </div>
  )
}

function CenterModal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, padding: 24, background: 'var(--overlay, rgba(0,0,0,0.5))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, maxWidth: '92vw', maxHeight: '88vh', background: 'var(--bg-elevated)',
        border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-lg)', color: 'var(--text-bright)' }}>{title}</span>
          <IconButton onClick={onClose} title="close"><IconClose size={14} /></IconButton>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
        {footer && <div style={{ padding: 12, borderTop: '0.5px solid var(--border)', display: 'flex', gap: 8 }}>{footer}</div>}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  )
}

function TargetEditor({ target, provider, onClose, onSave, onDuplicate, onDelete }: {
  target: Target
  provider?: ProviderView
  onClose: () => void
  onSave: (body: { name: string; tags: string[]; enabled: boolean; config: ModelTargetConfig }) => void | Promise<void>
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t } = useT()
  const [name, setName] = useState(target.name)
  const [tags, setTags] = useState<string[]>(target.tags)
  const [tagDraft, setTagDraft] = useState('')
  const [enabled, setEnabled] = useState(target.enabled)
  const [defaults, setDefaults] = useState<ProviderDefaults>({ ...(target.config.defaults ?? {}) })

  const overridden = (key: keyof ProviderDefaults) => Object.prototype.hasOwnProperty.call(defaults, key)
  const setField = (key: keyof ProviderDefaults, v: number | null) => setDefaults(d => ({ ...d, [key]: v }))
  const revert = (key: keyof ProviderDefaults) => setDefaults(d => { const n = { ...d }; delete n[key]; return n })
  const overrideCount = Object.keys(defaults).length

  const addTag = () => {
    const v = tagDraft.trim()
    if (v && !tags.includes(v)) setTags([...tags, v])
    setTagDraft('')
  }

  return (
    <CenterModal
      title={t('models.edit')}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" small onClick={() => void onSave({ name: name.trim() || target.name, tags, enabled, config: { ...target.config, defaults } })}>{t('common.save')}</Button>
          <Button small onClick={() => { onClose(); onDuplicate() }}>{t('models.duplicate')}</Button>
          <div style={{ flex: 1 }} />
          <Button variant="danger" small onClick={() => { onClose(); onDelete() }}>{t('models.delete')}</Button>
        </>
      }
    >
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
        {(provider?.name ?? target.config.providerId)} → {target.config.model}
      </div>

      <Field label={t('models.name')}><Input value={name} onChange={e => setName(e.target.value)} /></Field>

      <Field label={t('models.kind')}>
        <Segmented
          value={target.kind}
          disabled
          options={[
            { value: 'model' as const, label: t('models.kindModel') },
            { value: 'agent' as const, label: t('models.kindAgent') },
            { value: 'pipeline' as const, label: t('models.kindPipeline') },
          ]}
          onChange={() => {}}
        />
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('models.kindSoon')}</span>
      </Field>

      <div style={{ display: 'flex', gap: 24 }}>
        <Field label={t('models.connection')}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{provider?.name ?? target.config.providerId}</span>
        </Field>
        <Field label={t('models.baseModel')}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{target.config.model}</span>
        </Field>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-bright)' }}>{t('models.overrides')}</span>
          <span style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{tt('models.overridesCount', { n: overrideCount, total: FIELDS.length })}</span>
          {overrideCount > 0 && (
            <button onClick={() => setDefaults({})} style={{ all: 'unset', cursor: 'pointer', fontSize: 'var(--fs-xs)', color: 'var(--accent)' }}>{t('models.resetAll')}</button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FIELDS.map(f => {
            const inherited = (provider?.defaults?.[f.key] as number | null | undefined) ?? null
            const on = overridden(f.key)
            const value = on ? ((defaults[f.key] as number | null) ?? null) : inherited
            return (
              <InheritedField key={f.key} overridden={on} onRevert={() => revert(f.key)}>
                <SliderField label={f.label} min={f.min} max={f.max} step={f.step} allowAuto={f.allowAuto}
                  value={value} accent={on} onChange={v => setField(f.key, v)} />
              </InheritedField>
            )
          })}
        </div>
      </div>

      <Field label={t('models.tags')}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
          {tags.map(tag => (
            <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1px 6px' }}>
              {tag}
              <button onClick={() => setTags(tags.filter(x => x !== tag))} style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </span>
          ))}
        </div>
        <Input value={tagDraft} placeholder={t('models.addTag')} onChange={e => setTagDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
      </Field>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PillToggle on={enabled} onToggle={() => setEnabled(v => !v)} labelOn={t('models.enabled')} labelOff={t('models.disabled')} />
      </div>
    </CenterModal>
  )
}

function CreateParticipant({ providers, onClose, onCreated }: {
  providers: ProviderView[]
  onClose: () => void
  onCreated: (id: string) => void | Promise<void>
}) {
  const { t } = useT()
  const usable = providers.filter(p => p.models.length > 0)
  const [providerId, setProviderId] = useState(usable[0]?.id ?? '')
  const provider = usable.find(p => p.id === providerId)
  const [model, setModel] = useState(provider?.models[0] ?? '')
  const [name, setName] = useState(provider?.models[0] ?? '')

  const pickProvider = (id: string) => {
    setProviderId(id)
    const p = usable.find(x => x.id === id)
    setModel(p?.models[0] ?? '')
    setName(p?.models[0] ?? '')
  }
  const pickModel = (m: string) => { setModel(m); setName(m) }

  const create = async () => {
    if (!providerId || !model) return
    const created = await targetsApi.create({ name: name.trim() || model, config: { providerId, model } })
    await onCreated(created.id)
  }

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', background: 'var(--bg-base)', color: 'var(--text-primary)',
    border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)',
  }

  return (
    <CenterModal
      title={t('models.new')}
      onClose={onClose}
      footer={<Button variant="primary" small onClick={() => void create()}>{t('models.create')}</Button>}
    >
      {usable.length === 0 ? (
        <div style={{ color: 'var(--text-muted)' }}>{t('models.empty')}</div>
      ) : (
        <>
          <Field label={t('models.pickConnection')}>
            <select style={selectStyle} value={providerId} onChange={e => pickProvider(e.target.value)}>
              {usable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label={t('models.pickModel')}>
            {provider && provider.models.length > 0 ? (
              <select style={selectStyle} value={model} onChange={e => pickModel(e.target.value)}>
                {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : <span style={{ color: 'var(--text-muted)' }}>{t('models.noModels')}</span>}
          </Field>
          <Field label={t('models.name')}><Input value={name} onChange={e => setName(e.target.value)} /></Field>
        </>
      )}
    </CenterModal>
  )
}
