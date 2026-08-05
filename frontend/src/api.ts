import { useEffect, useRef, useState } from 'react'
import type { Provider, Run, Result, AttachmentMeta, CustomTool, Skill, McpServer, Dataset, DatasetItem, DatasetVar, ArenaVerdict, ArenaStanding } from '../../src/types'
// Type-only: src/version.ts pulls in node:fs, but `import type` is erased at build.
import type { VersionInfo } from '../../src/version'

export type { VersionInfo }

// ─── helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    // Content-Type only when there's a body — Fastify rejects an empty body
    // that claims to be JSON with 400 FST_ERR_CTP_EMPTY_JSON_BODY (broke
    // body-less POSTs like provider test and run fork).
    res = await fetch(path, {
      headers: { ...(init?.body != null ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
      ...init,
    })
  } catch {
    throw new Error('Cannot reach the benchy server — is it still running?')
  }
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: string }
  if (!res.ok || json.error) throw new Error(json.error ?? `Server error (HTTP ${res.status})`)
  return json.data as T
}

// ─── providers ──────────────────────────────────────────────────────────────

export const providersApi = {
  list: () => apiFetch<Provider[]>('/api/providers'),
  upsert: (p: Omit<Provider, 'id'> & { id?: string }) =>
    apiFetch<Provider>('/api/providers', { method: 'POST', body: JSON.stringify(p) }),
  remove: (id: string) =>
    fetch(`/api/providers/${id}`, { method: 'DELETE' }),
  // Test and fetchModels take the DRAFT the form is holding, not a saved id —
  // otherwise the UI has to save before it can look anything up, and Cancel
  // stops meaning cancel.
  test: (draft: ProviderDraft) =>
    apiFetch<{ ok: boolean; ttfs?: number; message?: string; error?: string }>(
      '/api/providers/test',
      { method: 'POST', body: JSON.stringify(draft) }
    ),
  fetchModels: (draft: ProviderDraft) =>
    apiFetch<string[]>('/api/providers/models', { method: 'POST', body: JSON.stringify(draft) }),
}

export interface ProviderDraft {
  type: Provider['type']
  apiKey?: string
  baseUrl?: string
  model?: string
}

// ─── library (tools / skills / mcp) ──────────────────────────────────────────

export const toolsApi = {
  list: () => apiFetch<CustomTool[]>('/api/tools'),
  upsert: (t: Omit<CustomTool, 'id'> & { id?: string }) =>
    apiFetch<CustomTool>('/api/tools', { method: 'POST', body: JSON.stringify(t) }),
  remove: (id: string) => fetch(`/api/tools/${id}`, { method: 'DELETE' }),
}
export const skillsApi = {
  list: () => apiFetch<Skill[]>('/api/skills'),
  upsert: (s: Omit<Skill, 'id'> & { id?: string }) =>
    apiFetch<Skill>('/api/skills', { method: 'POST', body: JSON.stringify(s) }),
  remove: (id: string) => fetch(`/api/skills/${id}`, { method: 'DELETE' }),
}
export const mcpApi = {
  list: () => apiFetch<McpServer[]>('/api/mcp'),
  upsert: (m: Omit<McpServer, 'id'> & { id?: string }) =>
    apiFetch<McpServer>('/api/mcp', { method: 'POST', body: JSON.stringify(m) }),
  remove: (id: string) => fetch(`/api/mcp/${id}`, { method: 'DELETE' }),
}

// ─── uploads ─────────────────────────────────────────────────────────────────

export const uploadsApi = {
  // Dedicated fetch — FormData must NOT get a JSON Content-Type (the browser
  // sets the multipart boundary itself).
  upload: async (file: File): Promise<AttachmentMeta> => {
    const form = new FormData()
    form.append('file', file)
    let res: Response
    try {
      res = await fetch('/api/uploads', { method: 'POST', body: form })
    } catch {
      throw new Error('Cannot reach the benchy server — is it still running?')
    }
    const json = (await res.json().catch(() => ({}))) as { data?: AttachmentMeta; error?: string }
    if (!res.ok || json.error) throw new Error(json.error ?? `Upload failed (HTTP ${res.status})`)
    return json.data as AttachmentMeta
  },
  url: (id: string) => `/api/uploads/${id}`,
  // Removing a chip before send — only unbound uploads; fire-and-forget so the
  // UI never blocks on cleanup. A bound attachment is refused by the server.
  remove: (id: string) => fetch(`/api/uploads/${id}`, { method: 'DELETE' }),
}

