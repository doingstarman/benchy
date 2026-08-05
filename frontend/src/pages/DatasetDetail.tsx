import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useT, t } from '../i18n'
import { datasetsApi, providersApi, runsApi, uploadsApi, useSSE, type ArenaState } from '../api'
import type { Dataset, DatasetItem, DatasetVar, DatasetVarType, Provider, Result } from '../../../src/types'

const VAR_TYPES: DatasetVarType[] = ['text', 'date', 'number']
type Tab = 'schema' | 'markup' | 'run'

const CSS = `
  .dsx { --p: #7F77DD; --p-strong: #6a61d0; --p-bg: rgba(127,119,221,0.12); --p-bd: rgba(127,119,221,0.45); --ok: #5ab87a; --mid: #d8a24a; --bad: #e05c5c; }
  .dsx-in { box-sizing: border-box; padding: 6px 9px; background: var(--bg-base); border: 0.5px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono); outline: none; }
  .dsx-in:focus { border-color: var(--p-bd); }
  .dsx-sec { background: var(--bg-elevated); border: 0.5px solid var(--border); border-radius: var(--radius-md); padding: 18px 20px; }
  .dsx-h { font-size: 13px; font-weight: 600; color: var(--text-bright); margin: 0 0 2px; }
  .dsx-sub { font-size: 11px; color: var(--text-muted); margin: 0 0 14px; }
  .dsx-label { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .dsx-primary { border: none; background: var(--p); color: #fff; border-radius: var(--radius-sm); padding: 7px 15px; font-size: 12px; font-family: var(--font-mono); font-weight: 600; cursor: pointer; }
  .dsx-primary:disabled { opacity: 0.45; cursor: default; }
  .dsx-ghost { border: 0.5px dashed var(--border); background: transparent; color: var(--text-secondary); border-radius: var(--radius-sm); padding: 7px 13px; font-size: 12px; font-family: var(--font-mono); cursor: pointer; }
  .dsx-ghost:hover { border-color: var(--p-bd); color: var(--p); }
  .dsx-x { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 0 4px; line-height: 1; }
  .dsx-x:hover { color: var(--bad); }
  .dsx-tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 8px 2px; margin-right: 20px; font-size: 12.5px; font-family: var(--font-mono); color: var(--text-muted); cursor: pointer; }
  .dsx-tab:hover { color: var(--text-secondary); }
  .dsx-tab.active { color: var(--text-bright); border-bottom-color: var(--p); }
  .dsx-tab .cnt { font-size: 10px; color: var(--text-muted); margin-left: 5px; }
  .dsx-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .dsx-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; padding: 7px 8px; border-bottom: 0.5px solid var(--border); }
  .dsx-table td { padding: 6px 8px; border-bottom: 0.5px solid var(--hairline); vertical-align: middle; }
  .dsx-table tr:hover td { background: rgba(127,119,221,0.04); }
  .dsx-thumb { width: 30px; height: 30px; border-radius: 5px; object-fit: cover; border: 0.5px solid var(--border); display: block; }
  .dsx-pdf { width: 30px; height: 30px; border-radius: 5px; border: 0.5px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 700; color: var(--bad); background: var(--bg-base); }
  .dsx-chip { border-radius: 20px; padding: 5px 12px; font-size: 12px; font-family: var(--font-mono); cursor: pointer; border: 0.5px solid var(--border); background: var(--bg-base); color: var(--text-muted); }
  .dsx-chip.on { border-color: var(--p-bd); background: var(--p-bg); color: var(--p); }
  .dsx-stat { display: flex; flex-direction: column; gap: 2px; }
  .dsx-stat b { font-size: 15px; font-family: var(--font-mono); color: var(--text-bright); font-weight: 600; }
  .dsx-stat span { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
`

function modelLabel(key: string): string {
  return key.split(':').slice(1).join(':') || key
}

function availableModels(providers: Provider[]): string[] {
  return providers
    .filter(p => p.enabled && (p.apiKey || p.baseUrl))
    .flatMap(p => p.models.map(m => `${p.id}:${m}`))
}

function isItemLabeled(item: DatasetItem, schema: DatasetVar[]): boolean {
  return schema.length > 0 && schema.every(v => (item.groundTruth[v.key] ?? '').trim() !== '')
}

interface MatrixRow {
  model: string
  overall: number | null
  perVar: Record<string, number | null>
}

// Aggregate a finished run's per-result scores into a model × variable matrix.
function buildMatrix(results: Result[], schema: DatasetVar[]): MatrixRow[] {
  const byModel = new Map<string, Result[]>()
  for (const r of results) {
    const arr = byModel.get(r.model) ?? []
    arr.push(r)
    byModel.set(r.model, arr)
  }
  return [...byModel.entries()].map(([model, rows]) => {
    const perVar: Record<string, number | null> = {}
    for (const v of schema) {
      let scored = 0, matched = 0
      for (const r of rows) {
        const d = r.scoreDetail?.[v.key]
        if (d === 'match' || d === 'miss') { scored++; if (d === 'match') matched++ }
      }
      perVar[v.key] = scored === 0 ? null : matched / scored
    }
    const scoredRows = rows.filter(r => r.score != null)
    const overall = scoredRows.length === 0 ? null
      : scoredRows.reduce((s, r) => s + (r.score ?? 0), 0) / scoredRows.length
    return { model, overall, perVar }
  }).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1))
}

