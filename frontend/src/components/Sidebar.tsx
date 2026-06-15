import { NavLink } from 'react-router-dom'

const links = [
  { to: '/run', label: 'new run' },
  { to: '/history', label: 'history' },
  { to: '/providers', label: 'providers' },
  { to: '/settings', label: 'settings' },
]

export function Sidebar() {
  return (
    <nav style={{
      width: 160,
      minWidth: 160,
      background: 'var(--bg-sidebar)',
      borderRight: '0.5px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      padding: '20px 0',
      gap: 2,
    }}>
      <div style={{
        padding: '0 16px 20px',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        fontWeight: 500,
        color: 'var(--text-bright)',
        letterSpacing: '-0.02em',
      }}>
        benchY
      </div>
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          style={({ isActive }) => ({
            display: 'block',
            padding: '6px 16px',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: isActive ? 'var(--text-bright)' : 'var(--text-muted)',
            borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'color 0.1s, border-color 0.1s',
          })}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
