import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { datasetsApi } from '../api'
import type { Dataset } from '../../../src/types'
import { useT } from '../i18n'
import { IconDatabase } from './icons'

const CSS = `
  .drp { --p: #7F77DD; --p-bg: rgba(127,119,221,0.12); --p-bd: rgba(127,119,221,0.45); --ok: #5ab87a; }
  .drp-grid { display: grid; grid-template-columns: 1fr 300px; border: 0.5px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); overflow: hidden; }
  .drp-form { min-width: 0; padding: 20px 22px; display: flex; flex-direction: column; gap: 16px; }
  .drp-insp { border-left: 0.5px solid var(--border); background: var(--bg-base); padding: 20px 18px; display: flex; flex-direction: column; gap: 14px; }
  @media (max-width: 720px) { .drp-grid { grid-template-columns: 1fr; } .drp-insp { border-left: none; border-top: 0.5px solid var(--border); } }
  .drp-label { display: flex; align-items: center; gap: 10px; font: 600 10px var(--font-sans); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .drp-label > i { flex: 1; height: 1px; background: var(--border); }
  .drp-in { width: 100%; box-sizing: border-box; padding: 10px 12px; background: var(--bg-base); border: 0.5px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font: 12px/1.6 var(--font-mono); outline: none; resize: vertical; }
  .drp-in:focus { border-color: var(--p-bd); }
  .drp-row { display: flex; align-items: center; gap: 8px; text-align: left; width: 100%; background: var(--bg-base); border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; cursor: pointer; }
  .drp-row:hover { border-color: var(--p-bd); }
  .drp-card { border: 1px solid var(--p-bd); background: var(--p-bg); border-radius: var(--radius-sm); padding: 12px 14px; display: flex; align-items: center; gap: 12px; }
  .drp-opt { text-align: left; border: 0.5px solid var(--border); background: var(--bg-base); border-radius: var(--radius-sm); padding: 11px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
  .drp-opt.on { border-color: var(--p-bd); background: var(--p-bg); }
  .drp-opt:disabled { opacity: 0.45; cursor: default; }
  .drp-chip { border-radius: 20px; padding: 5px 12px; font: 12px var(--font-mono); border: 0.5px solid var(--border); background: var(--bg-base); color: var(--text-muted); cursor: pointer; }
  .drp-chip.on { border-color: var(--p-bd); background: var(--p-bg); color: var(--p); }
  .drp-num { width: 70px; box-sizing: border-box; padding: 5px 10px; background: var(--bg-base); border: 0.5px solid var(--p-bd); border-radius: 20px; color: var(--text-primary); font: 12px var(--font-mono); outline: none; }
  .drp-primary { text-align: center; background: var(--p); color: #fff; border: none; border-radius: 7px; padding: 10px 18px; font: 600 13px var(--font-mono); cursor: pointer; }
  .drp-primary:disabled { opacity: 0.45; cursor: default; }
  .drp-link { background: none; border: none; color: var(--p); font: 12px var(--font-mono); cursor: pointer; padding: 0; }
`

function iconWrap(node: React.ReactNode): React.ReactElement {
  return <span style={{ color: 'var(--p)', display: 'flex', flexShrink: 0 }}>{node}</span>
}

