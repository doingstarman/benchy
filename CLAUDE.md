# benchy

Self-hosted AI model benchmarking tool. One command starts a local server on port 4242, opens browser. Run same prompts against multiple LLM providers in parallel — see TTFS / latency / token metrics side by side.

→ **[agents.md](agents.md)** — architecture, file map, design system, SSE protocol, agent split strategy  
→ **[rules/](rules/)** — focused rulesets: TypeScript, API, UI, testing, adapters

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Backend (tsx watch, port 4242) + Vite (port 5173) with HMR |
| `npm run build` | tsc + vite build → `frontend/dist/` |
| `npm run start` | Serve built app on port 4242 |
| `npm test` | vitest (real HTTP, real SQLite, mocked external APIs) |
| `npm run lint` | tsc --noEmit |

## Hard Constraints

| Constraint | Rule |
|---|---|
| Port | **4242** — hardcoded everywhere, never configurable via UI |
| Config | `~/.benchy/config.json` — never read from frontend, always via `/api/providers` |
| Database | SQLite only via better-sqlite3, file at `~/.benchy/benchy.db` |
| Adapters | Exactly 3: `openai` (OpenAI-compatible), `anthropic`, `google` |
| Parallelism | All provider calls via `Promise.all` — never sequential |
| Streaming | All adapters must stream — required for accurate TTFS |
| Frontend | Built by Vite into `frontend/dist/`, served as static by Fastify |

## What NOT to do

- Don't add a 4th adapter — the openai adapter already covers all OpenAI-compatible endpoints
- Don't add `any` types or `as unknown as X` casts
- Don't add default exports — named exports only
- Don't write comments explaining what code does — only why, when non-obvious
- Don't add error handling for impossible cases — validate only at API boundary
- Don't add sequential fallback when `Promise.all` fails — let it fail loudly
- Don't read `~/.benchy/config.json` from frontend code under any circumstances
