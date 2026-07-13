const SLIDER_CSS = `
  .rf-slider { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; background: var(--border); accent-color: var(--accent); cursor: pointer; }
  .rf-slider:disabled { opacity: .4; cursor: default; }
  .rf-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 13px; height: 13px; border-radius: 50%; background: var(--accent); cursor: pointer; }
  .rf-slider::-moz-range-thumb { width: 13px; height: 13px; border: none; border-radius: 50%; background: var(--accent); cursor: pointer; }
  .rf-value-btn { background: none; border: none; padding: 0; cursor: pointer; }
  .rf-value-btn:hover { text-decoration: underline; text-underline-offset: 3px; }
`

import { useT } from '../i18n'

interface SliderFieldProps {
  label: string
  min: number
  max: number
  step: number
  value: number | null
  onChange: (v: number | null) => void
  allowAuto?: boolean
  unit?: string
  // Tints the value readout — used to mark an active override vs an inherited value
  accent?: boolean
}

// One row: label | slider | value. Fills its container's width, so callers
// control sizing purely via their grid — no fixed widths that can collide.
// With allowAuto, the value readout itself toggles between Auto and a number.
export function SliderField({ label, min, max, step, value, onChange, allowAuto, unit, accent }: SliderFieldProps) {
  const { t } = useT()
  const isAuto = value == null
  const display = isAuto ? 'Auto' : `${value}${unit ?? ''}`
  const valueColor = accent ? 'var(--accent)' : isAuto ? 'var(--text-muted)' : 'var(--text-primary)'
  const valueStyle = {
    width: 52, textAlign: 'right' as const, flexShrink: 0,
    fontSize: 11, fontFamily: 'var(--font-mono)', color: valueColor,
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 0 }}>
      <style>{SLIDER_CSS}</style>
      <span
        title={label}
        style={{ fontSize: 11, color: 'var(--text-muted)', width: 88, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {label}
      </span>
      <input
        className="rf-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={isAuto}
        value={value ?? min}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, minWidth: 40 }}
      />
      {allowAuto ? (
        <button
          className="rf-value-btn"
          onClick={() => onChange(isAuto ? min : null)}
          title={isAuto ? t('slider.setValue') : t('slider.resetAuto')}
          style={valueStyle}
        >
          {display}
        </button>
      ) : (
        <span style={valueStyle}>{display}</span>
      )}
    </div>
  )
}
