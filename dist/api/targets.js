import { getDb } from '../db/index.js';
import { modelTargetId, parseTargetId, variantSlug } from '../targets.js';
import { isLocalRequest } from './csrf.js';
import { setSecret } from '../config.js';
import { handshakeAgent } from '../agentRun.js';
const KINDS = ['model', 'agent', 'pipeline'];
// SECURITY: the stored agent config carries only secret NAMES (secretRefs), never
// values, so returning it verbatim leaks nothing. This is the single choke point
// that hands target config to clients — keep it value-free.
function rowToTarget(row) {
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        config: (() => {
            try {
                return JSON.parse(row.config);
            }
            catch {
                return { providerId: '', model: '' };
            }
        })(),
        tags: (() => {
            try {
                const t = JSON.parse(row.tags);
                return Array.isArray(t) ? t : [];
            }
            catch {
                return [];
            }
        })(),
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
// Validate an agent config, persist any provided secret values under their names,
// and return the value-free config to store on the target row.
async function buildAgentConfig(input) {
    const transport = input.transport === 'http' ? 'http' : input.transport === 'command' ? 'command' : null;
    if (!transport)
        return { error: 'config.transport must be "command" or "http"' };
    if (transport === 'command' && !(typeof input.command === 'string' && input.command.trim())) {
        return { error: 'config.command is required for a command agent' };
    }
    if (transport === 'http' && !(typeof input.url === 'string' && input.url.trim())) {
        return { error: 'config.url is required for an http agent' };
    }
    const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : dflt);
    // Persist secret values under their names; collect the names into secretRefs.
    const refs = new Set(Array.isArray(input.secretRefs) ? input.secretRefs.filter(s => typeof s === 'string') : []);
    if (input.secrets && typeof input.secrets === 'object') {
        for (const [name, value] of Object.entries(input.secrets)) {
            if (typeof name !== 'string' || !name)
                continue;
            if (typeof value === 'string' && value) {
                await setSecret(name, value);
                refs.add(name);
            }
        }
    }
    const env = {};
    if (input.env && typeof input.env === 'object') {
        for (const [k, v] of Object.entries(input.env))
            if (typeof k === 'string' && typeof v === 'string')
                env[k] = v;
    }
    const config = {
        transport,
        ...(transport === 'command' ? { command: input.command.trim() } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(transport === 'http' ? { url: input.url.trim() } : {}),
        ...(input.authHeader ? { authHeader: input.authHeader } : {}),
        ...(Object.keys(env).length ? { env } : {}),
        ...(refs.size ? { secretRefs: [...refs] } : {}),
        timeoutMs: num(input.timeoutMs, 120_000),
        maxSteps: num(input.maxSteps, 40),
        ...(input.maxCostUsd != null ? { maxCostUsd: num(input.maxCostUsd, 0) } : {}),
        retries: num(input.retries, 0),
    };
    return { config };
}
// Find a free id: the plain base first, then `base#slug`, then `base#slug-2`, …
function uniqueId(base, slug) {
    const db = getDb();
    const taken = (id) => db.prepare('SELECT 1 FROM targets WHERE id = ?').get(id) !== undefined;
    if (!taken(base))
        return base;
    const stem = `${base}#${slug}`;
    if (!taken(stem))
        return stem;
    for (let n = 2;; n++) {
        const candidate = `${stem}-${n}`;
        if (!taken(candidate))
            return candidate;
    }
}
export async function registerTargetsRoutes(app) {
    app.get('/api/targets', async (req) => {
        const { kind } = req.query;
        const rows = (kind
            ? getDb().prepare('SELECT * FROM targets WHERE kind = ? ORDER BY created_at').all(kind)
            : getDb().prepare('SELECT * FROM targets ORDER BY created_at').all());
        return { data: rows.map(rowToTarget) };
    });
    app.get('/api/targets/:id', async (req, reply) => {
        const { id } = req.params;
        const row = getDb().prepare('SELECT * FROM targets WHERE id = ?').get(id);
        if (!row)
            return reply.code(404).send({ error: 'Target not found' });
        return { data: rowToTarget(row) };
    });
    app.post('/api/targets', async (req, reply) => {
        const body = (req.body ?? {});
        const kind = body.kind ?? 'model';
        if (!KINDS.includes(kind))
            return reply.code(400).send({ error: 'invalid kind' });
        if (kind === 'pipeline')
            return reply.code(400).send({ error: 'pipeline targets are not supported yet' });
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name)
            return reply.code(400).send({ error: 'name is required' });
        const tags = Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string') : [];
        const now = Date.now();
        let id;
        let cfg;
        if (kind === 'agent') {
            const built = await buildAgentConfig((body.config ?? {}));
            if ('error' in built)
                return reply.code(400).send({ error: built.error });
            cfg = built.config;
            id = uniqueId(`agent:${variantSlug(name)}`, variantSlug(name));
        }
        else {
            const config = body.config;
            if (!config || typeof config.providerId !== 'string' || !config.providerId ||
                typeof config.model !== 'string' || !config.model) {
                return reply.code(400).send({ error: 'config.providerId and config.model are required' });
            }
            cfg = {
                providerId: config.providerId,
                model: config.model,
                ...(config.defaults ? { defaults: config.defaults } : {}),
                ...(config.pricing ? { pricing: config.pricing } : {}),
            };
            id = uniqueId(modelTargetId(config.providerId, config.model), variantSlug(name));
        }
        getDb().prepare('INSERT INTO targets (id, kind, name, config, tags, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, kind, name, JSON.stringify(cfg), JSON.stringify(tags), body.enabled === false ? 0 : 1, now, now);
        const row = getDb().prepare('SELECT * FROM targets WHERE id = ?').get(id);
        return reply.code(201).send({ data: rowToTarget(row) });
    });
    app.patch('/api/targets/:id', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        if (!db.prepare('SELECT 1 FROM targets WHERE id = ?').get(id)) {
            return reply.code(404).send({ error: 'Target not found' });
        }
        const kind = db.prepare('SELECT kind FROM targets WHERE id = ?').get(id).kind;
        const body = (req.body ?? {});
        if (body.name !== undefined) {
            if (typeof body.name !== 'string' || !body.name.trim())
                return reply.code(400).send({ error: 'name must be a non-empty string' });
            db.prepare('UPDATE targets SET name = ? WHERE id = ?').run(body.name.trim(), id);
        }
        if (body.tags !== undefined) {
            if (!Array.isArray(body.tags))
                return reply.code(400).send({ error: 'tags must be an array' });
            db.prepare('UPDATE targets SET tags = ? WHERE id = ?').run(JSON.stringify(body.tags.filter(t => typeof t === 'string')), id);
        }
        if (body.enabled !== undefined) {
            db.prepare('UPDATE targets SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, id);
        }
        if (body.config !== undefined) {
            if (kind === 'agent') {
                const built = await buildAgentConfig((body.config ?? {}));
                if ('error' in built)
                    return reply.code(400).send({ error: built.error });
                db.prepare('UPDATE targets SET config = ? WHERE id = ?').run(JSON.stringify(built.config), id);
            }
            else {
                const c = body.config;
                if (!c || typeof c.providerId !== 'string' || !c.providerId || typeof c.model !== 'string' || !c.model) {
                    return reply.code(400).send({ error: 'config.providerId and config.model are required' });
                }
                db.prepare('UPDATE targets SET config = ? WHERE id = ?').run(JSON.stringify(c), id);
            }
        }
        db.prepare('UPDATE targets SET updated_at = ? WHERE id = ?').run(Date.now(), id);
        const row = db.prepare('SELECT * FROM targets WHERE id = ?').get(id);
        return { data: rowToTarget(row) };
    });
    app.post('/api/targets/:id/duplicate', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        const src = db.prepare('SELECT * FROM targets WHERE id = ?').get(id);
        if (!src)
            return reply.code(404).send({ error: 'Target not found' });
        const name = `${src.name} copy`;
        const base = src.kind === 'agent'
            ? `agent:${variantSlug(name)}`
            : (() => { const p = parseTargetId(id); return modelTargetId(p.providerId, p.model); })();
        const newId = uniqueId(base, variantSlug(name));
        const now = Date.now();
        db.prepare('INSERT INTO targets (id, kind, name, config, tags, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(newId, src.kind, name, src.config, src.tags, src.enabled, now, now);
        const row = db.prepare('SELECT * FROM targets WHERE id = ?').get(newId);
        return reply.code(201).send({ data: rowToTarget(row) });
    });
    app.delete('/api/targets/:id', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        if (!db.prepare('SELECT 1 FROM targets WHERE id = ?').get(id)) {
            return reply.code(404).send({ error: 'Target not found' });
        }
        // Deliberately NO cascade into results: a deleted target leaves its id string on
        // historical results, which the UI surfaces as an orphan. History is never
        // rewritten — the opposite of the ON DELETE CASCADE used for run-owned rows.
        db.prepare('DELETE FROM targets WHERE id = ?').run(id);
        return reply.code(204).send();
    });
    // Run an agent once on a trivial prompt and report on two axes: process (ran,
    // exit, wall) and structure (how many step events). Behind isLocalRequest — it
    // executes a user-specified command, so a cross-site page must never trigger it.
    app.post('/api/targets/:id/handshake', async (req, reply) => {
        if (!isLocalRequest(req))
            return reply.code(403).send({ error: 'cross-site request refused' });
        const { id } = req.params;
        const row = getDb().prepare('SELECT * FROM targets WHERE id = ?').get(id);
        if (!row)
            return reply.code(404).send({ error: 'Target not found' });
        if (row.kind !== 'agent')
            return reply.code(400).send({ error: 'handshake is only for agent targets' });
        const cfg = JSON.parse(row.config);
        const body = (req.body ?? {});
        const result = await handshakeAgent(cfg, id, body.prompt);
        return { data: result };
    });
}
