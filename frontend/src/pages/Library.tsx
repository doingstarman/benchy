import { useEffect, useState } from 'react'
import { useT, t } from '../i18n'
import { toolsApi, skillsApi, mcpApi } from '../api'
import type { Skill, CustomToolView, McpServerView } from '../../../src/types'

type Tab = 'tools' | 'skills' | 'mcp'

// The list returns a masked view (no raw key), so a draft carries the mask for
// display plus a write-only `apiKey` that is set only while replacing.
type ToolDraft = CustomToolView & { apiKey?: string }
type McpDraft = McpServerView & { apiKey?: string }

// Built-in tools, shown read-only in the Tools tab and selectable by a skill.
const BUILTIN_TOOLS = [
  { id: 'calc', name: 'calc', description: 'Arithmetic evaluator' },
  { id: 'fetch_url', name: 'fetch_url', description: 'Fetch a public web page' },
  { id: 'web_search', name: 'web_search', description: 'Search the web (needs a key)' },
]

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`
}

const CSS = `
  .lib-tab { background: none; border: 0.5px solid transparent; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-family: var(--font-mono); cursor: pointer; color: var(--text-muted); }
  .lib-tab:hover { color: var(--text-secondary); }
  .lib-tab.active { color: var(--accent); background: var(--accent-bg); border-color: var(--accent-dim); }
  .lib-card { text-align: left; background: var(--bg-elevated); border: 0.5px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
  .lib-card:hover { border-color: var(--border-hover); }
  .lib-card.ro { cursor: default; opacity: 0.85; }
  .lib-in { width: 100%; box-sizing: border-box; padding: 7px 10px; background: var(--bg-base); border: 0.5px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 13px; font-family: var(--font-mono); outline: none; }
  .lib-in:focus { border-color: var(--accent-dim); }
  .lib-label { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .lib-hint { font-size: 10px; color: var(--text-muted); }
`

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="lib-label">{label}</span>
        {hint && <span className="lib-hint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

// Write-only key field mirroring the provider modal: while a key is stored we
// show its mask and a "replace" affordance (leaving apiKey undefined → keep it);
// starting a replace switches to an input where '' erases and a value replaces.
function KeyField({ mask, value, onChange }: { mask: string | null; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const replacing = value !== undefined
  return (
    <Field label={t('library.apiKey')} hint={t('library.apiKeyOpt')}>
      {mask && !replacing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="lib-in" style={{ flex: 1, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{mask}</span>
          <button onClick={() => onChange('')} style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, padding: '6px 10px', whiteSpace: 'nowrap' }}>
            {t('library.replaceKey')}
          </button>
        </div>
      ) : (
        <input className="lib-in" type="password" autoFocus={replacing && !!mask} value={value ?? ''}
          onChange={e => onChange(e.target.value)} />
      )}
    </Field>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>{children}</div>
}

function Card({ title, subtitle, badge, readonly, onClick }: { title: string; subtitle?: string; badge?: string; readonly?: boolean; onClick?: () => void }) {
  return (
    <button className={`lib-card${readonly ? ' ro' : ''}`} onClick={onClick} disabled={readonly}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-bright)' }}>{title}</span>
        {badge && <span style={{ fontSize: 9, color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>{badge}</span>}
      </div>
      {subtitle && <span style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>}
    </button>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ border: '0.5px dashed var(--border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 12 }}>
      {label}
    </button>
  )
}

function Modal({ title, onClose, onSave, onDelete, saving, children }: {
  title: string; onClose: () => void; onSave: () => void; onDelete?: () => void; saving: boolean; children: React.ReactNode
}) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, zIndex: 100 }}>
      <div style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)', width: 560, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-bright)' }}>{title}</div>
          {children}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderTop: '0.5px solid var(--border)' }}>
          <button onClick={onSave} disabled={saving} style={{ background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '7px 16px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {t('common.save')}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>{t('common.cancel')}</button>
          {onDelete && <button onClick={onDelete} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 12 }}>{t('library.delete')}</button>}
        </div>
      </div>
    </div>
  )
}

export function Library() {
  const { t } = useT()
  const [tab, setTab] = useState<Tab>('tools')
  const [tools, setTools] = useState<CustomToolView[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [mcp, setMcp] = useState<McpServerView[]>([])
  const [saving, setSaving] = useState(false)

  const [toolDraft, setToolDraft] = useState<ToolDraft | null>(null)
  const [paramsText, setParamsText] = useState('{}')
  const [paramsErr, setParamsErr] = useState(false)
  const [skillDraft, setSkillDraft] = useState<Skill | null>(null)
  const [mcpDraft, setMcpDraft] = useState<McpDraft | null>(null)

  useEffect(() => { void reload() }, [])
  async function reload() {
    const [ts, ss, ms] = await Promise.all([toolsApi.list(), skillsApi.list(), mcpApi.list()])
    setTools(ts); setSkills(ss); setMcp(ms)
  }

  // ── tool editor ──
  function openTool(existing?: CustomToolView) {
    const d: ToolDraft = existing ?? { id: uid(), name: '', description: '', url: '', parameters: { type: 'object' as const, properties: {} }, apiKeyMask: null, enabled: true }
    setToolDraft(d)
    setParamsText(JSON.stringify(d.parameters, null, 2))
    setParamsErr(false)
  }
  async function saveTool() {
    if (!toolDraft) return
    let parameters = toolDraft.parameters
    try { parameters = JSON.parse(paramsText) } catch { setParamsErr(true); return }
    setSaving(true)
    try {
      const saved = await toolsApi.upsert({ ...toolDraft, parameters })
      setTools(prev => { const i = prev.findIndex(x => x.id === saved.id); return i >= 0 ? prev.map(x => x.id === saved.id ? saved : x) : [...prev, saved] })
      setToolDraft(null)
    } finally { setSaving(false) }
  }
  async function deleteTool() {
    if (!toolDraft) return
    await toolsApi.remove(toolDraft.id)
    setTools(prev => prev.filter(x => x.id !== toolDraft.id))
    setToolDraft(null)
  }

  // ── skill editor ──
  function openSkill(existing?: Skill) {
    setSkillDraft(existing ?? { id: uid(), name: '', instruction: '', toolIds: [], enabled: true })
  }
  async function saveSkill() {
    if (!skillDraft) return
    setSaving(true)
    try {
      const saved = await skillsApi.upsert(skillDraft)
      setSkills(prev => { const i = prev.findIndex(x => x.id === saved.id); return i >= 0 ? prev.map(x => x.id === saved.id ? saved : x) : [...prev, saved] })
      setSkillDraft(null)
    } finally { setSaving(false) }
  }
  async function deleteSkill() {
    if (!skillDraft) return
    await skillsApi.remove(skillDraft.id)
    setSkills(prev => prev.filter(x => x.id !== skillDraft.id))
    setSkillDraft(null)
  }

  // ── mcp editor ──
  function openMcp(existing?: McpServerView) {
    setMcpDraft(existing ?? { id: uid(), name: '', transport: 'http', url: '', apiKeyMask: null, enabled: true })
  }
  async function saveMcp() {
    if (!mcpDraft) return
    setSaving(true)
    try {
      const saved = await mcpApi.upsert(mcpDraft)
      setMcp(prev => { const i = prev.findIndex(x => x.id === saved.id); return i >= 0 ? prev.map(x => x.id === saved.id ? saved : x) : [...prev, saved] })
      setMcpDraft(null)
    } finally { setSaving(false) }
  }
  async function deleteMcp() {
    if (!mcpDraft) return
    await mcpApi.remove(mcpDraft.id)
    setMcp(prev => prev.filter(x => x.id !== mcpDraft.id))
    setMcpDraft(null)
  }

  const allToolChoices = [...BUILTIN_TOOLS.map(b => ({ id: b.id, name: b.name })), ...tools.map(c => ({ id: c.id, name: c.name }))]

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900 }}>
      <style>{CSS}</style>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-bright)', margin: '0 0 4px' }}>{t('library.title')}</h1>

      <div style={{ display: 'flex', gap: 6, margin: '16px 0 20px' }}>
        {(['tools', 'skills', 'mcp'] as const).map(tb => (
          <button key={tb} className={`lib-tab${tab === tb ? ' active' : ''}`} onClick={() => setTab(tb)}>
            {tb === 'tools' ? t('library.tabTools') : tb === 'skills' ? t('library.tabSkills') : t('library.tabMcp')}
          </button>
        ))}
      </div>

      {tab === 'tools' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div className="lib-label" style={{ marginBottom: 8 }}>{t('library.builtin')}</div>
            <Grid>
              {BUILTIN_TOOLS.map(b => <Card key={b.id} title={b.name} subtitle={b.description} badge={t('library.builtinReadonly')} readonly />)}
            </Grid>
          </div>
          <div>
            <div className="lib-label" style={{ marginBottom: 8 }}>{t('library.custom')}</div>
            <Grid>
              {tools.map(c => <Card key={c.id} title={c.name} subtitle={c.url} badge={c.enabled ? undefined : t('common.off')} onClick={() => openTool(c)} />)}
              <AddButton label={t('library.addTool')} onClick={() => openTool()} />
            </Grid>
          </div>
        </div>
      )}

      {tab === 'skills' && (
        <Grid>
          {skills.map(s => <Card key={s.id} title={s.name} subtitle={s.instruction || t('library.empty')} badge={s.enabled ? undefined : t('common.off')} onClick={() => openSkill(s)} />)}
          <AddButton label={t('library.addSkill')} onClick={() => openSkill()} />
        </Grid>
      )}

      {tab === 'mcp' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('library.mcpHint')}</div>
          <Grid>
            {mcp.map(m => <Card key={m.id} title={m.name} subtitle={m.url ?? m.command} badge={m.transport} onClick={() => openMcp(m)} />)}
            <AddButton label={t('library.addMcp')} onClick={() => openMcp()} />
          </Grid>
        </div>
      )}

      {/* ── Tool modal ── */}
      {toolDraft && (
        <Modal title={t('library.tabTools')} saving={saving} onClose={() => setToolDraft(null)} onSave={saveTool}
          onDelete={tools.some(x => x.id === toolDraft.id) ? deleteTool : undefined}>
          <Field label={t('library.name')} hint={t('library.toolNameHint')}>
            <input className="lib-in" value={toolDraft.name} onChange={e => setToolDraft({ ...toolDraft, name: e.target.value })} placeholder="get_weather" />
          </Field>
          <Field label={t('library.description')} hint={t('library.descHint')}>
            <input className="lib-in" value={toolDraft.description} onChange={e => setToolDraft({ ...toolDraft, description: e.target.value })} />
          </Field>
          <Field label={t('library.url')} hint={t('library.urlHint')}>
            <input className="lib-in" value={toolDraft.url} onChange={e => setToolDraft({ ...toolDraft, url: e.target.value })} placeholder="http://127.0.0.1:8080/tool" />
          </Field>
          <KeyField mask={toolDraft.apiKeyMask} value={toolDraft.apiKey} onChange={v => setToolDraft({ ...toolDraft, apiKey: v })} />
          <Field label={t('library.params')} hint={paramsErr ? t('library.paramsInvalid') : t('library.paramsHint')}>
            <textarea className="lib-in" style={{ minHeight: 110, resize: 'vertical', ...(paramsErr ? { borderColor: 'var(--error)' } : {}) }}
              value={paramsText} onChange={e => { setParamsText(e.target.value); setParamsErr(false) }} spellCheck={false} />
          </Field>
        </Modal>
      )}

      {/* ── Skill modal ── */}
      {skillDraft && (
        <Modal title={t('library.tabSkills')} saving={saving} onClose={() => setSkillDraft(null)} onSave={saveSkill}
          onDelete={skills.some(x => x.id === skillDraft.id) ? deleteSkill : undefined}>
          <Field label={t('library.name')}>
            <input className="lib-in" value={skillDraft.name} onChange={e => setSkillDraft({ ...skillDraft, name: e.target.value })} />
          </Field>
          <Field label={t('library.instruction')} hint={t('library.instructionHint')}>
            <textarea className="lib-in" style={{ minHeight: 90, resize: 'vertical' }} value={skillDraft.instruction} onChange={e => setSkillDraft({ ...skillDraft, instruction: e.target.value })} />
          </Field>
          <Field label={t('library.skillTools')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allToolChoices.map(c => {
                const on = skillDraft.toolIds.includes(c.id)
                return (
                  <button key={c.id}
                    onClick={() => setSkillDraft({ ...skillDraft, toolIds: on ? skillDraft.toolIds.filter(i => i !== c.id) : [...skillDraft.toolIds, c.id] })}
                    style={{ border: `0.5px solid ${on ? 'var(--accent-dim)' : 'var(--border)'}`, background: on ? 'var(--accent-bg)' : 'var(--bg-base)', color: on ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>
                    {on ? '✓ ' : ''}{c.name}
                  </button>
                )
              })}
            </div>
          </Field>
        </Modal>
      )}

      {/* ── MCP modal ── */}
      {mcpDraft && (
        <Modal title={t('library.tabMcp')} saving={saving} onClose={() => setMcpDraft(null)} onSave={saveMcp}
          onDelete={mcp.some(x => x.id === mcpDraft.id) ? deleteMcp : undefined}>
          <Field label={t('library.name')}>
            <input className="lib-in" value={mcpDraft.name} onChange={e => setMcpDraft({ ...mcpDraft, name: e.target.value })} />
          </Field>
          <Field label={t('library.transport')}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['http', 'sse', 'stdio'] as const).map(tr => (
                <button key={tr} onClick={() => setMcpDraft({ ...mcpDraft, transport: tr })}
                  style={{ border: `0.5px solid ${mcpDraft.transport === tr ? 'var(--accent-dim)' : 'var(--border)'}`, background: mcpDraft.transport === tr ? 'var(--accent-bg)' : 'var(--bg-base)', color: mcpDraft.transport === tr ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>
                  {tr}
                </button>
              ))}
            </div>
          </Field>
          {mcpDraft.transport === 'stdio' ? (
            <Field label={t('library.command')}>
              <input className="lib-in" value={mcpDraft.command ?? ''} onChange={e => setMcpDraft({ ...mcpDraft, command: e.target.value })} placeholder="npx -y @my/mcp-server" />
            </Field>
          ) : (
            <Field label={t('library.url')}>
              <input className="lib-in" value={mcpDraft.url ?? ''} onChange={e => setMcpDraft({ ...mcpDraft, url: e.target.value })} placeholder="https://mcp.example.com" />
            </Field>
          )}
          <KeyField mask={mcpDraft.apiKeyMask} value={mcpDraft.apiKey} onChange={v => setMcpDraft({ ...mcpDraft, apiKey: v })} />
        </Modal>
      )}
    </div>
  )
}
