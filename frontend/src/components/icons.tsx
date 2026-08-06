// Single stroke-based icon set — replaces the emoji/unicode glyph mix so
// buttons render identically on every OS. Same visual language as the
// sidebar nav icons (16-grid, 1.3-1.4 stroke, round caps).

interface IconProps {
  size?: number
}

function Svg({ size = 13, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

export function IconRefresh(p: IconProps) {
  return <Svg {...p}><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2.5v3h-3" /></Svg>
}

export function IconCopy(p: IconProps) {
  return <Svg {...p}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></Svg>
}

export function IconCheck(p: IconProps) {
  return <Svg {...p}><path d="M3 8.5l3.5 3.5L13 4.5" /></Svg>
}

// Up arrow — "a newer build is available to move up to".
export function IconArrowUp(p: IconProps) {
  return <Svg {...p}><path d="M8 13V3.5" /><path d="M4 7l4-4 4 4" /></Svg>
}

export function IconExpand(p: IconProps) {
  return <Svg {...p}><path d="M9.5 2h4.5v4.5" /><path d="M14 2L9 7" /><path d="M6.5 14H2V9.5" /><path d="M2 14l5-5" /></Svg>
}

export function IconCollapse(p: IconProps) {
  return <Svg {...p}><path d="M14 2L9.5 6.5" /><path d="M9.5 3.5v3h3" /><path d="M2 14l4.5-4.5" /><path d="M6.5 12.5v-3h-3" /></Svg>
}

export function IconClose(p: IconProps) {
  return <Svg {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></Svg>
}

export function IconPlay(p: IconProps) {
  return <Svg {...p}><path d="M4.5 2.8v10.4l8.4-5.2-8.4-5.2z" fill="currentColor" stroke="none" /></Svg>
}

export function IconStop(p: IconProps) {
  return <Svg {...p}><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" /></Svg>
}

export function IconEye(p: IconProps) {
  return <Svg {...p}><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></Svg>
}

export function IconText(p: IconProps) {
  return <Svg {...p}><path d="M3 3.5h10" /><path d="M8 3.5V13" /><path d="M5.5 13h5" /></Svg>
}

export function IconPencil(p: IconProps) {
  return <Svg {...p}><path d="M10.5 2.8l2.7 2.7L5.5 13.2l-3.3.6.6-3.3 7.7-7.7z" /></Svg>
}

export function IconPaperclip(p: IconProps) {
  return <Svg {...p}><path d="M13 7.5l-5.2 5.2a3.2 3.2 0 0 1-4.5-4.5L8.8 2.7a2.1 2.1 0 0 1 3 3l-5.4 5.5a1 1 0 0 1-1.5-1.5L9.5 5" /></Svg>
}

// Disclosure chevron: points right when closed, down when open.
export function IconChevron({ open, ...p }: IconProps & { open?: boolean }) {
  return (
    <Svg {...p}>
      <path d={open ? 'M3.5 6l4.5 4.5L12.5 6' : 'M6 3.5L10.5 8 6 12.5'} />
    </Svg>
  )
}

// Sliders — the shape people expect for "settings/tuning".
export function IconSliders(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 4.5h8M13 4.5h1M2 11.5h3M8 11.5h6" />
      <circle cx="11.5" cy="4.5" r="1.8" />
      <circle cx="6.5" cy="11.5" r="1.8" />
    </Svg>
  )
}

export function IconFile(p: IconProps) {
  return <Svg {...p}><path d="M9 1.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5L9 1.5z" /><path d="M9 1.5V5h3.5" /></Svg>
}

// Stacked layers — "how many models this run hits".
export function IconLayers(p: IconProps) {
  return <Svg {...p}><path d="M8 1.8 14.2 5 8 8.2 1.8 5 8 1.8Z" /><path d="M1.8 8.6 8 11.8l6.2-3.2" /></Svg>
}

// ─── Test-mode glyphs ─────────────────────────────────────────────────────
// Each one draws the shape of its run: prompts on the left, the models they
// land on as blocks on the right. Read side by side in the mode selector, the
// difference between them is the picture, not the label.

// Database cylinder — a dataset.
export function IconDatabase(p: IconProps) {
  return <Svg {...p}><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" /><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" /></Svg>
}

// a dataset (cylinder) → all models (blocks): the 4th run mode
export function IconModeDataset(p: IconProps) {
  return (
    <Svg {...p}>
      <ellipse cx="3.6" cy="3" rx="2.3" ry="1.1" />
      <path d="M1.3 3v6.2c0 .6 1 1.1 2.3 1.1s2.3-.5 2.3-1.1V3" />
      <path d="M6.2 6.6h4.9" />
      <rect x="11.3" y="1.9" width="2.9" height="2.6" rx=".8" />
      <rect x="11.3" y="6.7" width="2.9" height="2.6" rx=".8" />
      <rect x="11.3" y="11.5" width="2.9" height="2.6" rx=".8" />
      <path d="M6.2 6.6c1.7 0 1.3-3.4 3-3.4h1.3M6.2 6.6c1.7 0 1.3 6.2 3 6.2h1.3" />
    </Svg>
  )
}

// one prompt → all models
export function IconModeFan(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="2.4" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <path d="M4.3 8h2.5M6.8 8c1.7 0 1.3-4.8 3-4.8h1.3M6.8 8h4.3M6.8 8c1.7 0 1.3 4.8 3 4.8h1.3" />
      <rect x="11.3" y="1.9" width="2.9" height="2.6" rx=".8" />
      <rect x="11.3" y="6.7" width="2.9" height="2.6" rx=".8" />
      <rect x="11.3" y="11.5" width="2.9" height="2.6" rx=".8" />
    </Svg>
  )
}

// prompt per model
export function IconModePairs(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="2.2" cy="3.2" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="2.2" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="2.2" cy="12.8" r="1.3" fill="currentColor" stroke="none" />
      <path d="M4.1 3.2h7M4.1 8h7M4.1 12.8h7" />
      <rect x="11.3" y="1.9" width="2.9" height="2.6" rx=".8" />
      <rect x="11.3" y="6.7" width="2.9" height="2.6" rx=".8" />
      <rect x="11.3" y="11.5" width="2.9" height="2.6" rx=".8" />
    </Svg>
  )
}

// many prompts → all models
export function IconModeMatrix(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="2" cy="3.2" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="2" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="2" cy="12.8" r="1.2" fill="currentColor" stroke="none" />
      <path d="M3.7 3.2h2.5M3.7 8h2.5M3.7 12.8h2.5" />
      <rect x="6.4" y="1.9" width="7.8" height="12.2" rx="1" />
      <path d="M9 1.9v12.2M11.6 1.9v12.2M6.4 6h7.8M6.4 10.1h7.8" />
    </Svg>
  )
}
