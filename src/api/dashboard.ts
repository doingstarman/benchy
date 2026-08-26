import type { FastifyInstance } from 'fastify'
import { getDb } from '../db/index.js'
import { getProviders } from '../config.js'
import { resolvePricing, computeCost } from '../pricing.js'

// A read-only overview of the whole install: totals, recent runs, a participant
// leaderboard, and 14-day activity. Everything is derived at read time from runs /
// results / trace_steps — no new storage. Cost mirrors the metrics resolver: model
// results = tokens × pricing; agent/pipeline results = summed trace-step cost.
export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dashboard', async () => {
    const db = getDb()
    const providers = await getProviders().catch(() => [])
    const pricingByProvider = new Map(providers.map(p => [p.id, p.pricing]))

    const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { c: number }).c
    const runCount = one('SELECT COUNT(*) AS c FROM runs')
    const savedRuns = one('SELECT COUNT(*) AS c FROM runs WHERE saved = 1')
    const resultCount = one('SELECT COUNT(*) AS c FROM results')
    const kindCounts = db.prepare('SELECT kind, COUNT(*) AS c FROM targets GROUP BY kind').all() as { kind: string; c: number }[]
    const kc = (k: string) => kindCounts.find(x => x.kind === k)?.c ?? 0

    // Per (provider, model) rollup for cost + the leaderboard.
    const groups = db.prepare(
      `SELECT provider_id, model, COUNT(*) AS results,
              COALESCE(SUM(input_tokens),0) AS in_tok, COALESCE(SUM(output_tokens),0) AS out_tok,
              AVG(score) AS avg_score
       FROM results GROUP BY provider_id, model`,
    ).all() as { provider_id: string; model: string; results: number; in_tok: number; out_tok: number; avg_score: number | null }[]

    const traceRows = db.prepare(
      `SELECT r.provider_id AS pid, r.model AS model, COALESCE(SUM(ts.cost),0) AS cost
       FROM trace_steps ts JOIN results r ON r.id = ts.result_id
       GROUP BY r.provider_id, r.model`,
    ).all() as { pid: string; model: string; cost: number }[]
    const traceCost = new Map(traceRows.map(x => [`${x.pid}:${x.model}`, x.cost]))
    const nameById = new Map((db.prepare('SELECT id, name FROM targets').all() as { id: string; name: string }[]).map(t => [t.id, t.name]))

    let totalCostUsd = 0
    let totalTokens = 0
    const kindOf = (pid: string) => pid === 'agent' ? 'agent' : pid === 'pipeline' ? 'pipeline' : 'model'
    const leaderboard = groups.map(g => {
      totalTokens += g.in_tok + g.out_tok
      const kind = kindOf(g.provider_id)
      const cost = kind === 'model'
        ? computeCost(resolvePricing(g.model, pricingByProvider.get(g.provider_id)), g.in_tok, g.out_tok)
        : (traceCost.get(`${g.provider_id}:${g.model}`) ?? null)
      if (cost != null) totalCostUsd += cost
      const label = kind === 'model' ? (g.model.split(':').slice(1).join(':') || g.model) : (nameById.get(g.model) ?? g.model)
      return { key: g.model, kind, label, results: g.results, avgScore: g.avg_score, tokens: g.in_tok + g.out_tok, costUsd: cost }
    }).sort((a, b) => b.results - a.results).slice(0, 8)

    const recent = db.prepare(
      `SELECT id, title, kind, status, saved, created_at, models,
              (SELECT AVG(score) FROM results WHERE run_id = runs.id AND score IS NOT NULL) AS avg_score,
              (SELECT COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) FROM results WHERE run_id = runs.id) AS tokens,
              (SELECT MAX(total_time) FROM results WHERE run_id = runs.id) AS duration
       FROM runs ORDER BY created_at DESC LIMIT 8`,
    ).all() as { id: string; title: string | null; kind: string | null; status: string; saved: number; created_at: number; models: string; avg_score: number | null; tokens: number; duration: number | null }[]
    const recentRuns = recent.map(r => ({
      id: r.id, title: r.title, kind: r.kind ?? 'chat', status: r.status, saved: r.saved === 1,
      createdAt: r.created_at, participantCount: (JSON.parse(r.models) as string[]).length,
      avgScore: r.avg_score, tokens: r.tokens, durationMs: r.duration,
    }))

    // 14-day activity — runs per UTC day, gaps filled so the sparkline is continuous.
    const since = Date.now() - 14 * 86_400_000
    const byDay = new Map((db.prepare(
      `SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') AS day, COUNT(*) AS runs
       FROM runs WHERE created_at >= ? GROUP BY day`,
    ).all(since) as { day: string; runs: number }[]).map(x => [x.day, x.runs]))
    const activity: { day: string; runs: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
      activity.push({ day, runs: byDay.get(day) ?? 0 })
    }

    return {
      data: {
        totals: { runs: runCount, savedRuns, results: resultCount, models: kc('model'), agents: kc('agent'), pipelines: kc('pipeline'), totalTokens, totalCostUsd },
        recentRuns,
        leaderboard,
        activity,
      },
    }
  })
}
