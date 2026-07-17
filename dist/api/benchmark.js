import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { getProviders, DEFAULT_PROVIDER_SETTINGS } from '../config.js';
import { openaiAdapter } from '../adapters/openai.js';
import { anthropicAdapter } from '../adapters/anthropic.js';
import { googleAdapter } from '../adapters/google.js';
import { httpJsonAdapter } from '../adapters/http-json.js';
import { scriptAdapter } from '../adapters/script.js';
import { webhookAdapter } from '../adapters/webhook.js';
import { readFile, unlink } from 'node:fs/promises';
import { getAttachmentRow, uploadPath, cloneAttachmentsForTurn } from './uploads.js';
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
        // A model can name a provider that no longer exists (deleted, or a saved run
        // reopened). Failing here rather than returning early means it lands in the
        // normal error path: the row is written, so the failure survives a reload,
        // and the finally below still counts the call — the run used to sit at
        // completed < total forever with the error visible only in that live stream.
        const provider = providers.find(p => p.id === providerId);
        if (!provider)
            throw new Error(`Provider "${providerId}" is not configured — it may have been deleted`);
        const adapter = getAdapter(provider.type);
        const effectiveSettings = {
            ...DEFAULT_PROVIDER_SETTINGS,
            ...provider.defaults,
            ...(runSettings?.global ?? {}),
            ...(runSettings?.perModel?.[modelKey] ?? {}),
        };
        const attachments = await loadAttachments(runId, promptIndex);
        const stream = adapter.stream([...history, { role: 'user', content: promptText, ...(attachments.length ? { attachments } : {}) }], { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model, settings: effectiveSettings });
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
// Turns can overlap on one run — a second tab, or a continue fired while an
// edit is still streaming. Count them so the first to finish doesn't announce
// the whole run is over.
const inFlightTurns = new Map();
function finalizeRun(runId, tasks) {
    const db = getDb();
    inFlightTurns.set(runId, (inFlightTurns.get(runId) ?? 0) + 1);
    void Promise.all(tasks)
        .then(() => 'done', () => 'error')
        .then(status => {
        const left = (inFlightTurns.get(runId) ?? 1) - 1;
        if (left > 0) {
            // Another turn is still streaming; it will close the run out.
            inFlightTurns.set(runId, left);
            return;
        }
        inFlightTurns.delete(runId);
        db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(status, runId);
        // Always terminal, including on the error path: a client that never hears
        // this sits open in "running" forever.
        broadcast(runId, 'run_done', { runId });
        // Connections are NOT dropped here — the sockets are still alive and the
        // close handler owns their lifetime. Deleting the map entry unsubscribed
        // live clients, so a later turn broadcast into nothing.
    });
}
// Binds freshly-uploaded attachments to a specific turn. Rejects ids that
// don't exist or already belong to a different turn.
// Split from the binding itself so a caller that is about to destroy something
// can check the request is acceptable FIRST — edit-turn deleted attachments and
// only then discovered the request was invalid, taking the user's images with a
// request it went on to reject.
function validateAttachments(ids, runId, promptIndex) {
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
        return 'attachments must be an array of upload id strings';
    }
    for (const id of ids) {
        const row = getAttachmentRow(id);
        if (!row)
            return `Attachment ${id} not found — upload it first`;
        if (row.run_id && (row.run_id !== runId || row.prompt_index !== promptIndex)) {
            return `Attachment ${id} already belongs to another message`;
        }
    }
    return null;
}
function bindAttachments(ids, runId, promptIndex) {
    const invalid = validateAttachments(ids, runId, promptIndex);
    if (invalid)
        return invalid;
    const bind = getDb().prepare('UPDATE attachments SET run_id = ?, prompt_index = ? WHERE id = ?');
    for (const id of ids)
        bind.run(runId, promptIndex, id);
    return null;
}
// Reads a turn's attachments from disk into adapter-ready base64 payloads.
// Strict by default: a bound attachment whose file is gone throws, so the
// current call surfaces an honest per-cell error instead of silently answering
// as if no file was attached (capability differences are the benchmark signal).
// History reconstruction passes lenient — a vanished older file shouldn't sink
// a fresh turn — but still warns rather than dropping in silence.
async function loadAttachments(runId, promptIndex, lenient = false) {
    const rows = getDb().prepare('SELECT id, mime_type, name FROM attachments WHERE run_id = ? AND prompt_index = ? ORDER BY created_at').all(runId, promptIndex);
    const out = [];
    for (const row of rows) {
        try {
            const buf = await readFile(uploadPath(row.id, row.mime_type));
            out.push({ mimeType: row.mime_type, data: buf.toString('base64'), name: row.name });
        }
        catch {
            if (!lenient)
                throw new Error(`Attachment "${row.name}" is missing on disk — re-upload it`);
            console.warn(`benchy: history attachment "${row.name}" (${row.id}) missing on disk, skipping`);
        }
    }
    return out;
}
async function deleteAttachmentsFrom(runId, promptIndex) {
    const db = getDb();
    const rows = db.prepare('SELECT id, mime_type FROM attachments WHERE run_id = ? AND prompt_index >= ?').all(runId, promptIndex);
    for (const row of rows) {
        await unlink(uploadPath(row.id, row.mime_type)).catch(() => { });
    }
    db.prepare('DELETE FROM attachments WHERE run_id = ? AND prompt_index >= ?').run(runId, promptIndex);
}
// Reconstructs one model's own conversation branch from prior turns —
// failed turns (error IS NOT NULL) are skipped entirely rather than
// injected as broken/empty assistant messages.
async function buildHistory(runId, model, prompts, kind) {
    // A batch is many unrelated questions fanned out to every model, so replaying
    // them as a dialogue feeds a model three questions it was never asked in
    // sequence, poisoning every answer after the first. It has no conversation.
    //
    // A pairs run does: each model was asked its own prompt, so the rows below
    // (already filtered to this model) are exactly that model's own thread.
    if (kind === 'batch')
        return [];
    const db = getDb();
    const rows = db.prepare('SELECT prompt_index, text FROM results WHERE run_id = ? AND model = ? AND error IS NULL ORDER BY prompt_index').all(runId, model);
    const history = [];
    for (const row of rows) {
        const content = prompts[row.prompt_index];
        // A result can outlive its prompt: an edit forks prompts down while a
        // concurrent continue's cells are still landing past the new end. Sending
        // `content: undefined` builds a blank user message that real providers
        // reject with a 400 — one race and the conversation could never continue
        // again. Drop the orphan instead; its prompt no longer exists.
        if (typeof content !== 'string')
            continue;
        const attachments = await loadAttachments(runId, row.prompt_index, true);
        history.push({
            role: 'user',
            content,
            ...(attachments.length ? { attachments } : {}),
        });
        history.push({ role: 'assistant', content: row.text });
    }
    return history;
}
export async function registerBenchmarkRoutes(app) {
    app.post('/api/benchmark', async (req, reply) => {
        const { prompts, models, pairs, runSettings, attachments, cloneAttachmentsFrom } = req.body;
        if (!pairs?.length && (!prompts?.length || !models?.length)) {
            return reply.code(400).send({ error: 'provide pairs[] or prompts[]+models[]' });
        }
        if ((attachments?.length || cloneAttachmentsFrom) && (pairs?.length || (prompts?.length ?? 0) > 1)) {
            return reply.code(400).send({ error: 'attachments are only supported with a single prompt' });
        }
        if (cloneAttachmentsFrom && attachments?.length) {
            return reply.code(400).send({ error: 'cannot combine attachments with cloneAttachmentsFrom' });
        }
        // Validate the clone source shape at the boundary: a non-primitive runId or
        // promptIndex would otherwise throw inside better-sqlite3 AFTER the run row
        // is inserted, stranding a zombie run stuck in 'running'.
        if (cloneAttachmentsFrom &&
            (typeof cloneAttachmentsFrom.runId !== 'string' || !Number.isInteger(cloneAttachmentsFrom.promptIndex))) {
            return reply.code(400).send({ error: 'cloneAttachmentsFrom needs a string runId and an integer promptIndex' });
        }
        const runId = randomUUID();
        const db = getDb();
        // `pairs: []` is not a pairs run. The guard above tests .length while these
        // used to test truthiness, so an empty array slipped through and then won
        // every branch — producing a 202 for an empty run that dropped the prompts
        // the caller actually sent.
        const isPairs = !!pairs?.length;
        const totalCalls = isPairs ? pairs.length : prompts.length * models.length;
        const storedPrompts = isPairs ? pairs.map(p => p.prompt) : prompts;
        const storedModels = isPairs ? pairs.map(p => p.model) : models;
        const hasSettings = runSettings && (Object.keys(runSettings.global ?? {}).length > 0 ||
            Object.keys(runSettings.perModel ?? {}).length > 0);
        const runSettingsJson = hasSettings ? JSON.stringify(runSettings) : null;
        if (attachments?.length) {
            const bindError = bindAttachments(attachments, runId, 0);
            if (bindError)
                return reply.code(400).send({ error: bindError });
        }
        // Derived from the request's shape, not trusted from the client: pairs are
        // one prompt per model, several prompts fanned out to every model is a
        // batch, and a single prompt is the start of a chat.
        const kind = pairs?.length ? 'pairs' : storedPrompts.length > 1 ? 'batch' : 'chat';
        db.prepare('INSERT INTO runs (id, prompts, models, status, saved, total_calls, completed_calls, created_at, run_settings, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(runId, JSON.stringify(storedPrompts), JSON.stringify(storedModels), 'running', 0, totalCalls, 0, Date.now(), runSettingsJson, kind);
        // Regenerate copies the source turn's attachments onto this run so the
        // re-run sees the same media. Done after the INSERT (rows FK-reference it).
        if (cloneAttachmentsFrom) {
            await cloneAttachmentsForTurn(cloneAttachmentsFrom.runId, cloneAttachmentsFrom.promptIndex, runId, 0);
        }
        // Fire and forget — SSE stream delivers results
        const providers = await getProviders();
        const tasks = isPairs
            ? pairs.map(({ prompt, model }, pi) => runCell(runId, pi, prompt, model, providers, runSettings))
            : prompts.flatMap((prompt, pi) => models.map(model => runCell(runId, pi, prompt, model, providers, runSettings)));
        finalizeRun(runId, tasks);
        return reply.code(202).send({ data: { runId } });
    });
    app.post('/api/runs/:id/continue', async (req, reply) => {
        const { prompt, runSettings, attachments } = req.body;
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
        // In a pairs run `models` is aligned to `prompts`, one entry per pair — it
        // is not the run's model set, and the same model may appear twice. A
        // follow-up is addressed to each model once, so dedupe before fanning out.
        const targetModels = run.kind === 'pairs' ? [...new Set(models)] : models;
        if (attachments?.length) {
            const bindError = bindAttachments(attachments, req.params.id, newPromptIndex);
            if (bindError)
                return reply.code(400).send({ error: bindError });
        }
        const effectiveRunSettings = runSettings ?? (run.run_settings ? JSON.parse(run.run_settings) : undefined);
        const runSettingsJson = effectiveRunSettings ? JSON.stringify(effectiveRunSettings) : run.run_settings;
        db.prepare("UPDATE runs SET prompts = ?, status = 'running', total_calls = total_calls + ?, run_settings = ? WHERE id = ?").run(JSON.stringify(updatedPrompts), targetModels.length, runSettingsJson, req.params.id);
        const providers = await getProviders();
        const tasks = targetModels.map(async (model) => {
            // In a batch run this returns [] — the new prompt is another independent
            // question, not a follow-up to the previous ones.
            const history = await buildHistory(req.params.id, model, prompts, run.kind);
            return runCell(req.params.id, newPromptIndex, prompt, model, providers, effectiveRunSettings, history);
        });
        finalizeRun(req.params.id, tasks);
        return reply.code(202).send({ data: { runId: req.params.id, promptIndex: newPromptIndex } });
    });
    // Edit a past user message — ChatGPT fork semantics: everything after the
    // edited turn is discarded and the turn re-runs with the new prompt.
    app.post('/api/runs/:id/edit-turn', async (req, reply) => {
        const { promptIndex, prompt, attachments } = req.body;
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
        // Chat forks: later turns follow from this one, so editing it invalidates
        // them. A batch prompt answers to nobody — editing it re-runs that prompt
        // alone and leaves its neighbours untouched.
        const forks = run.kind === 'chat';
        // In a pairs run prompts[i] belongs to models[i] — but only for the
        // original pairs. A prompt appended by `continue` sits past the end of
        // `models` and was addressed to everyone, so it re-runs on everyone.
        // Indexing blindly gave `undefined` there: the edit deleted every answer,
        // re-ran nothing, and reported success.
        const targetModels = run.kind === 'pairs'
            ? (promptIndex < models.length ? [models[promptIndex]] : [...new Set(models)])
            : models;
        // Everything below destroys something. Reject a bad request before that,
        // or a 400 the user reads as "nothing happened" will already have deleted
        // their images — from this turn and every later one.
        if (attachments?.length) {
            const invalid = validateAttachments(attachments, req.params.id, promptIndex);
            if (invalid)
                return reply.code(400).send({ error: invalid });
        }
        if (forks)
            await deleteAttachmentsFrom(req.params.id, promptIndex + 1);
        const keep = new Set(attachments ?? []);
        const ownRows = db.prepare('SELECT id, mime_type FROM attachments WHERE run_id = ? AND prompt_index = ?')
            .all(req.params.id, promptIndex);
        for (const row of ownRows) {
            if (keep.has(row.id))
                continue;
            await unlink(uploadPath(row.id, row.mime_type)).catch(() => { });
            db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
        }
        if (attachments?.length) {
            const bindError = bindAttachments(attachments, req.params.id, promptIndex);
            if (bindError)
                return reply.code(400).send({ error: bindError });
        }
        const updatedPrompts = forks
            ? [...prompts.slice(0, promptIndex), prompt]
            : prompts.map((p, i) => i === promptIndex ? prompt : p);
        const countSql = forks
            ? 'SELECT COUNT(*) AS n FROM results WHERE run_id = ? AND prompt_index >= ?'
            : 'SELECT COUNT(*) AS n FROM results WHERE run_id = ? AND prompt_index = ?';
        const deleteSql = forks
            ? 'DELETE FROM results WHERE run_id = ? AND prompt_index >= ?'
            : 'DELETE FROM results WHERE run_id = ? AND prompt_index = ?';
        const dropped = db.prepare(countSql).get(req.params.id, promptIndex);
        db.prepare(deleteSql).run(req.params.id, promptIndex);
        db.prepare("UPDATE runs SET prompts = ?, status = 'running', total_calls = total_calls - ? + ?, completed_calls = completed_calls - ? WHERE id = ?").run(JSON.stringify(updatedPrompts), dropped.n, targetModels.length, dropped.n, req.params.id);
        const effectiveRunSettings = run.run_settings ? JSON.parse(run.run_settings) : undefined;
        const providers = await getProviders();
        const tasks = targetModels.map(async (model) => {
            const history = await buildHistory(req.params.id, model, prompts, run.kind);
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
            if (!conns)
                return;
            const idx = conns.indexOf(reply);
            if (idx >= 0)
                conns.splice(idx, 1);
            // Last listener gone — drop the entry so the map doesn't grow forever.
            if (conns.length === 0)
                sseConnections.delete(runId);
        });
        // Don't resolve — keep connection open
        await new Promise(resolve => req.raw.on('close', resolve));
    });
}
