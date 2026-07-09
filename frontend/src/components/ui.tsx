// Shared UI primitives — the single place button/input/pill styling lives.
// Pages compose these instead of re-declaring inline styles.

const UI_CSS = `
  .ui-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    border-radius: 7px; cursor: pointer;
    font-size: var(--fs-base); font-family: var(--font-mono);
    padding: 8px 18px; border: 0.5px solid transparent;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .ui-btn:disabled { cursor: not-allowed; opacity: 0.55; }
  .ui-btn-primary { background: var(--accent); color: var(--on-accent); }
  .ui-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
  .ui-btn-primary:disabled { background: var(--accent-bg); color: var(--text-muted); opacity: 1; }
  .ui-btn-ghost { background: none; border-color: var(--border); color: var(--text-secondary); }
  .ui-btn-ghost:hover:not(:disabled) { border-color: var(--border-hover); color: var(--text-primary); background: var(--bg-elevated); }
  .ui-btn-danger { background: none; border-color: var(--error); color: var(--error); }
  .ui-btn-danger:hover:not(:disabled) { background: var(--error-bg); }
  .ui-btn-sm { padding: 5px 12px; font-size: var(--fs-md); }

  .ui-iconbtn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; flex-shrink: 0;
    background: none; border: 0.5px solid var(--border); border-radius: 6px;
    color: var(--text-secondary); cursor: pointer;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .ui-iconbtn:hover { color: var(--text-primary); border-color: var(--border-hover); background: var(--bg-elevated); }
  .ui-iconbtn.on { background: var(--accent-bg); border-color: var(--accent-dim); color: var(--accent); }

  .ui-input {
    background: var(--bg-base); border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    padding: 8px 10px; width: 100%; box-sizing: border-box;
    color: var(--text-primary); font-size: var(--fs-md); font-family: var(--font-mono);
  }
  .ui-input:focus { outline: 1.5px solid var(--accent); border-color: transparent; }
  .ui-input::placeholder { color: var(--text-muted); }

  .ui-pill {
    display: inline-flex; align-items: center; gap: 6px;
    border: 0.5px solid var(--border); border-radius: 20px;
    padding: 5px 12px; cursor: pointer;
    font-size: var(--fs-md); font-family: var(--font-mono);
    background: var(--bg-base); color: var(--text-muted);
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .ui-pill.on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .ui-pill .ui-pill-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text-muted); }
  .ui-pill.on .ui-pill-dot { background: var(--on-accent); }

  .ui-spinner { display: inline-block; width: 10px; height: 10px; border: 1.5px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: ui-spin .6s linear infinite; }
  @keyframes ui-spin { to { transform: rotate(360deg) } }
`

export function UiStyles() {
  return <style>{UI_CSS}</style>
}

type ButtonVariant = 'primary' | 'ghost' | 'danger'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  small?: boolean
}

export function Button({ variant = 'ghost', small, className, ...rest }: ButtonProps) {
  const cls = ['ui-btn', `ui-btn-${variant}`, small ? 'ui-btn-sm' : '', className ?? ''].filter(Boolean).join(' ')
  return <button className={cls} {...rest} />
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function IconButton({ active, className, ...rest }: IconButtonProps) {
  const cls = ['ui-iconbtn', active ? 'on' : '', className ?? ''].filter(Boolean).join(' ')
  return <button className={cls} {...rest} />
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return <input className={['ui-input', className ?? ''].filter(Boolean).join(' ')} {...rest} />
}

interface PillToggleProps {
  on: boolean
  onToggle: () => void
  labelOn: string
  labelOff: string
  title?: string
}

export function PillToggle({ on, onToggle, labelOn, labelOff, title }: PillToggleProps) {
  return (
    <button className={`ui-pill${on ? ' on' : ''}`} onClick={onToggle} title={title}>
      <span className="ui-pill-dot" />
      {on ? labelOn : labelOff}
    </button>
  )
}