const pct = (v: number | null): string => v == null ? '—' : `${Math.round(v * 100)}%`

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

// Blind mode shuffles the answer cards deterministically per item so card
// position can't leak the model — same item always shuffles the same way.
function orderAnswers(results: Result[], promptIndex: number, blind: boolean): Result[] {
  if (!blind) return [...results].sort((a, b) => a.model.localeCompare(b.model))
  return [...results].sort((a, b) => hashStr(`${promptIndex}:${a.model}`) - hashStr(`${promptIndex}:${b.model}`))
}

// Heat tint for a matrix cell — green high, amber mid, red low, muted when unscored.
function heat(v: number | null): { color: string; background: string } {
  if (v == null) return { color: 'var(--text-muted)', background: 'transparent' }
  if (v >= 0.9) return { color: 'var(--ok)', background: 'rgba(90,184,122,0.13)' }
  if (v >= 0.6) return { color: 'var(--mid)', background: 'rgba(216,162,74,0.13)' }
  return { color: 'var(--bad)', background: 'rgba(224,92,92,0.13)' }
}

export function DatasetDetail() {
  const { id = '' } = useParams()
  const { t: tt } = useT()
  const nav = useNavigate()

  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [schema, setSchema] = useState<DatasetVar[]>([])
  const [schemaDirty, setSchemaDirty] = useState(false)
  const [items, setItems] = useState<DatasetItem[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('schema')
  const [markupView, setMarkupView] = useState<'focus' | 'table'>('focus')
  const [focusIdx, setFocusIdx] = useState(0)
  const [aiFilling, setAiFilling] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)
  // Per-item write serialization: a blur-commit and an accept can fire for the
  // same item in one gesture; chaining keeps the last-called PATCH the last to land.
  const writeChain = useRef<Map<string, Promise<unknown>>>(new Map())

  // run state
  const [prompt, setPrompt] = useState('')
  const [selModels, setSelModels] = useState<Set<string>>(new Set())
  const [runId, setRunId] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Result[] | null>(null)
  const [starting, setStarting] = useState(false)
  // arena (benchmark) state
  const [runMode, setRunMode] = useState<'score' | 'arena'>('score')
  const [viewRunId, setViewRunId] = useState<string | null>(null)
  const [arena, setArena] = useState<ArenaState | null>(null)
  const [blind, setBlind] = useState(false)
  const [curWorst, setCurWorst] = useState<string | null>(null)

  useEffect(() => { void load() }, [id])
  async function load() {
    const [ds, ps] = await Promise.all([datasetsApi.get(id), providersApi.list()])
    setDataset(ds)
    setSchema(ds.schema)
    setSchemaDirty(false)
    setItems(ds.items ?? [])
    setProviders(ps)
    if (!prompt) setPrompt(tt('dataset.promptBody'))
    const runs = await datasetsApi.runs(id)
    const last = runs[0]
    if (last && last.status !== 'running') {
      const full = await runsApi.get(last.id)
      setRunResults(full.results)
      setViewRunId(last.id)
      if (last.mode === 'arena') {
        setRunMode('arena')
        setArena(await datasetsApi.arena(id, last.id))
      }
    }
  }

  const models = useMemo(() => availableModels(providers), [providers])
  const trusted = dataset?.trustedModel ?? null
  const comparableModels = models.filter(m => m !== trusted)
  const labeledCount = useMemo(() => items.filter(i => isItemLabeled(i, dataset?.schema ?? [])).length, [items, dataset])

  useSSE(runId, e => {
    if (e.event !== 'run_done') return
    void runsApi.get(e.runId).then(r => {
      setRunResults(r.results)
      if (runMode === 'arena') void datasetsApi.arena(id, e.runId).then(setArena)
    })
  })

  // ── schema ──
  function addVar() { setSchema(s => [...s, { key: '', type: 'text' }]); setSchemaDirty(true) }
  function updateVar(i: number, patch: Partial<DatasetVar>) {
    setSchema(s => s.map((v, j) => j === i ? { ...v, ...patch } : v)); setSchemaDirty(true)
  }
  function removeVar(i: number) { setSchema(s => s.filter((_, j) => j !== i)); setSchemaDirty(true) }
  async function saveSchema() {
    const clean = schema.map(v => ({ ...v, key: v.key.trim() })).filter(v => /^[a-z0-9_]+$/.test(v.key))
    const ds = await datasetsApi.update(id, { schema: clean })
    setDataset(ds); setSchema(ds.schema); setSchemaDirty(false)
  }
  async function setTrusted(model: string | null) {
    const ds = await datasetsApi.update(id, { trustedModel: model })
    setDataset(ds)
    if (model) setSelModels(prev => { const n = new Set(prev); n.delete(model); return n })
  }

  // ── files / items ──
  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const att = await uploadsApi.upload(file)
        await datasetsApi.addItem(id, { attachmentId: att.id })
      }
      const ds = await datasetsApi.get(id)
      setItems(ds.items ?? []); setDataset(ds)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  async function removeItem(itemId: string) {
    await datasetsApi.removeItem(id, itemId)
    setItems(prev => prev.filter(i => i.id !== itemId))
  }
  // Text-type datasets: items carry an `input` string instead of a file.
  async function addTextItem() {
    try {
      const it = await datasetsApi.addItem(id, { input: '' })
      setItems(prev => [...prev, it])
    } catch (e) { setAiNote(e instanceof Error ? e.message : String(e)) }
  }
  async function importCsvNow() {
    if (!csvText.trim()) return
    setCsvBusy(true)
    try {
      const r = await datasetsApi.importCsv(id, csvText)
      const ds = await datasetsApi.get(id)
      setItems(ds.items ?? []); setDataset(ds)
      setCsvOpen(false); setCsvText('')
      setAiNote(tt('dataset.csvImported', { n: r.imported }))
    } catch (e) {
      // A malformed paste is a normal outcome — surface the server's message.
      setAiNote(e instanceof Error ? e.message : String(e))
    } finally { setCsvBusy(false) }
  }
  function editInput(itemId: string, value: string) {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, input: value } : i))
  }
  function commitInput(item: DatasetItem) {
    void mutateItem(item.id, { input: item.input ?? '' })
  }
  function editCell(itemId: string, key: string, value: string) {
    // Typing over a field also clears any pending AI suggestion for it — the human
    // value supersedes the machine's.
    setItems(prev => prev.map(i => {
      if (i.id !== itemId) return i
      const ai = { ...i.aiSuggested }; delete ai[key]
      return { ...i, groundTruth: { ...i.groundTruth, [key]: value }, aiSuggested: ai }
    }))
  }
  // Serialized, reconciled item write: awaits the item's previous write, PATCHes,
  // then adopts the server's authoritative row; on failure resyncs from the server
  // so the UI can never show a phantom "saved" state.
  function mutateItem(itemId: string, body: { groundTruth?: Record<string, string>; aiSuggested?: Record<string, string>; input?: string }): Promise<unknown> {
    const prev = writeChain.current.get(itemId) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(async () => {
      try {
        const updated = await datasetsApi.updateItem(id, itemId, body)
        setItems(cur => cur.map(i => i.id === itemId ? updated : i))
      } catch {
        const ds = await datasetsApi.get(id).catch(() => null)
        if (ds) { setItems(ds.items ?? []); setDataset(ds) }
      }
    })
    writeChain.current.set(itemId, next)
    return next
  }
  async function commitCell(item: DatasetItem) {
    await mutateItem(item.id, { groundTruth: item.groundTruth, aiSuggested: item.aiSuggested })
  }

  // ── AI-assisted markup (trusted model → ai_suggested → human confirms) ──
  async function runAiFill() {
    if (!trusted) return
    setAiFilling(true); setAiNote(null)
    try {
      const r = await datasetsApi.aiFill(id, { scope: 'empty' })
      const ds = await datasetsApi.get(id)
      setItems(ds.items ?? []); setDataset(ds)
      setAiNote(tt('dataset.aiDone', { filled: r.filled, skipped: r.skipped, errored: r.errored }))
    } finally { setAiFilling(false) }
  }
  function applyItem(itemId: string, gt: Record<string, string>, ai: Record<string, string>) {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, groundTruth: gt, aiSuggested: ai } : i)) // optimistic
    void mutateItem(itemId, { groundTruth: gt, aiSuggested: ai })
  }
  function acceptAi(item: DatasetItem, key: string) {
    const ai = { ...item.aiSuggested }; const v = ai[key]; delete ai[key]
    applyItem(item.id, { ...item.groundTruth, [key]: v }, ai)
  }
  function rejectAi(item: DatasetItem, key: string) {
    const ai = { ...item.aiSuggested }; delete ai[key]
    applyItem(item.id, item.groundTruth, ai)
  }
  function acceptAllAi() {
    const schemaKeys = (dataset?.schema ?? []).map(v => v.key)
    for (const it of items) {
      const keys = schemaKeys.filter(k => !(it.groundTruth[k] ?? '').trim() && (it.aiSuggested[k] ?? '').trim())
      if (!keys.length) continue
      const gt = { ...it.groundTruth }; const ai = { ...it.aiSuggested }
      for (const k of keys) { gt[k] = ai[k]; delete ai[k] }
      applyItem(it.id, gt, ai)
    }
  }
  // Persist the given item's ground truth, then move focus to index `i`.
  async function goToFocus(i: number) {
    const cur = items[Math.min(focusIdx, items.length - 1)]
    if (cur) await commitCell(cur)
    setFocusIdx(Math.max(0, Math.min(i, items.length - 1)))
  }

  // ── run ──
  async function startRun() {
    const chosen = [...selModels].filter(m => m !== trusted)
    if (!chosen.length || !prompt.trim()) return
    setStarting(true)
    setRunResults(null)
    setArena(null)
    setCurWorst(null)
    try {
      const { runId: newRun } = await datasetsApi.run(id, { models: chosen, prompt: prompt.trim(), mode: runMode })
      setRunId(newRun)
      setViewRunId(newRun)
    } finally { setStarting(false) }
  }

  // ── arena judging ──
  const answersFor = (i: number): Result[] => (runResults ?? []).filter(r => r.promptIndex === i)

  async function judge(bestModel: string) {
    if (!viewRunId || !arena || arena.nextIndex < 0) return
    const worstModel = curWorst && curWorst !== bestModel ? curWorst : undefined
    await datasetsApi.putVerdict(id, viewRunId, arena.nextIndex, { bestModel, worstModel })
    setArena(await datasetsApi.arena(id, viewRunId))
    setCurWorst(null)
  }
  async function skipItem() {
    if (!viewRunId || !arena || arena.nextIndex < 0) return
    await datasetsApi.putVerdict(id, viewRunId, arena.nextIndex, { skipped: true })
    setArena(await datasetsApi.arena(id, viewRunId))
    setCurWorst(null)
  }
  async function exitArena() {
    if (viewRunId) await runsApi.save(viewRunId, true).catch(() => {})
    nav('/datasets')
  }

  if (!dataset) return <div className="dsx" style={{ padding: '28px 32px', fontSize: 12, color: 'var(--text-muted)' }}><style>{CSS}</style>{t('common.loading')}</div>

  const matrix = runResults ? buildMatrix(runResults, dataset.schema) : []
  const running = runId != null && runResults == null
  const focusItem = items.length ? items[Math.min(focusIdx, items.length - 1)] : null
  // Input-based datasets (text + tools) share the whole markup/run path; only
  // 'files' uses attachments. `isText` = "input-based" (kept the name to avoid churn).
  const isText = dataset?.type !== 'files'
  const inputPlaceholderKey = dataset?.type === 'tools' ? 'dataset.toolsInputPlaceholder' : 'dataset.inputPlaceholder'
  // Schema fields the AI proposed that a human hasn't confirmed yet (keys no longer
  // in the schema don't count — they have no row to confirm).
  const aiPending = items.reduce((n, it) => n + dataset.schema.filter(v => !(it.groundTruth[v.key] ?? '').trim() && (it.aiSuggested[v.key] ?? '').trim()).length, 0)

  return (
    <div className="dsx" style={{ flex: 1, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: '22px 32px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 1000 }}>
        <button onClick={() => nav('/datasets')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 12 }}>
          {tt('dataset.back')}
        </button>

        {/* ── Header + summary strip ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 21, fontWeight: 600, color: 'var(--text-bright)', margin: 0 }}>{dataset.name}</h1>
          <div style={{ flex: 1 }} />
          <button onClick={async () => { if (confirm(tt('dataset.deleteConfirm'))) { await datasetsApi.remove(id); nav('/datasets') } }}
            style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '5px 10px' }}>
            {tt('dataset.delete')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 28, padding: '14px 20px', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 4 }}>
          <div className="dsx-stat"><b>{items.length}</b><span>{tt('dataset.cItems')}</span></div>
          <div className="dsx-stat"><b style={{ color: items.length && labeledCount === items.length ? 'var(--ok)' : undefined }}>{labeledCount}/{items.length}</b><span>{tt('dataset.cLabeled')}</span></div>
          <div className="dsx-stat"><b>{dataset.schema.length}</b><span>{tt('dataset.cSchema')}</span></div>
          <div className="dsx-stat" style={{ minWidth: 0 }}>
            <b style={{ fontSize: 13, color: trusted ? 'var(--p)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{trusted ? modelLabel(trusted) : tt('dataset.trustedNone')}</b>
            <span>{tt('dataset.trusted')}</span>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', margin: '10px 0 18px' }}>
          <button className={`dsx-tab${tab === 'schema' ? ' active' : ''}`} onClick={() => setTab('schema')}>
            {tt('dataset.schemaTitle')}<span className="cnt">{dataset.schema.length}</span>
          </button>
          <button className={`dsx-tab${tab === 'markup' ? ' active' : ''}`} onClick={() => setTab('markup')}>
            {tt('dataset.markup')}<span className="cnt">{labeledCount}/{items.length}</span>
          </button>
          <button className={`dsx-tab${tab === 'run' ? ' active' : ''}`} onClick={() => setTab('run')}>
            {tt('dataset.runTitle')}{matrix.length > 0 && <span className="cnt">✓</span>}
          </button>
        </div>

        {/* ── Schema tab ── */}
        {tab === 'schema' && (
          <div className="dsx-sec">
            <div className="dsx-h">{tt('dataset.schemaTitle')}</div>
            <div className="dsx-sub">{tt('dataset.schemaSub')}</div>
            <table className="dsx-table" style={{ marginBottom: 12 }}>
              <thead><tr>
                <th style={{ width: '26%' }}>{tt('dataset.varName')}</th>
                <th style={{ width: '18%' }}>{tt('dataset.varType')}</th>
                <th>{tt('dataset.varDesc')}</th>
                <th style={{ width: 30 }} />
              </tr></thead>
              <tbody>
                {schema.map((v, i) => (
                  <tr key={i}>
                    <td><input className="dsx-in" style={{ width: '100%' }} value={v.key} placeholder="merchant" onChange={e => updateVar(i, { key: e.target.value })} /></td>
                    <td>
                      <select className="dsx-in" style={{ width: '100%' }} value={v.type} onChange={e => updateVar(i, { type: e.target.value as DatasetVarType })}>
                        {VAR_TYPES.map(ty => <option key={ty} value={ty}>{ty}</option>)}
                      </select>
                    </td>
                    <td><input className="dsx-in" style={{ width: '100%' }} value={v.desc ?? ''} onChange={e => updateVar(i, { desc: e.target.value })} /></td>
                    <td><button className="dsx-x" onClick={() => removeVar(i)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="dsx-ghost" onClick={addVar}>{tt('dataset.addVar')}</button>
              {schemaDirty && <button className="dsx-primary" onClick={() => void saveSchema()}>{t('common.save')}</button>}
            </div>

            <div style={{ borderTop: '0.5px solid var(--hairline)', margin: '18px 0 0', paddingTop: 14 }}>
              <div className="dsx-label" style={{ marginBottom: 7 }}>{tt('dataset.trusted')}</div>
              <select className="dsx-in" style={{ minWidth: 260 }} value={trusted ?? ''} onChange={e => void setTrusted(e.target.value || null)}>
                <option value="">{tt('dataset.trustedNone')}</option>
                {models.map(m => <option key={m} value={m}>{modelLabel(m)}</option>)}
              </select>
              {trusted && (
                <div style={{ fontSize: 10.5, color: 'var(--p)', marginTop: 8, maxWidth: 580, background: 'var(--p-bg)', border: '0.5px solid var(--p-bd)', borderRadius: 'var(--radius-sm)', padding: '8px 11px', lineHeight: 1.5 }}>
                  ✦ {tt('dataset.trustedWarn')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Markup tab (focus-first) ── */}
        {tab === 'markup' && (
          <div className="dsx-sec">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <div className="dsx-h">{tt('dataset.markup')}</div>
                <div className="dsx-sub">{tt('dataset.markupSub')}</div>
              </div>
              {dataset.schema.length > 0 && items.length > 0 && (
                <div style={{ display: 'flex', gap: 4, border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
                  {(['focus', 'table'] as const).map(v => (
                    <button key={v} onClick={() => setMarkupView(v)}
                      style={{ border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer', background: markupView === v ? 'var(--p-bg)' : 'transparent', color: markupView === v ? 'var(--p)' : 'var(--text-muted)' }}>
                      {v === 'focus' ? tt('dataset.viewFocus') : tt('dataset.viewTable')}
                    </button>
                  ))}
                </div>
              )}
              {dataset.schema.length > 0 && items.length > 0 && (
                <button onClick={() => void runAiFill()} disabled={aiFilling || !trusted}
                  title={!trusted ? tt('dataset.aiNoTrusted') : undefined}
                  style={{ border: '0.5px solid var(--p-bd)', background: 'var(--p-bg)', color: 'var(--p)', borderRadius: 'var(--radius-sm)', padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: trusted && !aiFilling ? 'pointer' : 'default', opacity: !trusted ? 0.55 : 1, whiteSpace: 'nowrap' }}>
                  ✦ {aiFilling ? tt('dataset.aiFilling') : tt('dataset.labelWithAi')}
                </button>
              )}
              {isText ? (
                <>
                  <button className="dsx-ghost" onClick={() => setCsvOpen(o => !o)}>↓ {tt('dataset.importCsv')}</button>
                  <button className="dsx-ghost" onClick={() => void addTextItem()}>{tt('dataset.addItem')}</button>
                </>
              ) : (
                <>
                  <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" style={{ display: 'none' }} onChange={e => void onFiles(e.target.files)} />
                  <button className="dsx-ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? tt('dataset.uploading') : `＋ ${tt('dataset.chooseFiles')}`}
                  </button>
                </>
              )}
            </div>

            {isText && csvOpen && (
              <div style={{ margin: '0 0 12px', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--bg-elevated)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>{tt('dataset.csvHint')}</div>
                <textarea className="dsx-in" style={{ width: '100%', minHeight: 120, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                  placeholder={['input', ...dataset.schema.map(v => v.key)].join(',')}
                  value={csvText} onChange={e => setCsvText(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="dsx-primary" disabled={csvBusy || !csvText.trim()} onClick={() => void importCsvNow()}>{tt('dataset.doImport')}</button>
                  <button className="dsx-ghost" onClick={() => setCsvOpen(false)}>{t('common.cancel')}</button>
                </div>
              </div>
            )}

            {aiPending > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 12px', fontSize: 11, color: 'var(--p)' }}>
                <span>✦ {tt('dataset.aiFilled', { n: aiPending })} · {tt('dataset.awaitConfirm')}</span>
                <button className="dsx-ghost" style={{ padding: '3px 10px', borderColor: 'var(--p-bd)', color: 'var(--p)' }} onClick={acceptAllAi}>{tt('dataset.confirmAll')}</button>
              </div>
            )}
            {aiNote && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px' }}>{aiNote}</div>
            )}

            {dataset.schema.length === 0 ? (
              <div style={{ padding: '22px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{tt('dataset.noSchema')}</div>
                <button className="dsx-primary" onClick={() => setTab('schema')}>{tt('dataset.goToSchema')}</button>
              </div>
            ) : items.length === 0 || !focusItem ? (
              <div style={{ padding: '22px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{isText ? tt('dataset.textFirst') : tt('dataset.uploadFirst')}</div>
                {isText ? (
                  <button className="dsx-ghost" onClick={() => void addTextItem()}>{tt('dataset.addItem')}</button>
                ) : (
                  <button className="dsx-ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? tt('dataset.uploading') : `＋ ${tt('dataset.chooseFiles')}`}
                  </button>
                )}
              </div>
            ) : markupView === 'table' ? (
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table className="dsx-table">
                  <thead><tr>
                    <th style={{ width: 34 }} />
                    {isText ? <th style={{ width: '34%' }}>{tt('dataset.input')}</th> : (<><th style={{ width: 40 }} /><th>{tt('dataset.file')}</th></>)}
                    {dataset.schema.map(v => <th key={v.key}>{v.key}</th>)}
                    <th style={{ width: 28 }} />
                  </tr></thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const done = isItemLabeled(it, dataset.schema)
                      const isImg = it.attachment?.mimeType.startsWith('image/')
                      return (
                        <tr key={it.id}>
                          <td style={{ textAlign: 'center', color: done ? 'var(--ok)' : 'var(--text-muted)' }}>{done ? '✓' : '—'}</td>
                          {isText ? (
                            <td>
                              <input className="dsx-in" disabled={aiFilling} style={{ width: '100%' }} placeholder={tt(inputPlaceholderKey)}
                                value={it.input ?? ''}
                                onChange={e => editInput(it.id, e.target.value)}
                                onBlur={() => commitInput(items.find(x => x.id === it.id) ?? it)} />
                            </td>
                          ) : (
                            <>
                              <td>
                                {it.attachment ? (
                                  isImg
                                    ? <img className="dsx-thumb" src={uploadsApi.url(it.attachment.id)} alt="" />
                                    : <div className="dsx-pdf">PDF</div>
                                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                              <td>
                                {it.attachment
                                  ? <a href={uploadsApi.url(it.attachment.id)} target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11, textDecoration: 'none' }}>{it.attachment.name}</a>
                                  : <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{String(idx + 1).padStart(3, '0')}</span>}
                              </td>
                            </>
                          )}
                          {dataset.schema.map(v => {
                            const gt = it.groundTruth[v.key] ?? ''
                            const ai = it.aiSuggested[v.key] ?? ''
                            const isAi = !gt.trim() && !!ai.trim()
                            return (
                            <td key={v.key}>
                              <input className="dsx-in" disabled={aiFilling} style={{ width: '100%', minWidth: 92, ...(isAi ? { borderColor: 'var(--p-bd)', color: 'var(--p)', fontStyle: 'italic' } : {}) }} placeholder={tt('dataset.typeHere')}
                                value={isAi ? ai : gt}
                                onChange={e => editCell(it.id, v.key, e.target.value)}
                                onBlur={() => void commitCell(items.find(x => x.id === it.id) ?? it)}
                                onKeyDown={e => { if (e.key === 'Enter') { if (isAi) acceptAi(it, v.key); else (e.target as HTMLInputElement).blur() } }} />
                            </td>
                            )
                          })}
                          <td><button className="dsx-x" onClick={() => void removeItem(it.id)}>×</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: 'var(--text-muted)', alignItems: 'center' }}>
                  <span className="dsx-label">{tt('dataset.legend')}</span>
                  <span style={{ color: 'var(--ok)' }}>✓ {tt('dataset.legendHuman')}</span>
                  <span style={{ color: 'var(--p)' }}>✦ {tt('dataset.legendAi')}</span>
                  <span>— {tt('dataset.legendEmpty')}</span>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr 300px', gap: 16, marginTop: 10, alignItems: 'start' }}>
                {/* queue */}
                <div>
                  <div className="dsx-label" style={{ marginBottom: 8 }}>{tt('dataset.queue')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 520, overflowY: 'auto' }}>
                    {items.map((it, i) => {
                      const done = isItemLabeled(it, dataset.schema)
                      const active = i === Math.min(focusIdx, items.length - 1)
                      const isImg = it.attachment?.mimeType.startsWith('image/')
                      return (
                        <button key={it.id} onClick={() => void goToFocus(i)}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', border: `0.5px solid ${active ? 'var(--p-bd)' : 'var(--border)'}`, background: active ? 'var(--p-bg)' : 'var(--bg-base)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer' }}>
                          {it.attachment
                            ? (isImg ? <img className="dsx-thumb" style={{ width: 24, height: 24 }} src={uploadsApi.url(it.attachment.id)} alt="" /> : <div className="dsx-pdf" style={{ width: 24, height: 24 }}>PDF</div>)
                            : <div style={{ width: 24, height: 24 }} />}
                          <span style={{ flex: 1, fontSize: 10.5, fontFamily: 'var(--font-mono)', color: active ? 'var(--p)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isText ? ((it.input ?? '').trim() || `#${i + 1}`) : (it.attachment?.name ?? String(i + 1).padStart(3, '0'))}</span>
                          <span style={{ fontSize: 11, color: done ? 'var(--ok)' : active ? 'var(--p)' : 'var(--text-muted)' }}>{done ? '✓' : active ? '●' : ''}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* preview / input */}
                <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-base)', minHeight: 480, display: 'flex', alignItems: isText ? 'stretch' : 'center', justifyContent: 'center', overflow: 'auto' }}>
                  {isText ? (
                    <textarea className="dsx-in" disabled={aiFilling} placeholder={tt(inputPlaceholderKey)}
                      style={{ width: '100%', minHeight: 480, resize: 'vertical', border: 'none', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6 }}
                      value={focusItem.input ?? ''}
                      onChange={e => editInput(focusItem.id, e.target.value)}
                      onBlur={() => commitInput(items.find(x => x.id === focusItem.id) ?? focusItem)} />
                  ) : focusItem.attachment
                    ? (focusItem.attachment.mimeType.startsWith('image/')
                      ? <img src={uploadsApi.url(focusItem.attachment.id)} alt="" style={{ maxWidth: '100%', maxHeight: 620, objectFit: 'contain', display: 'block' }} />
                      : <iframe title="preview" src={uploadsApi.url(focusItem.attachment.id)} style={{ width: '100%', height: 620, border: 'none', background: '#fff' }} />)
                    : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tt('dataset.noPreview')}</span>}
                </div>

                {/* variables */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <span className="dsx-label">{tt('dataset.varsOfSchema')}</span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{Math.min(focusIdx, items.length - 1) + 1} / {items.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {dataset.schema.map(v => {
                      const gt = focusItem.groundTruth[v.key] ?? ''
                      const ai = focusItem.aiSuggested[v.key] ?? ''
                      const isAi = !gt.trim() && !!ai.trim()
                      return (
                      <div key={v.key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{v.key}</span>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>{v.type}</span>
                        </div>
                        <input className="dsx-in" disabled={aiFilling} style={{ width: '100%', ...(isAi ? { borderColor: 'var(--p-bd)', color: 'var(--p)', fontStyle: 'italic' } : {}) }} placeholder={tt('dataset.typeHere')}
                          value={isAi ? ai : gt}
                          onChange={e => editCell(focusItem.id, v.key, e.target.value)}
                          onBlur={() => void commitCell(items.find(x => x.id === focusItem.id) ?? focusItem)}
                          onKeyDown={e => { if (e.key === 'Enter') { if (isAi) acceptAi(focusItem, v.key); else (e.target as HTMLInputElement).blur() } }} />
                        {isAi ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3 }}>
                            <span style={{ fontSize: 10, color: 'var(--p)', flex: 1 }}>✦ {tt('dataset.legendAi')}</span>
                            <button onClick={() => acceptAi(focusItem, v.key)} title={tt('dataset.legendHuman')} style={{ border: '0.5px solid var(--ok)', background: 'transparent', color: 'var(--ok)', borderRadius: 4, padding: '1px 8px', fontSize: 11, cursor: 'pointer' }}>✓</button>
                            <button onClick={() => rejectAi(focusItem, v.key)} style={{ border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', borderRadius: 4, padding: '1px 8px', fontSize: 11, cursor: 'pointer' }}>✕</button>
                          </div>
                        ) : v.desc ? <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{v.desc}</div> : null}
                      </div>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button className="dsx-primary" style={{ flex: 1 }} onClick={() => void goToFocus(focusIdx + 1)}>
                      ✓ {tt('dataset.saveNext')}
                    </button>
                    <button className="dsx-ghost" disabled={focusIdx >= items.length - 1} onClick={() => setFocusIdx(Math.min(focusIdx + 1, items.length - 1))}>
                      {tt('dataset.skipItem')}
                    </button>
                  </div>
                  <button className="dsx-x" style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }} onClick={() => void removeItem(focusItem.id)}>× {tt('dataset.delete')}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Run tab ── */}
        {tab === 'run' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="dsx-sec">
              <div className="dsx-h">{tt('dataset.runTitle')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                <div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['score', 'arena'] as const).map(mo => (
                      <button key={mo} className="dsx-chip"
                        onClick={() => setRunMode(mo)}
                        style={{ borderColor: runMode === mo ? 'var(--p-bd)' : 'var(--border)', background: runMode === mo ? 'var(--p-bg)' : 'var(--bg-base)', color: runMode === mo ? 'var(--p)' : 'var(--text-muted)' }}>
                        {mo === 'score' ? tt('dataset.modeScore') : tt('dataset.modeArena')}
                      </button>
                    ))}
                  </div>
                  {runMode === 'arena' && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, maxWidth: 560 }}>{tt('dataset.benchExplain')}</div>}
                </div>
                <div>
                  <div className="dsx-label" style={{ marginBottom: 6 }}>{tt('dataset.prompt')}</div>
                  <textarea className="dsx-in" style={{ width: '100%', minHeight: 60, resize: 'vertical' }} value={prompt} onChange={e => setPrompt(e.target.value)} />
                </div>
                <div>
                  <div className="dsx-label" style={{ marginBottom: 6 }}>{tt('dataset.models')}</div>
                  {comparableModels.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tt('dataset.noModels')}</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                      {comparableModels.map(m => {
                        const on = selModels.has(m)
                        return (
                          <button key={m} className={`dsx-chip${on ? ' on' : ''}`}
                            onClick={() => setSelModels(prev => { const n = new Set(prev); on ? n.delete(m) : n.add(m); return n })}>
                            {on ? '✓ ' : ''}{modelLabel(m)}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {trusted && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>✦ {tt('dataset.trustedWarn')}</div>}
                </div>
                <div>
                  <button className="dsx-primary" disabled={starting || running || selModels.size === 0 || items.length === 0 || !prompt.trim()} onClick={() => void startRun()}>
                    {running ? tt('dataset.running') : tt('dataset.runStart')}
                  </button>
                </div>
              </div>
            </div>

            {runMode === 'score' && matrix.length > 0 && (
              <div className="dsx-sec">
                <div className="dsx-h">{tt('dataset.resultsTitle')}</div>
                <div className="dsx-sub">{tt('dataset.resultsHint')}</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="dsx-table">
                    <thead><tr>
                      <th>{tt('dataset.model')}</th>
                      {dataset.schema.map(v => <th key={v.key} style={{ textAlign: 'right' }}>{v.key}</th>)}
                      <th style={{ textAlign: 'right' }}>{tt('dataset.overall')}</th>
                    </tr></thead>
                    <tbody>
                      {matrix.map((row, i) => {
                        const best = i === 0 && row.overall != null
                        return (
                          <tr key={row.model} style={best ? { background: 'var(--p-bg)' } : undefined}>
                            <td style={{ fontFamily: 'var(--font-mono)', color: best ? 'var(--p)' : 'var(--text-secondary)', fontWeight: best ? 600 : 400, borderLeft: best ? '2px solid var(--p)' : '2px solid transparent' }}>
                              {best ? '★ ' : ''}{modelLabel(row.model)}
                            </td>
                            {dataset.schema.map(v => {
                              const h = heat(row.perVar[v.key])
                              return <td key={v.key} style={{ textAlign: 'right', color: h.color, background: h.background }}>{pct(row.perVar[v.key])}</td>
                            })}
                            {(() => { const h = heat(row.overall); return <td style={{ textAlign: 'right', fontWeight: 700, color: h.color, background: h.background }}>{pct(row.overall)}</td> })()}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {runMode === 'arena' && arena && runResults && (
              <div className="dsx-sec">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div className="dsx-h" style={{ margin: 0 }}>{tt('dataset.modeArena')}</div>
                  <div style={{ flex: 1 }} />
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={blind} onChange={e => setBlind(e.target.checked)} />{tt('dataset.blindMode')}
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                  <span>{tt('dataset.arenaProgress')}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{arena.verdicts.length}/{arena.itemCount}</span>
                </div>
                <div className="dsx-bar" style={{ marginBottom: 16 }}>
                  <i style={{ width: `${arena.itemCount ? Math.round((arena.verdicts.length / arena.itemCount) * 100) : 0}%`, background: 'var(--p)' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 210px', gap: 18, alignItems: 'start' }}>
                  <div>
                    {arena.nextIndex < 0 ? (
                      <div style={{ fontSize: 13, color: 'var(--ok)', padding: '18px 0' }}>✓ {tt('dataset.arenaDone')}</div>
                    ) : (
                      <>
                        <div className="dsx-label" style={{ marginBottom: 8 }}>{tt('dataset.arenaItem')} {arena.nextIndex + 1} / {arena.itemCount}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {orderAnswers(answersFor(arena.nextIndex), arena.nextIndex, blind).map((r, idx) => {
                            const isWorst = curWorst === r.model
                            return (
                              <div key={r.model} style={{ border: `0.5px solid ${isWorst ? 'var(--bad)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', padding: '11px 13px', background: isWorst ? 'rgba(224,92,92,0.06)' : 'var(--bg-base)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                                    {blind ? `${tt('dataset.blindLabel')} ${idx + 1}` : modelLabel(r.model)}
                                  </span>
                                  {!blind && (
                                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                      {r.metrics.totalTime != null ? `${(r.metrics.totalTime / 1000).toFixed(1)}s` : ''}
                                      {r.metrics.outputTokens != null ? ` · ${r.metrics.outputTokens} tok` : ''}
                                    </span>
                                  )}
                                  <div style={{ flex: 1 }} />
                                  <button className="dsx-primary" style={{ padding: '4px 12px' }} onClick={() => void judge(r.model)}>✓ {tt('dataset.pickBest')}</button>
                                  <button onClick={() => setCurWorst(isWorst ? null : r.model)}
                                    style={{ border: `0.5px solid ${isWorst ? 'var(--bad)' : 'var(--border)'}`, background: 'transparent', color: isWorst ? 'var(--bad)' : 'var(--text-muted)', borderRadius: 'var(--radius-sm)', padding: '4px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>
                                    ✕ {tt('dataset.pickWorst')}
                                  </button>
                                </div>
                                <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--text-primary)', maxHeight: 200, overflow: 'auto', fontFamily: 'var(--font-mono)' }}>
                                  {r.text || (r.error ? `⚠ ${r.error}` : '—')}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <button className="dsx-ghost" onClick={() => void skipItem()}>{tt('dataset.skipItem')}</button>
                        </div>
                      </>
                    )}
                  </div>

                  <div>
                    <div className="dsx-label" style={{ marginBottom: 8 }}>{tt('dataset.standings')}</div>
                    {blind ? (
                      // Names + live Elo would defeat the blind — keep them hidden while judging.
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 8px', border: '0.5px dashed var(--border)', borderRadius: 'var(--radius-sm)' }}>{tt('dataset.blindStandings')}</div>
                    ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {arena.standings.map((s, i) => (
                        <div key={s.model} style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: i === 0 ? 'var(--p-bg)' : 'transparent' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', color: i === 0 ? 'var(--p)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {i === 0 ? '★ ' : ''}{modelLabel(s.model)}
                            </span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-bright)', fontWeight: 600 }}>{s.elo}</span>
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{s.wins} {tt('dataset.wins')} · {s.losses} {tt('dataset.losses')}</div>
                        </div>
                      ))}
                    </div>
                    )}
                    <button className="dsx-ghost" style={{ marginTop: 14, width: '100%' }} onClick={() => void exitArena()}>{tt('dataset.exitBench')}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
