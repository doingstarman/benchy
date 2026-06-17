import { NavLink } from 'react-router-dom'

const SIDEBAR_CSS = `
  .nav-item {
    display: block;
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
  .nav-item:hover {
    color: var(--text-secondary);
    background: var(--bg-base);
  }
  .nav-item.active {
    color: var(--text-bright);
    border-left: 2px solid var(--accent);
    padding-left: 12px;
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
`

function Divider() {
  return <div style={{ height: '0.5px', background: 'var(--border)', margin: '6px 14px' }} />
}

function Item({ to, label, soon }: { to: string; label: string; soon?: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      {label}
      {soon && (
        <span style={{
          marginLeft: 6,
          fontSize: 9,
          fontFamily: 'var(--font-sans)',
          color: 'var(--border-hover)',
          letterSpacing: 0,
        }}>
          soon
        </span>
      )}
    </NavLink>
  )
}

function DisabledItem({ label, soon }: { label: string; soon?: boolean }) {
  return (
    <div className="nav-item disabled">
      {label}
      {soon && (
        <span style={{
          marginLeft: 6,
          fontSize: 9,
          fontFamily: 'var(--font-sans)',
          color: 'var(--border-hover)',
          letterSpacing: 0,
        }}>
          soon
        </span>
      )}
    </div>
  )
}

export function Sidebar() {
  return (
    <nav style={{
      width: 160,
      minWidth: 160,
      background: 'var(--bg-sidebar)',
      borderRight: '0.5px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      flexShrink: 0,
    }}>
      <style>{SIDEBAR_CSS}</style>

      {/* Logo */}
      <div style={{
        padding: '16px 14px 14px',
        fontSize: 15,
        fontWeight: 500,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-bright)',
        letterSpacing: '-0.02em',
        flexShrink: 0,
      }}>
        bench<span style={{ color: 'var(--accent)' }}>Y</span>
      </div>

      <Divider />

      <Item to="/run" label="Тест" />

      <Divider />

      <DisabledItem label="Дашборд" soon />
      <Item to="/history" label="История" />

      <Divider />

      <DisabledItem label="Модели" soon />
      <Item to="/providers" label="Провайдеры" />

      <Divider />

      <DisabledItem label="Датасеты" soon />

      {/* Push settings to bottom */}
      <div style={{ flex: 1 }} />

      <Divider />

      <Item to="/settings" label="Настройки" />
    </nav>
  )
}
