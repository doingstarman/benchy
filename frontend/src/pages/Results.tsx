import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { runsApi, metricsApi, providersApi, traceApi, targetsApi, useSSE } from '../api'
import type { SSEEvent } from '../api'
import { ResponseCard } from '../components/ResponseCard'
import { TestAnalytics } from '../components/TestAnalytics'
import { ParticipantCompare, type CompareParticipant } from '../components/ParticipantCompare'
import { participantValues, type ParticipantAnswer } from '../lib/metricsView'
import { useT } from '../i18n'
import type { Run, Result, MetricDef, TraceStepRow } from '../../../src/types'
import type { ModelPricing } from '../../../src/pricing'

interface CellState {
  text: string
  reasoning: string
  ttfs: number | null
  totalTime: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  reasoningMs: number | null
  done: boolean
  error: string | null
}

function cellKey(promptIndex: number, model: string) {
  return `${promptIndex}:${model}`
}

// The trajectory aggregate for one agent result, mirroring traceStore.traceAggregate
// on the backend: steps = node count, tool calls / errors over `tool` steps, agent
// cost = summed step cost (null if no step reported one).
function traceAgg(steps: TraceStepRow[]) {
  let toolCalls = 0, toolErrors = 0, cost = 0, sawCost = false
  for (const s of steps) {
    if (s.kind === 'tool') { toolCalls++; if (s.isError) toolErrors++ }
    if (s.cost != null) { cost += s.cost; sawCost = true }
  }
  return { steps: steps.length, toolCalls, toolErrors, agentCost: sawCost ? cost : null }
}

