# Testing Rules

## Philosophy

Tests run against the real system — real server, real SQLite, real HTTP. The only things mocked are external API calls (OpenAI, Anthropic, Google) because they require valid keys and are non-deterministic.

**What this means**: if a test passes, the actual code path that a user hits also works. No false confidence from `app.inject()` or in-memory stores.

## Test Structure

```
src/
  test/
    providers.test.ts   ← real HTTP + real config file
    runs.test.ts        ← real HTTP + real SQLite
    benchmark.test.ts   ← real HTTP + real SSE + real SQLite + mocked adapters
  adapters/
    openai.test.ts      ← real SSE parser + mocked fetch
```

## Isolation Pattern

Each test file gets its own server port, temp directory, and SQLite file:

```typescript
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempDir: string
let server: FastifyInstance

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'benchy-test-'))
  process.env.BENCHY_DIR = tempDir
  server = await createServer(PORT, join(tempDir, 'test.db'))
})

afterAll(async () => {
  await server.close()
  closeDb()
  rmSync(tempDir, { recursive: true, force: true })
  delete process.env.BENCHY_DIR
})
```

Ports used: `14300` (providers), `14310` (runs), `14320` (benchmark). Never `4242`.

## What to Mock

```typescript
// ✅ Mock: external HTTP calls to AI providers
vi.mock('../adapters/openai.js', () => ({
  openaiAdapter: {
    async *stream(_messages, config) {
      yield { type: 'token', text: `Hello from ${config.model}` }
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 3 } }
    },
  },
}))

// ❌ Don't mock: Fastify app, SQLite, config file, HTTP fetch to own server
```

## What NOT to Mock

- The Fastify server itself
- SQLite database operations
- `src/config.ts` read/write operations
- `fetch()` calls to the test server

## Making HTTP Requests in Tests

Use `fetch` directly against the running server:

```typescript
const res = await fetch(`${base}/api/providers`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
const body = await res.json()
```

Never use `app.inject()` — it bypasses the HTTP stack and misses real-world issues (headers, CORS, encoding).

## Database Seeding

Seed test data directly via `getDb()` for runs/results that need to pre-exist:

```typescript
import { getDb } from '../db/index.js'
import { randomUUID } from 'node:crypto'

function seedRun(override = {}) {
  const id = randomUUID()
  getDb().prepare('INSERT INTO runs (...) VALUES (?, ...)').run(id, ...)
  return id
}
```

For providers, always seed via the API (POST /api/providers) so config.json is exercised.

## SSE Testing

SSE tests need the run to still be in-progress when the client connects. Use a delay flag in the adapter mock:

```typescript
let slowMode = false

vi.mock('../adapters/openai.js', () => ({
  openaiAdapter: {
    async *stream(_messages, config) {
      if (slowMode) await new Promise(r => setTimeout(r, 80))
      yield { type: 'token', text: 'hello' }
      yield { type: 'done', usage: { inputTokens: 5, outputTokens: 1 } }
    },
  },
}))

it('SSE delivers events', async () => {
  slowMode = true
  // ... test
  slowMode = false
})
```

## Async Completion

For benchmark tests, poll for run completion rather than sleeping:

```typescript
async function waitForRun(runId: string, maxMs = 2000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/runs/${runId}`)
    const { data } = await res.json()
    if (data.status === 'done' || data.status === 'error') return data
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(`Run ${runId} did not complete in ${maxMs}ms`)
}
```

## Running Tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Tests run sequentially (`pool: forks, singleFork: true`) to avoid port conflicts between test files.
