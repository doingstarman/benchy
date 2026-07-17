import { randomUUID } from 'node:crypto';
import { getProviders, upsertProvider, removeProvider } from '../config.js';
import { humanizeNetworkError, describeHttpError } from '../errors.js';
// "https://api.x.ai/v1/" + "/models" is "/v1//models", which real servers 404 —
// so benchy called a perfectly good provider broken. The adapters already strip
// it before /chat/completions, which is why runs worked while Test connection
// and Fetch models lied.
function apiUrl(baseUrl, path) {
    return `${baseUrl.trim().replace(/\/+$/, '')}${path}`;
}
// An endpoint that accepts the socket and then says nothing used to hang these
// buttons forever — there was no timeout anywhere on the probe paths.
const PROBE_TIMEOUT_MS = 20_000;
function probeFetch(url, headers) {
    return fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
}
// getAdapter falls back to the OpenAI adapter for anything it doesn't know, so
// an unrecognised type would send the user's key to api.openai.com — nowhere
// near where they pointed it. Reject at the boundary instead.
// Mirrors ProviderType in types.ts; the satisfies keeps it honest if that union
// grows (hand-typing this list already cost me 'custom').
const KNOWN_TYPES = new Set(['openai', 'anthropic', 'google', 'openai-compatible', 'local', 'custom', 'http-json', 'script', 'webhook']);
// Static model lists for providers without a /models endpoint
const STATIC_MODELS = {
    anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-5-haiku-20241022'],
    google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
};
export async function registerProvidersRoutes(app) {
    app.get('/api/providers', async () => {
        const providers = await getProviders();
        return { data: providers };
    });
    app.post('/api/providers', async (req, reply) => {
        const body = req.body;
        // Validate here, at the boundary: a provider saved without a models array
        // was stored as-is and then blew up with a 500 the moment anything read
        // models[0].
        if (!body || typeof body.name !== 'string' || !body.name.trim()) {
            return reply.code(400).send({ error: 'name is required' });
        }
        if (typeof body.type !== 'string' || !KNOWN_TYPES.has(body.type)) {
            return reply.code(400).send({ error: `type must be one of: ${[...KNOWN_TYPES].join(', ')}` });
        }
        if (!Array.isArray(body.models) || !body.models.every(m => typeof m === 'string')) {
            return reply.code(400).send({ error: 'models must be an array of model ids' });
        }
        const provider = {
            id: body.id ?? randomUUID(),
            name: body.name.trim(),
            type: body.type,
            apiKey: body.apiKey,
            // Stored normalized so the trailing slash can't come back to bite the
            // next caller that builds a URL from it.
            baseUrl: body.baseUrl?.trim().replace(/\/+$/, ''),
            models: body.models,
            enabled: body.enabled ?? true,
            timeout: body.timeout,
            retries: body.retries,
            defaults: body.defaults,
        };
        await upsertProvider(provider);
        return reply.code(201).send({ data: provider });
    });
    app.delete('/api/providers/:id', async (req, reply) => {
        await removeProvider(req.params.id);
        return reply.code(204).send();
    });
    // POST /api/providers/models — list the models a DRAFT configuration can see.
    // Takes the candidate settings in the body rather than an id, because the
    // caller is a form the user hasn't saved yet. It used to read the stored
    // provider, which forced the UI to save before it could look anything up —
    // so "Cancel" silently kept whatever you had typed.
    app.post('/api/providers/models', async (req, reply) => {
        const { type, apiKey, baseUrl } = req.body ?? {};
        if (!type || !KNOWN_TYPES.has(type)) {
            return reply.code(400).send({ error: `Unknown provider type "${type ?? ''}"` });
        }
        if (STATIC_MODELS[type])
            return { data: STATIC_MODELS[type] };
        if (['http-json', 'script', 'webhook'].includes(type))
            return { data: [] };
        const base = baseUrl?.trim() || 'https://api.openai.com/v1';
        const url = apiUrl(base, '/models');
        try {
            const keyed = await probeFetch(url, apiKey ? { Authorization: `Bearer ${apiKey}` } : {});
            let res = keyed;
            // Some catalogues are public and refuse the key rather than ignore it —
            // OpenRouter 403s a restricted key on /models while happily streaming
            // completions with it. The list is public, so just ask anonymously.
            if (!keyed.ok && apiKey && (keyed.status === 401 || keyed.status === 403)) {
                const anon = await probeFetch(url, {});
                // Only keep the anonymous attempt if it actually helped. Otherwise the
                // keyless "missing bearer authentication" buried the real cause — a
                // revoked or wrong key — and blamed a header we deliberately omitted.
                if (anon.ok)
                    res = anon;
            }
            if (!res.ok) {
                const text = await res.text().catch(() => res.statusText);
                return reply.code(502).send({ error: `/models: ${describeHttpError(res.status, text)}` });
            }
            const json = await res.json().catch(() => null);
            // A captive portal or proxy answers 200 with HTML; a raw parser error is
            // not something a user can act on.
            if (!json || !Array.isArray(json.data)) {
                return reply.code(502).send({ error: `/models: ${base} answered without a model list — is this an OpenAI-compatible endpoint?` });
            }
            return { data: json.data.map(m => m.id).filter(id => typeof id === 'string').sort() };
        }
        catch (err) {
            return reply.code(502).send({ error: humanizeNetworkError(err, base) });
        }
    });
    // POST /api/providers/test — ask a DRAFT configuration to actually answer.
    // Body, not id, for the same reason as /models above: you are testing what is
    // on screen, not what is on disk.
    app.post('/api/providers/test', async (req, reply) => {
        const { type, apiKey, baseUrl, model } = req.body ?? {};
        if (!type)
            return reply.code(400).send({ error: 'type is required' });
        if (!model)
            return reply.code(400).send({ error: 'No models configured' });
        // An unknown type silently fell back to the OpenAI adapter, which then sent
        // the key to api.openai.com — not where the user pointed it.
        if (!KNOWN_TYPES.has(type)) {
            return reply.code(400).send({ error: `Unknown provider type "${type}"` });
        }
        // The only question worth asking: does this model answer? It used to gate on
        // /models first and call a provider broken when that failed — but /models is
        // a catalogue, not the service. OpenRouter's is public and 403s the very key
        // that streams completions fine, so a working provider was pronounced dead
        // without ever being asked to speak.
        const t0 = Date.now();
        const ask = async () => {
            try {
                const { getAdapter } = await import('./benchmark.js');
                const adapter = getAdapter(type);
                for await (const chunk of adapter.stream([{ role: 'user', content: 'Hi' }], { apiKey, baseUrl, model })) {
                    if (chunk.type === 'token') {
                        return { ok: true, ttfs: Date.now() - t0, message: 'streamed response received' };
                    }
                    if (chunk.type === 'error')
                        return { ok: false, error: chunk.message };
                }
                return { ok: false, error: 'No response from provider' };
            }
            catch (err) {
                return { ok: false, error: humanizeNetworkError(err, baseUrl) };
            }
        };
        // An endpoint that accepts the connection and then says nothing left this
        // button spinning forever — no timeout existed anywhere on this path.
        const giveUp = new Promise(resolve => {
            setTimeout(() => resolve({
                ok: false,
                error: `No response within ${PROBE_TIMEOUT_MS / 1000}s — the endpoint accepted the connection but never answered`,
            }), PROBE_TIMEOUT_MS).unref?.();
        });
        return { data: await Promise.race([ask(), giveUp]) };
    });
}
