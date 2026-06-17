import { randomUUID } from 'node:crypto';
import { getProviders, upsertProvider, removeProvider } from '../config.js';
export async function registerProvidersRoutes(app) {
    app.get('/api/providers', async () => {
        const providers = await getProviders();
        return { data: providers };
    });
    app.post('/api/providers', async (req, reply) => {
        const body = req.body;
        const provider = {
            id: body.id ?? randomUUID(),
            name: body.name,
            type: body.type,
            apiKey: body.apiKey,
            baseUrl: body.baseUrl,
            models: body.models,
            enabled: body.enabled ?? true,
        };
        await upsertProvider(provider);
        return reply.code(201).send({ data: provider });
    });
    app.delete('/api/providers/:id', async (req, reply) => {
        await removeProvider(req.params.id);
        return reply.code(204).send();
    });
    app.post('/api/providers/:id/test', async (req, reply) => {
        const providers = await getProviders();
        const provider = providers.find(p => p.id === req.params.id);
        if (!provider)
            return reply.code(404).send({ error: 'Provider not found' });
        try {
            const { getAdapter } = await import('./benchmark.js');
            const adapter = getAdapter(provider.type);
            const model = provider.models[0];
            if (!model)
                return reply.code(400).send({ error: 'No models configured' });
            let got = false;
            for await (const chunk of adapter.stream([{ role: 'user', content: 'Hi' }], { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model })) {
                if (chunk.type === 'token') {
                    got = true;
                    break;
                }
                if (chunk.type === 'error')
                    return reply.send({ data: { ok: false, error: chunk.message } });
            }
            return { data: { ok: got } };
        }
        catch (err) {
            return { data: { ok: false, error: err instanceof Error ? err.message : String(err) } };
        }
    });
}