export function Results() {
  const { t } = useT()
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [cells, setCells] = useState<Record<string, CellState>>({})
  const [promptIndex, setPromptIndex] = useState(0)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isLive, setIsLive] = useState(true)
  const [metricDefs, setMetricDefs] = useState<MetricDef[]>([])
  const [pricing, setPricing] = useState<Map<string, Record<string, ModelPricing> | undefined>>(new Map())
  const [participantNames, setParticipantNames] = useState<Map<string, string>>(new Map())
  const [traces, setTraces] = useState<Map<string, TraceStepRow[]>>(new Map())

  // The comparison table needs the metric registry (order + appliesTo), per-provider
  // pricing (to resolve `cost` client-side) and agent names for readable column labels.
  useEffect(() => {
    metricsApi.list().then(setMetricDefs).catch(() => {})
    providersApi.list().then(ps => setPricing(new Map(ps.map(p => [p.id, p.pricing])))).catch(() => {})
    // Readable labels for trace-bearing participants (agents + pipelines are keyed by id).
    Promise.all([targetsApi.list('agent'), targetsApi.list('pipeline')])
      .then(([ag, pi]) => setParticipantNames(new Map([...ag, ...pi].map(t => [t.id, t.name]))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!runId) return
    runsApi.get(runId).then(data => {
      setRun(data)
      setSaved(data.saved)
      setResults(data.results)
      if (data.status === 'done' || data.status === 'error') {
        setIsLive(false)
        // Populate cells from existing results
        const initial: Record<string, CellState> = {}
        for (const r of data.results) {
          initial[cellKey(r.promptIndex, r.model)] = {
            text: r.text,
            reasoning: r.reasoning ?? '',
            ttfs: r.metrics.ttfs,
            totalTime: r.metrics.totalTime,
            inputTokens: r.metrics.inputTokens,
            outputTokens: r.metrics.outputTokens,
            reasoningTokens: r.metrics.reasoningTokens,
            reasoningMs: r.metrics.reasoningMs,
            done: true,
            error: r.error,
          }
        }
        setCells(initial)
      }
    }).catch(() => navigate('/history'))
  }, [runId, navigate])

  const handleSSE = useCallback((e: SSEEvent) => {
    if (e.event === 'cell_token') {
      setCells(prev => {
        const k = cellKey(e.promptIndex, e.model)
        const existing = prev[k] ?? { text: '', reasoning: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null, reasoningTokens: null, reasoningMs: null, done: false, error: null }
        return { ...prev, [k]: { ...existing, text: existing.text + e.text } }
      })
    } else if (e.event === 'cell_reasoning') {
      setCells(prev => {
        const k = cellKey(e.promptIndex, e.model)
        const existing = prev[k] ?? { text: '', reasoning: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null, reasoningTokens: null, reasoningMs: null, done: false, error: null }
        return { ...prev, [k]: { ...existing, reasoning: existing.reasoning + e.text } }
      })
    } else if (e.event === 'cell_done') {
      setCells(prev => {
        const k = cellKey(e.promptIndex, e.model)
        return {
          ...prev,
          [k]: {
            ...(prev[k] ?? {}),
            ttfs: e.ttfs,
            totalTime: e.totalTime,
            inputTokens: e.usage.inputTokens,
            outputTokens: e.usage.outputTokens,
            reasoningTokens: e.usage.reasoningTokens ?? null,
            reasoningMs: e.reasoningMs,
            done: true,
            error: null,
          },
        }
      })
    } else if (e.event === 'cell_error') {
      setCells(prev => {
        const k = cellKey(e.promptIndex, e.model)
        return { ...prev, [k]: { ...(prev[k] ?? { text: '', reasoning: '', ttfs: null, totalTime: null, inputTokens: null, outputTokens: null, reasoningTokens: null, reasoningMs: null }), done: true, error: e.error } }
      })
    } else if (e.event === 'run_done') {
      setIsLive(false)
      // Refresh to get result IDs for feedback
      if (runId) runsApi.get(runId).then(data => setResults(data.results)).catch(() => {})
    }
  }, [runId])

  const { done: sseStreamDone } = useSSE(isLive && runId ? runId : null, handleSSE)

  useEffect(() => {
    if (sseStreamDone) setIsLive(false)
  }, [sseStreamDone])

  // Agent columns measure their trajectory, resolved from the stored trace (same
  // aggregate as api/metrics.ts). Fetch each agent result's trace once the run has
  // settled; model results carry their metrics inline and need no fetch.
  useEffect(() => {
    if (isLive) return
    const hasTrace = (r: Result) => r.providerId === 'agent' || r.providerId === 'pipeline'
    const pending = results.filter(r => hasTrace(r) && !traces.has(r.id))
    if (pending.length === 0) return
    let live = true
    Promise.all(pending.map(r =>
      traceApi.get(r.id).then(t => [r.id, t] as [string, TraceStepRow[]]).catch(() => [r.id, []] as [string, TraceStepRow[]])))
      .then(pairs => { if (live) setTraces(prev => new Map([...prev, ...pairs])) })
    return () => { live = false }
  }, [isLive, results, traces])

  const participants: CompareParticipant[] = useMemo(() => {
    if (!run || isLive || metricDefs.length === 0) return []
    const enabled = metricDefs.filter(d => d.enabled)
    const byColumn = new Map<string, Result[]>()
    for (const r of results) {
      const list = byColumn.get(r.model) ?? []
      list.push(r)
      byColumn.set(r.model, list)
    }
    return run.models.flatMap(col => {
      const rows = byColumn.get(col) ?? []
      if (rows.length === 0) return []
      const providerId = rows[0]?.providerId
      const kind = providerId === 'agent' ? 'agent' as const : providerId === 'pipeline' ? 'pipeline' as const : 'model' as const
      const hasTrace = kind === 'agent' || kind === 'pipeline'
      const answers: ParticipantAnswer[] = rows.map(r => {
        const base: ParticipantAnswer = {
          ttfs: r.metrics.ttfs, totalTime: r.metrics.totalTime,
          inputTokens: r.metrics.inputTokens, outputTokens: r.metrics.outputTokens,
          reasoningTokens: r.metrics.reasoningTokens, reasoningMs: r.metrics.reasoningMs,
          score: r.score ?? null, model: r.model, pricingOverrides: pricing.get(r.providerId),
        }
        if (!hasTrace) return base
        const agg = traceAgg(traces.get(r.id) ?? [])
        return { ...base, steps: agg.steps, toolCalls: agg.toolCalls, toolErrors: agg.toolErrors, agentCost: agg.agentCost }
      })
      const processError = rows.some(r => r.error != null) ||
        (hasTrace && rows.some(r => (traces.get(r.id) ?? []).some(s => s.kind === 'error')))
      return [{
        key: col,
        label: hasTrace ? (participantNames.get(col) ?? col) : col.split(':').slice(1).join(':') || col,
        kind,
        values: participantValues(answers, enabled),
        processError,
      }]
    })
  }, [run, isLive, metricDefs, results, traces, pricing, participantNames])

  const enabledDefs = useMemo(() => metricDefs.filter(d => d.enabled), [metricDefs])

  async function handleSave() {
    if (!runId) return
    setSaving(true)
    try {
      await runsApi.save(runId, !saved)
      setSaved(s => !s)
    } finally {
      setSaving(false)
    }
  }

  if (!run) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        {t('common.loading')}
      </div>
    )
  }

  const models = run.models
  const currentModels = models
  const modelsWithTtfs = currentModels
    .map(m => cells[cellKey(promptIndex, m)]?.ttfs)
    .filter((t): t is number => t != null)
  const minTtfs = modelsWithTtfs.length ? Math.min(...modelsWithTtfs) : null

  const resultMap = new Map(results.map(r => [cellKey(r.promptIndex, r.model), r]))

  const prompt = run.prompts[promptIndex]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderBottom: '0.5px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => navigate('/history')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
            {t('results.backHistory')}
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            {run.id.slice(0, 8)}
          </span>
          {isLive && (
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
              {t('results.live')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {minTtfs != null && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              {t('results.bestTtfs')} <span style={{ color: 'var(--warning)' }}>{minTtfs}ms</span>
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: saved ? 'var(--accent-bg)' : 'none',
              border: '0.5px solid',
              borderColor: saved ? 'var(--accent)' : 'var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 12px',
              color: saved ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {saved ? t('results.saved') : t('results.save')}
          </button>
        </div>
      </div>

      {/* Dataset test analytics (renders only for dataset runs; 404 → nothing) */}
      {!isLive && runId && <TestAnalytics runId={runId} />}

      {/* Participant comparison: model + agent columns share metric rows (agent-vs-model) */}
      {!isLive && participants.length >= 2 && (
        <div style={{ padding: '12px 24px', flexShrink: 0 }}>
          <ParticipantCompare defs={enabledDefs} participants={participants} />
        </div>
      )}

      {/* Prompt tabs */}
      {run.prompts.length > 1 && (
        <div style={{
          display: 'flex', gap: 4, padding: '8px 24px',
          borderBottom: '0.5px solid var(--border)', flexShrink: 0,
        }}>
          {run.prompts.map((_, i) => (
            <button
              key={i}
              onClick={() => setPromptIndex(i)}
              style={{
                background: i === promptIndex ? 'var(--accent-bg)' : 'none',
                border: '0.5px solid',
                borderColor: i === promptIndex ? 'var(--accent)' : 'var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 10px',
                color: i === promptIndex ? 'var(--accent)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              #{i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Prompt text */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '0.5px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--text-secondary)',
        background: 'var(--bg-elevated)',
        flexShrink: 0,
        maxHeight: 100,
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
      }}>
        {prompt}
      </div>

      {/* Run settings summary */}
      {run.runSettings?.global && Object.values(run.runSettings.global).some(v => v != null) && (() => {
        const global = run.runSettings!.global!
        const entries = Object.entries(global).filter(([, v]) => v != null) as [string, number | string | boolean][]
        const labels: Record<string, string> = {
          temperature: 'temp', topP: 'top_p', topK: 'top_k',
          maxOutputTokens: 'max_tokens', timeoutMs: 'timeout',
          retries: 'retries', streaming: 'stream',
        }
        const perModelKeys = Object.keys(run.runSettings?.perModel ?? {})
        return (
          <div style={{
            padding: '7px 24px', borderBottom: '0.5px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              ⚙ {perModelKeys.length > 0 ? t('results.customSettingsGlobal') : t('results.customSettings')}
            </span>
            {entries.map(([key, val]) => (
              <span key={key} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {labels[key] ?? key}: <span style={{ color: 'var(--text-secondary)' }}>
                  {key === 'timeoutMs' ? `${Math.round((val as number) / 1000)}s` : String(val)}
                </span>
              </span>
            ))}
            {perModelKeys.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {t('results.modelOverrides', { n: perModelKeys.length })}
              </span>
            )}
          </div>
        )
      })()}

      {/* Response columns */}
      <div style={{
        flex: 1, padding: 24, display: 'flex', gap: 12,
        overflowX: 'auto', overflowY: 'hidden', alignItems: 'flex-start',
      }}>
        {currentModels.map(model => {
          const cell = cells[cellKey(promptIndex, model)]
          const result = resultMap.get(cellKey(promptIndex, model))
          const isFastest = cell?.ttfs != null && cell.ttfs === minTtfs && minTtfs != null && modelsWithTtfs.length > 1

          return (
            <ResponseCard
              key={model}
              runId={run.id}
              resultId={result?.id}
              model={model}
              text={cell?.text ?? ''}
              reasoning={cell?.reasoning ?? ''}
              ttfs={cell?.ttfs ?? null}
              totalTime={cell?.totalTime ?? null}
              inputTokens={cell?.inputTokens ?? null}
              outputTokens={cell?.outputTokens ?? null}
              reasoningTokens={cell?.reasoningTokens}
              reasoningMs={cell?.reasoningMs}
              feedback={result?.feedback}
              isFastest={isFastest}
              isStreaming={isLive && !(cell?.done)}
              error={cell?.error}
            />
          )
        })}
      </div>
    </div>
  )
}
