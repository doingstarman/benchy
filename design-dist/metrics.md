<!-- @dsCard group="Metrics" -->
# Metrics — design reference (stage 2)

Source of truth: Claude Design project `d0c0be4e-79d3-4f67-9c69-881ac641ea6f`
("Metrics Registry"), re-syncable via the project's `github.md`. The four `.dc.html`
mockups (`Metrics Registry`, `Metric Editor`, `Metric Picker`, `Metrics in Context`)
live there; this file records the contract they encode so the implementation has a
committed reference. Design wins on layout; this note wins on the data model.

## The registry
Every value benchy can measure, format and compare — **built-in or custom**.

Fields per metric: `key` (slug), `name`, `kind` (builtin|custom), `expression`
(custom) or a column/function `source` (builtin), `unit`, `format`
(`raw|ms|s|tokens|usd|pct`), `direction` (`↓ lower | ↑ higher | · neutral`),
`scope` (`per answer | per run`) + `aggregate` (run: mean|median|p50|p95|min|max|sum),
`nullable`, `enabled`.

**Built-ins (9, fixed name/key/unit/direction; enable/disable + duplicate only):**
`ttfs` (ms,↓,nullable), `total_time` (ms→s,↓), `input_tokens` (tok,·,nullable),
`reasoning_tokens` (tok,·,nullable), `reasoning_ms` (ms→s,·,nullable, **off by
default**), `output_tokens` (tok,·,nullable), `score` (%,↑, per-run mean, nullable),
`cost` (USD,↓, per-run sum, nullable), `elo` (rating,↑, per-run, nullable).

**Custom = an expression over existing metric keys**, e.g. `output_tokens /
total_time * 1000` (tokens/sec), `cost / score` (cost per correct),
`reasoning_tokens / output_tokens * 100` (thinking share), `p95(ttfs)`. Full CRUD;
**evaluated after every run and materialized** (built-ins are never materialized).

## The rule that shapes everything
A **built-in metric is a registry record pointing at an existing `results` column or
a pure function over columns** (cost = tokens×pricing at read time). Built-ins are
NOT copied into a values table. **Only custom metrics materialize** (`metric_values`).

## Editor (Metric Editor.dc.html)
Centered modal (or drawer when a table stays visible). One-line mono expression with
a dotted underline on recognised keys and an error-tint span on the offending token;
one plain sentence names the bad token + a fix chip when guessable. Input picker
(built-in / custom groups + function chips: mean median p50 p95 min max sum abs round
clamp — aggregates only under `per run`). Unit, Format select, Direction segmented,
Scope + aggregate. **Live preview**: 5 recent real results, coverage counter (e.g.
2/5); a `null` renders as an em-dash with the reason, a real `0` renders as "0" —
**null is never zero**. Save blocked on a syntax/unknown-key error; a "produces no
value for some samples" case warns but saves (nullable).

## Registry screen (Metrics Registry.dc.html)
Lives as a **Settings subsection** (214px section rail; v1 choice — it's config, not
a working surface). Grouped By source (Built-in / Custom) or Flat; search; New
metric. Built-in rows: enable + duplicate. Custom rows: edit + duplicate + delete.
Direction column shares the arrow that later marks the best cell; `nullable` noted in
the source column. Legend: ↓ lower · ↑ higher · · no best · nullable = can report no
value, never shown as 0.

## Deferred to the display stage (Metric Picker + Metrics in Context)
The Picker (compact column-chooser + full configure-metrics popover, presets, per-
metric format, reorder) and the in-context rendering (one metric cell primitive at
three densities: per-answer strip / comparison table / target-row delta; direction-
aware accent only for non-neutral metrics; null≠0 with a coverage counter) are the
NEXT stage. Their mockups also hint at a larger future built-in catalog
(time_to_last_token, total_tokens, cached_tokens, answer_chars, tool_calls, cost_in,
cost_out, run_duration, avg_score, wins, error_rate, retry_count, refusal_rate) —
out of scope for the metrics core.
