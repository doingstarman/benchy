import { Outlet } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'

export function App() {
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar />
      <main style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--bg-base)',
      }}>
        <Outlet />
      </main>
    </div>
  )
}
