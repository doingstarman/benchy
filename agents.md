# benchy — Project Reference

## What it is

Open-source self-hosted AI model benchmarking tool. CLI starts a local server, opens browser. Compare LLMs side by side: run the same prompts across providers, see TTFS / latency / token metrics in one view.

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
       ├─ /api/results     →  src/api/results.ts
       ├─ /api/datasets    →  src/api/datasets.ts
       ├─ /api/library     →  src/api/library.ts     (tools / skills / MCP)
       ├─ /api/uploads     →  src/api/uploads.ts     (attachments)
       ├─ /api/settings    →  src/api/settings.ts
       ├─ /api/mock        →  src/api/mock.ts         (dev-only, ~/.benchy-dev)
       └─ /api/benchmark   →  src/api/benchmark.ts
            getAdapter(provider.type) → one of, all fired via Promise.all:
            ├─ src/adapters/openai.ts     (openai / openai-compatible / local / custom)
            ├─ src/adapters/anthropic.ts
            ├─ src/adapters/google.ts
            ├─ src/adapters/http-json.ts  (custom JSON/SSE endpoint)
            ├─ src/adapters/script.ts     (local command over stdio)
            └─ src/adapters/webhook.ts    (POST to a webhook URL)
```

**Dev mode**: Vite on 5173, proxies `/api` → backend on 4243. Dev config/database live in `~/.benchy-dev/`.  
**Production**: Fastify serves `frontend/dist/` as static on 4242.

Config: `~/.benchy/config.json` — read/written via `src/config.ts`. Never accessed from frontend.  
Database: `~/.benchy/benchy.db` — the live schema (base tables + idempotent `ALTER` migrations) is inlined in `src/db/index.ts`; `src/db/schema.sql` is a canonical read-only mirror of the end state, kept honest by `src/test/schema-sync.test.ts`.

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
npm install -g https://raw.githubusercontent.com/doingstarman/benchy/main/benchy-0.1.0.tgz
benchy           # production CLI: backend + built frontend on 4242
benchy start     # explicit equivalent of benchy
npm run dev      # backend on 4243 + Vite on 5173, using ~/.benchy-dev
npm run build    # TypeScript + production frontend build
npm test         # full test suite
npm run lint     # TypeScript no-emit check
npm run seed     # add mock providers to ~/.benchy-dev/config.json
```

The npm executable is `dist/cli.js`, built from `src/cli.ts` via `tsconfig.build.json`. Keep the shebang in `src/cli.ts`, keep `package.json` `bin.benchy` pointed at `./dist/cli.js`, and refresh the committed `benchy-0.1.0.tgz` with `npm pack` when changing runtime code. The GitHub install command uses that npm tarball; `npm install -g github:doingstarman/benchy` is not the supported path because npm's git-source installer is unreliable on Windows with native dependencies. Production builds must exclude tests from `dist`.

Use `npm run seed` for local demo data. Mock providers use the in-process `/api/mock/chat/completions` route and never call external AI APIs. The mock is **dev-only**: `config.getProviders` filters out `mock-` providers in production, and `server.ts` registers the route only under `~/.benchy-dev` — a production install ships no `/api/mock` endpoint (guarded by `src/test/mock-dev-only.test.ts`).

## File Map

### Backend `src/`

