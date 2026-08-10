import type { FastifyInstance } from 'fastify'
import {
  getAppSettings, setCodeExecutionEnabled, setCodeExecTimeoutMs, setAppRunDefaults,
  CODE_EXEC_TIMEOUT_MIN_MS, CODE_EXEC_TIMEOUT_MAX_MS,
  APP_TEMPERATURE_MIN, APP_TEMPERATURE_MAX,
  APP_MAX_OUTPUT_TOKENS_MIN, APP_MAX_OUTPUT_TOKENS_MAX,
} from '../config.js'
import { isLocalRequest } from './csrf.js'

type RunDefaultsPatch = { temperature?: number | null; maxOutputTokens?: number | null }

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
}

// Server-side settings the UI can read and flip. Kept separate from provider
// config because these are app-wide toggles, not per-provider credentials.
export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => {
    return { data: await getAppSettings() }
  })

  app.put<{ Body: { codeExecution?: unknown; codeExecTimeoutMs?: unknown; runDefaults?: unknown } }>(
    '/api/settings',
    async (req, reply) => {
      // Enabling code execution from a cross-site page would be a CSRF foothold —
      // refuse anything that isn't same-origin/localhost.
      if (!isLocalRequest(req)) return reply.code(403).send({ error: 'cross-site request refused' })
      const { codeExecution, codeExecTimeoutMs, runDefaults } = req.body

      // Validate every key before writing any of them. With one setting a
      // handler could not half-apply; with three, rejecting the last one after
      // writing the first would leave the config in a state the caller never
      // asked for and does not know about.
      if (codeExecution !== undefined && typeof codeExecution !== 'boolean') {
        return reply.code(400).send({ error: 'codeExecution must be a boolean' })
      }

      let timeoutMs: number | undefined
      if (codeExecTimeoutMs !== undefined) {
        if (!inRange(codeExecTimeoutMs, CODE_EXEC_TIMEOUT_MIN_MS, CODE_EXEC_TIMEOUT_MAX_MS)) {
          return reply.code(400).send({
            error: `codeExecTimeoutMs must be a number between ${CODE_EXEC_TIMEOUT_MIN_MS} and ${CODE_EXEC_TIMEOUT_MAX_MS}`,
          })
        }
        timeoutMs = codeExecTimeoutMs
      }

      let defaults: RunDefaultsPatch | undefined
      if (runDefaults !== undefined) {
        if (runDefaults === null || typeof runDefaults !== 'object' || Array.isArray(runDefaults)) {
          return reply.code(400).send({ error: 'runDefaults must be an object' })
        }
        defaults = {}

        if ('temperature' in runDefaults) {
          const v = runDefaults.temperature
          if (v !== null && !inRange(v, APP_TEMPERATURE_MIN, APP_TEMPERATURE_MAX)) {
            return reply.code(400).send({
              error: `runDefaults.temperature must be a number between ${APP_TEMPERATURE_MIN} and ${APP_TEMPERATURE_MAX}, or null`,
            })
          }
          defaults.temperature = v
        }

        if ('maxOutputTokens' in runDefaults) {
          const v = runDefaults.maxOutputTokens
          if (v !== null
            && (!inRange(v, APP_MAX_OUTPUT_TOKENS_MIN, APP_MAX_OUTPUT_TOKENS_MAX) || !Number.isInteger(v))) {
            return reply.code(400).send({
              error: `runDefaults.maxOutputTokens must be an integer between ${APP_MAX_OUTPUT_TOKENS_MIN} and ${APP_MAX_OUTPUT_TOKENS_MAX}, or null`,
            })
          }
          defaults.maxOutputTokens = v
        }
      }

      if (codeExecution !== undefined) await setCodeExecutionEnabled(codeExecution)
      if (timeoutMs !== undefined) await setCodeExecTimeoutMs(timeoutMs)
      if (defaults) await setAppRunDefaults(defaults)

      return { data: await getAppSettings() }
    },
  )
}
