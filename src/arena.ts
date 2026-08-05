// Human pairwise judging of an arena run turns into per-model standings here.
// Each item's verdict says which model was best (beats everyone) and, optionally,
// which was worst (loses to everyone); the rest tie among themselves. Elo is
// derived from those pairwise outcomes — never stored — so the K-factor and seed
// stay tunable and a reload always recomputes the same numbers.
import type { ArenaVerdict, ArenaStanding } from './types.js'

const START_ELO = 1000
const K = 24

// Expected score of A against B under the logistic Elo curve.
function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400))
}

// The pairwise outcome for one item from a's view: 1 = a beats b, 0 = a loses,
// 0.5 = tie. best beats all; worst loses to all; two middles tie. Order matters
// (best checked before worst) so the best-vs-worst edge resolves to a win.
function outcome(a: string, b: string, best: string | null, worst: string | null): number {
  if (a === best) return 1
  if (b === best) return 0
  if (a === worst) return 0
  if (b === worst) return 1
  return 0.5
}

export function computeStandings(models: string[], verdicts: ArenaVerdict[]): ArenaStanding[] {
  const elo = new Map<string, number>(models.map(m => [m, START_ELO]))
  const wins = new Map<string, number>(models.map(m => [m, 0]))
  const losses = new Map<string, number>(models.map(m => [m, 0]))

  // Deterministic: apply verdicts in item order.
  for (const v of [...verdicts].sort((x, y) => x.promptIndex - y.promptIndex)) {
    if (v.skipped) continue
    if (!v.bestModel && !v.worstModel) continue
    if (v.bestModel && elo.has(v.bestModel)) wins.set(v.bestModel, (wins.get(v.bestModel) ?? 0) + 1)
    if (v.worstModel && elo.has(v.worstModel)) losses.set(v.worstModel, (losses.get(v.worstModel) ?? 0) + 1)

    // Every unordered pair updated once, so an edge isn't double-counted.
    for (let i = 0; i < models.length; i++) {
      for (let j = i + 1; j < models.length; j++) {
        const a = models[i], b = models[j]
        const sa = outcome(a, b, v.bestModel, v.worstModel)
        // Two middle models — no defined order, no information, no Elo change.
        if (sa === 0.5) continue
        const ea = expected(elo.get(a) ?? START_ELO, elo.get(b) ?? START_ELO)
        elo.set(a, (elo.get(a) ?? START_ELO) + K * (sa - ea))
        elo.set(b, (elo.get(b) ?? START_ELO) + K * ((1 - sa) - (1 - ea)))
      }
    }
  }

  return models
    .map(m => ({ model: m, elo: Math.round(elo.get(m) ?? START_ELO), wins: wins.get(m) ?? 0, losses: losses.get(m) ?? 0 }))
    .sort((a, b) => b.elo - a.elo || b.wins - a.wins)
}
