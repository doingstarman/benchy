import { useCallback, useEffect, useState } from 'react'
import type { Target, AgentTargetConfig, AgentHealth } from '../../../src/types'
import { targetsApi, type AgentConfigUpsert, type HandshakeResult } from '../api'
import { UiStyles, Button, IconButton, Input, PillToggle, Segmented } from '../components/ui'
import { TypeBadge } from '../components/TypeBadge'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { IconPlus, IconClose, IconPencil, IconCopy, IconTrash } from '../components/icons'
import { useT } from '../i18n'

function asAgent(t: Target): AgentTargetConfig { return t.config as AgentTargetConfig }

// Per-row health from the last verify. green = ran (full = solid, degraded/no-protocol
// = ring); red = process died; muted ring = never verified. Diagnostic only — a red
// dot never means the agent is disabled.
export function HealthDot({ health }: { health?: AgentHealth }) {
  const { t } = useT()
  const spec = !health
    ? { color: 'var(--text-muted)', fill: false, title: t('agents.healthUnverified') }
    : !health.ok
      ? { color: 'var(--error)', fill: true, title: t('agents.healthCrashed') + (health.error ? `: ${health.error}` : '') }
      : health.spokeProtocol
        ? { color: 'var(--success)', fill: true, title: t('agents.healthFull') }
        : { color: 'var(--success)', fill: false, title: t('agents.healthDegraded') }
  return <span title={spec.title} style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: spec.fill ? spec.color : 'transparent', border: `1.5px solid ${spec.color}` }} />
}

export function Agents() {
  const { t } = useT()
  const [agents, setAgents] = useState<Target[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)   // null=closed, ''=new
  const [pendingDelete, setPendingDelete] = useState<Target | null>(null)

  const load = useCallback(async () => {
    setAgents(await targetsApi.list('agent'))
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const editing = editingId ? agents.find(a => a.id === editingId) ?? null : null

  async function confirmDelete() {
    const a = pendingDelete
    if (!a) return
    setPendingDelete(null)
    await targetsApi.remove(a.id)
    if (editingId === a.id) setEditingId(null)
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
            <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)', color: 'var(--text-bright)' }}>{t('agents.title')}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', maxWidth: 640 }}>{t('agents.subtitle')}</p>
          </div>
          <Button variant="primary" small onClick={() => setEditingId('')}><IconPlus size={13} /> {t('agents.new')}</Button>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</div>
        ) : agents.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>{t('agents.empty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {agents.map(a => (
              <AgentRow key={a.id} target={a}
                onEdit={() => setEditingId(a.id)}
                onToggle={() => void targetsApi.update(a.id, { enabled: !a.enabled }).then(load)}
                onDuplicate={() => void duplicate(a.id)}
                onDelete={() => setPendingDelete(a)} />
            ))}
          </div>
        )}
      </div>

      {editingId !== null && (
        <AgentDrawer
          target={editing}
          onClose={() => setEditingId(null)}
          onSaved={async id => { await load(); setEditingId(id) }}
          onDuplicate={() => editing && void duplicate(editing.id)}
          onDelete={() => editing && setPendingDelete(editing)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t('agents.delete')} message={t('agents.deleteConfirm')} confirmLabel={t('agents.delete')} danger
          onConfirm={() => void confirmDelete()} onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

function AgentRow({ target, onEdit, onToggle, onDuplicate, onDelete }: {
  target: Target; onEdit: () => void; onToggle: () => void; onDuplicate: () => void; onDelete: () => void
}) {
  const { t } = useT()
  const cfg = asAgent(target)
  const where = cfg.transport === 'command' ? cfg.command : cfg.url
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '0.5px solid var(--border)', opacity: target.enabled ? 1 : 0.55 }}>
      <TypeBadge kind={target.kind} />
      <HealthDot health={cfg.lastHandshake} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={onEdit} style={{ all: 'unset', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-base)', color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target.name}</button>
          <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 5px' }}>
            {cfg.transport === 'command' ? t('agents.transportCommand') : t('agents.transportHttp')}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where || '—'}</div>
        {target.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 1 }}>
            {target.tags.map(tag => <span key={tag} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 5px' }}>{tag}</span>)}
          </div>
        )}
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('agents.maxStepsShort', { n: cfg.maxSteps })}</span>
      <PillToggle on={target.enabled} onToggle={onToggle} labelOn={t('models.enabled')} labelOff={t('models.disabled')} />
      <IconButton onClick={onEdit} title={t('models.edit')}><IconPencil size={13} /></IconButton>
      <IconButton onClick={onDuplicate} title={t('models.duplicate')}><IconCopy size={13} /></IconButton>
      <IconButton onClick={onDelete} title={t('models.delete')}><IconTrash size={13} /></IconButton>
    </div>
  )
}

