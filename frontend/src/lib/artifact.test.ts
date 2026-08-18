import { describe, it, expect } from 'vitest'
import { splitFencedSegments, isRunnableCode, looksLikeHtml, wholeAnswerHtml, toPreviewDoc } from './artifact'

describe('splitFencedSegments', () => {
  it('splits prose and fenced code, and flags an unterminated fence as open', () => {
    const segs = splitFencedSegments('before\n```js\nconst x = 1\n```\nafter')
    expect(segs.map(s => s.type)).toEqual(['text', 'code', 'text'])
    const [, code] = segs
    expect(code.type === 'code' && code.lang).toBe('js')
    expect(code.type === 'code' && code.open).toBe(false)

    const streaming = splitFencedSegments('```html\n<div>')
    expect(streaming[0].type === 'code' && streaming[0].open).toBe(true)
  })
})

describe('isRunnableCode — broadened detection', () => {
  const code = (content: string, lang = '', open = false) => ({ type: 'code' as const, content, lang, open })

  it('runs html-ish languages regardless of content', () => {
    expect(isRunnableCode(code('<div>x</div>', 'html'))).toBe(true)
    expect(isRunnableCode(code('<svg></svg>', 'svg'))).toBe(true)
    expect(isRunnableCode(code('<p>hi</p>', 'markup'))).toBe(true)
  })

  it('catches HTML the model did not tag as ```html (fragment or document)', () => {
    expect(isRunnableCode(code('<!doctype html><html></html>', ''))).toBe(true)
    expect(isRunnableCode(code('<div class="x">y</div>', ''))).toBe(true)     // no lang tag
    expect(isRunnableCode(code('<style>.a{}</style><div></div>', ''))).toBe(true)
  })

  it('does not run non-markup code or a still-streaming fence', () => {
    expect(isRunnableCode(code('const x = "<div>"', 'js'))).toBe(false)
    expect(isRunnableCode(code('print("hello")', 'python'))).toBe(false)
    expect(isRunnableCode(code('<div>x</div>', 'html', true))).toBe(false)    // open → wait
  })
})

describe('looksLikeHtml', () => {
  it('is true for documents, fragments, and leading-comment HTML', () => {
    expect(looksLikeHtml('<!doctype html><html></html>')).toBe(true)
    expect(looksLikeHtml('<div>hi</div>')).toBe(true)
    expect(looksLikeHtml('<!-- note -->\n<html></html>')).toBe(true)
    expect(looksLikeHtml('  <svg viewBox="0 0 1 1"></svg>')).toBe(true)
  })

  it('is false for prose and code that merely mentions a tag', () => {
    expect(looksLikeHtml('Here is a <div> in prose')).toBe(false)
    expect(looksLikeHtml('const s = "<span>"')).toBe(false)
    expect(looksLikeHtml('function f() {}')).toBe(false)
  })
})

describe('wholeAnswerHtml — unfenced raw HTML answers', () => {
  it('promotes a bare markup answer, ignores prose that only contains a tag', () => {
    expect(wholeAnswerHtml('<!doctype html><html><body>hi</body></html>')).toBe('<!doctype html><html><body>hi</body></html>')
    expect(wholeAnswerHtml('  <div>only markup</div>  ')).toBe('<div>only markup</div>')
    // Prose: does not start with '<'
    expect(wholeAnswerHtml('Sure! <div>x</div>')).toBeNull()
    // Truncated: does not end with '>'
    expect(wholeAnswerHtml('<div>still typing')).toBeNull()
  })
})

describe('toPreviewDoc', () => {
  it('passes a full document through untouched', () => {
    const doc = '<!doctype html><html><body>x</body></html>'
    expect(toPreviewDoc(doc)).toBe(doc)
  })

  it('hosts a fragment in a minimal page so it renders', () => {
    const out = toPreviewDoc('<div>frag</div>')
    expect(out).toMatch(/^<!doctype html>/i)
    expect(out).toContain('<div>frag</div>')
    expect(out).toContain('<body>')
  })
})
