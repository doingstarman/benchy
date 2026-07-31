import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { getProviders } from '../config.js';
import { runCell, finalizeRun } from './benchmark.js';
import { getAttachmentRow, bindAttachmentToDataset, cloneAttachmentOnto, deleteAttachment, deleteAttachmentsForDataset, } from './uploads.js';
import { scoreResult } from '../scoring.js';
const VAR_TYPES = ['text', 'date', 'number'];
const KEY_RE = /^[a-z0-9_]+$/;
function parseSchema(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.flatMap(v => {
            if (!v || typeof v !== 'object')
                return [];
            const o = v;
            if (typeof o.key !== 'string' || !VAR_TYPES.includes(o.type))
                return [];
            return [{ key: o.key, type: o.type, ...(typeof o.desc === 'string' ? { desc: o.desc } : {}) }];
        });
    }
    catch {
        return [];
    }
}
// Validate a schema from the request boundary. Keys are the JSON keys the model
// must return, so they carry the same shape as tool/function argument names.
function validateSchema(input) {
    if (!Array.isArray(input))
        throw badRequest('schema must be an array');
    const seen = new Set();
    return input.map(v => {
        if (!v || typeof v !== 'object')
            throw badRequest('each schema variable must be an object');
        const o = v;
        if (typeof o.key !== 'string' || !KEY_RE.test(o.key)) {
            throw badRequest(`variable key "${String(o.key)}" must match ^[a-z0-9_]+$`);
        }
        if (seen.has(o.key))
            throw badRequest(`duplicate variable key "${o.key}"`);
        seen.add(o.key);
        if (!VAR_TYPES.includes(o.type)) {
            throw badRequest(`variable "${o.key}" has invalid type — use one of ${VAR_TYPES.join(', ')}`);
        }
        return { key: o.key, type: o.type, ...(typeof o.desc === 'string' && o.desc.trim() ? { desc: o.desc.trim() } : {}) };
    });
}
function badRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}
// An attachment is 1:1 with a dataset item. Reject binding one that another item
// already owns — otherwise deleting that item unlinks a file this item still
// points at (a shared attachment_id yanks the file out from under its sibling).
function attachmentTaken(datasetId, attachmentId, exceptItemId) {
    const row = getDb().prepare('SELECT 1 FROM dataset_items WHERE dataset_id = ? AND attachment_id = ? AND id != ?').get(datasetId, attachmentId, exceptItemId ?? '');
    return row !== undefined;
}
function toGroundTruth(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return {};
    const out = {};
    for (const [k, v] of Object.entries(input)) {
        if (v != null)
            out[k] = String(v);
    }
    return out;
}
function attachmentMeta(id) {
    const row = getAttachmentRow(id);
    return row ? { id: row.id, name: row.name, mimeType: row.mime_type, size: row.size } : null;
}
function rowToItem(row) {
    return {
        id: row.id,
        idx: row.idx,
        attachmentId: row.attachment_id,
        attachment: row.attachment_id ? attachmentMeta(row.attachment_id) : null,
        groundTruth: (() => { try {
            return toGroundTruth(JSON.parse(row.ground_truth));
        }
        catch {
            return {};
        } })(),
        createdAt: row.created_at,
    };
}
function loadItems(datasetId) {
    const rows = getDb().prepare('SELECT * FROM dataset_items WHERE dataset_id = ? ORDER BY idx, created_at')
        .all(datasetId);
    return rows.map(rowToItem);
}
// A dataset item is "labeled" when every schema variable has a non-empty ground
// truth — that's the 46/50 the list shows.
function isLabeled(item, schema) {
    return schema.length > 0 && schema.every(v => {
        const t = item.groundTruth[v.key];
        return t != null && String(t).trim() !== '';
    });
}
function rowToDataset(row, opts = {}) {
    const schema = parseSchema(row.schema);
    const items = opts.items ?? loadItems(row.id);
    return {
        id: row.id,
        name: row.name,
        note: row.note,
        type: 'files',
        schema,
        trustedModel: row.trusted_model,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        itemCount: items.length,
        labeledCount: items.filter(i => isLabeled(i, schema)).length,
        ...(opts.withItems ? { items } : {}),
    };
}
function getDatasetRow(id) {
    return getDb().prepare('SELECT * FROM datasets WHERE id = ?').get(id);
}
// The prompt sent for every item. For file datasets the item IS the file, so the
// prompt is constant; we append the schema keys so the model returns a JSON
// object the scorer can read.
function buildRunPrompt(prompt, schema) {
    const keys = schema.map(v => v.key);
    if (!keys.length)
        return prompt.trim();
    return `${prompt.trim()}\n\nReturn a JSON object with exactly these keys: ${keys.join(', ')}. Use null when a value is absent.`;
}
// Score every result of a finished dataset run against the item snapshot taken
// when the run started (prompt_index === item position). Writes score columns so
// the results endpoint carries them.
function scoreDatasetRun(runId, schema, items) {
    const db = getDb();
    const results = db.prepare('SELECT id, prompt_index, text FROM results WHERE run_id = ?')
        .all(runId);
    const upd = db.prepare('UPDATE results SET score = ?, score_detail = ? WHERE id = ?');
    for (const r of results) {
        const item = items[r.prompt_index];
        if (!item)
            continue;
        const { score, detail } = scoreResult(schema, item.groundTruth, r.text);
        upd.run(score, JSON.stringify(detail), r.id);
    }
}
export async function registerDatasetsRoutes(app) {
    app.get('/api/datasets', async () => {
        const rows = getDb().prepare('SELECT * FROM datasets ORDER BY updated_at DESC').all();
        return { data: rows.map(row => rowToDataset(row)) };
    });
    app.get('/api/datasets/:id', async (req, reply) => {
        const row = getDatasetRow(req.params.id);
        if (!row)
            return reply.code(404).send({ error: 'Dataset not found' });
        return { data: rowToDataset(row, { withItems: true }) };
    });
    app.post('/api/datasets', async (req, reply) => {
        const name = req.body.name?.trim();
        if (!name)
            return reply.code(400).send({ error: 'name is required' });
        const schema = req.body.schema === undefined ? [] : validateSchema(req.body.schema);
        const id = randomUUID();
        const now = Date.now();
        getDb().prepare('INSERT INTO datasets (id, name, note, type, schema, trusted_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, name, req.body.note?.trim() || null, 'files', JSON.stringify(schema), null, now, now);
        return reply.code(201).send({ data: rowToDataset(getDatasetRow(id), { withItems: true }) });
    });
    app.patch('/api/datasets/:id', async (req, reply) => {
        const db = getDb();
        const row = getDatasetRow(req.params.id);
        if (!row)
            return reply.code(404).send({ error: 'Dataset not found' });
        const { name, note, schema, trustedModel } = req.body;
        if (name !== undefined) {
            const trimmed = name.trim();
            if (!trimmed)
                return reply.code(400).send({ error: 'name cannot be empty' });
            db.prepare('UPDATE datasets SET name = ? WHERE id = ?').run(trimmed, req.params.id);
        }
        if (note !== undefined) {
            db.prepare('UPDATE datasets SET note = ? WHERE id = ?').run(typeof note === 'string' && note.trim() ? note.trim() : null, req.params.id);
        }
        if (schema !== undefined) {
            db.prepare('UPDATE datasets SET schema = ? WHERE id = ?').run(JSON.stringify(validateSchema(schema)), req.params.id);
        }
        if (trustedModel !== undefined) {
            const tm = typeof trustedModel === 'string' && trustedModel.trim() ? trustedModel.trim() : null;
            db.prepare('UPDATE datasets SET trusted_model = ? WHERE id = ?').run(tm, req.params.id);
        }
        db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id);
        return { data: rowToDataset(getDatasetRow(req.params.id), { withItems: true }) };
    });
    app.delete('/api/datasets/:id', async (req, reply) => {
        const db = getDb();
        // Item rows cascade via FK; their files/attachment rows have no FK, so remove
        // them explicitly before the dataset row is gone.
        await deleteAttachmentsForDataset(req.params.id);
        db.prepare('DELETE FROM datasets WHERE id = ?').run(req.params.id);
        return reply.code(204).send();
    });
    app.post('/api/datasets/:id/items', async (req, reply) => {
        const db = getDb();
        const dataset = getDatasetRow(req.params.id);
        if (!dataset)
            return reply.code(404).send({ error: 'Dataset not found' });
        const { attachmentId } = req.body;
        if (attachmentId !== undefined) {
            const att = getAttachmentRow(attachmentId);
            if (!att)
                return reply.code(400).send({ error: 'attachmentId does not exist' });
            if (att.run_id)
                return reply.code(400).send({ error: 'attachment is already bound to a run' });
            if (att.dataset_id && att.dataset_id !== req.params.id) {
                return reply.code(400).send({ error: 'attachment already belongs to another dataset' });
            }
            if (attachmentTaken(req.params.id, attachmentId)) {
                return reply.code(400).send({ error: 'attachment is already used by another item' });
            }
            bindAttachmentToDataset(attachmentId, req.params.id);
        }
        const nextIdx = db.prepare('SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM dataset_items WHERE dataset_id = ?')
            .get(req.params.id).n;
        const id = randomUUID();
        db.prepare('INSERT INTO dataset_items (id, dataset_id, idx, attachment_id, ground_truth, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.params.id, nextIdx, attachmentId ?? null, JSON.stringify(toGroundTruth(req.body.groundTruth)), Date.now());
        db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id);
        const itemRow = db.prepare('SELECT * FROM dataset_items WHERE id = ?').get(id);
        return reply.code(201).send({ data: rowToItem(itemRow) });
    });
    app.patch('/api/datasets/:id/items/:itemId', async (req, reply) => {
        const db = getDb();
        const item = db.prepare('SELECT * FROM dataset_items WHERE id = ? AND dataset_id = ?')
            .get(req.params.itemId, req.params.id);
        if (!item)
            return reply.code(404).send({ error: 'Dataset item not found' });
        if (req.body.attachmentId !== undefined) {
            const next = req.body.attachmentId;
            const att = getAttachmentRow(next);
            if (!att)
                return reply.code(400).send({ error: 'attachmentId does not exist' });
            if (att.run_id)
                return reply.code(400).send({ error: 'attachment is already bound to a run' });
            // Same guards as POST /items — a PATCH must not adopt another dataset's
            // file (deleting that dataset would then destroy this item's file) nor a
            // sibling item's file.
            if (att.dataset_id && att.dataset_id !== req.params.id) {
                return reply.code(400).send({ error: 'attachment already belongs to another dataset' });
            }
            if (attachmentTaken(req.params.id, next, req.params.itemId)) {
                return reply.code(400).send({ error: 'attachment is already used by another item' });
            }
            bindAttachmentToDataset(next, req.params.id);
            if (item.attachment_id && item.attachment_id !== next)
                await deleteAttachment(item.attachment_id);
            db.prepare('UPDATE dataset_items SET attachment_id = ? WHERE id = ?').run(next, req.params.itemId);
        }
        if (req.body.groundTruth !== undefined) {
            db.prepare('UPDATE dataset_items SET ground_truth = ? WHERE id = ?')
                .run(JSON.stringify(toGroundTruth(req.body.groundTruth)), req.params.itemId);
        }
        db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id);
        const updated = db.prepare('SELECT * FROM dataset_items WHERE id = ?').get(req.params.itemId);
        return { data: rowToItem(updated) };
    });
    app.delete('/api/datasets/:id/items/:itemId', async (req, reply) => {
        const db = getDb();
        const item = db.prepare('SELECT * FROM dataset_items WHERE id = ? AND dataset_id = ?')
            .get(req.params.itemId, req.params.id);
        if (!item)
            return reply.code(404).send({ error: 'Dataset item not found' });
        if (item.attachment_id)
            await deleteAttachment(item.attachment_id);
        db.prepare('DELETE FROM dataset_items WHERE id = ?').run(req.params.itemId);
        db.prepare('UPDATE datasets SET updated_at = ? WHERE id = ?').run(Date.now(), req.params.id);
        return reply.code(204).send();
    });
    // Recent runs for this dataset, newest first — makes the results view survive a
    // reload (the run id isn't only held in the client).
    app.get('/api/datasets/:id/runs', async (req, reply) => {
        const db = getDb();
        if (!getDatasetRow(req.params.id))
            return reply.code(404).send({ error: 'Dataset not found' });
        const rows = db.prepare(`SELECT r.id, r.status, r.models, r.total_calls, r.completed_calls, r.created_at,
              (SELECT AVG(score) FROM results WHERE run_id = r.id AND score IS NOT NULL) AS avg_score
       FROM runs r WHERE r.dataset_id = ? ORDER BY r.created_at DESC LIMIT 20`).all(req.params.id);
        return {
            data: rows.map(r => ({
                id: r.id, status: r.status, models: JSON.parse(r.models),
                totalCalls: r.total_calls, completedCalls: r.completed_calls, createdAt: r.created_at, avgScore: r.avg_score,
            })),
        };
    });
    app.post('/api/datasets/:id/run', async (req, reply) => {
        const db = getDb();
        const row = getDatasetRow(req.params.id);
        if (!row)
            return reply.code(404).send({ error: 'Dataset not found' });
        const dataset = rowToDataset(row, { withItems: true });
        const items = dataset.items ?? [];
        if (!items.length)
            return reply.code(400).send({ error: 'dataset has no items to run' });
        const prompt = req.body.prompt?.trim();
        if (!prompt)
            return reply.code(400).send({ error: 'prompt is required' });
        // Trim + dedupe first: otherwise "p:A " (trailing space) slips past the
        // trusted-model exclusion below and lets the ground-truth author grade its
        // own work. trustedModel is stored trimmed (PATCH trims it).
        const requested = [...new Set((Array.isArray(req.body.models) ? req.body.models : [])
                .filter((m) => typeof m === 'string')
                .map(m => m.trim())
                .filter(m => m !== ''))];
        // The trusted model is excluded — it labeled (or will label) the ground
        // truth, so pitting it against the field would let it grade its own work.
        const models = requested.filter(m => m !== dataset.trustedModel);
        if (!models.length) {
            return reply.code(400).send({
                error: dataset.trustedModel && requested.includes(dataset.trustedModel)
                    ? 'no models to compare — the only model selected is the dataset\'s trusted model'
                    : 'select at least one model',
            });
        }
        const effectivePrompt = buildRunPrompt(prompt, dataset.schema);
        const systemPrompt = typeof req.body.systemPrompt === 'string' && req.body.systemPrompt.trim()
            ? req.body.systemPrompt.trim() : undefined;
        const runId = randomUUID();
        const now = Date.now();
        db.prepare('INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at, kind, system_prompt, dataset_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(runId, JSON.stringify(items.map(() => effectivePrompt)), JSON.stringify(models), 'running', 0, items.length * models.length, 0, now, 'batch', systemPrompt ?? null, req.params.id);
        // Each item's file rides along at its own prompt_index, so runCell's vision
        // path loads it exactly as a normal single-prompt attachment would.
        for (let pi = 0; pi < items.length; pi++) {
            const att = items[pi].attachmentId;
            if (att)
                await cloneAttachmentOnto(att, runId, pi);
        }
        const providers = await getProviders();
        const tasks = items.flatMap((_, pi) => models.map(m => runCell(runId, pi, effectivePrompt, m, providers, undefined, [], new Map(), [], systemPrompt)));
        // run_done must not fire until scores are written, or the client refetches
        // results before they carry a score. Fold scoring into the finalize barrier.
        const scored = Promise.allSettled(tasks).then(() => {
            try {
                scoreDatasetRun(runId, dataset.schema, items);
            }
            catch { /* leave rows unscored */ }
        });
        finalizeRun(runId, [scored]);
        return reply.code(202).send({ data: { runId } });
    });
}
