import type { DatasetVar, DatasetVarType } from './types.js'

// From `text[start]` (which must be '{'), return the substring up to its
// balanced closing '}', ignoring braces inside JSON strings. null if unbalanced.
function balancedObject(text: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

// Pull the model's answer out of its text as an object. Models wrap JSON in
// prose or ```json fences, so scan each '{' for a balanced object and return the
// first one that parses — a stray `{id: 5}` in the prose no longer swallows the
// real object that follows it. Anything unparseable is "no answer" (every scored
// field misses).
export function parseModelOutput(text: string): Record<string, unknown> | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    const slice = balancedObject(text, i)
    if (!slice) break
    try {
      const parsed = JSON.parse(slice) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch { /* not JSON — try the next '{' */ }
  }
  return null
}

const toStr = (v: unknown): string => v == null ? '' : String(v)

// A number as printed by a receipt vs. by a model: "1 105,90" and "1105.90" are
// the same value. Strip spaces (incl. non-breaking), treat a comma as the
// decimal separator, and compare numerically — not as strings. Assumes the
// dataset's convention is space-thousands + comma-or-dot decimal (the receipt
// format); a dot-as-thousands value like "1.000" reads as 1.0, so datasets that
// use dot-grouping should label ground truth without the grouping separators.
function normalizeNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s ]/g, '').replace(',', '.')
  if (!cleaned || !/^[+-]?\d*\.?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

// Normalize a date to ISO YYYY-MM-DD so "12.03.2024" and "2024-03-12" match.
// Only ISO and day-first DD.MM.YYYY / DD/MM/YYYY are handled — a US month-first
// "01/02/2024" is read as day-first (2 Jan), so ground truth and model output
// should agree on ISO or day-first. Anything else stays as-is (a mismatch is
// then a real mismatch, not a normalization gap).
function normalizeDate(raw: string): string {
  const s = raw.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(s)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  return s.toLowerCase()
}

function normalizeText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Do two values match, given the variable's type? Ground truth and the model's
// value are both coerced to strings first (the model may emit a number/null).
export function valuesMatch(type: DatasetVarType, truth: unknown, actual: unknown): boolean {
  const t = toStr(truth)
  const a = toStr(actual)
  if (type === 'number') {
    const nt = normalizeNumber(t)
    const na = normalizeNumber(a)
    return nt !== null && na !== null && nt === na
  }
  if (type === 'date') return normalizeDate(t) === normalizeDate(a)
  return normalizeText(t) === normalizeText(a)
}

// Score one result against one item's ground truth. Only fields with a non-empty
// ground-truth value are scored (an unlabeled field can't be judged). score is
// matched/scored, or null when nothing was labeled for this item.
export function scoreResult(
  schema: DatasetVar[],
  groundTruth: Record<string, string>,
  modelText: string,
): { score: number | null; detail: Record<string, 'match' | 'miss'> } {
  const parsed = parseModelOutput(modelText)
  const detail: Record<string, 'match' | 'miss'> = {}
  let scored = 0
  let matched = 0
  for (const v of schema) {
    const truth = groundTruth[v.key]
    if (truth == null || String(truth).trim() === '') continue
    scored++
    const ok = parsed !== null && valuesMatch(v.type, truth, parsed[v.key])
    detail[v.key] = ok ? 'match' : 'miss'
    if (ok) matched++
  }
  return { score: scored === 0 ? null : matched / scored, detail }
}
