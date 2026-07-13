import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { runsApi } from '../api'
import { getActiveNewRunRunId, RUNS_CHANGED_EVENT } from '../pages/NewRun'
import { useT, t } from '../i18n'
import type { Run } from '../../../src/types'

const EXPANDED_WIDTH = 160
const COLLAPSED_WIDTH = 52
const RECENT_DIALOGS_COUNT = 5

const SIDEBAR_CSS = `
  .nav-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 14px 7px 16px;
    font-size: 11px;
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    color: var(--text-muted);
    border-left: 2px solid transparent;
    cursor: pointer;
    transition: color 0.1s, background 0.1s;
    text-decoration: none;
  }
  .nav-item.collapsed {
    padding-left: 15px;
    justify-content: center;
  }
  .nav-item:hover {
    color: var(--text-secondary);
    background: var(--bg-base);
  }
  .nav-item.active {
    color: var(--text-bright);
    border-left: 2px solid var(--accent);
    padding-left: 12px;
  }
  .nav-item.active.collapsed {
    padding-left: 11px;
  }
  .nav-item.disabled {
    color: var(--border-hover);
    cursor: default;
    pointer-events: none;
  }
  .nav-item.disabled:hover {
    color: var(--border-hover);
    background: none;
  }
  .nav-icon { flex-shrink: 0; display: flex; }
  .sidebar-collapse-btn {
    background: none; border: 0.5px solid var(--border); border-radius: 5px;
    color: var(--text-muted); cursor: pointer; padding: 3px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .sidebar-collapse-btn:hover { color: var(--text-primary); border-color: var(--border-hover); }
  .sidebar-logo-btn {
    background: none; border: none; cursor: pointer;
    width: 26px; height: 26px; border-radius: 5px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .sidebar-logo-btn .logo-expand { display: none; color: var(--text-primary); }
  .sidebar-logo-btn:hover { border: 0.5px solid var(--border-hover); }
  .sidebar-logo-btn:hover .logo-mark { display: none; }
  .sidebar-logo-btn:hover .logo-expand { display: flex; }
  .dialog-item {
    display: block; width: 100%; text-align: left;
    background: none; border: none; border-left: 2px solid transparent;
    padding: 4px 10px 4px 26px;
    font-size: 11px; font-family: var(--font-sans);
    color: var(--text-muted); cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    transition: color 0.1s, background 0.1s;
  }
  .dialog-item:hover { color: var(--text-secondary); background: var(--bg-base); }
  .dialog-item.active {
    color: var(--text-bright);
    border-left: 2px solid var(--accent);
    padding-left: 24px;
    background: var(--bg-base);
  }
`

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="nav-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

const ICONS: Record<string, React.ReactNode> = {
  test: <Icon><path d="M4 2.5v11l9-5.5-9-5.5z" fill="currentColor" stroke="none" /></Icon>,
  dashboard: <Icon><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></Icon>,
  results: <Icon><path d="M2 13.5h12" /><rect x="3" y="8" width="2.6" height="5.5" rx="0.5" /><rect x="6.7" y="4.5" width="2.6" height="9" rx="0.5" /><rect x="10.4" y="6.5" width="2.6" height="7" rx="0.5" /></Icon>,
  history: <Icon><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 2" /></Icon>,
  models: <Icon><path d="M8 2l6 3-6 3-6-3 6-3z" /><path d="M2 8l6 3 6-3" /><path d="M2 11l6 3 6-3" /></Icon>,
  providers: <Icon><path d="M6 2v4M10 2v4M4 6h8v3a4 4 0 01-4 4 4 4 0 01-4-4V6z" /><path d="M8 13v2" /></Icon>,
  datasets: <Icon><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" /><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" /></Icon>,
  settings: <Icon><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4M12.5 12.5l-1.4-1.4M4.9 4.9L3.5 3.5" /></Icon>,
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--hairline)', margin: '6px 10px' }} />
}

