import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { getProviders, DEFAULT_PROVIDER_SETTINGS } from '../config.js';
import { openaiAdapter } from '../adapters/openai.js';
import { anthropicAdapter } from '../adapters/anthropic.js';
import { googleAdapter } from '../adapters/google.js';
import { httpJsonAdapter } from '../adapters/http-json.js';
import { scriptAdapter } from '../adapters/script.js';
import { webhookAdapter } from '../adapters/webhook.js';
export function getAdapter(type) {
    if (type === 'anthropic')
        return anthropicAdapter;
    if (type === 'google')
        return googleAdapter;
    if (type === 'http-json')
        return httpJsonAdapter;
    if (type === 'script')
        return scriptAdapter;
    if (type === 'webhook')
        return webhookAdapter;
    return openaiAdapter;
}
// In-memory SSE connections keyed by runId
const sseConnections = new Map();
function broadcast(runId, event, data) {
    const conns = sseConnections.get(runId);
    if (!conns)
        return;
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const reply of conns) {
        try {
            reply.raw.write(line);
        }
        catch { /* client disconnected */ }
    }
}
async function runCell(runId, promptIndex, promptText, modelKey, providers, runSettings, history = []) {
    const [providerId, ...modelParts] = modelKey.split(':');
    const model = modelParts.join(':');
    const provider = providers.find(p => p.id === providerId);
    if (!provider) {
        broadcast(runId, 'cell_error', { runId, promptIndex, model: modelKey, error: `Provider "${providerId}" not found` });
        return;
    }
    const db = getDb();
    const resultId = randomUUID();
    db.prepare('INSERT INTO results (id, run_id, prompt_index, model, provider_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(resultId, runId, promptIndex, modelKey, providerId, '', Date.now());
    broadcast(runId, 'cell_start', { runId, promptIndex, model: modelKey });
    const t0 = Date.now();
    let ttfs = null;
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens;
    try {
        const adapter = getAdapter(provider.type);
        const effectiveSettings = {
            ...DEFAULT_PROVIDER_SETTINGS,
            ...provider.defaults,
            ...(runSettings?.global ?? {}),
            ...(runSettings?.perModel?.[modelKey] ?? {}),
        };
        const stream = adapter.stream([...history, { role: 'user', content: promptText }], { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model, settings: effectiveSettings });
        for await (const chunk of stream) {
            if (chunk.type === 'token') {
                if (ttfs === null)
                    ttfs = Date.now() - t0;
                fullText += chunk.text;
                broadcast(runId, 'cell_token', { runId, promptIndex, model: modelKey, text: chunk.text });
            }
            else if (chunk.type === 'done') {
                inputTokens = chunk.usage.inputTokens;
                outputTokens = chunk.usage.outputTokens;
                reasoningTokens = chunk.usage.reasoningTokens;
            }
            else if (chunk.type === 'error') {
                throw new Error(chunk.message);
            }
        }
        const totalTime = Date.now() - t0;
        db.prepare('UPDATE results SET text = ?, ttfs = ?, total_time = ?, input_tokens = ?, output_tokens = ?, reasoning_tokens = ? WHERE id = ?').run(fullText, ttfs, totalTime, inputTokens, outputTokens, reasoningTokens ?? null, resultId);
        broadcast(runId, 'cell_done', {
            runId, promptIndex, model: modelKey,
            ttfs, totalTime,
            usage: { inputTokens, outputTokens, ...(reasoningTokens != null ? { reasoningTokens } : {}) },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        db.prepare('UPDATE results SET error = ? WHERE id = ?').run(msg, resultId);
        broadcast(runId, 'cell_error', { runId, promptIndex, model: modelKey, error: msg });
    }
    finally {
        db.prepare('UPDATE runs SET completed_calls = completed_calls + 1 WHERE id = ?').run(runId);
    }
}
function finalizeRun(runId, tasks) {
    const db = getDb();
    Promise.all(tasks)
        .then(() => {
        db.prepare("UPDATE runs SET status = 'done' WHERE id = ?").run(runId);
        broadcast(runId, 'run_done', { runId });
        sseConnections.delete(runId);
    })
        .catch(() => {
        db.prepare("UPDATE runs SET status = 'error' WHERE id = ?").run(runId);
        sseConnections.delete(runId);
    });
}
// Reconstructs one model's own conversation branch from prior turns —
// failed turns (error IS NOT NULL) are skipped entirely rather than
// injected as broken/empty assistant messages.
function buildHistory(runId, model, prompts) {
    const db = getDb();
    const rows = db.prepare('SELECT prompt_index, text FROM results WHERE run_id = ? AND model = ? AND error IS NULL ORDER BY prompt_index').all(runId, model);
    return rows.flatMap(row => [
        { role: 'user', content: prompts[row.prompt_index] },
        { role: 'assistant', content: row.text },
    ]);
}
export async function registerBenchmarkRoutes(app) {
    app.post('/api/benchmark', async (req, reply) => {
        const { prompts, models, pairs, runSettings } = req.body;
        if (!pairs?.length && (!prompts?.length || !models?.length)) {
            return reply.code(400).send({ error: 'provide pairs[] or prompts[]+models[]' });
        }
        const runId = randomUUID();
        const totalCalls = pairs ? pairs.length : prompts.length * models.length;
        const db = getDb();
        const storedPrompts = pairs ? pairs.map(p => p.prompt) : prompts;
        const storedModels = pairs ? pairs.map(p => p.model) : models;
        const hasSettings = runSettings && (Object.keys(runSettings.global ?? {}).length > 0 ||
            Object.keys(runSettings.perModel ?? {}).length > 0);
        const runSettingsJson = hasSettings ? JSON.stringify(runSettings) : null;
        db.prepare('INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at, run_settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(runId, JSON.stringify(storedPrompts), JSON.stringify(storedModels), 'running', 0, totalCalls, 0, Date.now(), runSettingsJson);
        // Fire and forget — SSE stream delivers results
        const providers = await getProviders();
        const tasks = pairs
            ? pairs.map(({ prompt, model }, pi) => runCell(runId, pi, prompt, model, providers, runSettings))
            : prompts.flatMap((prompt, pi) => models.map(model => runCell(runId, pi, prompt, model, providers, runSettings)));
        finalizeRun(runId, tasks);
        return reply.code(202).send({ data: { runId } });
    });
    app.post('/api/runs/:id/continue', async (req, reply) => {
        const { prompt, runSettings } = req.body;
        if (!prompt?.trim())
            return reply.code(400).send({ error: 'prompt is required' });
        const db = getDb();
        const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
        if (!run)
            return reply.code(404).send({ error: 'Run not found' });
        const prompts = JSON.parse(run.prompts);
        const models = JSON.parse(run.models);
        const newPromptIndex = prompts.length;
        const updatedPrompts = [...prompts, prompt];
        const effectiveRunSettings = runSettings ?? (run.run_settings ? JSON.parse(run.run_settings) : undefined);
        const runSettingsJson = effectiveRunSettings ? JSON.stringify(effectiveRunSettings) : run.run_settings;
        db.prepare("UPDATE runs SET prompts = ?, status = 'running', total_calls = total_calls + ?, run_settings = ? WHERE id = ?").run(JSON.stringify(updatedPrompts), models.length, runSettingsJson, req.params.id);
        const providers = await getProviders();
        const tasks = models.map(model => {
            const history = buildHistory(req.params.id, model, prompts);
            return runCell(req.params.id, newPromptIndex, prompt, model, providers, effectiveRunSettings, history);
        });
        finalizeRun(req.params.id, tasks);
        return reply.code(202).send({ data: { runId: req.params.id, promptIndex: newPromptIndex } });
    });
    // Edit a past user message — ChatGPT fork semantics: everything after the
    // edited turn is discarded and the turn re-runs with the new prompt.
    app.post('/api/runs/:id/edit-turn', async (req, reply) => {
        const { promptIndex, prompt } = req.body;
        if (!prompt?.trim())
            return reply.code(400).send({ error: 'prompt is required' });
        const db = getDb();
        const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
        if (!run)
            return reply.code(404).send({ error: 'Run not found' });
        const prompts = JSON.parse(run.prompts);
        const models = JSON.parse(run.models);
        if (!Number.isInteger(promptIndex) || promptIndex < 0 || promptIndex >= prompts.length) {
            return reply.code(400).send({ error: `promptIndex out of range (0..${prompts.length - 1})` });
        }
        const updatedPrompts = [...prompts.slice(0, promptIndex), prompt];
        const dropped = db.prepare('SELECT COUNT(*) AS n FROM results WHERE run_id = ? AND prompt_index >= ?')
            .get(req.params.id, promptIndex);
        db.prepare('DELETE FROM results WHERE run_id = ? AND prompt_index >= ?').run(req.params.id, promptIndex);
        db.prepare("UPDATE runs SET prompts = ?, status = 'running', total_calls = total_calls - ? + ?, completed_calls = completed_calls - ? WHERE id = ?").run(JSON.stringify(updatedPrompts), dropped.n, models.length, dropped.n, req.params.id);
        const effectiveRunSettings = run.run_settings ? JSON.parse(run.run_settings) : undefined;
        const providers = await getProviders();
        const tasks = models.map(model => {
            const history = buildHistory(req.params.id, model, prompts);
            return runCell(req.params.id, promptIndex, prompt, model, providers, effectiveRunSettings, history);
        });
        finalizeRun(req.params.id, tasks);
        return reply.code(202).send({ data: { runId: req.params.id, promptIndex } });
    });
    app.get('/api/benchmark/stream/:runId', async (req, reply) => {
        const { runId } = req.params;
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        reply.raw.flushHeaders();
        if (!sseConnections.has(runId))
            sseConnections.set(runId, []);
        sseConnections.get(runId).push(reply);
        // Send heartbeat comment to keep connection alive
        const heartbeat = setInterval(() => {
            try {
                reply.raw.write(': ping\n\n');
            }
            catch {
                clearInterval(heartbeat);
            }
        }, 15000);
        req.raw.on('close', () => {
            clearInterval(heartbeat);
            const conns = sseConnections.get(runId);
            if (conns) {
                const idx = conns.indexOf(reply);
                if (idx >= 0)
                    conns.splice(idx, 1);
            }
        });
        // Don't resolve — keep connection open
        await new Promise(resolve => req.raw.on('close', resolve));
    });
}
