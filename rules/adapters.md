# Adapter Rules

## The Contract

All adapters implement `Adapter` from `src/adapters/base.ts`:

```typescript
interface Adapter {
  stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk>
}

type Chunk =
  | { type: 'token'; text: string }
  | { type: 'reasoning'; text: string }   // the model's thinking — NOT the answer
  | { type: 'tool_call'; call: ToolCall }  // model wants a tool run
  | { type: 'done'; usage: Usage }
  | { type: 'error'; message: string }
```

An adapter must:
1. Yield `{ type: 'token', text }` for each **answer** token received
2. Yield `{ type: 'reasoning', text }` for thinking tokens — kept separate all the
   way to the UI so TTFS stays "time to first *answer* token" (a thinking model's
   TTFS would otherwise collapse and stop comparing against past runs)
3. Yield `{ type: 'tool_call', call }` once it has assembled a whole tool call
   (over chat/completions the arguments arrive as fragments). The benchmark loop —
   **not the adapter** — runs the tool and re-streams with the result
4. Yield exactly one `{ type: 'done', usage }` at the end with token counts
5. Yield `{ type: 'error', message }` on failure — **never throw**

## TTFS Measurement

TTFS is measured in `src/api/benchmark.ts`, not in the adapters. `t0` is recorded
immediately before the `for await` begins (which triggers the first `await` inside
the adapter, hence `fetch()`), and TTFS is stamped on the first **`token`** chunk —
`reasoning` chunks do not count.

```typescript
const t0 = Date.now()
for await (const chunk of adapter.stream(messages, config)) {
  if (chunk.type === 'token' && ttfs === null) ttfs = Date.now() - t0
}
```

TTFS includes the network round-trip + provider time-to-first-token; it excludes
request serialization/header setup (synchronous, negligible).

## The Six Adapters

There is **one adapter per transport shape**, not per vendor. `getAdapter(type)` in
`src/api/benchmark.ts` dispatches on `provider.type`:

| `ProviderType` | Adapter |
|---|---|
| `anthropic` | `anthropic.ts` |
| `google` | `google.ts` |
| `http-json` | `http-json.ts` |
| `script` | `script.ts` |
| `webhook` | `webhook.ts` |
| `openai` / `openai-compatible` / `local` / `custom` (default) | `openai.ts` |

### `openai` — OpenAI-compatible

Covers OpenAI, Groq, Fireworks, Together, OpenRouter, Replicate, Ollama, LM Studio,
DeepSeek, Mistral, xAI, and any `local`/`custom` endpoint.
- Raw `fetch` with `stream: true` + `stream_options: { include_usage: true }`
- Parses `data: {...}` SSE lines; usage arrives in a final chunk with `choices: []`
- `response.ok === false` → emit `error`, return
- Base URL: `config.baseUrl ?? 'https://api.openai.com/v1'`
- Reasoning: uses `ThinkTagParser` (`think-tags.ts`) to split inline
  `<think>…</think>` out of `delta.content` into `reasoning` chunks (Ollama/vLLM/
  llama.cpp and hosted qwen/deepseek builds have no reasoning field)

### `anthropic` — Anthropic Claude

Uses `@anthropic-ai/sdk` streaming.
- System messages → the `system` parameter (not the messages array)
- `max_tokens: config.settings?.maxOutputTokens ?? 4096` (Anthropic requires it)
- Extended thinking: `thinking: { type: 'adaptive' }` when
  `config.settings.extendedThinking === true` **and** no tools are enabled (a
  thinking turn that calls a tool must replay its signed thinking block, which
  benchy's loop doesn't carry — so thinking is forced off when tools are on)
- Usage from `stream.finalMessage()`; custom `baseURL` via SDK constructor

### `google` — Google Gemini

Uses `@google/generative-ai`.
- System messages → `systemInstruction`
- History = all messages except the last (the chat model takes history separately)
- Usage from `chunk.usageMetadata` during streaming (keep the last value)

### `http-json` — custom HTTP endpoint

- `POST config.baseUrl` with `{ messages, model }`, `Authorization: Bearer` if a key
- Reads the reply by `content-type`: `text/event-stream` → parse `data:` SSE lines;
  otherwise a plain JSON body

### `script` — local command over stdio

- `config.baseUrl` is a shell-less command (`spawn`, `shell: false`); messages are
  piped to stdin, stdout is the answer, non-zero exit → `error`
- Treat any local program as a "model"

### `webhook` — POST to a webhook URL

- `POST config.baseUrl` with `{ model, messages, timestamp }`,
  `X-Webhook-Secret: config.apiKey`

## Adding a Provider vs. Adding an Adapter

**A new hosted LLM that speaks OpenAI's API is a provider config, not code.** To add
Fireworks / xAI / any OpenAI-compatible service:

1. Add a preset in `frontend/src/pages/Providers.tsx` with its `baseUrl`
2. Set `type: 'openai-compatible'`
3. The `openai` adapter handles it via `config.baseUrl` — no new file

Add a new adapter **only** for a genuinely new transport (not OpenAI-compatible, not
the Anthropic/Google SDK, not one of the three custom shapes above), and wire it
through `getAdapter`.

## Streaming is Mandatory

All adapters must stream. There is no batch mode — the `AsyncIterable<Chunk>`
contract enforces it. Yielding every token at once after completion makes TTFS equal
total time.

## Error Handling

```typescript
// ✅ catch everything, yield an error chunk
try {
  // ... streaming logic
} catch (err) {
  yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
}

// ❌ never throw from an adapter
throw new Error('Something went wrong')
```

The benchmark engine catches `chunk.type === 'error'`, stores it in the result's
`error` field, marks the result errored, and broadcasts `cell_error` via SSE. The
run continues with other cells. Use `humanizeNetworkError` / `describeHttpError`
from `src/errors.ts` for network/HTTP failures — never leak a raw stack.
