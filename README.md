# benchy

Self-hosted LLM benchmarking tool. One command starts a local server, opens the browser — run the same prompts against multiple providers **in parallel** and compare answers, speed and cost side by side.

Everything stays on your machine: API keys and config in `~/.benchy/config.json`, run history in a local SQLite database. No accounts, no telemetry.

## Install

```bash
npm install -g https://raw.githubusercontent.com/doingstarman/benchy/main/benchy-0.1.0.tgz
benchy
```

By default, `benchy` starts the local server on `http://localhost:4242` and opens the browser. Use `benchy start --no-open` to keep the browser closed.

The `benchy` name on the public npm registry is not this project yet. Until this package is published there, install the GitHub-hosted npm tarball with the command above.

## What it does

- **Side-by-side runs** — one prompt → all models, a different prompt per model, or a batch of prompts fanned out to every selected model. All provider calls fire in parallel; responses stream in live.
- **Chat mode** — any run can be continued as a multi-turn conversation. Each model keeps *its own* dialog branch: it sees your messages and its previous replies, never the other models' answers.
- **Attachments** — drop an image or PDF into the prompt (file picker, `Ctrl+V` a screenshot, or drag & drop; PNG/JPEG/WebP/GIF/PDF, up to 10 MB) and benchmark how each model handles it. A provider that can't take the format says so in its own card, with a pointer to its docs — the capability gap *is* the signal, so nothing is silently dropped.
- **Canvas preview** — when a model generates HTML/CSS/JS, render it in a sandboxed iframe right in the result card. Compare two models' takes on the same game or UI, playable side by side.
- **Metrics** — time to first token (TTFS), total time, input/output tokens per response; the fastest card in each turn gets highlighted.
- **History** — every run is a session: revisit it, rename it after your test, reopen it from the sidebar and keep chatting. The sidebar shows your last 5 dialogs.
- **Human-readable errors** — connection refused, bad API key, rate limits and the like are reported as actionable messages, not `fetch failed`.
- **English / Russian** — the whole interface switches language from Settings; it follows your browser's locale by default.
- **Update notices** — benchy compares its own build against the latest one published here and tells you when a newer one is installable, in the app and on startup. Nothing auto-installs: you run `benchy update` yourself.

## Providers

| Kind | Examples |
|---|---|
| Official APIs | OpenAI, Anthropic, Google |
| OpenAI-compatible | Mistral, DeepSeek, xAI, Groq, Together AI, OpenRouter — any `/chat/completions` endpoint |
| Local | Ollama, LM Studio |
| Custom integrations | HTTP JSON endpoint, local script (stdin/stdout), webhook |

All adapters stream — required for accurate TTFS.

## CLI

| Command | What it does |
|---|---|
| `benchy` / `benchy start` | Start the server on port 4242 (`--port`, `--config-dir`, `--no-open`); prints a notice if a newer build is available |
| `benchy stop [--port]` | Stop a running server |
| `benchy update` | Update to the latest version from GitHub, in place. Restart benchy afterwards to apply it |

## Development

```bash
npm install
npm run dev    # backend :4243 (tsx watch) + Vite :5173 with HMR
npm run seed   # seed mock providers into ~/.benchy-dev — no API keys needed
npm test       # vitest: real HTTP, real SQLite, mocked external APIs
```

Dev mode is fully isolated from production: it uses port 4243 and keeps config/database under `~/.benchy-dev/`. The seeded mock providers simulate streaming with realistic latencies, so the whole UI is testable offline.

Architecture, file map and design system: see [agents.md](agents.md) and [rules/](rules/).
