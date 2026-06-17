# benchy — Project Reference

## What it is

Open-source self-hosted AI model benchmarking tool. CLI starts a local server on port 4242, opens browser. Compare LLMs side by side: run the same prompts across providers, see TTFS / latency / token metrics in one view.

Design aesthetic: **Langfuse / LangSmith** — dense, dark, developer-tool. No decorative elements.  
Functional references: artificialanalysis.ai, openrouter.ai

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 + TypeScript (strict) | ESM throughout |
| Server | Fastify 5 | Plugins: @fastify/cors, @fastify/static |
| Frontend | React 19 + Vite 6 | React Router v7 |
| Database | better-sqlite3 (SQLite) | WAL mode, FK enforcement |
| CLI | commander.js | Entry: `src/cli.ts` |
| Dev | concurrently + tsx | `tsx watch` for hot backend reload |

## Architecture

```
src/cli.ts  (commander entry)
  └─ src/server.ts  (Fastify)
       ├─ static: frontend/dist/  (production only)
       ├─ /api/providers   →  src/api/providers.ts
       ├─ /api/runs        →  src/api/runs.ts
       └─ /api/benchmark   →  src/api/benchmark.ts
            ├─ src/adapters/openai.ts   ─┐
            ├─ src/adapters/anthropic.ts ├─ Promise.all
            └─ src/adapters/google.ts   ─┘
```

**Dev mode**: Vite on 5173, proxies `/api` → 4242.  
**Production**: Fastify serves `frontend/dist/` as static on 4242.

Config: `~/.benchy/config.json` — read/written via `src/config.ts`. Never accessed from frontend.  
Database: `~/.benchy/benchy.db` — initialized in `src/db/index.ts`, schema inlined there.

## Repository State

GitHub repository: `doingstarman/benchy`.

- Single long-lived branch: `main`
- Do not recreate or push `master`
- Local `main` tracks `origin/main`
- Default GitHub branch must stay `main`
- If GitHub shows both `main` and `master`, delete `master` after confirming both point at the same commit

See `rules/devops.md` for branch, commit, push, and release workflow rules.

## Development Commands

```bash
npm run dev      # backend on 4242 + Vite on 5173
npm run build    # TypeScript + production frontend build
npm test         # full test suite
npm run lint     # TypeScript no-emit check
npm run seed     # add mock providers to ~/.benchy/config.json
```

Use `npm run seed` for local demo data. Mock providers use the in-process `/api/mock/chat/completions` route and never call external AI APIs.

## File Map

### Backend `src/`

| File | Role |
|---|---|
| `cli.ts` | Entry point. Commander parses `start [--port] [--no-open]`, calls `createServer()`, opens browser |
| `server.ts` | Fastify setup. Registers CORS, static, mounts all API routes. Accepts optional `dbPath` for tests |
| `config.ts` | `readConfig / writeConfig / getProviders / upsertProvider / removeProvider`. Reads `BENCHY_DIR` env var for test isolation |
| `types.ts` | All shared types: `Provider`, `ProviderType`, `Run`, `RunStatus`, `Result`, `Metrics`, `Message`, `BenchmarkRequest` |
| `db/index.ts` | `initDb(path?)` — creates DB, runs schema, exposes `getDb()` and `closeDb()` |
| `db/schema.sql` | Source of truth for table definitions (kept for reference; schema is inlined in `db/index.ts`) |
| `api/providers.ts` | `GET /api/providers`, `POST /api/providers`, `DELETE /api/providers/:id`, `POST /api/providers/:id/test` |
| `api/runs.ts` | `GET /api/runs` (filtered), `GET /api/runs/:id`, `DELETE /api/runs/:id`, `POST /api/runs/:id/fork`, `PATCH /api/runs/:id`, `PATCH /api/runs/:id/results/:resultId/feedback` |
| `api/benchmark.ts` | `POST /api/benchmark` → creates run, fires `Promise.all`. `GET /api/benchmark/stream/:runId` → SSE. Exports `getAdapter()` |
| `api/mock.ts` | Local OpenAI-compatible streaming mock endpoint for demos/tests. No external calls |
| `adapters/base.ts` | `Adapter` interface, `Chunk` union, `Usage`, `AdapterConfig`, `Message` |
| `adapters/openai.ts` | OpenAI-compatible: raw fetch + SSE line parser. Covers OpenAI, Groq, Fireworks, Together, OpenRouter, Replicate, Ollama, LM Studio, DeepSeek, Mistral, xAI, custom |
| `adapters/anthropic.ts` | `@anthropic-ai/sdk` stream API → `Chunk` |
| `adapters/google.ts` | `@google/generative-ai` stream → `Chunk` |
| `seed.ts` | Seeds mock providers into config for local demo use |

### Frontend `frontend/src/`

