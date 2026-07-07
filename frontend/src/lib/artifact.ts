const FENCED_HTML_BLOCK = /```html\s*\n([\s\S]*?)```/i

export function extractHtmlArtifact(text: string): string | null {
  const fenced = text.match(FENCED_HTML_BLOCK)
  if (fenced) return fenced[1].trim()

  const trimmed = text.trim()
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return trimmed

  return null
}