// ─── datasets ─────────────────────────────────────────────────────────────────

export interface DatasetRunSummary {
  id: string
  status: string
  models: string[]
  totalCalls: number
  completedCalls: number
  createdAt: number
  avgScore: number | null
  mode: 'score' | 'arena'
  judgedCount: number
}

export interface ArenaState {
  itemCount: number
  verdicts: ArenaVerdict[]
  standings: ArenaStanding[]
  nextIndex: number
}

export const datasetsApi = {
  list: () => apiFetch<Dataset[]>('/api/datasets'),
  get: (id: string) => apiFetch<Dataset>(`/api/datasets/${id}`),
  create: (body: { name: string; note?: string; schema?: DatasetVar[]; type?: 'files' | 'text' | 'tools' | 'code'; language?: 'python' | 'javascript' }) =>
    apiFetch<Dataset>('/api/datasets', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { name?: string; note?: string | null; schema?: DatasetVar[]; trustedModel?: string | null }) =>
    apiFetch<Dataset>(`/api/datasets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => fetch(`/api/datasets/${id}`, { method: 'DELETE' }),
  addItem: (id: string, body: { attachmentId?: string; groundTruth?: Record<string, string>; input?: string; tests?: string }) =>
    apiFetch<DatasetItem>(`/api/datasets/${id}/items`, { method: 'POST', body: JSON.stringify(body) }),
  updateItem: (id: string, itemId: string, body: { attachmentId?: string; groundTruth?: Record<string, string>; aiSuggested?: Record<string, string>; input?: string; tests?: string }) =>
    apiFetch<DatasetItem>(`/api/datasets/${id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeItem: (id: string, itemId: string) => fetch(`/api/datasets/${id}/items/${itemId}`, { method: 'DELETE' }),
  aiFill: (id: string, body: { scope?: 'empty' | 'all'; instruction?: string; itemIds?: string[] } = {}) =>
    apiFetch<{ filled: number; skipped: number; errored: number }>(`/api/datasets/${id}/ai-fill`, { method: 'POST', body: JSON.stringify(body) }),
  importCsv: (id: string, csv: string) =>
    apiFetch<{ imported: number }>(`/api/datasets/${id}/import-csv`, { method: 'POST', body: JSON.stringify({ csv }) }),
  runs: (id: string) => apiFetch<DatasetRunSummary[]>(`/api/datasets/${id}/runs`),
  run: (id: string, body: { models: string[]; prompt: string; systemPrompt?: string; mode?: 'score' | 'arena' }) =>
    apiFetch<{ runId: string }>(`/api/datasets/${id}/run`, { method: 'POST', body: JSON.stringify(body) }),
  arena: (id: string, runId: string) => apiFetch<ArenaState>(`/api/datasets/${id}/runs/${runId}/arena`),
  putVerdict: (id: string, runId: string, promptIndex: number, body: { bestModel?: string; worstModel?: string; skipped?: boolean }) =>
    apiFetch<{ standings: ArenaStanding[]; nextIndex: number }>(`/api/datasets/${id}/runs/${runId}/verdicts/${promptIndex}`, { method: 'PUT', body: JSON.stringify(body) }),
}

// ─── results (dataset test database + analytics) ──────────────────────────────

export interface ResultsRow {
  runId: string
  datasetId: string
  datasetName: string
  itemCount: number
  modelCount: number
  mode: string
  status: string
  createdAt: number
  avgScore: number | null
  tokens: number
  durationMs: number | null
  winner: string | null
}

export interface AnalyticsSummary {
  mode: string
  datasetName: string
  itemCount: number
  modelCount: number
  winner: string | null
  tokens: number
  durationMs: number | null
  coverage: number
  skipped: number
  standings: { model: string; elo: number; wins: number; losses: number }[] | null
  matrix: { model: string; overall: number | null; perVar: Record<string, number | null> }[] | null
  agreement: number | null
  perModelLatency: { model: string; ms: number | null }[]
  weak: { file: string; why: string }[]
}

export const resultsApi = {
  list: () => apiFetch<ResultsRow[]>('/api/results'),
  summary: (runId: string) => apiFetch<AnalyticsSummary>(`/api/results/${runId}`),
  exportUrl: (runId: string, format: 'csv' | 'json') => `/api/results/${runId}/export?format=${format}`,
}

// ─── settings (server-side app toggles) ──────────────────────────────────────

export interface AppSettings {
  codeExecution: boolean
}

export const settingsApi = {
  get: () => apiFetch<AppSettings>('/api/settings'),
  update: (patch: Partial<AppSettings>) =>
    apiFetch<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
}

// ─── version / updates ───────────────────────────────────────────────────────

export const versionApi = {
  // force=true bypasses the server's 30-min remote cache (the "check now" button)
  get: (force = false) => apiFetch<VersionInfo>(`/api/version${force ? '?check=1' : ''}`),
}

// ─── runs ────────────────────────────────────────────────────────────────────

export interface RunWithResults extends Run {
  results: Result[]
  attachments?: (AttachmentMeta & { promptIndex: number })[]
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
  rename: (id: string, title: string | null) =>
    apiFetch<Run>(`/api/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  // Narrow the run's model set — a closed column must stop costing money on
  // every follow-up, not just disappear from view.
  setModels: (id: string, models: string[]) =>
    apiFetch<Run>(`/api/runs/${id}`, { method: 'PATCH', body: JSON.stringify({ models }) }),
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
  attachments?: string[]
  cloneAttachmentsFrom?: { runId: string; promptIndex: number }
  tools?: string[]
  systemPrompt?: string
  skills?: string[]
  mcp?: string[]
}

export const benchmarkApi = {
  start: (req: BenchmarkRequest) =>
    apiFetch<{ runId: string }>('/api/benchmark', { method: 'POST', body: JSON.stringify(req) }),
  continue: (runId: string, prompt: string, runSettings?: import('../../src/types').RunSettings, attachments?: string[]) =>
    apiFetch<{ runId: string; promptIndex: number }>(`/api/runs/${runId}/continue`, {
      method: 'POST',
      body: JSON.stringify({ prompt, runSettings, attachments }),
    }),
  editTurn: (runId: string, promptIndex: number, prompt: string, attachments?: string[]) =>
    apiFetch<{ runId: string; promptIndex: number }>(`/api/runs/${runId}/edit-turn`, {
      method: 'POST',
      body: JSON.stringify({ promptIndex, prompt, attachments }),
    }),
}

// ─── SSE hook ────────────────────────────────────────────────────────────────

export type SSEEvent =
  | { event: 'cell_start'; runId: string; promptIndex: number; model: string }
  | { event: 'cell_token'; runId: string; promptIndex: number; model: string; text: string }
  | { event: 'cell_reasoning'; runId: string; promptIndex: number; model: string; text: string }
  | { event: 'cell_tool_call'; runId: string; promptIndex: number; model: string; id: string; name: string; args: unknown }
  | { event: 'cell_tool_result'; runId: string; promptIndex: number; model: string; id: string; name: string; content: string; isError: boolean; ms: number }
  | { event: 'cell_done'; runId: string; promptIndex: number; model: string; ttfs: number | null; totalTime: number; reasoningMs: number | null; toolCalls: number; usage: { inputTokens: number; outputTokens: number; reasoningTokens?: number } }
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

    for (const t of ['cell_start', 'cell_token', 'cell_reasoning', 'cell_tool_call', 'cell_tool_result', 'cell_done', 'cell_error', 'run_done']) {
      es.addEventListener(t, handleEvent(t))
    }

    es.onerror = () => { setConnected(false); es.close() }

    return () => { es.close(); setConnected(false) }
  }, [runId])

  return { connected, done }
}
