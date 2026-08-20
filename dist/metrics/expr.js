// A tiny arithmetic language over metric keys — the engine behind custom metrics.
// No `eval`: tokenize → Pratt-parse → AST → walk. Pure (no node/browser APIs) so
// BOTH the backend (materialize) and the browser (instant editor validation) import
// it, exactly like pricing.ts. Two rules the design insists on: any null operand
// propagates to null, and division by zero is null (not 0, not Infinity).
export const AGGREGATES = ['mean', 'median', 'p50', 'p95', 'min', 'max', 'sum'];
export const SCALAR_FUNCTIONS = ['abs', 'round', 'clamp'];
const AGG_SET = new Set(AGGREGATES);
const FUNC_ARITY = {
    abs: [1, 1], round: [1, 2], clamp: [3, 3],
    mean: [1, 1], median: [1, 1], p50: [1, 1], p95: [1, 1], min: [1, 1], max: [1, 1], sum: [1, 1],
};
class ParseError extends Error {
    span;
    suggestion;
    constructor(message, span, suggestion) {
        super(message);
        this.span = span;
        this.suggestion = suggestion;
    }
}
// Bounds the recursive-descent parser so a pathological `(((…)))` fails as a clean
// validation error instead of overflowing the JS stack into an uncaught RangeError
// (which the API would surface as a 500). No real expression nests this deep.
const MAX_DEPTH = 128;
// Any non-finite arithmetic result (overflow → ±Infinity, `big - big` → NaN,
// `round(x, 400)` → NaN) collapses to null — the same "no value" the ÷0 guard
// produces. Keeps the "never NaN/Infinity" contract even on absurd inputs.
function fin(v) {
    return v != null && Number.isFinite(v) ? v : null;
}
function tokenize(src) {
    const toks = [];
    const re = /\s+|([A-Za-z_][A-Za-z0-9_]*)|(\d+(?:\.\d+)?)|([+\-*/])|(\()|(\))|(,)|(.)/g;
    let m;
    while ((m = re.exec(src))) {
        if (m[0].trim() === '' && !m[1] && !m[2] && !m[3] && !m[4] && !m[5] && !m[6])
            continue;
        const start = m.index;
        if (m[1])
            toks.push({ t: 'ident', text: m[1], start });
        else if (m[2])
            toks.push({ t: 'num', text: m[2], start });
        else if (m[3])
            toks.push({ t: 'op', text: m[3], start });
        else if (m[4])
            toks.push({ t: 'lparen', text: '(', start });
        else if (m[5])
            toks.push({ t: 'rparen', text: ')', start });
        else if (m[6])
            toks.push({ t: 'comma', text: ',', start });
        else if (m[7])
            throw new ParseError(`Unexpected character "${m[7]}"`, [start, start + 1]);
    }
    return toks;
}
// Pratt parser: binding powers 1 (+ -) < 2 (* /) < unary.
function parseTokens(toks, src) {
    let pos = 0;
    let depth = 0;
    const peek = () => toks[pos];
    const eof = () => [src.length, src.length];
    function expr(minBp) {
        let left = unary();
        while (pos < toks.length) {
            const t = toks[pos];
            if (t.t !== 'op' || (t.text !== '+' && t.text !== '-' && t.text !== '*' && t.text !== '/'))
                break;
            const bp = t.text === '+' || t.text === '-' ? 1 : 2;
            if (bp < minBp)
                break;
            pos++;
            const right = expr(bp + 1);
            left = { t: 'binary', op: t.text, l: left, r: right };
        }
        return left;
    }
    function unary() {
        const t = peek();
        if (t && t.t === 'op' && t.text === '-') {
            pos++;
            return { t: 'unary', op: '-', x: unary() };
        }
        if (t && t.t === 'op' && t.text === '+') {
            pos++;
            return unary();
        }
        return atom();
    }
    function atom() {
        if (++depth > MAX_DEPTH) {
            depth--;
            throw new ParseError('Expression is nested too deeply', [0, src.length]);
        }
        try {
            return atomInner();
        }
        finally {
            depth--;
        }
    }
    function atomInner() {
        const t = peek();
        if (!t)
            throw new ParseError('Unexpected end of expression', eof());
        if (t.t === 'num') {
            pos++;
            return { t: 'num', v: Number(t.text) };
        }
        if (t.t === 'lparen') {
            pos++;
            const inner = expr(1);
            const close = peek();
            if (!close || close.t !== 'rparen')
                throw new ParseError('Unbalanced bracket — this group is never closed', [t.start, t.start + 1]);
            pos++;
            return inner;
        }
        if (t.t === 'ident') {
            pos++;
            const next = peek();
            if (next && next.t === 'lparen') {
                pos++;
                const args = [];
                if (peek() && peek().t !== 'rparen') {
                    args.push(expr(1));
                    while (peek() && peek().t === 'comma') {
                        pos++;
                        args.push(expr(1));
                    }
                }
                const close = peek();
                if (!close || close.t !== 'rparen')
                    throw new ParseError(`Unbalanced bracket — ${t.text}( is never closed`, [next.start, next.start + 1]);
                pos++;
                return { t: 'call', name: t.text, args, span: [t.start, t.start + t.text.length] };
            }
            return { t: 'ident', name: t.text, span: [t.start, t.start + t.text.length] };
        }
        throw new ParseError(`Unexpected "${t.text}"`, [t.start, t.start + t.text.length]);
    }
    if (toks.length === 0)
        throw new ParseError('Expression is empty', [0, 0]);
    const node = expr(1);
    if (pos < toks.length) {
        const t = toks[pos];
        throw new ParseError(`Unexpected "${t.text}"`, [t.start, t.start + t.text.length]);
    }
    return node;
}
export function parse(src) {
    try {
        return { ast: parseTokens(tokenize(src), src), error: null };
    }
    catch (e) {
        if (e instanceof ParseError)
            return { ast: null, error: { message: e.message, span: e.span, suggestion: e.suggestion } };
        // Backstop for a stack overflow the depth cap somehow missed — a clean error,
        // never an uncaught RangeError bubbling out to a 500.
        if (e instanceof RangeError)
            return { ast: null, error: { message: 'Expression is nested too deeply', span: [0, src.length] } };
        throw e;
    }
}
function levenshtein(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++)
        d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    return d[a.length][b.length];
}
function nearestKey(name, keys) {
    let best, bestD = Infinity;
    for (const k of keys) {
        const dd = levenshtein(name, k);
        if (dd < bestD) {
            bestD = dd;
            best = k;
        }
    }
    return bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}
