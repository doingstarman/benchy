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

// Languages a browser can render directly in an iframe.
const HTMLISH_LANG = /^(html|htm|xhtml|svg|markup)$/i

// A structural root tag: a snippet that opens with one renders as a page or a
// graphic on its own (leading comments/whitespace tolerated). Used to catch HTML
// that the model didn't tag as ```html.
const HTML_ROOT = /^\s*(?:<!--[\s\S]*?-->\s*)*<\s*(!doctype\s+html|html|head|body|svg|div|section|main|article|table|ul|ol|form|canvas|style|template|nav|header|footer|figure|h[1-6]|p|span|button|a|img|pre|blockquote)[\s/>]/i

export function looksLikeHtml(content: string): boolean {
  return HTML_ROOT.test(content)
}

export function isRunnableCode(seg: CodeSegment): boolean {
  if (seg.open) return false
  if (HTMLISH_LANG.test(seg.lang)) return true
  return looksLikeHtml(seg.content)
}

// A model that answers with a bare HTML/SVG blob and no ``` fence: the whole
// reply is markup, not prose that merely mentions a tag. endsWith '>' is what
// separates "the answer IS a document" from "the answer talks about one".
export function wholeAnswerHtml(text: string): string | null {
  const t = text.trim()
  if (!t.startsWith('<') || !t.endsWith('>')) return null
  return looksLikeHtml(t) ? t : null
}

// What actually gets fed to the sandboxed iframe. A full document is used as-is;
// a fragment (a lone <div>/<svg>/<style>…) is hosted in a minimal page so it
// renders instead of showing nothing.
export function toPreviewDoc(content: string): string {
  const t = content.trim()
  if (/^\s*(?:<!--[\s\S]*?-->\s*)*<\s*(?:!doctype\s+html|html[\s/>])/i.test(t)) return content
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:8px;font-family:system-ui,-apple-system,sans-serif}</style></head><body>${content}</body></html>`
}
