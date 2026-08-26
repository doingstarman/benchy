import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Target, PipelineTargetConfig, PipelineNode, PipelineEdge } from '../../../src/types'
import { targetsApi, type PipelineConfigUpsert, type HandshakeResult } from '../api'
import { UiStyles, Button, IconButton, Input, PillToggle, Segmented } from '../components/ui'
import { TypeBadge } from '../components/TypeBadge'
import { HealthDot } from './Agents'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { IconPlus, IconClose, IconPencil, IconCopy, IconTrash } from '../components/icons'
import { useT } from '../i18n'

function asPipeline(t: Target): PipelineTargetConfig { return t.config as PipelineTargetConfig }
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'pipeline' }

export function Pipelines() {
  const { t } = useT()
  const [pipelines, setPipelines] = useState<Target[]>([])
  const [allTargets, setAllTargets] = useState<Target[]>([])   // ref candidates
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)   // null=closed, ''=new
  const [pendingDelete, setPendingDelete] = useState<Target | null>(null)

  const load = useCallback(async () => {
    const [pi, mo, ag] = await Promise.all([targetsApi.list('pipeline'), targetsApi.list('model'), targetsApi.list('agent')])
    setPipelines(pi)
    setAllTargets([...mo, ...ag, ...pi])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const editing = editingId ? pipelines.find(p => p.id === editingId) ?? null : null

  async function confirmDelete() {
    const p = pendingDelete
    if (!p) return
    setPendingDelete(null)
    await targetsApi.remove(p.id)
    if (editingId === p.id) setEditingId(null)
    await load()
  }
  async function duplicate(id: string) {
    const created = await targetsApi.duplicate(id)
    await load()
    setEditingId(created.id)
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: 24 }}>
      <UiStyles />
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)', color: 'var(--text-bright)' }}>{t('pipelines.title')}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', maxWidth: 640 }}>{t('pipelines.subtitle')}</p>
          </div>
          <Button variant="primary" small onClick={() => setEditingId('')}><IconPlus size={13} /> {t('pipelines.new')}</Button>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</div>
        ) : pipelines.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>{t('pipelines.empty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pipelines.map(p => (
              <PipelineRow key={p.id} target={p}
                onEdit={() => setEditingId(p.id)}
                onToggle={() => void targetsApi.update(p.id, { enabled: !p.enabled }).then(load)}
                onDuplicate={() => void duplicate(p.id)}
                onDelete={() => setPendingDelete(p)} />
            ))}
          </div>
        )}
      </div>

      {editingId !== null && (
        <PipelineDrawer
          target={editing}
          targets={allTargets}
          onClose={() => setEditingId(null)}
          onSaved={async id => { await load(); setEditingId(id) }}
          onDelete={() => editing && setPendingDelete(editing)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t('pipelines.delete')} message={t('pipelines.deleteConfirm')} confirmLabel={t('pipelines.delete')} danger
          onConfirm={() => void confirmDelete()} onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

function PipelineRow({ target, onEdit, onToggle, onDuplicate, onDelete }: {
  target: Target; onEdit: () => void; onToggle: () => void; onDuplicate: () => void; onDelete: () => void
}) {
  const { t } = useT()
  const cfg = asPipeline(target)
  const summary = cfg.mode === 'external'
    ? (cfg.command || cfg.url || '—')
    : t('pipelines.nodesN', { n: cfg.nodes?.length ?? 0 })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '0.5px solid var(--border)', opacity: target.enabled ? 1 : 0.55 }}>
      <TypeBadge kind={target.kind} />
      <HealthDot health={cfg.lastHandshake} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onEdit} style={{ all: 'unset', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-base)', color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target.name}</button>
          <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 5px' }}>
            {cfg.mode === 'external' ? t('pipelines.modeExternal') : t('pipelines.modeInternal')}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</div>
      </div>
      <PillToggle on={target.enabled} onToggle={onToggle} labelOn={t('models.enabled')} labelOff={t('models.disabled')} />
      <IconButton onClick={onEdit} title={t('models.edit')}><IconPencil size={13} /></IconButton>
      <IconButton onClick={onDuplicate} title={t('models.duplicate')}><IconCopy size={13} /></IconButton>
      <IconButton onClick={onDelete} title={t('models.delete')}><IconTrash size={13} /></IconButton>
    </div>
  )
}

