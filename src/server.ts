import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCors from '@fastify/cors'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { initDb } from './db/index.js'
import { registerProvidersRoutes } from './api/providers.js'
import { registerRunsRoutes } from './api/runs.js'
import { registerBenchmarkRoutes } from './api/benchmark.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function createServer(port: number, dbPath?: string) {
  await initDb(dbPath)

  const app = Fastify({ logger: false })

  // CORS for dev (Vite on 5173 → backend on 4242)
  await app.register(fastifyCors, { origin: true })

  // API routes
  await registerProvidersRoutes(app)
  await registerRunsRoutes(app)
  await registerBenchmarkRoutes(app)

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
