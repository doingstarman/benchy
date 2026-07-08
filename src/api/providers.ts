import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getProviders, upsertProvider, removeProvider } from '../config.js'
import { humanizeNetworkError, describeHttpError } from '../errors.js'
import type { Provider, ProviderType, ProviderDefaults } from '../types.js'

interface ProviderBody {
  id?: string
  name: string
  type: ProviderType
  apiKey?: string
  baseUrl?: string
  models: string[]
  enabled?: boolean
  timeout?: number
  retries?: number
  defaults?: ProviderDefaults
}

// Static model lists for providers without a /models endpoint
const STATIC_MODELS: Record<string, string[]> = {
  anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-5-haiku-20241022'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
}

export async function registerProvidersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/providers', async () => {
    const providers = await getProviders()
    return { data: providers }
  })

  app.post<{ Body: ProviderBody }>('/api/providers', async (req, reply) => {
    const body = req.body
    const provider: Provider = {
      id: body.id ?? randomUUID(),
      name: body.name,
      type: body.type,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      models: body.models,
      enabled: body.enabled ?? true,
      timeout: body.timeout,
      retries: body.retries,
      defaults: body.defaults,
    }
    await upsertProvider(provider)
    return reply.code(201).send({ data: provider })
  })

  app.delete<{ Params: { id: string } }>('/api/providers/:id', async (req, reply) => {
    await removeProvider(req.params.id)
    return reply.code(204).send()
  })

  // GET /api/providers/:id/models — fetch available models from provider API
  app.get<{ Params: { id: string } }>('/api/providers/:id/models', async (req, reply) => {
    const providers = await getProviders()
    const provider = providers.find(p => p.id === req.params.id)
    if (!provider) return reply.code(404).send({ error: 'Provider not found' })

    if (STATIC_MODELS[provider.type]) return { data: STATIC_MODELS[provider.type] }

    if (['http-json', 'script', 'webhook'].includes(provider.type)) return { data: [] }

    const baseUrl = provider.baseUrl ?? 'https://api.openai.com/v1'
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        return reply.code(502).send({ error: `/models: ${describeHttpError(res.status, text)}` })
      }
      const json = await res.json() as { data?: { id: string }[] }
      const ids = (json.data ?? []).map((m: { id: string }) => m.id).sort()
      return { data: ids }
    } catch (err) {
      return reply.code(502).send({ error: humanizeNetworkError(err, baseUrl) })
    }
  })

  // POST /api/providers/:id/test?model=<id>
  app.post<{ Params: { id: string }; Querystring: { model?: string } }>(
    '/api/providers/:id/test',
    async (req, reply) => {
      const providers = await getProviders()
      const provider = providers.find(p => p.id === req.params.id)
      if (!provider) return reply.code(404).send({ error: 'Provider not found' })

      const model = req.query.model ?? provider.models[0]
      if (!model) return reply.code(400).send({ error: 'No models configured' })

      const isCompatible = provider.type === 'openai-compatible' || provider.type === 'local'

      // For openai-compatible: also verify /models endpoint is reachable
      if (isCompatible && provider.baseUrl) {
        try {
          const r = await fetch(`${provider.baseUrl}/models`, {
            headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
          })
          if (!r.ok) {
            const text = await r.text().catch(() => r.statusText)
            return { data: { ok: false, error: `/models: ${describeHttpError(r.status, text)}` } }
          }
        } catch (err) {
          return { data: { ok: false, error: humanizeNetworkError(err, provider.baseUrl) } }
        }
      }

      try {
        const { getAdapter } = await import('./benchmark.js')
        const adapter = getAdapter(provider.type)
        const t0 = Date.now()

        for await (const chunk of adapter.stream(
          [{ role: 'user', content: 'Hi' }],
          { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model },
        )) {
          if (chunk.type === 'token') {
            const ttfs = Date.now() - t0
            const message = isCompatible ? '/models + chat completion succeeded' : 'streamed response received'
            return { data: { ok: true, ttfs, message } }
          }
          if (chunk.type === 'error') return { data: { ok: false, error: chunk.message } }
        }
        return { data: { ok: false, error: 'No response from provider' } }
      } catch (err) {
        return { data: { ok: false, error: humanizeNetworkError(err, provider.baseUrl) } }
      }
    }
  )
}