interface EnvRow { name: string; value: string; secret: boolean; stored: boolean }

const selectStyle: React.CSSProperties = {
  padding: '6px 9px', background: 'var(--bg-base)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)',
}

function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'agent' }

function AgentDrawer({ target, onClose, onSaved, onDuplicate, onDelete }: {
  target: Target | null
  onClose: () => void
  onSaved: (id: string) => void | Promise<void>
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t } = useT()
  const cfg = target ? asAgent(target) : null
  const [name, setName] = useState(target?.name ?? '')
  const [transport, setTransport] = useState<'command' | 'http'>(cfg?.transport ?? 'command')
  const [command, setCommand] = useState(cfg?.command ?? '')
  const [cwd, setCwd] = useState(cfg?.cwd ?? '')
  const [url, setUrl] = useState(cfg?.url ?? '')
  const [authHeader, setAuthHeader] = useState(cfg?.authHeader ?? 'Authorization')
  const [httpToken, setHttpToken] = useState('')
  const [envRows, setEnvRows] = useState<EnvRow[]>(() => {
    const rows: EnvRow[] = []
    for (const [k, v] of Object.entries(cfg?.env ?? {})) rows.push({ name: k, value: v, secret: false, stored: false })
    for (const nm of cfg?.secretRefs ?? []) rows.push({ name: nm, value: '', secret: true, stored: true })
    return rows
  })
  const [timeoutMs, setTimeoutMs] = useState(cfg?.timeoutMs ?? 120_000)
  const [maxSteps, setMaxSteps] = useState(cfg?.maxSteps ?? 40)
  const [maxCostUsd, setMaxCostUsd] = useState<string>(cfg?.maxCostUsd != null ? String(cfg.maxCostUsd) : '')
  const [retries, setRetries] = useState(cfg?.retries ?? 0)
  const [enabled, setEnabled] = useState(target?.enabled ?? true)
  const [tags, setTags] = useState<string[]>(target?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifyPrompt, setVerifyPrompt] = useState(t('agents.verifyPromptDefault'))
  const [verifying, setVerifying] = useState(false)
  const [verify, setVerify] = useState<HandshakeResult | null>(null)

  const buildConfig = (): AgentConfigUpsert => {
    const base = { timeoutMs, maxSteps, retries, ...(maxCostUsd.trim() ? { maxCostUsd: Number(maxCostUsd) } : {}) }
    if (transport === 'command') {
      const env: Record<string, string> = {}
      const secrets: Record<string, string> = {}
      const secretRefs: string[] = []
      for (const r of envRows) {
        const n = r.name.trim()
        if (!n) continue
        if (r.secret) { secretRefs.push(n); if (r.value) secrets[n] = r.value }
        else env[n] = r.value
      }
      return { transport: 'command', command: command.trim(), ...(cwd.trim() ? { cwd: cwd.trim() } : {}), env, secretRefs, secrets, ...base }
    }
    const secretRefs: string[] = []
    const secrets: Record<string, string> = {}
    const existing = cfg?.secretRefs?.[0]
    if (httpToken || existing) {
      const nm = existing ?? `${slug(name)}__auth`
      secretRefs.push(nm)
      if (httpToken) secrets[nm] = httpToken
    }
    return { transport: 'http', url: url.trim(), authHeader: authHeader.trim() || 'Authorization', secretRefs, secrets, ...base }
  }

  async function save(): Promise<string | null> {
    setError(null); setBusy(true)
    try {
      const config = buildConfig()
      const saved = target
        ? await targetsApi.update(target.id, { name: name.trim() || target.name, tags, enabled, config })
        : await targetsApi.create({ kind: 'agent', name: name.trim() || 'agent', tags, enabled, config })
      setHttpToken('')
      setEnvRows(rows => rows.map(r => r.secret ? { ...r, value: '', stored: true } : r))
      await onSaved(saved.id)
      return saved.id
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally { setBusy(false) }
  }

  async function runVerify() {
    // Handshake runs by id, so persist first (also captures unsaved config edits).
    const id = await save()
    if (!id) return
    setVerifying(true); setVerify(null)
    try {
      setVerify(await targetsApi.handshake(id, verifyPrompt))
      await onSaved(id)   // reload the list so the row's health dot reflects this verify
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setVerifying(false) }
  }

  const addTag = () => { const v = tagDraft.trim(); if (v && !tags.includes(v)) setTags([...tags, v]); setTagDraft('') }
  const setRow = (i: number, patch: Partial<EnvRow>) => setEnvRows(rows => rows.map((r, j) => j === i ? { ...r, ...patch } : r))

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, padding: 24, background: 'var(--overlay, rgba(0,0,0,0.5))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 620, maxWidth: '92vw', maxHeight: '90vh', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: '0.5px solid var(--border)' }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-lg)', color: 'var(--text-bright)' }}>{target ? t('agents.edit') : t('agents.new')}</span>
          <IconButton onClick={onClose} title="close"><IconClose size={14} /></IconButton>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Field label={t('agents.name')}><Input value={name} onChange={e => setName(e.target.value)} placeholder="openclaw · web" /></Field>

          <Section label={t('agents.transport')}>
            <Segmented value={transport}
              options={[{ value: 'command' as const, label: t('agents.transportCommand') }, { value: 'http' as const, label: t('agents.transportHttp') }]}
              onChange={setTransport} />
            {transport === 'command' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label={t('agents.command')}><Input value={command} onChange={e => setCommand(e.target.value)} placeholder="python -m openclaw.cli --json" /></Field>
                <Field label={t('agents.cwd')}><Input value={cwd} onChange={e => setCwd(e.target.value)} placeholder="~/src/openclaw" /></Field>
                <EnvEditor rows={envRows} setRow={setRow} add={() => setEnvRows(r => [...r, { name: '', value: '', secret: false, stored: false }])} remove={i => setEnvRows(r => r.filter((_, j) => j !== i))} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label={t('agents.url')}><Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://openclaw.local/run" /></Field>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ width: 200 }}><Field label={t('agents.authHeader')}><Input value={authHeader} onChange={e => setAuthHeader(e.target.value)} /></Field></div>
                  <div style={{ flex: 1 }}><Field label={t('agents.secret')}><Input value={httpToken} onChange={e => setHttpToken(e.target.value)} placeholder={cfg?.secretRefs?.length ? '••••  ' + t('agents.replaceHint') : 'Bearer …'} /></Field></div>
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('agents.secretStored')}</div>
              </div>
            )}
          </Section>

          <Section label={t('agents.limits')} hint={t('agents.limitsHint')}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
              <NumField label={t('agents.timeout')} unit="ms" value={timeoutMs} onChange={setTimeoutMs} />
              <NumField label={t('agents.maxSteps')} unit={t('agents.stepsUnit')} value={maxSteps} onChange={setMaxSteps} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 132, flexShrink: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{t('agents.maxCost')}</span>
                <input value={maxCostUsd} onChange={e => setMaxCostUsd(e.target.value)} placeholder="—" style={{ ...selectStyle, width: 74, textAlign: 'right' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>USD</span>
              </div>
              <NumField label={t('agents.retries')} unit={t('agents.retriesUnit')} value={retries} onChange={setRetries} />
            </div>
          </Section>

          <Section label={t('agents.verify')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Input value={verifyPrompt} onChange={e => setVerifyPrompt(e.target.value)} />
              <Button small onClick={() => void runVerify()} disabled={verifying || busy}>{verifying ? t('agents.verifying') : t('agents.runOnce')}</Button>
            </div>
            {verify && <VerifyResult r={verify} />}
          </Section>

          <Field label={t('models.tags')}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
              {tags.map(tag => (
                <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1px 6px' }}>
                  {tag}<button onClick={() => setTags(tags.filter(x => x !== tag))} style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
                </span>
              ))}
            </div>
            <Input value={tagDraft} placeholder={t('models.addTag')} onChange={e => setTagDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
          </Field>

          {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--error)' }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="primary" small onClick={() => void save()} disabled={busy}>{t('common.save')}</Button>
          {target && <Button small onClick={onDuplicate}>{t('models.duplicate')}</Button>}
          {target && <Button variant="danger" small onClick={() => { onClose(); onDelete() }}>{t('models.delete')}</Button>}
          <div style={{ flex: 1 }} />
          <PillToggle on={enabled} onToggle={() => setEnabled(v => !v)} labelOn={t('models.enabled')} labelOff={t('models.disabled')} />
        </div>
      </div>
    </div>
  )
}

function VerifyResult({ r }: { r: HandshakeResult }) {
  const { t } = useT()
  // Two axes → three outcomes: full trace / degraded / crashed.
  const kind = !r.ok ? 'crash' : r.spokeProtocol ? 'full' : 'degraded'
  const tone = kind === 'full' ? 'success' : kind === 'degraded' ? 'warning' : 'error'
  const label = kind === 'full' ? t('agents.outcomeFull') : kind === 'degraded' ? t('agents.outcomeDegraded') : t('agents.outcomeCrash')
  return (
    <div style={{ border: `0.5px solid var(--${tone}-dim)`, borderRadius: 'var(--radius-md)', background: `var(--${tone}-bg)`, overflow: 'hidden', marginTop: 8 }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: `0.5px solid var(--${tone}-dim)` }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: `var(--${tone})`, flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: `var(--${tone})` }}>{label}</span>
      </div>
      <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Stat label={t('agents.axisProcess')} value={r.ok ? t('agents.ran') : t('agents.died')} />
        <Stat label={t('agents.axisStructure')} value={t('agents.eventsN', { n: r.steps })} />
        <Stat label={t('agents.answer')} value={r.output ? (r.output.length > 12 ? r.output.slice(0, 12) + '…' : r.output) : '—'} />
        <Stat label={t('agents.tokensLabel')} value={r.reportedUsage.outputTokens ? String(r.reportedUsage.outputTokens) : '—'} />
      </div>
      {r.error && <div style={{ padding: '0 14px 12px', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--error)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.error}</div>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

function EnvEditor({ rows, setRow, add, remove }: { rows: EnvRow[]; setRow: (i: number, p: Partial<EnvRow>) => void; add: () => void; remove: (i: number) => void }) {
  const { t } = useT()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{t('agents.env')}</span>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 76px 26px', gap: 8, alignItems: 'center' }}>
          <Input value={r.name} onChange={e => setRow(i, { name: e.target.value })} placeholder="NAME" />
          <Input value={r.value} onChange={e => setRow(i, { value: e.target.value })} placeholder={r.secret && r.stored ? '••••  ' + t('agents.replaceHint') : r.secret ? 'secret value' : 'value'} />
          <button onClick={() => setRow(i, { secret: !r.secret })} style={{ padding: '5px 8px', border: `0.5px solid ${r.secret ? 'var(--accent-dim)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', background: r.secret ? 'var(--accent-bg)' : 'none', color: r.secret ? 'var(--accent)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', cursor: 'pointer' }}>{t('agents.secretToggle')}</button>
          <IconButton onClick={() => remove(i)} title={t('models.delete')}><IconClose size={11} /></IconButton>
        </div>
      ))}
      <button onClick={add} style={{ alignSelf: 'flex-start', padding: '5px 12px', border: '1px dashed var(--border-hover)', borderRadius: 'var(--radius-sm)', background: 'none', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>{t('agents.addEnv')}</button>
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

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{label}</span>
        <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
        {hint && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function NumField({ label, unit, value, onChange }: { label: string; unit: string; value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 132, flexShrink: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{label}</span>
      <input value={value} onChange={e => onChange(Number(e.target.value) || 0)} style={{ ...selectStyle, width: 74, textAlign: 'right' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{unit}</span>
    </div>
  )
}