| File | Role |
|---|---|
| `main.tsx` | React root, StrictMode |
| `App.tsx` | Layout shell: `<Sidebar>` + `<Outlet />` |
| `router.tsx` | `BrowserRouter` + routes: `/run`, `/results/:runId`, `/history`, `/providers`, `/settings` |
| `tokens.css` | All CSS custom properties. Source of truth for colors/spacing/radii |
| `api.ts` | Typed `fetch` wrappers for all endpoints + `useSSE(runId, onEvent)` hook |
| `pages/NewRun.tsx` | Left: model selector (provider tree, toggle chips). Right: prompt textareas + run summary + Run button |
| `pages/NewRun.test.tsx` | Promptbox/model-selection regression tests |
| `pages/Results.tsx` | SSE consumer. Prompt tabs, side-by-side `ResponseCard` columns, save/best-TTFS bar |
| `pages/History.tsx` | Runs table with filters (search/date/status), hover-reveal fork+delete actions |
| `pages/Providers.tsx` | Provider grid by section, connect/disconnect/test modal |
| `pages/Settings.tsx` | Server info, about |
| `components/Sidebar.tsx` | Nav links with active state (white text + 2px purple left bar) |
| `components/MetricsBar.tsx` | TTFS, total time, tokens in/reasoning/out. Star icon on fastest TTFS |
| `components/ResponseCard.tsx` | Model header, streaming text, MetricsBar, thumbs feedback |
| `components/ProviderTile.tsx` | Provider card: name, status dot, model count. Opens modal on click |

## Adapter Contract

`src/adapters/base.ts` is the source of truth. Must be stable before any adapter is written.

```typescript
export interface Adapter {
  stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk>
}

export type Chunk =
  | { type: 'token'; text: string }
  | { type: 'done'; usage: Usage }
  | { type: 'error'; message: string }
```

**TTFS measurement** — happens in `benchmark.ts`, not in the adapter:
```typescript
const t0 = Date.now()
for await (const chunk of adapter.stream(messages, config)) {
  if (chunk.type === 'token' && ttfs === null) ttfs = Date.now() - t0
  // ...
}
```

## SSE Benchmark Protocol

`POST /api/benchmark` → `202 { data: { runId } }`. Then `GET /api/benchmark/stream/:runId` (SSE).

```
event: cell_start   data: {"runId":"…","promptIndex":0,"model":"openai:gpt-4o"}
event: cell_token   data: {"runId":"…","promptIndex":0,"model":"openai:gpt-4o","text":"Hello"}
event: cell_done    data: {"runId":"…","promptIndex":0,"model":"openai:gpt-4o","ttfs":312,"totalTime":1840,"usage":{…}}
event: cell_error   data: {"runId":"…","promptIndex":0,"model":"openai:gpt-4o","error":"Rate limited"}
event: run_done     data: {"runId":"…"}
```

Model key format everywhere: `"providerId:modelName"` (e.g. `"my-groq:llama-3.3-70b"`).

## Design System

```css
/* Backgrounds */
--bg-sidebar:     #060608;
--bg-base:        #0a0a0b;
--bg-elevated:    #111113;

/* Borders */
--border:         #1e1e22;   /* always 0.5px solid, never box-shadow */
--border-hover:   #2a2a30;

/* Text */
--text-muted:     #555;
--text-secondary: #888;
--text-primary:   #c8c8c8;
--text-bright:    #e8e8e8;

/* Accent — purple, used sparingly */
--accent:         #7F77DD;
--accent-dim:     #3a3470;
--accent-bg:      #1e1a3a;

/* Semantic */
--success: #5ab87a;  --success-bg: #132018;
--error:   #e05c5c;  --error-bg:   #271515;
--warning: #d4944a;  --warning-bg: #251d0e;
--info:    #5b9bd5;  --info-bg:    #0e1825;

/* Fonts */
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
--font-sans: ui-sans-serif, system-ui, -apple-system, sans-serif;

/* Scale */
--radius-sm: 6px;  --radius-md: 8px;  --radius-lg: 10px;
```

**Typography rule**: monospace for all data (IDs, metrics, token counts, model names in tables, latency values, response text). Sans-serif for headings, nav labels, button labels, UI copy.

## Parallel Agent Split

Write `src/types.ts` and `src/adapters/base.ts` first — everything else depends on them.

| Agent | Scope |
|---|---|
| Agent A | `src/adapters/openai.ts`, `src/adapters/anthropic.ts`, `src/adapters/google.ts` |
| Agent B | `src/api/benchmark.ts`, `src/api/runs.ts`, `src/api/providers.ts`, `src/db/` |
| Agent C | `frontend/src/pages/` |
| Agent D | `frontend/src/components/`, `frontend/src/tokens.css`, `frontend/src/api.ts` |

## Testing Strategy

Tests live in `src/test/` and `src/**/*.test.ts`. Run: `npm test`.

- **Real server** on an isolated port per test file
- **Real SQLite** in a temp directory (not `:memory:`, so tests catch path-related issues)
- **Real HTTP** via `fetch` — no `app.inject()`
- **Mock only**: external API calls to OpenAI/Anthropic/Google (via `vi.mock` on adapter modules)
- **Config isolation**: `process.env.BENCHY_DIR` redirects to temp dir per test suite

See `rules/testing.md` for patterns.

## DevOps Rules

See `rules/devops.md`.

- Keep exactly one remote branch unless a feature branch or PR is explicitly needed
- Default branch is `main`
- Commit before pushing user-visible changes
- Run `npm test` and `npm run build` before pushing code changes
- Documentation-only changes can skip tests if the final note says tests were not run
