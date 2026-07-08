import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
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
        ...(runSettings ? { runSettings } : {}),
        ...(row.title != null ? { title: row.title } : {}),
    };
}
function rowToResult(row) {
    const metrics = {
        ttfs: row.ttfs,
        totalTime: row.total_time,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        reasoningTokens: row.reasoning_tokens,
    };
    return {
        id: row.id,
        runId: row.run_id,
        promptIndex: row.prompt_index,
        model: row.model,
        providerId: row.provider_id,
        text: row.text,
        metrics,
        feedback: row.feedback,
        error: row.error,
        createdAt: row.created_at,
    };
}
export async function registerRunsRoutes(app) {
    app.get('/api/runs', async (req) => {
        const db = getDb();
        const { status, model, date, search, page = '1' } = req.query;
        const limit = 50;
        const offset = (parseInt(page, 10) - 1) * limit;
        let query = 'SELECT * FROM runs WHERE 1=1';
        const params = [];
        if (status === 'saved') {
            query += ' AND saved = 1';
        }
        else if (status === 'unsaved') {
            query += ' AND saved = 0';
        }
        if (model) {
            query += ' AND models LIKE ?';
            params.push(`%${model}%`);
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
        if (search) {
            query += ' AND prompts LIKE ?';
            params.push(`%${search}%`);
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
        return { data: { ...rowToRun(run), results: results.map(rowToResult) } };
    });
    app.delete('/api/runs/:id', async (req, reply) => {
        const db = getDb();
        db.prepare('DELETE FROM runs WHERE id = ?').run(req.params.id);
        return reply.code(204).send();
    });
    app.post('/api/runs/:id/fork', async (req, reply) => {
        const db = getDb();
        const original = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
        if (!original)
            return reply.code(404).send({ error: 'Run not found' });
        const newId = randomUUID();
        db.prepare('INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(newId, original.prompts, original.models, 'pending', 0, 0, 0, Date.now());
        // Note: fork intentionally omits settings_overrides — forked runs use provider defaults
        const newRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(newId);
        return reply.code(201).send({ data: rowToRun(newRun) });
    });
    app.patch('/api/runs/:id', async (req, reply) => {
        const db = getDb();
        const { saved, title } = req.body;
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
