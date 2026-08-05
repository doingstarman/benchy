import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../i18n'
import { datasetsApi } from '../api'
import type { Dataset } from '../../../src/types'

const CSS = `
  .dsx { --p: #7F77DD; --p-strong: #6a61d0; --p-bg: rgba(127,119,221,0.12); --p-bd: rgba(127,119,221,0.45); --ok: #5ab87a; }
  .dsx-card { position: relative; text-align: left; background: var(--bg-elevated); border: 0.5px solid var(--border); border-radius: var(--radius-md); padding: 15px 16px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 10px; overflow: hidden; transition: border-color 0.12s, transform 0.12s; }
  .dsx-card:hover { border-color: var(--p-bd); transform: translateY(-1px); }
  .dsx-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--p); opacity: 0.55; }
  .dsx-badge { font-size: 9px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--p); background: var(--p-bg); border: 0.5px solid var(--p-bd); border-radius: 4px; padding: 2px 6px; white-space: nowrap; }
  .dsx-bar { height: 4px; border-radius: 3px; background: var(--bg-base); overflow: hidden; }
  .dsx-bar > i { display: block; height: 100%; background: var(--ok); border-radius: 3px; }
  .dsx-in { width: 100%; box-sizing: border-box; padding: 8px 11px; background: var(--bg-base); border: 0.5px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 13px; font-family: var(--font-mono); outline: none; }
  .dsx-in:focus { border-color: var(--p-bd); }
  .dsx-primary { background: var(--p); color: #fff; border: none; border-radius: var(--radius-sm); padding: 8px 16px; font-size: 12px; cursor: pointer; font-weight: 600; white-space: nowrap; font-family: var(--font-mono); }
  .dsx-primary:disabled { opacity: 0.5; cursor: default; }
`

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

function schemaSummary(ds: Dataset): string {
  if (ds.schema.length === 0) return '—'
  const keys = ds.schema.map(v => v.key).join(', ')
  return `${ds.schema.length}: ${keys}`
}

export function Datasets() {
  const { t } = useT()
  const nav = useNavigate()
  const [items, setItems] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [newType, setNewType] = useState<'files' | 'text' | 'tools' | 'code'>('files')
  const [newLang, setNewLang] = useState<'python' | 'javascript'>('python')
  const [saving, setSaving] = useState(false)

  useEffect(() => { void reload() }, [])
  async function reload() {
    setLoading(true)
    try { setItems(await datasetsApi.list()) } finally { setLoading(false) }
  }

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const ds = await datasetsApi.create({ name: trimmed, type: newType, ...(newType === 'code' ? { language: newLang } : {}) })
      nav(`/datasets/${ds.id}`)
    } finally { setSaving(false) }
  }

  return (
    <div className="dsx" style={{ flex: 1, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: '28px 32px' }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 940 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 600, color: 'var(--text-bright)', margin: '0 0 3px' }}>{t('dataset.title')}</h1>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>{t('dataset.sub')}</p>
          </div>
          <div style={{ flex: 1 }} />
          {!creating && (
            <button className="dsx-primary" onClick={() => { setName(''); setCreating(true) }}>{t('dataset.new')}</button>
          )}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderLeft: '2px solid var(--p)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', marginBottom: 20 }}>
          {t('dataset.hint')}
        </div>

        {creating && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, maxWidth: 620, alignItems: 'center' }}>
            <input className="dsx-in" autoFocus value={name} placeholder={t('dataset.cName')}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setCreating(false) }} />
            <div style={{ display: 'flex', gap: 3, border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2, flex: 'none' }}>
              {(['files', 'text', 'tools', 'code'] as const).map(ty => (
                <button key={ty} onClick={() => setNewType(ty)}
                  style={{ border: 'none', borderRadius: 4, padding: '5px 11px', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer', background: newType === ty ? 'var(--p-bg)' : 'transparent', color: newType === ty ? 'var(--p)' : 'var(--text-muted)' }}>
                  {ty === 'files' ? t('dataset.typeFiles') : ty === 'text' ? t('dataset.typeText') : ty === 'tools' ? t('dataset.typeTools') : t('dataset.typeCode')}
                </button>
              ))}
            </div>
            {newType === 'code' && (
              <div style={{ display: 'flex', gap: 3, border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2, flex: 'none' }}>
                {(['python', 'javascript'] as const).map(lg => (
                  <button key={lg} onClick={() => setNewLang(lg)}
                    style={{ border: 'none', borderRadius: 4, padding: '5px 11px', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer', background: newLang === lg ? 'var(--p-bg)' : 'transparent', color: newLang === lg ? 'var(--p)' : 'var(--text-muted)' }}>
                    {lg === 'python' ? 'Python' : 'JavaScript'}
                  </button>
                ))}
              </div>
            )}
            <button className="dsx-primary" onClick={() => void create()} disabled={saving || !name.trim()}>{t('dataset.create')}</button>
            <button onClick={() => setCreating(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>{t('common.cancel')}</button>
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <div style={{ border: '0.5px dashed var(--border)', borderRadius: 'var(--radius-md)', padding: 40, textAlign: 'center', background: 'var(--bg-elevated)' }}>
            <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.5 }}>🗂</div>
            <div style={{ fontSize: 15, color: 'var(--text-bright)', marginBottom: 6 }}>{t('dataset.emptyTitle')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 440, margin: '0 auto', lineHeight: 1.5 }}>{t('dataset.emptyBody')}</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {items.map(ds => {
              const total = ds.itemCount ?? 0
              const labeled = ds.labeledCount ?? 0
              const p = total > 0 ? Math.round((labeled / total) * 100) : 0
              return (
                <button key={ds.id} className="dsx-card" onClick={() => nav(`/datasets/${ds.id}`)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ds.name}</span>
                    <div style={{ flex: 1 }} />
                    <span className="dsx-badge">{total} {t('dataset.cItems').toLowerCase()}</span>
                  </div>
                  {ds.note && <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ds.note}</div>}
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{schemaSummary(ds)}</div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                      <span>{t('dataset.cLabeled')}</span>
                      <span style={{ color: p === 100 ? 'var(--ok)' : 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{labeled}/{total} · {p}%</span>
                    </div>
                    <div className="dsx-bar"><i style={{ width: `${p}%` }} /></div>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('dataset.cUpdated')}: {fmtDate(ds.updatedAt)}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
