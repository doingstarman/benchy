# Agents — design reference (stage 3)

Source: Claude Design project `b31adc46-7f68-4809-a751-5d2840290ba5` (four screens:
`agents-list`, `agent-editor`, `trace-view`, `agent-vs-model`). Design wins on layout;
the stage prompt wins on the data model/protocol. This file is the binding summary —
the full `.dc.html` mockups live in the Design project (same convention as
[metrics.md](metrics.md)).

## agents-list
The Models screen for `kind='agent'`: grouped list, `TargetRow` + `TypeBadge` (the agent
badge is **dashed**, model is solid), `MetricCell`. Health surfaces per row (green/red
from the last handshake). Pipelines/Dashboard stay disabled.

## agent-editor
A **drawer** over the dimmed list (not a centered modal). A **segmented transport
switch** (LOCAL COMMAND / HTTP ENDPOINT) that truly swaps the fields under it — the two
transports' fields are never visible together. Command: command, working dir, env rows.
HTTP: url, auth header + secret. **Secrets are a per-row toggle**, rendered exactly like
the provider API-key field (mask + "replace", value never returned) — not a separate
section. Limits (timeout / max steps / max cost / retries) with "task aborts on the first
reached". A **verify** section (handshake) reporting on **two axes**: process (ran, exit
code, wall) and structure (how many step events) — which is why there are **three
outcomes, not two**: full trace / ran-but-no-structure (degraded, values show "—") /
process died (red). Verify diagnoses; it never auto-disables the agent.

## trace-view (the primitive — `components/TraceView.tsx`)
Props: `steps` + a `live` flag; **fetches nothing itself**. Two developments of the same
data, a toggle not a fork:
- **A — indented list (primary):** one row per step — `# · glyph+name · tokens · ms ·
  share-bar`. Nesting = 14px indent/level + bar lightening, ≤3 deep; deeper flattens to
  "+N nested". Reads the same at 40 steps and in a narrow compare column.
- **B — timeline (toggle "время"):** proportional time axis; bar X = start/total, width =
  duration. Answers "where did the 55s go" at a glance; degenerates when narrow (that's
  the argument for A being primary).

Load-bearing behaviors:
- **Payload opens in a pinned side panel** (wide) or bottom sheet (narrow) — expanding
  step 3 can NEVER shift step 30.
- **Live = no autoscroll:** new steps append at the bottom; the only thing that moves is a
  "+N below ↓" pill. While streaming, **no share % and no time axis** — the denominator
  (wall-clock) isn't known yet.
- Tokens column: **hatched = not applicable** (a `think` step has no tokens) vs **`—` =
  not reported** (a `model` step that gave no usage). Two forms, never confused: hatch is
  a texture, em-dash is a symbol.
- **Three reds on two axes, not three shades:** process error = solid dot (`--error`);
  retry that recovered = warning **ring** (`--warning`, "restored", not a run failure); a
  wrong answer on a green trajectory is NEVER red here — it lives in agent-vs-model as a
  score chip.

Glyphs: think = hollow circle · tool = filled square · model = rotated square (diamond) ·
retry = warning ring · error = error dot · answer = success dot. Bar color: error→error,
retry→warning, model→secondary, else→border-hover.

## agent-vs-model (the comparison — Results/NewRun columns)
Two model columns and an agent column share the **same metric rows**. Asymmetry is a
**cell state**, not a separate "agent-only" block: a metric a participant kind can't have
is drawn as a **hatched empty cell** (135° repeating-linear-gradient) — no glyph, no
number, no color, `title` = "not applicable to this kind". This is **distinct** from
**`—` (muted em-dash) = "participant didn't report a value (never zero)"**. A "trajectory
metrics — agents only" sub-header separates the two groups. Process status = a left dot;
correctness = a right score chip (`--error-bg` when wrong) — two axes, never merged into
one row. Rejected: a plain dash for not-applicable (reads as "didn't compute"), and a grey
"n/a" badge in every cell (nine useless words in a 9-row table).

## Backend mapping (this stage)
`appliesTo: TargetKind[]` on every metric encodes the hatch-vs-dash distinction: a metric
whose `appliesTo` excludes a target's kind is **skipped** (hatched), never null and never
0. `steps`/`tool_calls`/`tool_error_rate`/`agent_cost`/`wall_clock` are `appliesTo:
['agent']`; `ttfs`/`reasoning_*`/`elo`/`cost` are model-side; `total_time`/tokens/`score`
are both.
