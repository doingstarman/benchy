# API Rules

## Response Format

All routes return JSON in one of two shapes — no exceptions:

```typescript
// Success
{ data: T }

// Error
{ error: string }
```

HTTP status codes:
- `200` — GET success
- `201` — POST created
- `202` — POST accepted (async work started, e.g. benchmark)
- `204` — DELETE success (no body)
- `400` — validation error
- `404` — not found
- `500` — unhandled server error (let Fastify handle this)

## Route Registration

Routes are registered in `src/api/*.ts` files as `async function register*(app: FastifyInstance)`.  
All are mounted in `src/server.ts`. No route logic lives in `server.ts`.

Current route modules: `providers`, `runs`, `benchmark`, `results`, `datasets`,
`library` (tools/skills/MCP), `uploads` (attachments), `settings`, `version`, and
`mock`. The `mock` routes are **dev-only** — `server.ts` registers them only under
`~/.benchy-dev` (`isDevEnvironment()`), so a production install has no `/api/mock`.

## CSRF / Local-only Guard

benchy's API is unauthenticated on localhost, so any website the user visits could
script requests to it. That's harmless for most routes, but routes that **arrange
local code execution** (the `settings` code-execution toggle, code-dataset runs)
gate on `isLocalRequest(req)` from `src/api/csrf.ts`: a request with an absent or
localhost `Origin` is trusted (benchy's own UI, incl. the dev server on another
localhost port); anything else is a cross-site attempt and is refused. A browser can
never forge `Origin` to localhost.

## Validation

Validate only at the API boundary — the entry point of each route handler.  
Trust internal functions, DB queries, and adapter calls; don't add defensive checks there.

```typescript
// ✅ validate at route boundary
app.post('/api/benchmark', async (req, reply) => {
  const { prompts, models } = req.body
  if (!prompts?.length || !models?.length) {
    return reply.code(400).send({ error: 'prompts and models are required' })
  }
  // ... trust everything from here
})
```

## Database Conventions

- Table names: `plural_snake_case` (`runs`, `results`)
- Column names: `snake_case`
- Timestamps: integer Unix milliseconds (`created_at INTEGER NOT NULL`)
- Booleans: `INTEGER` (0/1), never `BOOLEAN`
- JSON columns: stored as `TEXT`, parsed/serialized at the route layer
- Foreign keys: always declared with `ON DELETE CASCADE`
- Indexes: create for every column used in WHERE filters

## Config vs DB

- **Config** (`~/.benchy/config.json`): provider credentials, API keys, base URLs. Mutable via UI.
- **DB** (`~/.benchy/benchy.db`): run history, results, feedback. Append-mostly.

Provider data lives in config only — not in the DB. The `providers.ts` routes read/write config, not DB.

## Model Key Format

Everywhere a model is identified: `"providerId:modelName"`.

```
openai:gpt-4o
my-groq:llama-3.3-70b-versatile
local-ollama:llama3.2
```

Parse: `const [providerId, ...rest] = key.split(':'); const model = rest.join(':')`  
This handles model names that contain `:` (e.g. some HuggingFace models).

## SSE Endpoints

SSE endpoints must:
1. Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`
2. Call `reply.raw.flushHeaders()` immediately
3. Send `: ping\n\n` on a 15s interval to keep connections alive through proxies
4. Clean up on `req.raw.on('close', ...)` — remove from connection map, clear interval
5. Keep the handler alive with `await new Promise(resolve => req.raw.on('close', resolve))`
