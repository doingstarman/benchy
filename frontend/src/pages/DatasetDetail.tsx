import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useT, t } from '../i18n'
import { datasetsApi, providersApi, runsApi, uploadsApi, useSSE } from '../api'
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

  // run state
  const [prompt, setPrompt] = useState('')
  const [selModels, setSelModels] = useState<Set<string>>(new Set())
  const [runId, setRunId] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Result[] | null>(null)
  const [starting, setStarting] = useState(false)

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
    }
  }

  const models = useMemo(() => availableModels(providers), [providers])
  const trusted = dataset?.trustedModel ?? null
  const comparableModels = models.filter(m => m !== trusted)
  const labeledCount = useMemo(() => items.filter(i => isItemLabeled(i, dataset?.schema ?? [])).length, [items, dataset])

  useSSE(runId, e => {
    if (e.event === 'run_done') void runsApi.get(e.runId).then(r => setRunResults(r.results))
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
  function editCell(itemId: string, key: string, value: string) {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, groundTruth: { ...i.groundTruth, [key]: value } } : i))
  }
  async function commitCell(item: DatasetItem) {
    await datasetsApi.updateItem(id, item.id, { groundTruth: item.groundTruth })
  }

  // ── run ──
  async function startRun() {
    const chosen = [...selModels].filter(m => m !== trusted)
    if (!chosen.length || !prompt.trim()) return
    setStarting(true)
    setRunResults(null)
    try {
      const { runId: newRun } = await datasetsApi.run(id, { models: chosen, prompt: prompt.trim() })
      setRunId(newRun)
    } finally { setStarting(false) }
  }

  if (!dataset) return <div className="dsx" style={{ padding: '28px 32px', fontSize: 12, color: 'var(--text-muted)' }}><style>{CSS}</style>{t('common.loading')}</div>

  const matrix = runResults ? buildMatrix(runResults, dataset.schema) : []
  const running = runId != null && runResults == null

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

        {/* ── Markup tab ── */}
        {tab === 'markup' && (
          <div className="dsx-sec">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div className="dsx-h">{tt('dataset.markup')}</div>
                <div className="dsx-sub">{tt('dataset.markupSub')}</div>
              </div>
              <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" style={{ display: 'none' }} onChange={e => void onFiles(e.target.files)} />
              <button className="dsx-ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? tt('dataset.uploading') : `＋ ${tt('dataset.chooseFiles')}`}
              </button>
            </div>

            {dataset.schema.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '18px 0' }}>{tt('dataset.noSchema')}</div>
            ) : items.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '18px 0' }}>{tt('dataset.noItems')}</div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table className="dsx-table">
                  <thead><tr>
                    <th style={{ width: 34 }} />
                    <th style={{ width: 40 }} />
                    <th>{tt('dataset.file')}</th>
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
                          {dataset.schema.map(v => (
                            <td key={v.key}>
                              <input className="dsx-in" style={{ width: '100%', minWidth: 92 }} placeholder={tt('dataset.typeHere')}
                                value={it.groundTruth[v.key] ?? ''}
                                onChange={e => editCell(it.id, v.key, e.target.value)}
                                onBlur={() => void commitCell(items.find(x => x.id === it.id) ?? it)}
                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                            </td>
                          ))}
                          <td><button className="dsx-x" onClick={() => void removeItem(it.id)}>×</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: 'var(--text-muted)', alignItems: 'center' }}>
                  <span className="dsx-label">{tt('dataset.legend')}</span>
                  <span style={{ color: 'var(--ok)' }}>✓ {tt('dataset.legendHuman')}</span>
                  <span>— {tt('dataset.legendEmpty')}</span>
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

            {matrix.length > 0 && (
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
          </div>
        )}
      </div>
    </div>
  )
}
