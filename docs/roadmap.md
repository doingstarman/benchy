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

---

## Open — design-complete (no product spec needed)

### 1. agent-vs-model comparison table  ⬜  · priority: high
**Goal.** The one piece of Stage-3's own design that didn't ship: a Results surface that
puts model columns and an agent column in the **same metric rows**, so a run with mixed
participants reads as one table.

**Scope.**
- In: a "side-by-side / table" comparison on the run/Results view — rows = metrics (shared
  order), columns = the run's participants; the **not-applicable** cell is a **hatched
  empty cell** (135° repeating-linear-gradient), *distinct* from `—` (not reported) and
  from `0`; a "trajectory metrics — agents only" sub-header; process status = left dot,
  correctness = right score chip (two axes, never merged). Design: `design-dist/agents.md`
  + the `agent-vs-model.dc.html` mockup.
- Out: any live-compose metric strip (that's the parked "metrics in context" — do NOT
  revive here); custom-metric display.

**Approach + files.** Reuse the pure resolver (`src/metrics/resolve.ts`) client-side over
the run's results, exactly as the (reverted) metricsView helper did — no backend change.
`appliesTo` already encodes hatch-vs-dash: a metric whose `appliesTo` excludes a column's
kind → hatched; a null value → `—`. New component (e.g. `frontend/src/components/
ParticipantCompare.tsx`) rendered on `pages/Results.tsx`; reuse `MetricCell`. i18n en+ru.

**Done-when.** Open a run with two models + an agent → the table shows shared rows; agent
columns hatch `ttfs`/`reasoning`, model columns hatch `steps`/`tool_calls`/`agent_cost`;
nulls are `—`; a wrong answer shows as a score chip, never red in the process column.

**⚠️ Sensitivity.** This is a metric-display surface. You reverted the live-run metrics bar
before (option A: registry-only). Confirm you want this Results table before I build it.

### 2. Agent health in the list  ⬜  · priority: medium
**Goal.** The design's agents-list shows per-row health (green/red) from the last verify.
Right now rows have no health signal.

**Scope/approach.** Persist the last handshake outcome per agent (a `lastHandshake` blob in
the target config, or a tiny `agent_health` store) written by the handshake route; render a
dot in `AgentRow` (green = full/degraded, red = crashed). Files: `src/api/targets.ts`
(store on handshake), `frontend/src/pages/Agents.tsx` (`AgentRow`). **Done-when** a crashed
handshake turns the row red until re-verified; verify never auto-disables the agent.

### 3. Agent metrics in ResponseCard  ⬜  · priority: low
`ResponseCard` still shows the model-shaped `MetricsBar` for agents. Show agent metrics
(steps / tools / agent cost) the way the /run cell now does. File:
`frontend/src/components/ResponseCard.tsx` (+ `MetricsBar` or a small agent variant).

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