function walk(n, fn) {
    fn(n);
    if (n.t === 'unary')
        walk(n.x, fn);
    else if (n.t === 'binary') {
        walk(n.l, fn);
        walk(n.r, fn);
    }
    else if (n.t === 'call')
        n.args.forEach(a => walk(a, fn));
}
// A bare ident is one not enclosed by any aggregate call — only aggregate args may
// reference per-answer keys in a per-run expression.
function identsOutsideAggregates(n, insideAgg, out) {
    if (n.t === 'ident' && !insideAgg)
        out.push(n);
    else if (n.t === 'unary')
        identsOutsideAggregates(n.x, insideAgg, out);
    else if (n.t === 'binary') {
        identsOutsideAggregates(n.l, insideAgg, out);
        identsOutsideAggregates(n.r, insideAgg, out);
    }
    else if (n.t === 'call') {
        const agg = AGG_SET.has(n.name);
        n.args.forEach(a => identsOutsideAggregates(a, insideAgg || agg, out));
    }
}
export function validate(src, knownKeys, scope) {
    const { ast, error } = parse(src);
    if (!ast)
        return { ok: false, error: error ?? undefined, refs: [], usesAggregate: false };
    const refs = new Set();
    let usesAggregate = false;
    let fail;
    walk(ast, n => {
        if (fail)
            return;
        if (n.t === 'ident') {
            if (!knownKeys.includes(n.name))
                fail = { message: `No metric named ${n.name}`, span: n.span, suggestion: nearestKey(n.name, knownKeys) };
            else
                refs.add(n.name);
        }
        else if (n.t === 'call') {
            const arity = FUNC_ARITY[n.name];
            if (!arity)
                fail = { message: `Unknown function ${n.name}(`, span: n.span, suggestion: nearestKey(n.name, [...AGGREGATES, ...SCALAR_FUNCTIONS]) };
            else if (n.args.length < arity[0] || n.args.length > arity[1])
                fail = { message: `${n.name}() takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]}–${arity[1]}`} argument(s)`, span: n.span };
            else if (AGG_SET.has(n.name))
                usesAggregate = true;
        }
    });
    if (fail)
        return { ok: false, error: fail, refs: [...refs], usesAggregate };
    if (usesAggregate && scope === 'answer') {
        return { ok: false, error: { message: 'Aggregates are only available in a per-run metric', span: [0, src.length] }, refs: [...refs], usesAggregate };
    }
    if (usesAggregate && scope === 'run') {
        const bare = [];
        identsOutsideAggregates(ast, false, bare);
        if (bare.length) {
            const b = bare[0];
            return { ok: false, error: { message: `In a per-run metric with aggregates, ${b.name} must sit inside an aggregate like mean(${b.name})`, span: b.span }, refs: [...refs], usesAggregate };
        }
    }
    // An aggregate's argument is evaluated per-answer, where aggregates are illegal —
    // so a nested aggregate (mean(max(x))) would sail past the checks above yet always
    // evaluate to null. Reject it explicitly.
    let nested;
    const scanNested = (n, insideAgg) => {
        if (n.t === 'call') {
            const agg = AGG_SET.has(n.name);
            if (agg && insideAgg && !nested)
                nested = n;
            n.args.forEach(a => scanNested(a, insideAgg || agg));
        }
        else if (n.t === 'unary')
            scanNested(n.x, insideAgg);
        else if (n.t === 'binary') {
            scanNested(n.l, insideAgg);
            scanNested(n.r, insideAgg);
        }
    };
    scanNested(ast, false);
    if (nested)
        return { ok: false, error: { message: `Aggregates can't be nested — ${nested.name}( sits inside another aggregate`, span: nested.span }, refs: [...refs], usesAggregate };
    return { ok: true, refs: [...refs], usesAggregate };
}
// Per-answer evaluation. Null propagates; division by zero is null. Aggregate calls
// must not appear here (validation forbids them in answer scope).
export function evaluate(ast, scope) {
    switch (ast.t) {
        case 'num': return fin(ast.v);
        case 'ident': return scope[ast.name] ?? null;
        case 'unary': {
            const x = evaluate(ast.x, scope);
            return x == null ? null : fin(-x);
        }
        case 'binary': {
            const l = evaluate(ast.l, scope), r = evaluate(ast.r, scope);
            if (l == null || r == null)
                return null;
            if (ast.op === '+')
                return fin(l + r);
            if (ast.op === '-')
                return fin(l - r);
            if (ast.op === '*')
                return fin(l * r);
            return r === 0 ? null : fin(l / r);
        }
        case 'call': return applyScalar(ast, ast.args.map(a => evaluate(a, scope)));
    }
}
function applyScalar(node, args) {
    if (args.some(a => a == null))
        return null;
    const a = args;
    switch (node.name) {
        case 'abs': return fin(Math.abs(a[0]));
        case 'round': return a.length === 2 ? fin(Math.round(a[0] * 10 ** a[1]) / 10 ** a[1]) : fin(Math.round(a[0]));
        case 'clamp': return fin(Math.min(Math.max(a[0], a[1]), a[2]));
        default: return null; // aggregates handled in evaluateRun
    }
}
export function aggregate(name, values) {
    const finite = values.filter(v => Number.isFinite(v));
    if (finite.length === 0)
        return null;
    const s = [...finite].sort((x, y) => x - y);
    values = finite;
    const pct = (p) => s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)];
    switch (name) {
        case 'sum': return fin(values.reduce((x, y) => x + y, 0));
        case 'mean': return fin(values.reduce((x, y) => x + y, 0) / values.length);
        case 'min': return s[0];
        case 'max': return s[s.length - 1];
        case 'median':
        case 'p50': return pct(50);
        case 'p95': return pct(95);
        default: return null;
    }
}
// Per-run evaluation over the run's answer scopes. An expression with aggregate
// calls collapses each aggregate's inner expression across answers; an expression
// without aggregates is wrapped by the metric's scope-level aggregate.
export function evaluateRun(ast, series, scopeAggregate) {
    let hasAgg = false;
    walk(ast, n => { if (n.t === 'call' && AGG_SET.has(n.name))
        hasAgg = true; });
    if (!hasAgg) {
        return aggregate(scopeAggregate, series.map(s => evaluate(ast, s)).filter((v) => v != null));
    }
    return evalRunNode(ast, series);
}
function evalRunNode(ast, series) {
    switch (ast.t) {
        case 'num': return ast.v;
        case 'ident': return null; // guarded by validation (must be inside an aggregate)
        case 'unary': {
            const x = evalRunNode(ast.x, series);
            return x == null ? null : fin(-x);
        }
        case 'binary': {
            const l = evalRunNode(ast.l, series), r = evalRunNode(ast.r, series);
            if (l == null || r == null)
                return null;
            if (ast.op === '+')
                return fin(l + r);
            if (ast.op === '-')
                return fin(l - r);
            if (ast.op === '*')
                return fin(l * r);
            return r === 0 ? null : fin(l / r);
        }
        case 'call':
            if (AGG_SET.has(ast.name)) {
                return aggregate(ast.name, series.map(s => evaluate(ast.args[0], s)).filter((v) => v != null));
            }
            return applyScalar(ast, ast.args.map(a => evalRunNode(a, series)));
    }
}
