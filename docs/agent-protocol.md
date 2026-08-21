# benchy agent trace protocol

Make your program a benchmark participant. benchy runs it, reads the trajectory it
prints, stores it, and turns it into metrics — beside your model columns.

benchy **observes** your agent. It never runs your agent's tools or controls its
steps: you already ran them, you just tell benchy what happened.

## The wire

- **Local command:** benchy spawns your program, writes one JSON object to **stdin**
  (`{ "messages": [...], "model": "<target-id>" }`), and reads **JSONL from stdout** —
  one JSON object per line.
- **HTTP endpoint:** benchy POSTs the same body; stream **NDJSON** back
  (`Content-Type: application/x-ndjson`), one JSON object per line.

**A line that is not JSON with a known `type` is treated as an output token.** So a
plain script that just prints its answer already works — it is a valid (degraded)
participant that reports an answer but no trajectory.

## Line types

| `type` | meaning | key fields |
|---|---|---|
| `step` | a trajectory node (thinking, planning, …) | `kind` (`think`/`plan`/`retry`/`answer`), `name`, `ms` |
| `tool` | a tool your agent **already ran** | `name`, `ms`, `args`, `result`, `isError` |
| `model` | an LLM call your agent made | `name`, `usage:{inputTokens,outputTokens}`, `cost` |
| `token` | a token of the final answer | `text` |
| `reasoning` | your agent's own thinking text | `text` |
| `error` | something went wrong | `scope`, `name` |
| `done` | terminal | `usage` |

Common optional fields on any node: `id` (unique per run), `parent` (an **earlier**
`id`, or omit for a root), `ms` (self-time), `cost` (USD).

### `error.scope` — three distinct outcomes

- `tool` — a tool call failed but your agent can recover. Recorded as a step; the run
  continues.
- `agent` — the process died. Terminal.
- `task` — your agent reached the end and **declares failure**. Terminal, but it is a
  real answer, not a crash.

### Rules benchy enforces (never fatal)

- An `id` that repeats is reassigned; a `parent` that points forward or nowhere is
  dropped to a root (with a warning).
- Nesting deeper than 3 levels is flattened onto the nearest allowed ancestor.
- A step's payload (its non-standard fields) is capped (8 KB by default) and the
  truncation is flagged, never silently cut.
- **`cost`:** if you report it, benchy trusts it. Otherwise, if you send `usage` and
  benchy knows the model's price, it computes it. Otherwise cost is **null — never 0**
  (a fabricated `0` reads as "free", which is worse than "unknown").

## Python — full protocol (~30 lines)

```python
import sys, json, time

def emit(obj): print(json.dumps(obj), flush=True)

req = json.loads(sys.stdin.read())            # { "messages": [...], "model": "..." }
question = req["messages"][-1]["content"]

t = time.time()
emit({"type": "step", "id": "s1", "kind": "think", "name": "read the question",
      "ms": int((time.time() - t) * 1000)})

emit({"type": "tool", "id": "s2", "parent": "s1", "name": "calculator",
      "args": {"expr": "2+2"}, "result": "4", "ms": 3})

emit({"type": "model", "id": "s3", "name": "gpt-4o",
      "usage": {"inputTokens": 42, "outputTokens": 5}, "cost": 0.0004, "ms": 900})

for tok in ["The", " answer", " is", " 4."]:
    emit({"type": "token", "text": tok})

emit({"type": "done", "usage": {"inputTokens": 42, "outputTokens": 5}})
```

## Node — full protocol

```js
const chunks = []
process.stdin.on('data', d => chunks.push(d))
process.stdin.on('end', () => {
  const req = JSON.parse(Buffer.concat(chunks).toString())
  const emit = o => process.stdout.write(JSON.stringify(o) + '\n')

  emit({ type: 'step', id: 's1', kind: 'think', name: 'read the question', ms: 4 })
  emit({ type: 'tool', id: 's2', parent: 's1', name: 'calculator',
         args: { expr: '2+2' }, result: '4', ms: 3 })
  emit({ type: 'model', id: 's3', name: 'gpt-4o',
         usage: { inputTokens: 42, outputTokens: 5 }, cost: 0.0004, ms: 900 })
  for (const t of ['The', ' answer', ' is', ' 4.']) emit({ type: 'token', text: t })
  emit({ type: 'done', usage: { inputTokens: 42, outputTokens: 5 } })
})
```

## Limits & secrets

An agent target sets `timeoutMs`, `maxSteps`, and `maxCostUsd`; the task aborts on the
first one reached (SIGTERM, then SIGKILL) and is recorded as `error scope:agent`.

Secrets are stored **by name** in `~/.benchy/config.json` and injected into your
program's environment at spawn (command transport) or the auth header (http). The
target row only ever holds the **names**, never the values, and no API response
returns a value.