// The dataset run configured from inside Test — the 4th run mode. Picks a dataset
// (built + labeled over in Datasets), a base prompt (the schema keys are appended
// server-side), and a scoring mode, then hands off to the existing dataset run +
// results view. Models come from the Test header's own picker.
export function DatasetRunPanel({ selectedModels }: { selectedModels: string[] }) {
  const { t } = useT()
  const nav = useNavigate()
  const [datasets, setDatasets] = useState<Dataset[] | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [scoreMode, setScoreMode] = useState<'score' | 'arena'>('score')
  const [sampleMode, setSampleMode] = useState<'all' | 'random' | 'first'>('all')
  const [sampleN, setSampleN] = useState(20)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { datasetsApi.list().then(setDatasets).catch(() => setDatasets([])) }, [])
  useEffect(() => { setPrompt(p => p || t('datasetRun.promptDefault')) }, [t])

  const sel = useMemo(() => datasets?.find(d => d.id === selId) ?? null, [datasets, selId])
  const models = selectedModels.length
  const items = sel?.itemCount ?? 0
  const effItems = sampleMode === 'all' ? items : Math.min(Math.max(1, sampleN || 1), items)
  const labeled = sel?.labeledCount ?? 0
  const calls = effItems * models
  const isCode = sel?.type === 'code'
  const labeledFull = items > 0 && labeled >= items
  const effMode: 'score' | 'arena' = isCode ? 'score' : scoreMode
  const canLaunch = !!sel && models > 0 && items > 0 && (isCode || prompt.trim().length > 0) && !launching

  // A trial run always covers just the first item — a cheap dry run to eyeball the
  // prompt before spending the whole dataset; the results view then offers "run
  // all N". Otherwise the subsample selection decides coverage.
  async function launch(trial = false) {
    if (!sel || !canLaunch) return
    setLaunching(true); setError(null)
    try {
      const sample = trial
        ? { strategy: 'first' as const, n: 1 }
        : (sampleMode === 'all' ? undefined : { strategy: sampleMode, n: effItems })
      await datasetsApi.run(sel.id, { models: selectedModels, prompt: prompt.trim(), mode: effMode, ...(sample ? { sample } : {}) })
      nav(`/datasets/${sel.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLaunching(false)
    }
  }

  return (
    <div className="drp" style={{ width: '100%', maxWidth: 1000, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{CSS}</style>

      {datasets && datasets.length === 0 ? (
        <div style={{ border: '0.5px dashed var(--border)', borderRadius: 'var(--radius-md)', padding: 32, textAlign: 'center', background: 'var(--bg-elevated)' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>{t('datasetRun.noDatasets')}</div>
          <button className="drp-link" onClick={() => nav('/datasets')}>{t('datasetRun.goToDatasets')} ↗</button>
        </div>
      ) : (
        <div className="drp-grid">
          <div className="drp-form">
            {/* ── Dataset ── */}
            {!sel ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="drp-label">{t('datasetRun.dataset')}<i /></div>
                {datasets == null ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
                ) : datasets.map(d => (
                  <button key={d.id} className="drp-row" onClick={() => setSelId(d.id)}>
                    {iconWrap(<IconDatabase size={15} />)}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t('datasetRun.itemsN', { n: d.itemCount ?? 0 })} · {t('datasetRun.varsN', { n: d.schema.length })}
                      </span>
                    </span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: (d.itemCount && d.labeledCount === d.itemCount) ? 'var(--ok)' : 'var(--text-muted)' }}>
                      {d.labeledCount ?? 0}/{d.itemCount ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="drp-card">
                <div style={{ width: 34, height: 34, borderRadius: 7, background: 'var(--p-bg)', border: '0.5px solid var(--p-bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {iconWrap(<IconDatabase size={16} />)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('datasetRun.itemsN', { n: items })} · {t('datasetRun.varsN', { n: sel.schema.length })} ·{' '}
                    <span style={{ color: labeledFull ? 'var(--ok)' : 'var(--text-muted)' }}>{t('datasetRun.labeledN', { a: labeled, b: items })}</span>
                    {sel.trustedModel && <> · {t('datasetRun.trusted', { m: sel.trustedModel.split(':').slice(1).join(':') || sel.trustedModel })}</>}
                  </div>
                </div>
                <button className="drp-link" style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '6px 12px' }} onClick={() => setSelId(null)}>{t('datasetRun.change')}</button>
                <button className="drp-link" onClick={() => nav(`/datasets/${sel.id}`)}>{t('datasetRun.labeling')} ↗</button>
              </div>
            )}

            {sel && items > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="drp-label">{t('datasetRun.subsample')}<i /></div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className={`drp-chip${sampleMode === 'all' ? ' on' : ''}`} onClick={() => setSampleMode('all')}>{t('datasetRun.sampleAll', { n: items })}</button>
                  <button className={`drp-chip${sampleMode === 'random' ? ' on' : ''}`} onClick={() => setSampleMode('random')}>{t('datasetRun.sampleRandom')}</button>
                  <button className={`drp-chip${sampleMode === 'first' ? ' on' : ''}`} onClick={() => setSampleMode('first')}>{t('datasetRun.sampleFirst')}</button>
                  {sampleMode !== 'all' && (
                    <input className="drp-num" type="number" min={1} max={items} value={sampleN}
                      onChange={e => setSampleN(Math.max(1, Math.min(items, Number(e.target.value) || 1)))} />
                  )}
                </div>
              </div>
            )}

            {sel && !isCode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="drp-label">{t('datasetRun.prompt')}<i /></div>
                <textarea className="drp-in" rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={t('datasetRun.promptDefault')} />
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{t('datasetRun.promptHint')}</div>
              </div>
            )}

            {sel && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="drp-label">{t('datasetRun.scoring')}<i /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button className={`drp-opt${effMode === 'score' ? ' on' : ''}`} onClick={() => setScoreMode('score')}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: effMode === 'score' ? 'var(--p)' : 'var(--text-secondary)' }}>{t('datasetRun.scoreAuto')}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('datasetRun.scoreAutoDesc')}</span>
                  </button>
                  <button className={`drp-opt${effMode === 'arena' ? ' on' : ''}`} disabled={isCode} onClick={() => setScoreMode('arena')}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: effMode === 'arena' ? 'var(--p)' : 'var(--text-secondary)' }}>{t('datasetRun.scoreArena')}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{isCode ? t('datasetRun.arenaNoCode') : t('datasetRun.scoreArenaDesc')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Inspector ── */}
          <div className="drp-insp">
            <div className="drp-label" style={{ marginBottom: 2 }}>{t('datasetRun.run')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--text-bright)' }}>{effItems}</span><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('datasetRun.items')}</span>
              {effItems < items && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('datasetRun.sampleOf', { n: items })}</span>}
              <span style={{ color: 'var(--text-muted)' }}>×</span>
              <span style={{ color: 'var(--text-bright)' }}>{models}</span><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('datasetRun.modelsWord')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 12, borderBottom: '0.5px solid var(--border)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 600, color: 'var(--accent)' }}>{calls}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('datasetRun.calls')}</span>
            </div>

            {sel && effMode === 'score' && (
              labeledFull ? (
                <div style={{ background: 'var(--success-bg)', border: '0.5px solid var(--success-dim)', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: 'var(--success)', lineHeight: 1.5 }}>{t('datasetRun.labeledFull')}</div>
              ) : (
                <div style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('datasetRun.labeledPartial', { a: labeled, b: items })}</div>
              )
            )}

            <div style={{ flex: 1 }} />

            {error && <div style={{ fontSize: 11, color: 'var(--error)', lineHeight: 1.5 }}>{error}</div>}
            {models === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('datasetRun.needModels')}</div>}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="drp-primary" disabled={!canLaunch} onClick={() => void launch()} style={{ flex: 1 }}>
                {launching ? t('datasetRun.launching') : t('datasetRun.launch')}
              </button>
              {items > 1 && (
                <button className="drp-chip" disabled={!canLaunch} onClick={() => void launch(true)}
                  title={t('datasetRun.trialHint')} style={{ flexShrink: 0, opacity: canLaunch ? 1 : 0.5, cursor: canLaunch ? 'pointer' : 'default' }}>
                  {t('datasetRun.trial')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
