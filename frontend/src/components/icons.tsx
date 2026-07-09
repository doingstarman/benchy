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

export function IconFile(p: IconProps) {
  return <Svg {...p}><path d="M9 1.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5L9 1.5z" /><path d="M9 1.5V5h3.5" /></Svg>
}
