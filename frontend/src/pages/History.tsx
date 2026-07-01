import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { runsApi } from '../api'
import type { Run } from '../../../src/types'

export function History() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    runsApi.list({ search: search || undefined, date: dateFilter || undefined, status: statusFilter || undefined })
      .then(setRuns)
      .finally(() => setLoading(false))
  }, [search, dateFilter, statusFilter])

  useEffect(() => { load() }, [load])

  async function handleFork(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    const forked = await runsApi.fork(id)
    navigate(`/run`, { state: { forkFrom: forked } })
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (!confirm('Delete this run?')) return
    await runsApi.remove(id)
    load()
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
        <h1 style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-bright)' }}>History</h1>
        <button
          onClick={() => navigate('/run')}
          style={{
            background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius-sm)', padding: '6px 14px', fontSize: 12, cursor: 'pointer',
          }}
        >
          + new run
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="Search prompts…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '7px 10px',
            color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--font-mono)', fontSize: 12,
          }}
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
          <option value="">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
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
          <option value="">All</option>
          <option value="saved">Saved</option>
          <option value="unsaved">Unsaved</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ border: '0.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              {['ID', 'Prompt', 'Models', 'Calls', 'Date', 'Status', ''].map(h => (
                <th key={h} style={{
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
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading…</td></tr>
            )}
            {!loading && runs.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No runs yet.</td></tr>
            )}
            {runs.map(run => {
              const isHovered = hoveredId === run.id
              const firstPrompt = run.prompts[0] ?? ''
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
                    <span style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {firstPrompt}
                    </span>
                    {run.prompts.length > 1 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> +{run.prompts.length - 1}</span>}
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
                      <button
                        onClick={e => handleFork(e, run.id)}
                        style={{
                          background: 'none', border: '0.5px solid var(--border)',
                          borderRadius: 'var(--radius-sm)', padding: '3px 8px',
                          fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer',
                        }}
                      >
                        fork
                      </button>
                      <button
                        onClick={e => handleDelete(e, run.id)}
                        style={{
                          background: 'none', border: '0.5px solid var(--border)',
                          borderRadius: 'var(--radius-sm)', padding: '3px 8px',
                          fontSize: 11, color: 'var(--error)', cursor: 'pointer',
                        }}
                      >
                        delete
                      </button>
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
