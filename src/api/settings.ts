import type { FastifyInstance } from 'fastify'
import { getCodeExecutionEnabled, setCodeExecutionEnabled } from '../config.js'

// Server-side settings the UI can read and flip. Kept separate from provider
// config because these are app-wide toggles, not per-provider credentials.
export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => {
    return { data: { codeExecution: await getCodeExecutionEnabled() } }
  })

  app.put<{ Body: { codeExecution?: unknown } }>('/api/settings', async (req, reply) => {
    const { codeExecution } = req.body
    if (codeExecution !== undefined) {
      if (typeof codeExecution !== 'boolean') {
        return reply.code(400).send({ error: 'codeExecution must be a boolean' })
      }
      await setCodeExecutionEnabled(codeExecution)
    }
    return { data: { codeExecution: await getCodeExecutionEnabled() } }
  })
}
