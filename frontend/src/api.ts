import { useEffect, useRef, useState } from 'react'
import type { Provider, Run, Result } from '../../src/types'

// ─── helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  const json = (await res.json()) as { data?: T; error?: string }
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json.data as T
}

// ─── providers ──────────────────────────────────────────────────────────────

export const providersApi = {
  list: () => apiFetch<Provider[]>('/api/providers'),
  upsert: (p: Omit<Provider, 'id'> & { id?: string }) =>
    apiFetch<Provider>('/api/providers', { method: 'POST', body: JSON.stringify(p) }),
  remove: (id: string) =>
    fetch(`/api/providers/${id}`, { method: 'DELETE' }),
  test: (id: string, model?: string) =>
    apiFetch<{ ok: boolean; ttfs?: number; message?: string; error?: string }>(
      `/api/providers/${id}/test${model ? `?model=${encodeURIComponent(model)}` : ''}`,
      { method: 'POST' }
    ),
  fetchModels: (id: string) => apiFetch<string[]>(`/api/providers/${id}/models`),
}

// ─── runs ────────────────────────────────────────────────────────────────────

export interface RunWithResults extends Run {
  results: Result[]
}

export interface RunsQuery {
  status?: string
  model?: string
  date?: string
  search?: string
  page?: number
}

export const runsApi = {
  list: (q: RunsQuery = {}) => {
    const params = new URLSearchParams()
    Object.entries(q).forEach(([k, v]) => v != null && params.set(k, String(v)))
    return apiFetch<Run[]>(`/api/runs?${params}`)
  },
  get: (id: string) => apiFetch<RunWithResults>(`/api/runs/${id}`),
  remove: (id: string) => fetch(`/api/runs/${id}`, { method: 'DELETE' }),
  fork: (id: string) => apiFetch<Run>(`/api/runs/${id}/fork`, { method: 'POST' }),
  save: (id: string, saved: boolean) =>
    apiFetch<Run>(`/api/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ saved }) }),
  setFeedback: (runId: string, resultId: string, feedback: 'up' | 'down' | null) =>
    fetch(`/api/runs/${runId}/results/${resultId}/feedback`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    }),
}

// ─── benchmark ───────────────────────────────────────────────────────────────

export interface BenchmarkRequest {
  prompts?: string[]
  models?: string[]
  pairs?: { prompt: string; model: string }[]
  runSettings?: import('../../src/types').RunSettings
}

export const benchmarkApi = {
  start: (req: BenchmarkRequest) =>
    apiFetch<{ runId: string }>('/api/benchmark', { method: 'POST', body: JSON.stringify(req) }),
  continue: (runId: string, prompt: string, runSettings?: import('../../src/types').RunSettings) =>
    apiFetch<{ runId: string; promptIndex: number }>(`/api/runs/${runId}/continue`, {
      method: 'POST',
      body: JSON.stringify({ prompt, runSettings }),
    }),
}

// ─── SSE hook ────────────────────────────────────────────────────────────────

export type SSEEvent =
  | { event: 'cell_start'; runId: string; promptIndex: number; model: string }
  | { event: 'cell_token'; runId: string; promptIndex: number; model: string; text: string }
  | { event: 'cell_done'; runId: string; promptIndex: number; model: string; ttfs: number; totalTime: number; usage: { inputTokens: number; outputTokens: number; reasoningTokens?: number } }
  | { event: 'cell_error'; runId: string; promptIndex: number; model: string; error: string }
  | { event: 'run_done'; runId: string }

export function useSSE(runId: string | null, onEvent: (e: SSEEvent) => void) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const [connected, setConnected] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!runId) return

    const es = new EventSource(`/api/benchmark/stream/${runId}`)
    setConnected(true)

    const handleEvent = (type: string) => (e: MessageEvent) => {
      const data = JSON.parse(e.data as string) as Record<string, unknown>
      onEventRef.current({ event: type, ...data } as SSEEvent)
      if (type === 'run_done') {
        setDone(true)
        es.close()
      }
    }

    for (const t of ['cell_start', 'cell_token', 'cell_done', 'cell_error', 'run_done']) {
      es.addEventListener(t, handleEvent(t))
    }

    es.onerror = () => { setConnected(false); es.close() }

    return () => { es.close(); setConnected(false) }
  }, [runId])

  return { connected, done }
}