function Item({ to, label, icon, collapsed, soon }: { to: string; label: string; icon: string; collapsed: boolean; soon?: boolean }) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}${collapsed ? ' collapsed' : ''}`}
    >
      {ICONS[icon]}
      {!collapsed && (
        <>
          {label}
          {soon && (
            <span style={{ marginLeft: 6, fontSize: 9, fontFamily: 'var(--font-sans)', color: 'var(--border-hover)', letterSpacing: 0 }}>
              {t('nav.soon')}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

function DisabledItem({ label, icon, collapsed, soon }: { label: string; icon: string; collapsed: boolean; soon?: boolean }) {
  return (
    <div className={`nav-item disabled${collapsed ? ' collapsed' : ''}`} title={collapsed ? label : undefined}>
      {ICONS[icon]}
      {!collapsed && (
        <>
          {label}
          {soon && (
            <span style={{ marginLeft: 6, fontSize: 9, fontFamily: 'var(--font-sans)', color: 'var(--border-hover)', letterSpacing: 0 }}>
              {t('nav.soon')}
            </span>
          )}
        </>
      )}
    </div>
  )
}

function RecentDialogs() {
  const [runs, setRuns] = useState<Run[]>([])
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const refresh = () => {
      runsApi.list().then(rs => setRuns(rs.slice(0, RECENT_DIALOGS_COUNT))).catch(() => {})
    }
    refresh()
    window.addEventListener(RUNS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(RUNS_CHANGED_EVENT, refresh)
    // Re-fetch on navigation too — renames/deletes elsewhere become visible on return
  }, [location.pathname])

  if (runs.length === 0) return null
  const activeId = getActiveNewRunRunId()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 2 }}>
      {runs.map(run => {
        const label = run.title?.trim() || run.prompts[0] || run.id.slice(0, 8)
        const active = run.id === activeId
        return (
          <button
            key={run.id}
            className={`dialog-item${active ? ' active' : ''}`}
            title={label}
            onClick={() => navigate(active ? '/run' : `/run?session=${run.id}`)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

interface SidebarProps {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export function Sidebar({ collapsed, onCollapsedChange }: SidebarProps) {
  const { t } = useT()
  return (
    <nav style={{
      width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
      minWidth: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
      background: 'var(--bg-sidebar)',
      borderRight: '0.5px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      flexShrink: 0,
      transition: 'width 0.15s, min-width 0.15s',
      overflow: 'hidden',
    }}>
      <style>{SIDEBAR_CSS}</style>

      {/* Logo + collapse toggle — same row, same height in both states.
          Collapsed: the Y mark itself is the expand button, morphing into a
          chevron on hover. */}
      <div style={{
        padding: collapsed ? '16px 0 14px' : '16px 14px 14px',
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        flexShrink: 0,
      }}>
        {collapsed ? (
          <button
            className="sidebar-logo-btn"
            onClick={() => onCollapsedChange(false)}
            title={t('nav.expand')}
          >
            <span className="logo-mark" style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>Y</span>
            <svg className="logo-expand" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
        ) : (
          <>
            <div style={{
              fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)',
              color: 'var(--text-bright)', letterSpacing: '-0.02em',
            }}>
              bench<span style={{ color: 'var(--accent)' }}>Y</span>
            </div>
            <button
              className="sidebar-collapse-btn"
              onClick={() => onCollapsedChange(true)}
              title={t('nav.collapse')}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
          </>
        )}
      </div>

      <Divider />

      {/* ?new=1 → always starts a fresh dialog; past ones live in the list below */}
      <Item to="/run?new=1" label={t('nav.test')} icon="test" collapsed={collapsed} />
      {!collapsed && <RecentDialogs />}
      <Item to="/history" label={t('nav.history')} icon="history" collapsed={collapsed} />

      <Divider />

      <DisabledItem label={t('nav.dashboard')} icon="dashboard" collapsed={collapsed} soon />
      <DisabledItem label={t('nav.results')} icon="results" collapsed={collapsed} soon />

      <Divider />

      <DisabledItem label={t('nav.models')} icon="models" collapsed={collapsed} soon />
      <Item to="/providers" label={t('nav.providers')} icon="providers" collapsed={collapsed} />

      <Divider />

      <DisabledItem label={t('nav.datasets')} icon="datasets" collapsed={collapsed} soon />

      {/* Push settings to bottom */}
      <div style={{ flex: 1 }} />

      <Divider />

      <Item to="/settings" label={t('nav.settings')} icon="settings" collapsed={collapsed} />
    </nav>
  )
}
