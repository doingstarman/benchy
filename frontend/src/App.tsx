import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { UiStyles } from './components/ui'
import { hasActiveNewRunSession } from './pages/NewRun'

const SIDEBAR_STORAGE_KEY = 'benchy-sidebar-collapsed'

export function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1')

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  // With the sidebar collapsed there's no readable "Тест" nav label, so give
  // an explicit way back to the ongoing conversation from other sections.
  const showBackToDialog = collapsed && location.pathname !== '/run' && hasActiveNewRunSession()

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <UiStyles />
      <Sidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
      <main style={{
        flex: 1,
        overflow: 'hidden',
        background: 'var(--bg-base)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {showBackToDialog && (
          <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
            <button
              onClick={() => navigate('/run')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                borderRadius: 20, padding: '5px 12px',
                fontSize: 12, fontFamily: 'var(--font-mono)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
              в диалог
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
