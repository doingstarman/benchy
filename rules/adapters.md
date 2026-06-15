# Adapter Rules

## The Contract

All adapters implement `Adapter` from `src/adapters/base.ts`:

```typescript
interface Adapter {
  stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk>
}

type Chunk =
  | { type: 'token'; text: string }
  | { type: 'done'; usage: Usage }
  | { type: 'error'; message: string }
```

An adapter must:
1. Yield `{ type: 'token', text }` for each text token received
2. Yield exactly one `{ type: 'done', usage }` at the end with token counts
3. Yield `{ type: 'error', message }` on failure (instead of throwing)
4. Never throw — wrap all errors in `{ type: 'error' }`

## TTFS Measurement

TTFS is measured in `src/api/benchmark.ts`, not in the adapters:

```typescript
const t0 = Date.now()
for await (const chunk of adapter.stream(messages, config)) {
  if (chunk.type === 'token' && ttfs === null) {
    ttfs = Date.now() - t0  // ← first token received
  }
}
```

`t0` is recorded immediately before the `for await` begins (which triggers the first `await` inside the adapter, which triggers `fetch()`). This means TTFS includes:
- Network round-trip to the provider
- Provider time-to-first-token
- Does NOT include: request body serialization, header setup (these are synchronous and negligible)

## The 3 Adapters

### `openai` — OpenAI-compatible

Covers: OpenAI, Groq, Fireworks AI, Together AI, OpenRouter, HuggingFace Inference, Replicate, Ollama, LM Studio, DeepSeek, Mistral, xAI, any custom endpoint.

Key details:
- Raw `fetch` with `stream: true` + `stream_options: { include_usage: true }`
- Parses `data: {...}` lines from the response body
- Usage comes in a final chunk with `choices: []` and `usage` field
- Error detection: `response.ok === false` → emit error, return
- Custom base URL: `config.baseUrl ?? 'https://api.openai.com/v1'`

### `anthropic` — Anthropic Claude

Uses `@anthropic-ai/sdk` streaming API. Key details:
- System messages are extracted and passed as the `system` parameter (not in the messages array)
- Max tokens: 4096 (hardcoded — Anthropic requires this parameter)
- Usage comes from `stream.finalMessage()` after the loop
- Supports custom `baseURL` via SDK constructor option

### `google` — Google Gemini

Uses `@google/generative-ai`. Key details:
- System messages extracted into `systemInstruction`
- History = all messages except the last one (chat model requires history separately)
- Usage comes from `chunk.usageMetadata` during streaming (accumulate last value)
- No custom base URL support currently (Google SDK doesn't expose it simply)

## Adding a New Provider

**Don't add a new adapter.** The `openai` adapter covers all OpenAI-compatible APIs. To add a new provider like Fireworks AI or xAI:

1. Add it as a preset in `frontend/src/pages/Providers.tsx` with its `baseUrl`
2. Set `type: 'openai-compatible'` and the correct `baseUrl`
3. The openai adapter handles it automatically via `config.baseUrl`

Only add a new adapter file if the provider uses a fundamentally different API protocol (not OpenAI-compatible, not Anthropic SDK, not Google GenAI).

## Streaming is Mandatory

All adapters must stream. There is no batch/non-streaming mode. This is enforced by the `AsyncIterable<Chunk>` contract — if you implement `stream()` as a function that yields all tokens at once after completion, TTFS will be wrong (it will equal total time).

## Error Handling

```typescript
// ✅ Catch all errors, yield error chunk
try {
  // ... streaming logic
} catch (err) {
  yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
}

// ❌ Don't throw from an adapter
throw new Error('Something went wrong')
```

The benchmark engine catches `chunk.type === 'error'` and stores it in the result's `error` field, marks the result as errored, and broadcasts `cell_error` via SSE. The run continues with other cells.
