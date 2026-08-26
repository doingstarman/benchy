# Stage 4 — Pipelines (design)

A **pipeline** is a benchmark participant that is itself a graph of participants —
`kind='pipeline'`, already reserved in `TargetKind`. This doc is the binding design; it
records the three decisions you made and proposes the rest (flagged **PROPOSAL** — correct
on review). Companion to [agents.md](../design-dist/agents.md) and
[agent-protocol.md](agent-protocol.md).

## Your decisions
- **Shape — DAG with branching.** Not a linear chain: nodes form a directed acyclic graph;
  a node's output can fan out to several downstream nodes, and edges may carry a route
  condition.
- **Members — model / agent / nested pipeline.** A stage can reference any target kind,
  *including another pipeline* (recursion) — so nesting needs a **depth limit** and a
  **cycle guard** (a pipeline may never contain itself, directly or transitively).
- **Orchestration — the pipeline's author chooses.** Two modes, per pipeline:
  - **internal** — benchy runs the DAG itself (like the tool loop): topological order, each
    node runs its member, an upstream output becomes the downstream input.
  - **external** — the pipeline is a user program benchy only *observes* via the Stage-3
    trace protocol (reuse the agent `command`/`http` transport); benchy runs no stages, it
    just reads the emitted trace.

## Data model (PROPOSAL)
```ts
export interface PipelineNode {
  id: string                 // local, unique within the pipeline
  ref: string                // a target id (model / agent / pipeline)
  label?: string
}
export interface PipelineEdge {
  from: string               // node id ('' = the pipeline input)
  to: string                 // node id ('' = the pipeline output)
  when?: string              // optional route condition over the upstream output; absent = always
}
export interface PipelineTargetConfig {
  mode: 'internal' | 'external'
  // internal:
  nodes?: PipelineNode[]
  edges?: PipelineEdge[]
  // external (reuses the agent transport shape):
  transport?: 'command' | 'http'
  command?: string; cwd?: string; url?: string; authHeader?: string
  env?: Record<string, string>; secretRefs?: string[]
  // limits — task aborts on the first reached (same rule as agents)
  maxDepth: number           // nesting guard (default 3)
  maxNodes: number           // fan-out guard (default 32)
  timeoutMs: number
  maxCostUsd?: number
  lastHandshake?: AgentHealth // reuse the agent health dot
}
```
**Guards (validated at the API boundary):** every `ref` exists; the graph is acyclic
(edges) *and* the nesting is acyclic (a pipeline never references itself transitively);
nesting depth ≤ `maxDepth`; node ids unique; every non-input node reachable from `''`.

## Trace (PROPOSAL — reuse `trace_steps`)
Stage 3 deliberately made `trace_steps` stage-4-queryable; reuse it. A pipeline run writes
one step per stage, `parent` = the upstream stage (nesting = graph depth, capped at the
`TraceView`'s ≤3 like agents). Internal mode: benchy emits the synthetic per-stage steps.
External mode: the program emits them, exactly like an agent. So `TraceView` renders a
pipeline for free.

## Metrics rollup (PROPOSAL)
Add `'pipeline'` to the trajectory metrics' `appliesTo` and resolve them from the
pipeline's trace aggregate (same `traceStore.traceAggregate`): `steps` = stage count,
`tool_calls` = summed, `agent_cost` = **summed** stage cost, `wall_clock` = the pipeline's
**total** wall time (not a sum — stages may overlap). `score`/`total_time`/tokens stay
`appliesTo: both`+pipeline as they already aggregate.

## Discriminator & run integration (PROPOSAL)
A pipeline result is marked `provider_id='pipeline'` (mirrors agents' `'agent'`), so
`appliesTo` skip rules and the ParticipantCompare table need no new join. A pipeline target
is selectable in NewRun like any participant.

## UI (PROPOSAL)
- **Pipelines page** (flip the disabled sidebar stub), same shell as Agents/Models. v1
  editor = a **node list + edge list** (ref pickers over existing targets, a transport
  switch for external mode), not a visual graph canvas — the canvas is a later polish.
- Reuse the agent **health dot** and **verify/handshake** (internal verify = a dry topo
  check + one trivial run; external = the agent handshake).

## Phased build plan (each phase: branch → build+tests → your dev-eyeball → merge)
1. **Foundation (backend, no execution).** `PipelineTargetConfig` type + validators (refs
   exist, acyclic graph, acyclic nesting, depth/node limits) + `targets.ts` pipeline CRUD
   (remove the `400`). Contract tests for every guard. **Done-when** a valid pipeline
   persists and every malformed graph is rejected with a specific error.
2. **Internal orchestration.** `runPipelineCell` in the benchmark fan-out: topo-order,
   run each member (model adapter / `runAgentCell` / nested pipeline recursively), thread
   outputs along edges, emit `trace_steps`, enforce limits. **Done-when** a 2-node chain and
   a fan-out/fan-in DAG both run and read back their trace.
3. **External observation.** Observe an external pipeline program via the agent transport
   (reuse `runAgentCell`'s consumption). **Done-when** an external pipeline's emitted trace
   is stored and read back.
4. **Metrics rollup.** `'pipeline'` in `appliesTo` + the rollup resolver; ParticipantCompare
   already renders it. **Done-when** a mixed run shows pipeline columns with rolled-up cost.
5. **UI.** Pipelines page (node/edge builder) + NewRun selection + verify + health dot.

## Open sub-questions (answer on review, or I take the PROPOSALs)
- Route conditions (`edge.when`): ship in v1 (basic fan-out/fan-in only, conditions later),
  or design the condition language now?
- `maxDepth` default (3, like the TraceView cap)?
- External mode: does it need its own trace `kind='stage'`, or reuse agent step kinds?
