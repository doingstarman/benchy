import { getDb } from '../db/index.js';
import { getDisabledMetrics, setBuiltinMetricEnabled, getProviders } from '../config.js';
import { isLocalRequest } from './csrf.js';
import { builtinDefs, BUILTIN_KEYS, RESOLVABLE_BUILTIN_KEYS, isBuiltinKey } from '../metrics/builtins.js';
import { validate, parse, evaluate } from '../metrics/expr.js';
import { resolveBuiltins, topoSortCustoms, evaluateAnswerCustoms, evaluateRunCustom, } from '../metrics/resolve.js';
const KEY_RE = /^[a-z][a-z0-9_]*$/;
const FORMATS = new Set(['raw', 'ms', 's', 'tokens', 'usd', 'pct']);
const DIRECTIONS = new Set(['lower', 'higher', 'neutral']);
const SCOPES = new Set(['answer', 'run']);
const AGGREGATES = new Set(['mean', 'median', 'p50', 'p95', 'min', 'max', 'sum']);
const PREVIEW_SAMPLE = 5;
const MATERIALIZE_RECENT_RUNS = 50;
function rowToCustom(r) {
    return {
        key: r.key, name: r.name, expression: r.expression, unit: r.unit,
        format: r.format, direction: r.direction,
        scope: r.scope, aggregate: r.aggregate ?? null,
        nullable: r.nullable === 1, enabled: r.enabled === 1, sortOrder: r.sort_order,
        createdAt: r.created_at, updatedAt: r.updated_at,
    };
}
function loadCustoms(db) {
    return db.prepare('SELECT * FROM metrics ORDER BY sort_order, created_at').all().map(rowToCustom);
}
function customToDef(c) {
    return {
        key: c.key, name: c.name, kind: 'custom', expression: c.expression, unit: c.unit,
        format: c.format, direction: c.direction, scope: c.scope, aggregate: c.aggregate,
        nullable: c.nullable, enabled: c.enabled,
    };
}
// Validate a create/update body; returns the normalized fields or an error message.
function validateBody(db, body, key, isCreate) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name)
        return { error: 'name is required' };
    const expression = typeof body.expression === 'string' ? body.expression.trim() : '';
    if (!expression)
        return { error: 'expression is required' };
    const format = (body.format ?? 'raw');
    if (!FORMATS.has(format))
        return { error: 'invalid format' };
    const direction = (body.direction ?? 'neutral');
    if (!DIRECTIONS.has(direction))
        return { error: 'invalid direction' };
    const scope = (body.scope ?? 'answer');
    if (!SCOPES.has(scope))
        return { error: 'invalid scope' };
    let aggregate = null;
    if (scope === 'run') {
        aggregate = (body.aggregate ?? 'mean');
        if (!AGGREGATES.has(aggregate))
            return { error: 'invalid aggregate' };
    }
    const unit = typeof body.unit === 'string' && body.unit.trim() ? body.unit.trim() : null;
    const others = loadCustoms(db).filter(c => c.key !== key);
    const known = [...BUILTIN_KEYS, ...others.map(c => c.key), key];
    const v = validate(expression, known, scope);
    if (!v.ok)
        return { error: v.error?.message ?? 'invalid expression' };
    // A custom may only reference keys that have a per-answer value: the resolvable
    // built-ins (not elo) and per-answer customs. A ref to elo or another per-run
    // custom would pass validate() as "known" yet always evaluate to null.
    const referenceable = new Set([...RESOLVABLE_BUILTIN_KEYS, ...others.filter(c => c.scope === 'answer').map(c => c.key)]);
    const badRef = v.refs.find(r => r !== key && !referenceable.has(r));
    if (badRef)
        return { error: `${badRef} has no per-answer value and can't be used in an expression (elo and per-run metrics are excluded)` };
    const candidate = {
        key, name, expression, unit, format, direction, scope, aggregate,
        nullable: body.nullable === false ? false : true, enabled: body.enabled === false ? false : true,
        sortOrder: 0, createdAt: 0, updatedAt: 0,
    };
    try {
        topoSortCustoms([...others, candidate]);
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : 'reference cycle' };
    }
    const { createdAt: _a, updatedAt: _b, sortOrder: _c, ...fields } = candidate;
    return { fields };
}
async function loadProviderPricing() {
    const providers = await getProviders().catch(() => []);
    return new Map(providers.map(p => [p.id, p.pricing]));
}
const RES_COLS = 'id, model, provider_id, text, ttfs, total_time, input_tokens, output_tokens, reasoning_tokens, reasoning_ms, score';
function toInput(r, pricing) {
    return {
        ttfs: r.ttfs, totalTime: r.total_time, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
        reasoningTokens: r.reasoning_tokens, reasoningMs: r.reasoning_ms, score: r.score,
        model: r.model, pricingOverrides: pricing.get(r.provider_id),
    };
}
// Recompute + store every enabled custom metric's value for one run. Built-ins are
// never written. Safe to call repeatedly (clears the run's rows first).
export async function materializeRunMetrics(runId) {
    const db = getDb();
    const clear = () => db.prepare('DELETE FROM metric_values WHERE run_id = ? OR result_id IN (SELECT id FROM results WHERE run_id = ?)').run(runId, runId);
    const customs = loadCustoms(db).filter(c => c.enabled);
    if (customs.length === 0) {
        clear();
        return;
    }
    let ordered;
    try {
        ordered = topoSortCustoms(customs);
    }
    catch {
        clear();
        return;
    }
    const results = db.prepare(`SELECT ${RES_COLS} FROM results WHERE run_id = ? ORDER BY prompt_index`).all(runId);
    if (results.length === 0) {
        clear();
        return;
    }
    // Read pricing (async file read) BEFORE the write, so DELETE + INSERT run inside a
    // single synchronous better-sqlite3 transaction that no concurrent materialize can
    // interleave with. Previously the await split DELETE from INSERT, letting two
    // overlapping calls double-insert (metric_values has no unique constraint).
    const pricing = await loadProviderPricing();
    const now = Date.now();
    const insert = db.prepare('INSERT INTO metric_values (metric_key, result_id, run_id, value, created_at) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => {
        clear();
        const answerScopes = [];
        for (const r of results) {
            const builtinScope = resolveBuiltins(toInput(r, pricing));
            const customVals = evaluateAnswerCustoms(ordered, builtinScope);
            for (const c of ordered)
                if (c.scope === 'answer')
                    insert.run(c.key, r.id, null, customVals[c.key] ?? null, now);
            answerScopes.push({ ...builtinScope, ...customVals });
        }
        for (const c of ordered)
            if (c.scope === 'run')
                insert.run(c.key, null, runId, evaluateRunCustom(c, answerScopes), now);
    })();
}
async function materializeRecent() {
    const rows = getDb().prepare('SELECT id FROM runs ORDER BY created_at DESC LIMIT ?').all(MATERIALIZE_RECENT_RUNS);
    for (const r of rows)
        await materializeRunMetrics(r.id);
}
export async function registerMetricsRoutes(app) {
    app.get('/api/metrics', async (req) => {
        const { kind } = req.query;
        const disabled = await getDisabledMetrics();
        const defs = [...builtinDefs(disabled), ...loadCustoms(getDb()).map(customToDef)];
        return { data: kind ? defs.filter(d => d.kind === kind) : defs };
    });
    app.post('/api/metrics/validate', async (req) => {
        const body = (req.body ?? {});
        const scope = body.scope === 'run' ? 'run' : 'answer';
        const known = [...BUILTIN_KEYS, ...loadCustoms(getDb()).map(c => c.key)];
        return { data: validate(typeof body.expression === 'string' ? body.expression : '', known, scope) };
    });
    app.post('/api/metrics/preview', async (req) => {
        const body = (req.body ?? {});
        const scope = body.scope === 'run' ? 'run' : 'answer';
        const expression = typeof body.expression === 'string' ? body.expression.trim() : '';
        const known = [...BUILTIN_KEYS, ...loadCustoms(getDb()).map(c => c.key)];
        const v = validate(expression, known, scope);
        if (!v.ok)
            return { data: { ok: false, error: v.error, rows: [], coverage: { have: 0, total: 0 } } };
        const results = getDb().prepare(`SELECT ${RES_COLS} FROM results WHERE text != '' ORDER BY created_at DESC LIMIT ?`).all(PREVIEW_SAMPLE);
        const pricing = await loadProviderPricing();
        const customs = loadCustoms(getDb()).filter(c => c.enabled);
        let ordered;
        try {
            ordered = topoSortCustoms(customs);
        }
        catch {
            ordered = [];
        }
        const rows = results.map(r => {
            const builtinScope = resolveBuiltins(toInput(r, pricing));
            const fullScope = { ...builtinScope, ...evaluateAnswerCustoms(ordered, builtinScope) };
            const single = evaluateRunCustom({ key: '__preview', name: '', expression, unit: null, format: 'raw', direction: 'neutral', scope, aggregate: body.aggregate ?? 'mean', nullable: true, enabled: true, sortOrder: 0, createdAt: 0, updatedAt: 0 }, [fullScope]);
            const value = scope === 'run' ? single : evalOne(expression, fullScope);
            const nullRef = v.refs.find(k => fullScope[k] == null);
            return {
                item: `${r.model.split(':').slice(1).join(':') || r.model} · ${r.text.replace(/\s+/g, ' ').slice(0, 40)}`,
                inputs: v.refs.map(k => `${k}=${fullScope[k] ?? '—'}`).join(' '),
                value,
                note: value != null ? 'ok' : nullRef ? `no ${nullRef}` : 'no value',
            };
        });
        const have = rows.filter(r => r.value != null).length;
        return { data: { ok: true, rows, coverage: { have, total: rows.length } } };
    });
    app.get('/api/metrics/:key', async (req, reply) => {
        const { key } = req.params;
        if (isBuiltinKey(key)) {
            const disabled = await getDisabledMetrics();
            return { data: builtinDefs(disabled).find(d => d.key === key) };
        }
        const row = getDb().prepare('SELECT * FROM metrics WHERE key = ?').get(key);
        if (!row)
            return reply.code(404).send({ error: 'Metric not found' });
        return { data: customToDef(rowToCustom(row)) };
    });
    app.post('/api/metrics', async (req, reply) => {
        if (!isLocalRequest(req))
            return reply.code(403).send({ error: 'cross-site request refused' });
        const body = (req.body ?? {});
        const key = typeof body.key === 'string' ? body.key.trim() : '';
        if (!KEY_RE.test(key))
            return reply.code(400).send({ error: 'key must match ^[a-z][a-z0-9_]*$' });
        if (isBuiltinKey(key))
            return reply.code(400).send({ error: `${key} is a built-in metric` });
        const db = getDb();
        if (db.prepare('SELECT 1 FROM metrics WHERE key = ?').get(key))
            return reply.code(400).send({ error: 'a metric with that key already exists' });
        const v = validateBody(db, body, key, true);
        if ('error' in v)
            return reply.code(400).send({ error: v.error });
        const now = Date.now();
        const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM metrics').get().m;
        db.prepare('INSERT INTO metrics (key, name, expression, unit, format, direction, scope, aggregate, nullable, enabled, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(key, v.fields.name, v.fields.expression, v.fields.unit, v.fields.format, v.fields.direction, v.fields.scope, v.fields.aggregate, v.fields.nullable ? 1 : 0, v.fields.enabled ? 1 : 0, maxOrder + 1, now, now);
        void materializeRecent().catch(() => { });
        return reply.code(201).send({ data: customToDef(rowToCustom(db.prepare('SELECT * FROM metrics WHERE key = ?').get(key))) });
    });
    app.patch('/api/metrics/:key', async (req, reply) => {
        if (!isLocalRequest(req))
            return reply.code(403).send({ error: 'cross-site request refused' });
        const { key } = req.params;
        const body = (req.body ?? {});
        if (isBuiltinKey(key)) {
            // Only enable/disable is allowed on a built-in — its definition is code.
            const onlyEnabled = Object.keys(body).every(k => k === 'enabled');
            if (!onlyEnabled || typeof body.enabled !== 'boolean') {
                return reply.code(400).send({ error: 'a built-in metric can only be enabled or disabled' });
            }
            await setBuiltinMetricEnabled(key, body.enabled);
            const disabled = await getDisabledMetrics();
            return { data: builtinDefs(disabled).find(d => d.key === key) };
        }
        const db = getDb();
        const existing = db.prepare('SELECT * FROM metrics WHERE key = ?').get(key);
        if (!existing)
            return reply.code(404).send({ error: 'Metric not found' });
        const merged = { ...rowToCustom(existing), ...body };
        const v = validateBody(db, merged, key, false);
        if ('error' in v)
            return reply.code(400).send({ error: v.error });
        db.prepare('UPDATE metrics SET name = ?, expression = ?, unit = ?, format = ?, direction = ?, scope = ?, aggregate = ?, nullable = ?, enabled = ?, updated_at = ? WHERE key = ?')
            .run(v.fields.name, v.fields.expression, v.fields.unit, v.fields.format, v.fields.direction, v.fields.scope, v.fields.aggregate, v.fields.nullable ? 1 : 0, v.fields.enabled ? 1 : 0, Date.now(), key);
        void materializeRecent().catch(() => { });
        return { data: customToDef(rowToCustom(db.prepare('SELECT * FROM metrics WHERE key = ?').get(key))) };
    });
    app.delete('/api/metrics/:key', async (req, reply) => {
        if (!isLocalRequest(req))
            return reply.code(403).send({ error: 'cross-site request refused' });
        const { key } = req.params;
        if (isBuiltinKey(key))
            return reply.code(400).send({ error: `${key} is a built-in metric and cannot be deleted` });
        const db = getDb();
        if (!db.prepare('SELECT 1 FROM metrics WHERE key = ?').get(key))
            return reply.code(404).send({ error: 'Metric not found' });
        // A custom metric's materialized values are meaningless without its definition,
        // so they go with it (unlike results, which outlive a deleted target).
        db.prepare('DELETE FROM metric_values WHERE metric_key = ?').run(key);
        db.prepare('DELETE FROM metrics WHERE key = ?').run(key);
        return reply.code(204).send();
    });
}
// One-off per-answer evaluation for the preview (answer scope path).
function evalOne(expression, scope) {
    const { ast } = parse(expression);
    return ast ? evaluate(ast, scope) : null;
}
