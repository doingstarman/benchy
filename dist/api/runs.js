import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { deleteAttachmentsForRun, deleteAttachmentsForRuns, cloneAttachmentsForRun } from './uploads.js';
import { isLocalRequest } from './csrf.js';
// Backslash-escape LIKE's own metacharacters so the query means what it says.
// Paired with ESCAPE '\' on the LIKE.
function escapeLike(value) {
    return value.replace(/[\\%_]/g, m => `\\${m}`);
}
function rowToRun(row) {
    const runSettings = row.run_settings
        ? JSON.parse(row.run_settings)
        : undefined;
    return {
        id: row.id,
        prompts: JSON.parse(row.prompts),
        models: JSON.parse(row.models),
        status: row.status,
        saved: row.saved === 1,
        totalCalls: row.total_calls,
        completedCalls: row.completed_calls,
        createdAt: row.created_at,
        // Older rows predate the column; the migration defaults them to 'chat'.
        kind: row.kind ?? 'chat',
        ...(runSettings ? { runSettings } : {}),
        ...(row.title != null ? { title: row.title } : {}),
        ...(row.tools ? { tools: parseTools(row.tools) } : {}),
        ...(row.system_prompt != null ? { systemPrompt: row.system_prompt } : {}),
        ...(row.skills ? { skills: parseTools(row.skills) } : {}),
        ...(row.mcp ? { mcp: parseTools(row.mcp) } : {}),
        ...(row.dataset_item_ids ? { datasetItemIds: JSON.parse(row.dataset_item_ids) } : {}),
        ...(row.base_prompt != null ? { basePrompt: row.base_prompt } : {}),
    };
}
function parseTools(raw) {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
    }
    catch {
        return [];
    }
}
function parseToolCalls(raw) {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function rowToResult(row) {
    const metrics = {
        ttfs: row.ttfs,
        totalTime: row.total_time,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        reasoningTokens: row.reasoning_tokens,
        reasoningMs: row.reasoning_ms,
    };
    return {
        id: row.id,
        runId: row.run_id,
        promptIndex: row.prompt_index,
        model: row.model,
        providerId: row.provider_id,
        text: row.text,
        reasoning: row.reasoning,
        toolCalls: parseToolCalls(row.tool_calls),
        metrics,
        feedback: row.feedback,
        error: row.error,
        createdAt: row.created_at,
        ...(row.score != null ? { score: row.score } : {}),
        ...(row.score_detail ? { scoreDetail: parseScoreDetail(row.score_detail) } : {}),
        ...(row.code_report ? { codeReport: parseCodeReport(row.code_report) } : {}),
    };
}
function parseCodeReport(raw) {
    try {
        const o = JSON.parse(raw);
        const cases = Array.isArray(o.cases)
            ? o.cases.flatMap(c => {
                const cc = c;
                if (typeof cc?.name !== 'string' || typeof cc.ok !== 'boolean')
                    return [];
                return [{ name: cc.name, ok: cc.ok, ...(typeof cc.err === 'string' ? { err: cc.err } : {}) }];
            })
            : [];
        return { cases, error: typeof o.error === 'string' ? o.error : null };
    }
    catch {
        return { cases: [], error: null };
    }
}
function parseScoreDetail(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        const out = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (v === 'match' || v === 'miss')
                out[k] = v;
        }
        return out;
    }
    catch {
        return {};
    }
}
export async function registerRunsRoutes(app) {
    app.get('/api/runs', async (req) => {
        const db = getDb();
        const { status, model, date, search, page = '1' } = req.query;
        const limit = 50;
        // A non-numeric page used to reach SQLite as NaN and 500 with "datatype
        // mismatch"; a zero/negative one silently meant page 1 anyway.
        const parsedPage = parseInt(page, 10);
        const offset = (Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1) - 1) * limit;
        let query = 'SELECT * FROM runs WHERE 1=1';
        const params = [];
        if (status === 'saved') {
            query += ' AND saved = 1';
        }
        else if (status === 'unsaved') {
            query += ' AND saved = 0';
        }
        // models is a JSON array, so a LIKE substring matched a filter for
        // "…:gpt-4o" against a run that only ever used "…:gpt-4o-mini". Compare
        // each element instead.
        if (model) {
            query += ' AND EXISTS (SELECT 1 FROM json_each(runs.models) WHERE json_each.value = ?)';
            params.push(model);
        }
        if (date === 'today') {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            query += ' AND created_at >= ?';
            params.push(start.getTime());
        }
        else if (date === 'week') {
            query += ' AND created_at >= ?';
            params.push(Date.now() - 7 * 24 * 60 * 60 * 1000);
        }
        // The search box is a search box, not a pattern language: % and _ are what
        // the user typed, not wildcards that quietly match everything.
        if (search) {
            query += " AND prompts LIKE ? ESCAPE '\\'";
            params.push(`%${escapeLike(search)}%`);
        }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const rows = db.prepare(query).all(...params);
        return { data: rows.map(rowToRun) };
    });
    app.get('/api/runs/:id', async (req, reply) => {
        const db = getDb();
        const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
        if (!run)
            return reply.code(404).send({ error: 'Run not found' });
        const results = db.prepare('SELECT * FROM results WHERE run_id = ? ORDER BY prompt_index, model')
            .all(req.params.id);
        const attachmentRows = db.prepare('SELECT id, prompt_index, mime_type, name, size FROM attachments WHERE run_id = ? ORDER BY created_at').all(req.params.id);
        const attachments = attachmentRows.map(a => ({
            id: a.id, promptIndex: a.prompt_index, mimeType: a.mime_type, name: a.name, size: a.size,
        }));
        return { data: { ...rowToRun(run), results: results.map(rowToResult), attachments } };
    });
    // Clear the whole history. CSRF-guarded even though the per-run delete below
    // is not, and the asymmetry is the point: /api/runs/:id needs an id an
    // attacker does not have, while this one needs nothing but the URL, so a
    // cross-site page could wipe someone's history with a single fetch.
    //
    // Datasets and their items survive — they are authored content, and only
    // their per-run verdicts belong to a run. Answering 200 with counts rather
    // than the 204 rules/api.md prescribes for DELETE, because the caller has to
    // be told how many went and that an in-flight run was kept.
    app.delete('/api/runs', async (req, reply) => {
        if (!isLocalRequest(req))
            return reply.code(403).send({ error: 'cross-site request refused' });
        const db = getDb();
        // A running run is skipped: its stream is still INSERTing result rows, and
        // the foreign key to a deleted run would throw inside the SSE handler.
        const doomed = db.prepare("SELECT id FROM runs WHERE status != 'running'").all();
        const total = db.prepare('SELECT count(*) AS n FROM runs').get().n;
        // results and dataset verdicts cascade; attachments have no foreign key at
        // all, so nothing removes them unless this line does — and their files
        // outlive the rows, leaking in the uploads dir with no way to find them
        // again. The ids are captured above, so this may sit either side of the
        // run delete; what it may not do is not happen.
        await deleteAttachmentsForRuns(doomed.map(r => r.id));
        const info = db.prepare("DELETE FROM runs WHERE status != 'running'").run();
        return { data: { deleted: info.changes, skipped: total - info.changes } };
    });
    app.delete('/api/runs/:id', async (req, reply) => {
        const db = getDb();
        // results cascade via FK; attachments have no FK (they exist before the
        // run when unbound) so their files + rows are removed explicitly.
        await deleteAttachmentsForRun(req.params.id);
        db.prepare('DELETE FROM runs WHERE id = ?').run(req.params.id);
        return reply.code(204).send();
    });
    app.post('/api/runs/:id/fork', async (req, reply) => {
        const db = getDb();
        const original = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
        if (!original)
            return reply.code(404).send({ error: 'Run not found' });
        const newId = randomUUID();
        db.prepare('INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at, kind, tools, system_prompt, skills, mcp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(newId, original.prompts, original.models, 'pending', 0, 0, 0, Date.now(), original.kind ?? 'chat', original.tools ?? null, original.system_prompt ?? null, original.skills ?? null, original.mcp ?? null);
        // Note: fork intentionally omits settings_overrides — forked runs use provider defaults
        // Attachments are copied (own files + rows) so the fork re-runs with the
        // same media instead of silently dropping it.
        await cloneAttachmentsForRun(req.params.id, newId);
        const newRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(newId);
        return reply.code(201).send({ data: rowToRun(newRun) });
    });
    app.patch('/api/runs/:id', async (req, reply) => {
        const db = getDb();
        const { saved, title, models } = req.body;
        // Dropping a model from the comparison. Only ever a narrowing: `models` is
        // also the historical record of what this run asked, so adding to it would
        // invent results that never happened.
        if (models !== undefined) {
            const current = db.prepare('SELECT models, kind FROM runs WHERE id = ?').get(req.params.id);
            if (!current)
                return reply.code(404).send({ error: 'Run not found' });
            // In a pairs run `models` is aligned index-for-index with `prompts` — it
            // is not a set, and removing an entry silently re-pairs every prompt after
            // it with the wrong model.
            if ((current.kind ?? 'chat') === 'pairs') {
                return reply.code(400).send({ error: 'Cannot change the model set of a pairs run — its models are paired to its prompts' });
            }
            const existing = new Set(JSON.parse(current.models));
            if (!Array.isArray(models) || models.length === 0) {
                return reply.code(400).send({ error: 'models must be a non-empty array' });
            }
            const unknown = models.filter(m => !existing.has(m));
            if (unknown.length > 0) {
                return reply.code(400).send({ error: `Cannot add models to an existing run: ${unknown.join(', ')}` });
            }
            db.prepare('UPDATE runs SET models = ? WHERE id = ?').run(JSON.stringify(models), req.params.id);
        }
        if (saved !== undefined) {
            db.prepare('UPDATE runs SET saved = ? WHERE id = ?').run(saved ? 1 : 0, req.params.id);
        }
        if (title !== undefined) {
            const trimmed = typeof title === 'string' ? title.trim() : null;
            db.prepare('UPDATE runs SET title = ? WHERE id = ?').run(trimmed || null, req.params.id);
        }
        const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
        if (!run)
            return reply.code(404).send({ error: 'Run not found' });
        return { data: rowToRun(run) };
    });
    app.patch('/api/runs/:id/results/:resultId/feedback', async (req, reply) => {
        const db = getDb();
        db.prepare('UPDATE results SET feedback = ? WHERE id = ? AND run_id = ?')
            .run(req.body.feedback, req.params.resultId, req.params.id);
        return reply.code(204).send();
    });
}
