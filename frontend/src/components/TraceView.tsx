import { useMemo, useRef, useState, useEffect } from 'react'
import { useT } from '../i18n'
import type { TraceStepRow } from '../../../src/types'

// One execution of one task as a trajectory — the trace-view primitive. Takes the
// steps and a `live` flag as props and fetches NOTHING itself, so the same
// component serves the wide result panel and a narrow comparison column.
//
// Design decisions this encodes (design-dist/agents.md):
//  · View A (indented list) is primary; a "time" toggle switches to a proportional
//    timeline. Same data, different unrolling.
//  · Expanding a step opens its payload in a PINNED side panel — it can never shift
//    the list, so clicking step 3 doesn't move step 30.
//  · Live: the list does NOT autoscroll; new steps append at the bottom and the only
//    thing that moves is a "+N below" pill. No share % / no axis while streaming —
//    the wall-clock denominator isn't known yet.
//  · Tokens column: hatched = not applicable (a think step has no tokens); "—" = not
//    reported (a model step that gave no usage). Never 0.
//  · Three reds on two axes: error = solid dot, retry = warning ring (recovered), and
//    a wrong-but-green answer is never red here (that lives in agent-vs-model).

interface TraceViewProps {
  steps: TraceStepRow[]
  live?: boolean
  layout?: 'wide' | 'narrow'
}

