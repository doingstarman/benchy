import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { runsApi } from '../api'
import { RUNS_CHANGED_EVENT } from './NewRun'
import { Button, Input } from '../components/ui'
import { IconPencil } from '../components/icons'
import { useT } from '../i18n'
import type { Run } from '../../../src/types'

export function History() {
  const { t } = useT()
  const navigate = useNavigate()
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    runsApi.list({ search: search || undefined, date: dateFilter || undefined, status: statusFilter || undefined })
      .then(setRuns)
      .finally(() => setLoading(false))
  }, [search, dateFilter, statusFilter])

  useEffect(() => { load() }, [load])

  // Fork = "set this test up again, ready to edit and re-run". It loads the run
  // into the composer; the new run is created when the user actually hits Run.
  // It used to POST /fork first, which left a 'pending' run nobody ever ran —
  // and then navigated with state that no page read, so the button did nothing.
  function handleFork(e: React.MouseEvent, run: Run) {
    e.stopPropagation()
    navigate('/run', { state: { forkFrom: run } })
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm(t('history.confirmDelete'))) return
    await runsApi.remove(id)
    window.dispatchEvent(new Event(RUNS_CHANGED_EVENT))
    load()
  }

  function startRename(e: React.MouseEvent, run: Run) {
    e.stopPropagation()
    setRenamingId(run.id)
    setRenameValue(run.title ?? '')
  }

  async function commitRename(id: string) {
    const title = renameValue.trim()
    setRenamingId(null)
    const updated = await runsApi.rename(id, title || null)
    setRuns(prev => prev.map(r => r.id === id ? updated : r))
    window.dispatchEvent(new Event(RUNS_CHANGED_EVENT))
  }

  function formatDate(ts: number) {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const statusColor: Record<string, string> = {
    done: 'var(--success)',
    running: 'var(--accent)',
    error: 'var(--error)',
    pending: 'var(--text-muted)',
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-bright)' }}>{t('history.title')}</h1>
        <Button variant="primary" small onClick={() => navigate('/run')}>
          {t('history.newRun')}
        </Button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          type="text"
          placeholder={t('history.searchPrompts')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, width: 'auto', background: 'var(--bg-elevated)' }}
        />
        <select
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
          style={{
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '7px 10px',
            color: 'var(--text-secondary)', outline: 'none', fontSize: 12,
          }}
        >
          <option value="">{t('history.allTime')}</option>
          <option value="today">{t('history.today')}</option>
          <option value="week">{t('history.week')}</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '7px 10px',
            color: 'var(--text-secondary)', outline: 'none', fontSize: 12,
          }}
        >
          <option value="">{t('history.all')}</option>
          <option value="saved">{t('history.savedFilter')}</option>
          <option value="unsaved">{t('history.unsavedFilter')}</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              {[['id', 'ID'], ['prompt', t('history.colPrompt')], ['models', t('history.colModels')], ['calls', t('history.colCalls')], ['replies', t('history.colReplies')], ['date', t('history.colDate')], ['status', t('history.colStatus')], ['actions', '']].map(([key, h]) => (
                <th key={key} style={{
                  padding: '8px 12px', textAlign: 'left',
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                  color: 'var(--text-muted)', fontWeight: 500, borderBottom: '0.5px solid var(--border)',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{t('common.loading')}</td></tr>
            )}
            {!loading && runs.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{t('history.noRuns')}</td></tr>
            )}
            {runs.map(run => {
              const isHovered = hoveredId === run.id
              const turnCount = run.prompts.length
              const previewPrompt = (turnCount > 1 ? run.prompts[turnCount - 1] : run.prompts[0]) ?? ''
              return (
                <tr
                  key={run.id}
                  onClick={() => navigate(`/results/${run.id}`)}
                  onMouseEnter={() => setHoveredId(run.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    cursor: 'pointer',
                    background: isHovered ? 'var(--bg-elevated)' : 'transparent',
                    borderBottom: '0.5px solid var(--border)',
                    transition: 'background 0.1s',
                  }}
                >
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                    {run.id.slice(0, 8)}
                    {run.saved && <span style={{ marginLeft: 6, color: 'var(--accent)', fontSize: 10 }}>●</span>}
                  </td>
                  <td style={{ padding: '10px 12px', maxWidth: 280, color: 'var(--text-primary)', fontSize: 12 }}>
                    {renamingId === run.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void commitRename(run.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={() => void commitRename(run.id)}
                        placeholder={t('history.namePlaceholder')}
                        style={{
                          width: '100%', background: 'var(--bg-base)', border: '0.5px solid var(--accent-dim)',
                          borderRadius: 5, padding: '3px 7px', fontSize: 12,
                          color: 'var(--text-primary)', outline: 'none',
                        }}
                      />
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: run.title ? 'var(--text-bright)' : 'var(--text-primary)' }}>
                          {run.title || previewPrompt}
                        </span>
                        <button
                          onClick={e => startRename(e, run)}
                          title={t('history.rename')}
                          style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            color: 'var(--text-muted)', lineHeight: 1, flexShrink: 0, display: 'inline-flex',
                            opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s',
                          }}
                        >
                          <IconPencil size={12} />
                        </button>
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {run.models.slice(0, 3).map(m => (
                        <span key={m} style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10,
                          background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                          borderRadius: 'var(--radius-sm)', padding: '2px 6px', color: 'var(--text-secondary)',
                        }}>
                          {m.split(':')[1] ?? m}
                        </span>
                      ))}
                      {run.models.length > 3 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{run.models.length - 3}</span>}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {run.totalCalls}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {turnCount}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatDate(run.createdAt)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 10,
                        color: statusColor[run.status] ?? 'var(--text-muted)',
                      }}>
                        {run.status}
                      </span>
                      {(() => {
                        const gc = Object.values(run.runSettings?.global ?? {}).filter(v => v != null).length
                        const pc = Object.values(run.runSettings?.perModel ?? {}).reduce((s, m) => s + Object.values(m).filter(v => v != null).length, 0)
                        const total = gc + pc
                        if (!total) return null
                        return (
                          <span style={{
                            fontSize: 9, fontFamily: 'var(--font-mono)',
                            color: 'var(--accent)', background: 'var(--accent-bg)',
                            border: '0.5px solid var(--accent-dim)', borderRadius: 8,
                            padding: '1px 5px',
                          }}>
                            ⚙ {total}
                          </span>
                        )
                      })()}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 6, opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s' }}>
                      <Button small onClick={e => handleFork(e, run)}>{t('history.fork')}</Button>
                      <Button variant="danger" small onClick={e => handleDelete(e, run.id)}>{t('history.delete')}</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
