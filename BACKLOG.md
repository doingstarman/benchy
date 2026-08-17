# benchy — backlog

Living list of what's open. Not blockers — `main` is shipped and clean. Ordered
by priority within each theme; sizes are rough (S ≈ hours, M ≈ a day, L ≈ more).

## P1 — security & correctness

- [ ] **library.ts: mask the stored key in responses** (S). The Origin gate is in;
  parity with providers still missing — `GET /api/tools` and `GET /api/mcp` return
  the custom-tool / MCP Bearer secret in the clear. Add a `toView` that drops
  `apiKey`/adds a mask, mirror `ProviderView` on the frontend (Library page).
- [ ] **library.ts: preserve the key on edit** (S). `POST /api/tools|/api/mcp`
  drops `apiKey` when it isn't re-sent, so editing a tool without re-typing the key
  wipes it. Mirror providers' tri-state (absent = keep, `''` = erase, value =
  replace).
- [x] **Triaged `codex/review-fixes`** (old, 30 commits behind main). Its security
  (`f7b4ede`) and docs (`124a0cd`) commits are superseded by shipped work
  (provider-key-exposure, docs-accuracy) — drop them. Do NOT merge the stale branch
  (conflicts / would revert newer work); keep it only as reference for the three
  features below, which are re-landed fresh on current `main`.

## P2 — datasets features

- [ ] **Normalization rules — "это то же самое"** (M). Sibling of "use as truth":
  from the disagreements review, declare a model's differently-written value
  equivalent (`214.08` ≡ `214,08 руб.`), store a per-type rule, apply it in scoring
  + rescore — no model calls. The design's 07 callout.
- [ ] **Prompt variants as an axis** (M). Run one dataset against several prompt
  variants; compare which prompt scores best per model.
- [ ] **Trial run** (S). One-item dry run before spending the whole (possibly paid)
  dataset — a cheaper cousin of subsampling.
- [ ] **CODE per-test: error detail** (M). Persist each test's `err` text and
  distinguish "code didn't compile / timed out" from "a test failed" in the
  per-test results grid (today both read as blank/0).
- [ ] **Results: PDF report export** (M). Alongside the existing CSV/JSON.
- [ ] **Results: compare two tests** (M). Side-by-side diff of two runs.
- [ ] **Analytics: agreement card** (M–L). How often auto-scoring agrees with human
  picks. Blocked: needs a run carrying BOTH auto scores AND human verdicts — arena
  skips auto-scoring, so a mixed mode must exist first.

### Eval engine (salvaged from `codex/review-fixes`, re-land fresh on main)

- [ ] **Cost per answer / per run** (M). A per-model pricing table → cost columns
  next to tokens; would let the datasets cards show cost, not just tokens
  (`pricing.ts`, `stats.ts` on the reference branch).
- [ ] **Repeats → compare medians** (M). Run each cell N times and compare medians
  instead of single noisy samples.
- [ ] **Headless run — eval engine without a browser** (L). `benchy run …` from the
  CLI, no UI (`headless.ts`, `cli.ts` on the reference branch).

## P3 — scoring robustness & nits

- [ ] **Locale-aware number/date scoring** (M). `scoring.ts` assumes the RU-receipt
  convention (space-thousands, comma decimal, ISO/day-first dates); European
  dot-thousands (`1.000`) and US month-first dates mis-score. Make the convention
  configurable per dataset or per variable.
- [ ] **`parseModelOutput` brace scan** (S, rare). A stray unmatched `{` in model
  prose can stop a valid trailing JSON object from being parsed (verify-ritual F3).
  Only bites on malformed prose; low priority.

## Housekeeping

- [ ] **Restart prod** to apply the last `benchy update`.
- [ ] **`codex/docs-accuracy`**: free the worktree at `D:/Temp/claude/benchy-wt-docs`,
  then delete the (already-merged) branch.