| File | Role |
|---|---|
| `cli.ts` | Entry point. Commander parses `start [--port] [--no-open]` (+ `stop`/`update`), calls `createServer()`, opens browser |
| `server.ts` | Fastify setup. Registers CORS, static, mounts all API routes. Accepts optional `dbPath` for tests. Mock routes gated on `isDevEnvironment()` |
| `config.ts` | `readConfig / writeConfig / getProviders / upsertProvider / removeProvider` + `isDevEnvironment()`. Reads `BENCHY_DIR` env var for test isolation; filters `mock-` providers in prod |
| `types.ts` | All shared types: `Provider`, `ProviderType` (9 values), `ProviderDefaults`, `RunSettings`, `Run`, `Result`, `Message` |
| `pricing.ts` | Curated per-model price table + `resolvePricing` (per-provider overrides win over defaults) |
| `scoring.ts` | Per-field accuracy scoring for dataset runs; `norm_rules` leniency |
| `arena.ts` | Derives Elo / win-loss standings from `dataset_run_verdicts` on read |
| `codeRun.ts` | Runs a model's code solution against a code dataset's hidden tests in an opt-in subprocess sandbox |
| `csv.ts` | Results → CSV export |
| `errors.ts` | `humanizeNetworkError` / `describeHttpError` — adapter-facing error prose |
| `ports.ts` | Free-port selection for the server |
| `version.ts` | Reads the stamped build version |
| `db/index.ts` | `initDb(path?)` — creates DB, runs inline schema + `ALTER` migrations, exposes `getDb()` / `closeDb()`. **Live source of truth for the schema** |
| `db/schema.sql` | Canonical read-only mirror of the end-state schema (not executed at runtime). Kept in sync by `schema-sync.test.ts` |
| `api/providers.ts` | `GET/POST /api/providers`, `DELETE /api/providers/:id`, `POST /api/providers/:id/test` |
| `api/runs.ts` | `GET /api/runs` (filtered), `GET/DELETE/PATCH /api/runs/:id`, `POST /api/runs/:id/fork`, feedback PATCH |
| `api/benchmark.ts` | `POST /api/benchmark` → creates run, fires `Promise.all`. `GET /api/benchmark/stream/:runId` → SSE. Exports `getAdapter(type)` |
| `api/results.ts` | Persisted results + dataset scoring/arena verdict endpoints; CSV export |
| `api/datasets.ts` | Dataset + item CRUD, uploads, AI-fill (trusted-model suggestions), run launching |
| `api/library.ts` | Custom tools / skills / MCP-server definitions |
| `api/uploads.ts` | Attachment upload + unbound-upload GC |
| `api/settings.ts` | Server settings |
| `api/version.ts` | `GET /api/version` |
| `api/csrf.ts` | CSRF origin guard for mutating routes |
| `api/mock.ts` | **Dev-only** local streaming mock endpoint (canned + dataset-matched responses, incl. a `game` HTML demo). No external calls |
| `adapters/base.ts` | `Adapter` interface, `Chunk` union, `Usage`, `AdapterConfig`, `Message`, `ToolCall`/`ToolResult`/`ToolSpec` |
| `adapters/openai.ts` | OpenAI-compatible: raw fetch + SSE parser, `<think>`-tag reasoning. Covers OpenAI, Groq, Together, OpenRouter, Ollama, LM Studio, DeepSeek, Mistral, xAI, `local`/`custom` |
| `adapters/anthropic.ts` | `@anthropic-ai/sdk` stream API → `Chunk` |
| `adapters/google.ts` | `@google/generative-ai` stream → `Chunk` |
| `adapters/http-json.ts` | Custom HTTP endpoint: `POST { messages, model }`, Bearer auth, JSON or SSE reply |
| `adapters/script.ts` | Local command over stdio (`spawn`) — treat any program as a model |
| `adapters/webhook.ts` | `POST { model, messages, timestamp }` to a webhook URL, `X-Webhook-Secret` auth |
| `adapters/think-tags.ts` | `ThinkTagParser` — splits `<think>…</think>` out of OpenAI-compatible content into `reasoning` chunks (used by `openai.ts`) |
| `tools/` | Built-in tools (`calc`, `fetch-url`, `web-search`), `http-tool` (custom HTTP tools), `mcp` client, `ssrf` guard, registry in `index.ts` |
| `seed.ts` | Seeds mock providers into `~/.benchy-dev` config for local demo use |

### Frontend `frontend/src/`

