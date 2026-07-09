const FENCED_HTML_BLOCK = /```html\s*\n([\s\S]*?)```/i

export function extractHtmlArtifact(text: string): string | null {
  const fenced = text.match(FENCED_HTML_BLOCK)
  if (fenced) return fenced[1].trim()

  const trimmed = text.trim()
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return trimmed

  return null
}

export interface TextSegment {
  type: 'text'
  content: string
}

export interface CodeSegment {
  type: 'code'
  content: string
  lang: string
  // An unterminated fence (still streaming) — render as code, don't offer Run yet
  open: boolean
}

export type Segment = TextSegment | CodeSegment

// Splits a model reply into prose and fenced-code segments so code can be
// rendered in its own windowed block (ChatGPT-style) instead of inline.
export function splitFencedSegments(text: string): Segment[] {
  const segments: Segment[] = []
  const fenceRe = /```([\w+-]*)[^\S\n]*\n/g
  let pos = 0

  while (pos < text.length) {
    fenceRe.lastIndex = pos
    const open = fenceRe.exec(text)
    if (!open) {
      const rest = text.slice(pos)
      if (rest.trim()) segments.push({ type: 'text', content: rest })
      break
    }

    const before = text.slice(pos, open.index)
    if (before.trim()) segments.push({ type: 'text', content: before })

    const bodyStart = open.index + open[0].length
    const closeIdx = text.indexOf('```', bodyStart)
    if (closeIdx === -1) {
      segments.push({ type: 'code', content: text.slice(bodyStart), lang: open[1] || 'code', open: true })
      break
    }
    segments.push({ type: 'code', content: text.slice(bodyStart, closeIdx).replace(/\n$/, ''), lang: open[1] || 'code', open: false })
    pos = closeIdx + 3
  }

  return segments
}

export function isRunnableCode(seg: CodeSegment): boolean {
  if (seg.open) return false
  if (/^html$/i.test(seg.lang)) return true
  const t = seg.content.trim()
  return /^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)
}