function ms(v: number | null): string {
  if (v == null) return '—'
  return v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(1)}s`
}

const HATCH = 'repeating-linear-gradient(135deg, var(--border) 0 1px, transparent 1px 5px)'

// The glyph, bar color, and name color for a step kind. Unknown kinds render as a
// generic node rather than breaking.
function kindMeta(kind: string, depth: number, isError: boolean) {
  const base = { flexShrink: 0 } as const
  let glyph: React.CSSProperties = { width: 7, height: 7, borderRadius: '50%', background: 'var(--text-muted)', ...base }
  if (kind === 'think' || kind === 'plan') glyph = { width: 7, height: 7, borderRadius: '50%', border: '1px solid var(--text-muted)', boxSizing: 'border-box', ...base }
  else if (kind === 'tool') glyph = { width: 7, height: 7, background: 'var(--text-secondary)', ...base }
  else if (kind === 'model') glyph = { width: 7, height: 7, background: 'var(--text-primary)', transform: 'rotate(45deg)', ...base }
  else if (kind === 'retry') glyph = { width: 7, height: 7, borderRadius: '50%', border: '1.5px solid var(--warning)', boxSizing: 'border-box', ...base }
  else if (kind === 'error') glyph = { width: 7, height: 7, borderRadius: '50%', background: 'var(--error)', ...base }
  else if (kind === 'answer') glyph = { width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', ...base }

  const barColor = (kind === 'error' || isError) ? 'var(--error)' : kind === 'retry' ? 'var(--warning)' : kind === 'model' ? 'var(--text-secondary)' : 'var(--border-hover)'
  const nameColor = (kind === 'error' || isError) ? 'var(--error)' : kind === 'retry' ? 'var(--warning)' : depth === 0 ? 'var(--text-primary)' : 'var(--text-secondary)'
  return { glyph, barColor, nameColor }
}

const MONO = 'var(--font-mono)'

export function TraceView({ steps, live = false, layout = 'wide' }: TraceViewProps) {
  const { t } = useT()
  const [mode, setMode] = useState<'list' | 'time'>('list')
  const [sel, setSel] = useState<number>(0)
  const listRef = useRef<HTMLDivElement>(null)
  // Steps the user has already scrolled past; the pill counts steps beyond it.
  const anchorRef = useRef<number>(steps.length)
  const [, force] = useState(0)

  const total = useMemo(() => steps.reduce((s, r) => s + (r.ms ?? 0), 0), [steps])
  // Timeline needs each step's start offset (cumulative self-time). Live hides it.
  const starts = useMemo(() => {
    let cur = 0
    return steps.map(s => { const at = cur; cur += s.ms ?? 0; return at })
  }, [steps])

  const showShare = !live && total > 0
  const selected = steps[Math.min(sel, steps.length - 1)]

  // Never autoscroll on new steps — that is the whole point of the live view. Only
  // update the "+N below" pill count.
  const newBelow = live ? Math.max(0, steps.length - anchorRef.current) : 0
  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom && anchorRef.current !== steps.length) { anchorRef.current = steps.length; force(n => n + 1) }
  }
  const jumpToBottom = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    anchorRef.current = steps.length
    force(n => n + 1)
  }
  // A brand-new, not-yet-scrolled live view starts anchored at the end so the pill
  // only appears for steps that arrive after the first paint.
  useEffect(() => { if (!live) anchorRef.current = steps.length }, [live, steps.length])

  if (steps.length === 0) {
    return <div style={{ padding: '14px 16px', fontFamily: MONO, fontSize: 12, color: 'var(--text-muted)' }}>{t('trace.empty')}</div>
  }

  const narrow = layout === 'narrow'
  const listHeight = narrow ? 300 : 460

  const row = (r: TraceStepRow, i: number) => {
    const meta = kindMeta(r.kind, r.depth, r.isError)
    const isSel = i === sel
    const share = total > 0 ? ((r.ms ?? 0) / total) * 100 : 0
    const hasTokens = r.kind === 'model'
    const tok = hasTokens ? (r.outputTokens ?? r.inputTokens ?? null) : undefined // undefined = N/A (hatched)
    const leftMark = r.kind === 'error' || r.isError ? 'var(--error)' : r.kind === 'retry' ? 'var(--warning)' : isSel ? 'var(--accent)' : 'transparent'
    return (
      <div
        key={r.id}
        data-testid="trace-row"
        onClick={() => setSel(i)}
        style={{
          display: 'grid',
          gridTemplateColumns: narrow ? '24px minmax(0,1fr) 46px' : '30px minmax(0,1fr) 54px 58px 84px',
          gap: 8, alignItems: 'center', padding: '5px 14px 5px 11px',
          borderBottom: '0.5px solid var(--border)', borderLeft: `3px solid ${leftMark}`,
          background: isSel ? 'var(--bg-elevated)' : 'transparent', cursor: 'pointer',
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{i + 1}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, paddingLeft: 14 * Math.min(r.depth, 3) }}>
          <span style={meta.glyph} />
          <span style={{ fontFamily: MONO, fontSize: narrow ? 11 : 12, color: meta.nameColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.name ?? r.kind}
          </span>
        </div>
        {!narrow && (
          hasTokens
            ? <span style={{ fontFamily: MONO, fontSize: 11, color: tok ? 'var(--text-secondary)' : 'var(--text-muted)', textAlign: 'right' }}>{tok ?? '—'}</span>
            : <span title={t('trace.na')} style={{ height: 8, borderRadius: 2, background: HATCH, justifySelf: 'stretch' }} />
        )}
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>{ms(r.ms)}</span>
        {!narrow && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            {showShare
              ? <>
                  <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(2, share)}%`, background: meta.barColor }} />
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 10, width: 28, textAlign: 'right', color: share > 20 ? 'var(--text-bright)' : 'var(--text-muted)' }}>
                    {share < 1 ? '<1%' : `${Math.round(share)}%`}
                  </span>
                </>
              : <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted)' }}>{t('trace.streaming')}</span>}
          </div>
        )}
      </div>
    )
  }

  const timelineRow = (r: TraceStepRow, i: number) => {
    const meta = kindMeta(r.kind, r.depth, r.isError)
    const left = total > 0 ? (starts[i] / total) * 100 : 0
    const width = total > 0 ? Math.max(0.5, ((r.ms ?? 0) / total) * 100) : 1
    return (
      <div key={r.id} data-testid="trace-row" onClick={() => setSel(i)}
        style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: 12, alignItems: 'center', padding: '4px 14px', borderBottom: '0.5px solid var(--border)', background: i === sel ? 'var(--bg-elevated)' : 'transparent', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, paddingLeft: 14 * Math.min(r.depth, 3) }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted)', width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
          <span style={meta.glyph} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: meta.nameColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name ?? r.kind}</span>
        </div>
        <div style={{ position: 'relative', height: 14, borderLeft: '0.5px solid var(--border)' }}>
          <div style={{ position: 'absolute', top: 2, bottom: 2, left: `${left}%`, width: `${width}%`, minWidth: 2, background: meta.barColor, borderRadius: 1 }} />
        </div>
      </div>
    )
  }

  const payload = (() => {
    if (!selected) return null
    let pretty = selected.payload
    if (pretty) { try { pretty = JSON.stringify(JSON.parse(pretty), null, 2) } catch { /* keep raw */ } }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', ...(narrow ? { borderTop: '0.5px solid var(--border)' } : {}) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{t('trace.payload')}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-muted)' }}>{selected.kind}</span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, color: 'var(--text-bright)', wordBreak: 'break-word' }}>{selected.name ?? selected.kind}</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <PayloadStat label={t('trace.duration')} value={ms(selected.ms)} />
          <PayloadStat label={t('trace.tokensLabel')} value={selected.kind === 'model' ? (selected.outputTokens != null ? String(selected.outputTokens) : '—') : t('trace.na')} />
          <PayloadStat label="$" value={selected.cost != null ? selected.cost.toFixed(4) : '—'} />
        </div>
        {pretty && (
          <div style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)', background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '9px 11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: narrow ? 120 : 280, overflowY: 'auto' }}>{pretty}</div>
        )}
        {selected.payloadTruncated && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('trace.truncated')}</div>}
      </div>
    )
  })()

  return (
    <div style={{ border: '0.5px solid var(--border)', borderRadius: 10, background: 'var(--bg-base)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {!narrow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '0.5px solid var(--border)', background: 'var(--bg-sidebar)' }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)' }}>{t('trace.stepsN', { n: steps.length })}</span>
          {!live && total > 0 && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)' }}>· {ms(total)}</span>}
          <div style={{ flex: 1 }} />
          {!live && (
            <div style={{ display: 'inline-flex', background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 7, padding: 3, gap: 2 }}>
              <SegBtn on={mode === 'list'} onClick={() => setMode('list')}>{t('trace.viewList')}</SegBtn>
              <SegBtn on={mode === 'time'} onClick={() => setMode('time')}>{t('trace.viewTime')}</SegBtn>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', borderRight: narrow ? undefined : '0.5px solid var(--border)' }}>
          <div ref={listRef} onScroll={onScroll} style={{ height: listHeight, overflowY: 'auto' }}>
            {(mode === 'time' && !narrow && !live ? steps.map(timelineRow) : steps.map(row))}
          </div>
          {newBelow > 0 && (
            <button onClick={jumpToBottom} style={{ position: 'absolute', right: 14, bottom: 12, padding: '4px 10px', borderRadius: 20, border: '0.5px solid var(--accent-dim)', background: 'var(--accent-bg)', color: 'var(--accent)', fontFamily: MONO, fontSize: 11, cursor: 'pointer' }}>
              {t('trace.newBelow', { n: newBelow })}
            </button>
          )}
        </div>
        {!narrow && <div style={{ width: 300, flexShrink: 0, background: 'var(--bg-elevated)', overflowY: 'auto', maxHeight: listHeight + 40 }}>{payload}</div>}
      </div>
      {narrow && <div style={{ background: 'var(--bg-elevated)' }}>{payload}</div>}
    </div>
  )
}

function PayloadStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

function SegBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 5, cursor: 'pointer', fontFamily: MONO, fontSize: 11, letterSpacing: '0.04em',
      border: on ? '0.5px solid var(--border-hover)' : '0.5px solid transparent',
      background: on ? 'var(--bg-elevated)' : 'transparent', color: on ? 'var(--text-bright)' : 'var(--text-muted)',
    }}>{children}</button>
  )
}
