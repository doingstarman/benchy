# benchy — roadmap & backlog

Status of the `targets` (participants) line of work and everything still open, specced
to a level you can pick up and execute. Companion to [agents.md](../agents.md) (arch) and
the stage history in memory. Each open item lists **goal / scope / approach + files /
done-when**. Legend: ✅ shipped · 🅿️ parked · ⬜ open · 🔒 needs a product spec from you.

---

## Shipped

- ✅ **Stage 1 — targets registry + Models screen** (`585db5c`). A target = a benchmark
  participant (base model + overrides), persisted. `targets` table, CRUD, `/models`.
- ✅ **Stage 2 — metrics registry** (`23e5122`). Built-ins in code over existing columns;
  custom metrics = expressions materialized into `metric_values`. Settings subsection.
- ✅ **Stage 3 — agents** (`99ef3cc`). A user's program as a participant: trace protocol,
  `kind='agent'` targets + secrets-by-name, handshake, `trace_steps`, `runAgentCell`, 5
  agent metrics + `appliesTo`, Agents page, `TraceView`, live agent column in /run, trace
  in reopened results. Docs + examples.
- ✅ **Stage 3 finish — agent-vs-model table** (`a6334fc`). Results surface where model and
  agent columns share metric rows; not-applicable = hatched cell (distinct from `—`/`0`),
  "trajectory metrics — agents only" sub-header, process dot + score chip on two axes.
  Client-side via the pure resolver; `lib/metricsView.ts` + `ParticipantCompare.tsx`.
- ✅ **Agent health dot** (`c6e6613`). Handshake persists its outcome as `lastHandshake` on
  the (value-free) agent config; the list shows green (full/degraded) / red (crashed) /
  muted (unverified). Diagnostic only — never disables the agent.
- ✅ **Agent metrics in ResponseCard** (`04452da`). `AgentMetricsBar` (steps/tools/cost/time)
  replaces the model `MetricsBar` for agent results, derived from the fetched trace.
- ✅ **Test flake hardening** (`f9de236`). Raised the `/api/version` test timeout (two 5s
  GitHub fetches vs a 5s default) and isolated `mock-dev-only` teardown so ordering can't
  leak.

---

## Open — design-complete (no product spec needed)

_All three items here shipped (2026-08-26) — see **Shipped** above: #1 agent-vs-model
table, #2 agent health dot, #3 agent metrics in ResponseCard, plus the flake hardening._

---

## Open — needs a product spec from you  🔒

### 4. Stage 4 — Pipelines  🔒  · priority: high (next roadmap stage)
`kind='pipeline'` is already reserved in `TargetKind`; the sidebar item is a disabled stub.
A pipeline = a participant that is itself a chain/graph of participants. Open product
questions I need answered before design (same fidelity as the Stage-3 prompt):
- **Shape.** Linear chain only, or a DAG? Does a stage's output feed the next as its prompt,
  or is there routing/branching?
- **Members.** Can a stage be a model, an agent, *and* another pipeline (nesting)? How deep?
- **Trace.** Does a pipeline run reuse `trace_steps` (each stage = a step, nested), or a new
  store? (Stage 3 deliberately made `trace_steps` stage-4-queryable — likely reuse.)
- **Metrics.** How do per-stage metrics roll up to the pipeline? Sum cost, max wall-clock,
  etc.? `appliesTo` already has a `'pipeline'` slot.
- **Config + UI.** How is a pipeline authored (a builder screen?) and how does it join a run?
- **Orchestration.** benchy runs the stages (like the tool loop), vs. an external pipeline
  benchy only observes (like an agent)? This is the load-bearing choice.

### 5. Dashboard  🔒  · priority: medium
Disabled nav stub. Needs a product spec: what does it summarize (recent runs, per-model
trends, cost over time, arena standings?), and is it a landing surface or a report?

---

## Parked  🅿️

### 6. Metrics in context (display)  🅿️
Built then reverted at your request (option A: keep only the Settings registry, show custom
metrics nowhere). Recoverable at tag `parked/metrics-in-context` (`b5cba36`). If revived,
likely lands on a Results/comparison surface, NOT the live compose view. Related deferred
display work that would ride with it: per-run metric columns in the ResultsDb list, the
DatasetDetail score matrix, the Models target-row delta, an `AnalyticsSummary` extension.

---

## Code health / small polish  ⬜

- **Test flakes under load** (surfaced during the Stage-3 release; not regressions):
  `src/test/version.test.ts` "reports this install" trips its 5s timeout when the machine is
  loaded; `src/test/mock-dev-only.test.ts` contaminates when `version.test` runs immediately
  before it (passes alone). Harden: raise/relax the version timeout; isolate the `BENCHY_DIR`/
  server teardown so ordering can't leak. Low risk, removes release-time noise.
- **script adapter — no command quoting.** Per spec (`shell:false`) the command is split on
  whitespace, so a path with spaces needs `cwd` + a relative command. If that bites in
  practice, add minimal quote-aware splitting (still no shell). File: `src/adapters/script.ts`.
- **Datasets — small Results polish** (carried over from the datasets stage).
- **Release ritual note.** `check-release`'s `lastSource` excludes test files, so a test-only
  tip commit false-fails "predates source"; keep a non-test commit as the tip before `npm
  pack` (or reorder). Documented here so the next release doesn't re-hit it.

---

## Suggested order
1. Confirm & build **#1 agent-vs-model table** (finishes Stage 3's design) — *pending your
   go-ahead, it's a metric-display surface.*
2. **#2 agent health** (small, completes the agents-list design).
3. Provide the **Stage 4 (Pipelines) spec** → design → build (the next real stage).
4. Fold in the **flake hardening** opportunistically.