interface NodeRow { id: string; ref: string; label: string }

function PipelineDrawer({ target, targets, onClose, onSaved, onDelete }: {
  target: Target | null
  targets: Target[]
  onClose: () => void
  onSaved: (id: string) => void | Promise<void>
  onDelete: () => void
}) {
  const { t } = useT()
  const cfg = target ? asPipeline(target) : null
  const [name, setName] = useState(target?.name ?? '')
  const [mode, setMode] = useState<'internal' | 'external'>(cfg?.mode ?? 'internal')
  const [nodes, setNodes] = useState<NodeRow[]>(() => (cfg?.nodes ?? []).map(n => ({ id: n.id, ref: n.ref, label: n.label ?? '' })))
  const [edges, setEdges] = useState<PipelineEdge[]>(() => (cfg?.edges ?? []).map(e => ({ from: e.from, to: e.to, ...(e.when ? { when: e.when } : {}) })))
  const [transport, setTransport] = useState<'command' | 'http'>(cfg?.transport ?? 'command')
  const [command, setCommand] = useState(cfg?.command ?? '')
  const [cwd, setCwd] = useState(cfg?.cwd ?? '')
  const [url, setUrl] = useState(cfg?.url ?? '')
  const [authHeader, setAuthHeader] = useState(cfg?.authHeader ?? 'Authorization')
  const [httpToken, setHttpToken] = useState('')
  const [maxDepth, setMaxDepth] = useState(cfg?.maxDepth ?? 3)
  const [maxNodes, setMaxNodes] = useState(cfg?.maxNodes ?? 32)
  const [timeoutMs, setTimeoutMs] = useState(cfg?.timeoutMs ?? 120_000)
  const [maxCostUsd, setMaxCostUsd] = useState<string>(cfg?.maxCostUsd != null ? String(cfg.maxCostUsd) : '')
  const [enabled, setEnabled] = useState(target?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verify, setVerify] = useState<HandshakeResult | null>(null)

  const refOptions = useMemo(() => targets.filter(x => x.id !== target?.id), [targets, target])

  const addNode = () => {
    const used = new Set(nodes.map(n => n.id))
    let i = nodes.length + 1
    while (used.has(`n${i}`)) i++
    setNodes([...nodes, { id: `n${i}`, ref: refOptions[0]?.id ?? '', label: '' }])
  }
  const removeNode = (id: string) => {
    setNodes(nodes.filter(n => n.id !== id))
    setEdges(edges.filter(e => e.from !== id && e.to !== id))
  }
  const addEdge = () => setEdges([...edges, { from: '', to: nodes[0]?.id ?? '' }])

  function buildConfig(): PipelineConfigUpsert {
    const base = { maxDepth, maxNodes, timeoutMs, ...(maxCostUsd.trim() ? { maxCostUsd: Number(maxCostUsd) } : {}) }
    if (mode === 'external') {
      const secretRefs: string[] = []
      const secrets: Record<string, string> = {}
      const existing = cfg?.secretRefs?.[0]
      if (transport === 'http' && (httpToken || existing)) {
        const nm = existing ?? `${slug(name)}__auth`
        secretRefs.push(nm)
        if (httpToken) secrets[nm] = httpToken
      }
      return transport === 'command'
        ? { mode, transport, command: command.trim(), ...(cwd.trim() ? { cwd: cwd.trim() } : {}), ...base }
        : { mode, transport, url: url.trim(), authHeader: authHeader.trim() || 'Authorization', secretRefs, secrets, ...base }
    }
    return {
      mode,
      nodes: nodes.map(n => ({ id: n.id, ref: n.ref, ...(n.label.trim() ? { label: n.label.trim() } : {}) })) as PipelineNode[],
      edges,
      ...base,
    }
  }

  async function save(): Promise<string | null> {
    setError(null); setBusy(true)
    try {
      const config = buildConfig()
      const saved = target
        ? await targetsApi.update(target.id, { name: name.trim() || target.name, enabled, config })
        : await targetsApi.create({ kind: 'pipeline', name: name.trim() || 'pipeline', enabled, config })
      setHttpToken('')
      await onSaved(saved.id)
      return saved.id
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally { setBusy(false) }
  }

  // Verify runs by id, so persist first (also captures unsaved edits), then reload the
  // list so the row's health dot reflects this verify.
  async function runVerify() {
    const id = await save()
    if (!id) return
    setVerifying(true); setVerify(null)
    try {
      setVerify(await targetsApi.handshake(id))
      await onSaved(id)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setVerifying(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', zIndex: 50 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ marginTop: 40, width: 'min(760px, 94vw)', maxHeight: '88vh', overflowY: 'auto', background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)', color: 'var(--text-bright)' }}>{target ? t('pipelines.edit') : t('pipelines.new')}</h2>
          <IconButton onClick={onClose} title={t('common.close')}><IconClose size={15} /></IconButton>
        </div>

        <Field label={t('pipelines.name')}><Input value={name} onChange={e => setName(e.target.value)} placeholder="my-pipeline" /></Field>

        <Field label={t('pipelines.mode')}>
          <Segmented value={mode} onChange={setMode} options={[
            { value: 'internal', label: t('pipelines.modeInternal') },
            { value: 'external', label: t('pipelines.modeExternal') },
          ]} />
          <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            {mode === 'internal' ? t('pipelines.modeInternalHint') : t('pipelines.modeExternalHint')}
          </div>
        </Field>

        {mode === 'internal' ? (
          <>
            <Section label={t('pipelines.nodes')}>
              {nodes.length === 0 && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('pipelines.nodesEmpty')}</div>}
              {nodes.map(n => (
                <div key={n.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', width: 34 }}>{n.id}</span>
                  <select value={n.ref} onChange={e => setNodes(nodes.map(x => x.id === n.id ? { ...x, ref: e.target.value } : x))} style={selectStyle}>
                    {refOptions.map(o => <option key={o.id} value={o.id}>{o.name} · {o.kind}</option>)}
                  </select>
                  <Input value={n.label} onChange={e => setNodes(nodes.map(x => x.id === n.id ? { ...x, label: e.target.value } : x))} placeholder={t('pipelines.labelOptional')} style={{ flex: 1 }} />
                  <IconButton onClick={() => removeNode(n.id)} title={t('common.remove')}><IconTrash size={12} /></IconButton>
                </div>
              ))}
              <Button small onClick={addNode}><IconPlus size={12} /> {t('pipelines.addNode')}</Button>
            </Section>

            <Section label={t('pipelines.edges')}>
              <div style={{ marginBottom: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('pipelines.edgesHint')}</div>
              {edges.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <select value={e.from} onChange={ev => setEdges(edges.map((x, j) => j === i ? { ...x, from: ev.target.value } : x))} style={selectStyle}>
                    <option value="">{t('pipelines.input')}</option>
                    {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
                  </select>
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  <select value={e.to} onChange={ev => setEdges(edges.map((x, j) => j === i ? { ...x, to: ev.target.value } : x))} style={selectStyle}>
                    {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
                    <option value="">{t('pipelines.output')}</option>
                  </select>
                  <Input value={e.when ?? ''} onChange={ev => setEdges(edges.map((x, j) => j === i ? { ...x, when: ev.target.value || undefined } : x))} placeholder={t('pipelines.when')} style={{ flex: 1 }} />
                  <IconButton onClick={() => setEdges(edges.filter((_, j) => j !== i))} title={t('common.remove')}><IconTrash size={12} /></IconButton>
                </div>
              ))}
              <Button small onClick={addEdge} disabled={nodes.length === 0}><IconPlus size={12} /> {t('pipelines.addEdge')}</Button>
            </Section>
          </>
        ) : (
          <Section label={t('pipelines.transport')}>
            <Segmented value={transport} onChange={setTransport} options={[
              { value: 'command', label: t('agents.transportCommand') },
              { value: 'http', label: t('agents.transportHttp') },
            ]} />
            {transport === 'command' ? (
              <>
                <Field label={t('agents.command')}><Input value={command} onChange={e => setCommand(e.target.value)} placeholder="node pipeline.mjs" /></Field>
                <Field label={t('agents.cwd')}><Input value={cwd} onChange={e => setCwd(e.target.value)} placeholder="/path (optional)" /></Field>
              </>
            ) : (
              <>
                <Field label={t('agents.url')}><Input value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:8000/run" /></Field>
                <Field label={t('agents.authHeader')}><Input value={authHeader} onChange={e => setAuthHeader(e.target.value)} /></Field>
                <Field label={t('pipelines.token')}><Input type="password" value={httpToken} onChange={e => setHttpToken(e.target.value)} placeholder={cfg?.secretRefs?.length ? '•••• (unchanged)' : ''} /></Field>
              </>
            )}
          </Section>
        )}

        <Section label={t('pipelines.limits')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <Field label={t('pipelines.maxDepth')}><Input type="number" value={maxDepth} onChange={e => setMaxDepth(Number(e.target.value) || 0)} /></Field>
            <Field label={t('pipelines.maxNodes')}><Input type="number" value={maxNodes} onChange={e => setMaxNodes(Number(e.target.value) || 0)} /></Field>
            <Field label={t('pipelines.timeoutMs')}><Input type="number" value={timeoutMs} onChange={e => setTimeoutMs(Number(e.target.value) || 0)} /></Field>
            <Field label={t('pipelines.maxCost')}><Input value={maxCostUsd} onChange={e => setMaxCostUsd(e.target.value)} placeholder="—" /></Field>
          </div>
        </Section>

        <Section label={t('pipelines.verify')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button small onClick={() => void runVerify()} disabled={verifying || busy}>{verifying ? t('agents.verifying') : t('pipelines.runOnce')}</Button>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('pipelines.verifyHint')}</span>
          </div>
          {verify && (
            <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)' }}>
              <span style={{ color: verify.ok ? 'var(--success)' : 'var(--error)' }}>
                {verify.ok ? (verify.spokeProtocol ? t('pipelines.verifyOk') : t('pipelines.verifyDegraded')) : t('pipelines.verifyCrashed')}
              </span>
              <span style={{ color: 'var(--text-muted)' }}> · {t('pipelines.nodesN', { n: verify.steps })}</span>
              {verify.error && <div style={{ color: 'var(--error)', marginTop: 4 }}>{verify.error}</div>}
              {!verify.error && verify.output && <div style={{ color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{verify.output.slice(0, 300)}</div>}
            </div>
          )}
        </Section>

        {error && <div style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)', marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <PillToggle on={enabled} onToggle={() => setEnabled(!enabled)} labelOn={t('models.enabled')} labelOff={t('models.disabled')} />
          <div style={{ flex: 1 }} />
          {target && <Button small onClick={onDelete}><IconTrash size={12} /> {t('pipelines.delete')}</Button>}
          <Button variant="primary" small onClick={() => void save()} disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Button>
        </div>
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '6px 9px', background: 'var(--bg-base)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14, paddingTop: 12, borderTop: '0.5px solid var(--border)' }}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  )
}
