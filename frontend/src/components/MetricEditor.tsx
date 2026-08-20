import { useEffect, useMemo, useState } from 'react'
import type { MetricDef, MetricFormat, MetricDirection, MetricScope, MetricAggregate } from '../../../src/types'
import { metricsApi, type MetricPreviewResult } from '../api'
import { validate } from '../../../src/metrics/expr'
import { BUILTIN_KEYS } from '../../../src/metrics/builtins'
import { Button, IconButton, Input, Segmented } from './ui'
import { IconClose } from './icons'
import { useT, t as tt } from '../i18n'

const FORMATS: MetricFormat[] = ['raw', 'ms', 's', 'tokens', 'usd', 'pct']
const AGGS: MetricAggregate[] = ['mean', 'median', 'p50', 'p95', 'min', 'max', 'sum']
const FUNCS = ['mean(', 'median(', 'p95(', 'min(', 'max(', 'sum(', 'abs(', 'round(', 'clamp(']

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

const selectStyle: React.CSSProperties = {
  padding: '7px 9px', background: 'var(--bg-base)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)',
}
const label = (s: string) => (
  <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{s}</span>
)

export function MetricEditor({ metric, registry, onClose, onSaved }: {
  metric: MetricDef | null
  registry: MetricDef[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useT()
  // "Editing" only when the metric already exists in the registry — a duplicate
  // arrives as a synthetic def with a fresh key and must save as a create.
  const editing = metric != null && registry.some(m => m.key === metric.key)
  const [name, setName] = useState(metric?.name ?? '')
  const [key, setKey] = useState(metric?.key ?? '')
  const [keyEdited, setKeyEdited] = useState(editing)
  const [expression, setExpression] = useState(metric?.expression ?? '')
  const [unit, setUnit] = useState(metric?.unit ?? '')
  const [format, setFormat] = useState<MetricFormat>(metric?.format ?? 'raw')
  const [direction, setDirection] = useState<MetricDirection>(metric?.direction ?? 'neutral')
  const [scope, setScope] = useState<MetricScope>(metric?.scope ?? 'answer')
  const [aggregate, setAggregate] = useState<MetricAggregate>(metric?.aggregate ?? 'mean')
  const [preview, setPreview] = useState<MetricPreviewResult | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => { if (!keyEdited) setKey(slug(name)) }, [name, keyEdited])

  const allKnown = useMemo(
    () => [...new Set([...BUILTIN_KEYS, ...registry.map(m => m.key)])].filter(k => k !== key),
    [registry, key],
  )
  const check = useMemo(() => validate(expression, [...allKnown, key], scope), [expression, allKnown, key, scope])

  useEffect(() => {
    if (!expression.trim() || !check.ok) { setPreview(null); return }
    const id = setTimeout(() => {
      metricsApi.preview(expression, scope, scope === 'run' ? aggregate : undefined).then(setPreview).catch(() => setPreview(null))
    }, 250)
    return () => clearTimeout(id)
  }, [expression, scope, aggregate, check.ok])

  const insert = (tok: string) => setExpression(e => (e.trim() ? e.trimEnd() + ' ' : '') + tok)
  const canSave = !!name.trim() && !!key && !!expression.trim() && check.ok

  async function save() {
    try {
      const body = {
        key, name: name.trim(), expression: expression.trim(), unit: unit.trim() || null,
        format, direction, scope, aggregate: scope === 'run' ? aggregate : null,
      }
      if (editing) await metricsApi.update(metric!.key, body)
      else await metricsApi.create(body)
      onSaved()
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'save failed') }
  }

  const builtinKeys = registry.filter(m => m.kind === 'builtin').map(m => m.key)
  const customKeys = registry.filter(m => m.kind === 'custom' && m.key !== key).map(m => m.key)

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, zIndex: 300, padding: 24, background: 'var(--overlay, rgba(0,0,0,0.5))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 880, maxWidth: '94vw', maxHeight: '90vh', background: 'var(--bg-elevated)',
        border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-bright)' }}>{editing ? t('metrics.editorEdit') : t('metrics.editorNew')}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('metrics.editorSub')}</div>
          </div>
          <IconButton onClick={onClose} title={t('common.close')}><IconClose size={14} /></IconButton>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {label(t('metrics.fName'))}
                <Input value={name} placeholder="Tokens per second" onChange={e => setName(e.target.value)} />
              </label>
              <label style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{label(t('metrics.fKey'))}
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{keyEdited ? t('metrics.edited') : t('metrics.auto')}</span>
                </span>
                <Input value={key} placeholder="tokens_per_sec" disabled={editing}
                  onChange={e => { setKey(e.target.value); setKeyEdited(true) }} />
              </label>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {label(t('metrics.fExpression'))}
              <input value={expression} onChange={e => setExpression(e.target.value)} placeholder="output_tokens / total_time * 1000"
                spellCheck={false} style={{
                  ...selectStyle, fontSize: 'var(--fs-lg)', padding: '10px 12px',
                  borderColor: expression.trim() && !check.ok ? 'var(--error)' : 'var(--border)',
                }} />
              <div style={{ minHeight: 18, display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)' }}>
                {expression.trim() && !check.ok ? (
                  <>
                    <span style={{ color: 'var(--error)' }}>{check.error?.message}</span>
                    {check.error?.suggestion && (
                      <button onClick={() => setExpression(expression.replace(/[a-z_][a-z0-9_]*$/i, check.error!.suggestion!))}
                        style={{ border: '0.5px solid var(--border-hover)', background: 'var(--bg-base)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', padding: '1px 8px', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', cursor: 'pointer' }}>
                        {tt('metrics.useKey', { key: check.error.suggestion })}
                      </button>
                    )}
                  </>
                ) : expression.trim() ? <span style={{ color: 'var(--success)' }}>{t('metrics.ready')}</span> : null}
              </div>
            </label>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: 130, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {label(t('metrics.fUnit'))}
                <Input value={unit} placeholder="tok/s" onChange={e => setUnit(e.target.value)} />
              </label>
              <label style={{ flex: 1, minWidth: 130, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {label(t('metrics.fFormat'))}
                <select value={format} onChange={e => setFormat(e.target.value as MetricFormat)} style={selectStyle}>
                  {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {label(t('metrics.fDirection'))}
              <Segmented value={direction} onChange={setDirection}
                options={[{ value: 'lower' as const, label: '↓ lower' }, { value: 'higher' as const, label: '↑ higher' }, { value: 'neutral' as const, label: '· neutral' }]} />
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {direction === 'lower' ? t('metrics.dirLowerHint') : direction === 'higher' ? t('metrics.dirHigherHint') : t('metrics.dirNeutralHint')}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {label(t('metrics.fScope'))}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Segmented value={scope} onChange={setScope}
                  options={[{ value: 'answer' as const, label: t('metrics.perAnswer') }, { value: 'run' as const, label: t('metrics.perRun') }]} />
                {scope === 'run' && (
                  <select value={aggregate} onChange={e => setAggregate(e.target.value as MetricAggregate)} style={selectStyle}>
                    {AGGS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                {label(t('metrics.preview'))}
                {preview && <span style={{ fontSize: 'var(--fs-xs)', color: preview.coverage.have < preview.coverage.total ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {tt('metrics.coverage', { have: preview.coverage.have, total: preview.coverage.total })}
                </span>}
              </div>
              <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px 1fr', gap: 8, padding: '6px 10px', borderBottom: '0.5px solid var(--border)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  <span>{t('metrics.pResult')}</span><span>{t('metrics.pInputs')}</span><span style={{ textAlign: 'right' }}>{t('metrics.pValue')}</span><span>{t('metrics.pNote')}</span>
                </div>
                {!check.ok && expression.trim() ? (
                  <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{t('metrics.noPreview')}</div>
                ) : (preview?.rows ?? []).map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px 1fr', gap: 8, padding: '7px 10px', borderTop: i ? '0.5px solid var(--border)' : 'none', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.item}</span>
                    <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.inputs}</span>
                    <span style={{ textAlign: 'right', color: r.value == null ? 'var(--text-muted)' : 'var(--text-primary)' }}>{r.value == null ? '—' : formatValue(r.value, format)}</span>
                    <span style={{ fontSize: 'var(--fs-xs)', color: r.note === 'ok' ? 'var(--text-muted)' : 'var(--warning)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ width: 240, minWidth: 240, borderLeft: '0.5px solid var(--border)', background: 'var(--bg-sidebar)', overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {label(t('metrics.availableInputs'))}
            <Picker title={t('metrics.builtin')} keys={builtinKeys} inExpr={check.refs} onInsert={insert} />
            {customKeys.length > 0 && <Picker title={t('metrics.custom')} keys={customKeys} inExpr={check.refs} onInsert={insert} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {label(t('metrics.functions'))}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {FUNCS.map(f => (
                  <button key={f} onClick={() => insert(f)} style={{ border: '0.5px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', borderRadius: 16, padding: '2px 8px', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', cursor: 'pointer' }}>{f}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderTop: '0.5px solid var(--border)' }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: saveError ? 'var(--error)' : canSave ? 'var(--text-muted)' : 'var(--warning)' }}>
            {saveError ?? (canSave ? '' : t('metrics.cannotSave'))}
          </span>
          <Button small onClick={onClose}>{tt('common.cancel')}</Button>
          <Button small variant="primary" disabled={!canSave} onClick={() => void save()}>{t('metrics.saveMetric')}</Button>
        </div>
      </div>
    </div>
  )
}

function Picker({ title, keys, inExpr, onInsert }: { title: string; keys: string[]; inExpr: string[]; onInsert: (k: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', color: 'var(--text-muted)', padding: '2px 0' }}>{title}</span>
      {keys.map(k => (
        <button key={k} onClick={() => onInsert(k)} style={{ textAlign: 'left', background: 'none', border: '0.5px solid transparent', borderRadius: 'var(--radius-sm)', padding: '4px 6px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: inExpr.includes(k) ? 'var(--accent)' : 'var(--text-primary)' }}>{k}</button>
      ))}
    </div>
  )
}

function formatValue(v: number, format: MetricFormat): string {
  switch (format) {
    case 'ms': return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`
    case 's': return `${v.toFixed(2)}s`
    case 'pct': return `${v <= 1 ? Math.round(v * 100) : Math.round(v)}%`
    case 'usd': return `$${v.toFixed(4)}`
    case 'tokens': return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))
    default: return Number.isInteger(v) ? String(v) : v.toFixed(2)
  }
}