| File | Role |
|---|---|
| `main.tsx` | React root, StrictMode |
| `App.tsx` | Layout shell: `<Sidebar>` + `<Outlet />` |
| `router.tsx` | `BrowserRouter` + routes: `/` (→ `run`), `run`, `results`, `results/:runId`, `history`, `providers`, `library`, `datasets`, `datasets/:id`, `settings` |
| `i18n.ts` | Lightweight EN/RU i18n store + `useT()` hook + `DICT`. Every UI string keys through here |
| `tokens.css` | All CSS custom properties. Source of truth for colors/spacing/radii |
| `api.ts` | Typed `fetch` wrappers for all endpoints + `useSSE(runId, onEvent)` hook |
| `lib/artifact.ts` | `splitFencedSegments` / `isRunnableCode` / `wholeAnswerHtml` — parse an answer into prose + runnable HTML segments for the code preview |
| `pages/NewRun.tsx` | The run view: model selector (provider tree, chips) + prompts, then live side-by-side answer cells (streaming, metrics, cost, code preview) |
| `pages/Results.tsx` | SSE-driven live run view (shared cell rendering with NewRun) |
| `pages/ResultsDb.tsx` | Persisted run view loaded from the DB (no SSE) |
| `pages/History.tsx` | Runs table with filters (search/date/status), hover-reveal fork+delete |
| `pages/Providers.tsx` | Provider grid by section; connect/disconnect/test modal; per-provider pricing (Advanced) |
| `pages/Datasets.tsx` | Dataset list + create (files/text/tools/code) |
| `pages/DatasetDetail.tsx` | Dataset items, variable schema, ground-truth + AI-fill, run launcher |
| `pages/Library.tsx` | Tools / skills / MCP tabs (built-in + custom) |
| `pages/Settings.tsx` | Server info, about, language |
| `components/Sidebar.tsx` | Nav links with active state (white text + 2px purple left bar) |
| `components/MetricsBar.tsx` | TTFS, total time, tokens in/reasoning/out, cost. Star on fastest TTFS |
| `components/ResponseCard.tsx` | Model header, streaming text, MetricsBar, thumbs feedback |
| `components/ActivityTrace.tsx` | Reasoning/thinking trace panel for a cell |
| `components/CodeBlock.tsx` | ChatGPT-style windowed code block: listing ↔ sandboxed live preview |
| `components/ArtifactPreview.tsx` | Sandboxed `<iframe>` that runs a code artifact |
| `components/DatasetRunPanel.tsx` | Dataset run controls (subsample, arena/score mode) |
| `components/TestAnalytics.tsx` | Per-run scoring / accuracy charts |
| `components/ProviderTile.tsx` | Provider card: name, status dot, model count. Opens modal on click |
| `components/SliderField.tsx` | Labeled slider used by settings/generation params |
| `components/UpdateBanner.tsx` | "A new build is available" banner |
| `components/icons.tsx`, `components/ui.tsx` | Shared SVG icons and primitive UI (`IconButton`, …) |

## Adapter Contract

`src/adapters/base.ts` is the source of truth. Must be stable before any adapter is written.

```typescript
export interface Adapter {
  stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk>
}

export type Chunk =
  | { type: 'token'; text: string }
  | { type: 'reasoning'; text: string }   // thinking — kept OUT of TTFS and the answer
  | { type: 'tool_call'; call: ToolCall }  // adapter emits once the whole call is assembled
  | { type: 'done'; usage: Usage }
  | { type: 'error'; message: string }
```

The benchmark loop — not the adapter — runs the tool a `tool_call` names and re-streams with the result. `reasoning` is streamed and stored separately so a thinking model's TTFS stays "time to first **answer** token" and remains comparable across runs.

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
event: cell_start        data: {"runId":"…","promptIndex":0,"model":"openai:gpt-4o"}
event: cell_reasoning     data: {"…","text":"Let me think…"}     # thinking token (not answer)
event: cell_token         data: {"…","text":"Hello"}
event: cell_tool_call     data: {"…","id":"…","name":"calc","args":{…}}
event: cell_tool_result   data: {"…","id":"…","name":"calc","content":"43","isError":false,"ms":4}
event: cell_done          data: {"…","ttfs":312,"totalTime":1840,"usage":{…}}
event: cell_error         data: {"…","error":"Rate limited"}
event: run_done           data: {"runId":"…"}
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

The original build split (historical — the app is built; kept as the seam map for
parallelizing large changes). Contracts first: write/settle `src/types.ts` and
`src/adapters/base.ts` before anything that depends on them.

| Agent | Scope |
|---|---|
| Agent A | `src/adapters/*` (six adapters + `think-tags`), `src/tools/` |
| Agent B | `src/api/*`, `src/db/`, scoring/arena/pricing (`scoring.ts`, `arena.ts`, `pricing.ts`, `codeRun.ts`) |
| Agent C | `frontend/src/pages/` |
| Agent D | `frontend/src/components/`, `frontend/src/tokens.css`, `frontend/src/api.ts`, `frontend/src/i18n.ts` |

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
