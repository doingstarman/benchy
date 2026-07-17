import Fastify, { type FastifyError } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCors from '@fastify/cors'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { initDb } from './db/index.js'
import { registerProvidersRoutes } from './api/providers.js'
import { registerRunsRoutes } from './api/runs.js'
import { registerBenchmarkRoutes } from './api/benchmark.js'
import { registerMockRoutes } from './api/mock.js'
import { registerUploadsRoutes, gcUnboundUploads } from './api/uploads.js'
import { registerVersionRoutes } from './api/version.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const UNBOUND_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

export async function createServer(port: number, dbPath?: string) {
  await initDb(dbPath)

  // Sweep uploads that were attached but never sent (chip removed / tab closed).
  // Fire-and-forget — a cleanup failure must never block server startup.
  void gcUnboundUploads(UNBOUND_UPLOAD_TTL_MS).catch(() => {})

  const app = Fastify({ logger: false })

  // CORS for dev (Vite on 5173 -> backend on 4243)
  await app.register(fastifyCors, { origin: true })

  // Every route answers {data} or {error}; a *thrown* error would otherwise fall
  // through to Fastify's own shape, which the frontend's apiFetch can't read —
  // the user gets a blank 500 and no idea what happened. This tool is localhost
  // and single-user, so an honest message beats a silent one.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    return reply.code(status).send({ error: err.message })
  })

  // API routes
  await registerUploadsRoutes(app)
  await registerVersionRoutes(app)
  await registerProvidersRoutes(app)
  await registerRunsRoutes(app)
  await registerBenchmarkRoutes(app)
  await registerMockRoutes(app)

  // Serve built frontend in production
  const frontendDist = join(__dirname, '..', 'frontend', 'dist')
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, { root: frontendDist, prefix: '/' })
    // SPA fallback
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html')
    })
  }

  await app.listen({ port, host: '127.0.0.1' })
  return app
}
