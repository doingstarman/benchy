// From `text[start]` (which must be '{'), return the substring up to its
// balanced closing '}', ignoring braces inside JSON strings. null if unbalanced.
function balancedObject(text, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (esc)
                esc = false;
            else if (c === '\\')
                esc = true;
            else if (c === '"')
                inStr = false;
        }
        else if (c === '"')
            inStr = true;
        else if (c === '{')
            depth++;
        else if (c === '}' && --depth === 0)
            return text.slice(start, i + 1);
    }
    return null;
}
// Pull the model's answer out of its text as an object. Models wrap JSON in
// prose or ```json fences, so scan each '{' for a balanced object and return the
// first one that parses — a stray `{id: 5}` in the prose no longer swallows the
// real object that follows it. Anything unparseable is "no answer" (every scored
// field misses).
export function parseModelOutput(text) {
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '{')
            continue;
        const slice = balancedObject(text, i);
        if (!slice)
            break;
        try {
            const parsed = JSON.parse(slice);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        }
        catch { /* not JSON — try the next '{' */ }
    }
    return null;
}
const toStr = (v) => v == null ? '' : String(v);
// A number as printed by a receipt vs. by a model: "1 105,90" and "1105.90" are
// the same value. Strip spaces (incl. non-breaking), treat a comma as the
// decimal separator, and compare numerically — not as strings. Assumes the
// dataset's convention is space-thousands + comma-or-dot decimal (the receipt
// format); a dot-as-thousands value like "1.000" reads as 1.0, so datasets that
// use dot-grouping should label ground truth without the grouping separators.
function normalizeNumber(raw) {
    const cleaned = raw.replace(/[\s ]/g, '').replace(',', '.');
    if (!cleaned || !/^[+-]?\d*\.?\d+$/.test(cleaned))
        return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}
// Normalize a date to ISO YYYY-MM-DD so "12.03.2024" and "2024-03-12" match.
// Only ISO and day-first DD.MM.YYYY / DD/MM/YYYY are handled — a US month-first
// "01/02/2024" is read as day-first (2 Jan), so ground truth and model output
// should agree on ISO or day-first. Anything else stays as-is (a mismatch is
// then a real mismatch, not a normalization gap).
function normalizeDate(raw) {
    const s = raw.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso)
        return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(s);
    if (dmy)
        return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return s.toLowerCase();
}
function normalizeText(raw) {
    return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}
function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
// A scalar as a number, whether it arrives as 5 or "5" — so a stringified tool
// argument ({"limit":"5"}) matches its numeric ground truth ({"limit":5}).
function asNumber(v) {
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const s = v.trim();
        if (s === '')
            return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
// Compare two JSON-decoded argument values by shape, not by text: object keys in
// any order, whitespace and numeric formatting irrelevant, a number equal whether
// written 5 or "5". Arrays stay order-sensitive — a tool's argument list order
// usually carries meaning. String leaves keep the flat-text trim/case leniency.
function looseValueEqual(a, b) {
    if (a === b)
        return true;
    const na = asNumber(a), nb = asNumber(b);
    if (na !== null && nb !== null)
        return na === nb;
    if (typeof a === 'string' && typeof b === 'string')
        return normalizeText(a) === normalizeText(b);
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
            return false;
        return a.every((el, i) => looseValueEqual(el, b[i]));
    }
    if (isObject(a) && isObject(b)) {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length)
            return false;
        return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && looseValueEqual(a[k], b[k]));
    }
    return false;
}
// Structured tool arguments (an object/array value) compare by shape, not string:
// the model's object arrives decoded, so a string compare would read it as
// "[object Object]" and always miss. Fires only when the ground truth is itself
// JSON structure; scalars return null and fall through to the per-type rules.
function structuralMatch(truthStr, actual) {
    let truthVal;
    try {
        truthVal = JSON.parse(truthStr);
    }
    catch {
        return null;
    }
    if (!isObject(truthVal) && !Array.isArray(truthVal))
        return null;
    let actualVal = actual;
    if (typeof actual === 'string') {
        try {
            actualVal = JSON.parse(actual);
        }
        catch {
            return false;
        }
    }
    return looseValueEqual(truthVal, actualVal);
}
// Do two values match, given the variable's type? A structured argument compares
// by shape; otherwise ground truth and the model's value are coerced to strings
// (the model may emit a number/null) and compared under the type's rules.
export function valuesMatch(type, truth, actual) {
    const t = toStr(truth);
    const structural = structuralMatch(t, actual);
    if (structural !== null)
        return structural;
    const a = toStr(actual);
    if (type === 'number') {
        const nt = normalizeNumber(t);
        const na = normalizeNumber(a);
        return nt !== null && na !== null && nt === na;
    }
    if (type === 'date')
        return normalizeDate(t) === normalizeDate(a);
    return normalizeText(t) === normalizeText(a);
}
// Score one result against one item's ground truth. Only fields with a non-empty
// ground-truth value are scored (an unlabeled field can't be judged). score is
// matched/scored, or null when nothing was labeled for this item.
export function scoreResult(schema, groundTruth, modelText) {
    const parsed = parseModelOutput(modelText);
    const detail = {};
    let scored = 0;
    let matched = 0;
    for (const v of schema) {
        const truth = groundTruth[v.key];
        if (truth == null || String(truth).trim() === '')
            continue;
        scored++;
        const ok = parsed !== null && valuesMatch(v.type, truth, parsed[v.key]);
        detail[v.key] = ok ? 'match' : 'miss';
        if (ok)
            matched++;
    }
    return { score: scored === 0 ? null : matched / scored, detail };
}
