import { useEffect, useRef, useState } from 'react'
import type { Provider, ProviderView, Run, Result, AttachmentMeta, CustomTool, CustomToolView, Skill, McpServer, McpServerView, Dataset, DatasetItem, DatasetVar, ArenaVerdict, ArenaStanding, Target, TargetKind, ModelTargetConfig, MetricDef, MetricFormat, MetricDirection, MetricScope, MetricAggregate } from '../../src/types'
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

// Saving a provider. `apiKey` is write-only and tri-state, because the client
// no longer holds the key and so cannot echo it back unchanged:
//   omitted → keep the stored key · '' → erase it · a value → replace it
export type ProviderUpsert = Omit<ProviderView, 'id' | 'apiKeyMask'> & { id?: string; apiKey?: string }

export const providersApi = {
  list: () => apiFetch<ProviderView[]>('/api/providers'),
  upsert: (p: ProviderUpsert) =>
    apiFetch<ProviderView>('/api/providers', { method: 'POST', body: JSON.stringify(p) }),
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

// ─── targets (participants registry) ──────────────────────────────────────────

export type TargetUpsert = { name: string; config: ModelTargetConfig; tags?: string[]; enabled?: boolean; kind?: TargetKind }

export const targetsApi = {
  list: (kind: TargetKind = 'model') => apiFetch<Target[]>(`/api/targets?kind=${kind}`),
  get: (id: string) => apiFetch<Target>(`/api/targets/${encodeURIComponent(id)}`),
  create: (body: TargetUpsert) =>
    apiFetch<Target>('/api/targets', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<{ name: string; tags: string[]; enabled: boolean; config: ModelTargetConfig }>) =>
    apiFetch<Target>(`/api/targets/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  duplicate: (id: string) =>
    apiFetch<Target>(`/api/targets/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  remove: (id: string) => fetch(`/api/targets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export interface ProviderDraft {
  type: Provider['type']
  // Only set while the user is typing a replacement. For a saved provider the
  // form sends providerId instead and the backend supplies the key.
  apiKey?: string
  providerId?: string
  baseUrl?: string
  model?: string
}

// ─── library (tools / skills / mcp) ──────────────────────────────────────────

// Same write-only tri-state key as providers: the list returns a masked View, so
// the key field is omitted (keep) unless the user starts a replace ('' erases, a
// value replaces).
export type CustomToolUpsert = Omit<CustomToolView, 'apiKeyMask'> & { apiKey?: string }
export type McpServerUpsert = Omit<McpServerView, 'apiKeyMask'> & { apiKey?: string }

export const toolsApi = {
  list: () => apiFetch<CustomToolView[]>('/api/tools'),
  upsert: (t: CustomToolUpsert) =>
    apiFetch<CustomToolView>('/api/tools', { method: 'POST', body: JSON.stringify(t) }),
  remove: (id: string) => fetch(`/api/tools/${id}`, { method: 'DELETE' }),
}
export const skillsApi = {
  list: () => apiFetch<Skill[]>('/api/skills'),
  upsert: (s: Omit<Skill, 'id'> & { id?: string }) =>
    apiFetch<Skill>('/api/skills', { method: 'POST', body: JSON.stringify(s) }),
  remove: (id: string) => fetch(`/api/skills/${id}`, { method: 'DELETE' }),
}
export const mcpApi = {
  list: () => apiFetch<McpServerView[]>('/api/mcp'),
  upsert: (m: McpServerUpsert) =>
    apiFetch<McpServerView>('/api/mcp', { method: 'POST', body: JSON.stringify(m) }),
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
  run: (id: string, body: { models: string[]; prompt: string; systemPrompt?: string; mode?: 'score' | 'arena'; sample?: { strategy: 'first' | 'random'; n: number } }) =>
    apiFetch<{ runId: string }>(`/api/datasets/${id}/run`, { method: 'POST', body: JSON.stringify(body) }),
  rescore: (id: string, runId: string) =>
    apiFetch<{ rescored: boolean }>(`/api/datasets/${id}/runs/${runId}/rescore`, { method: 'POST' }),
  addNormRule: (id: string, type: 'text' | 'date' | 'number') =>
    apiFetch<Dataset>(`/api/datasets/${id}/norm-rules`, { method: 'POST', body: JSON.stringify({ type }) }),
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

export interface AppRunDefaults {
  temperature?: number
  maxOutputTokens?: number
}

export interface AppSettings {
  codeExecution: boolean
  codeExecTimeoutMs: number
  runDefaults: AppRunDefaults
  disabledMetrics: string[]
}

// Not Partial<AppSettings>: null is how a run default is UNSET, and it means
// something different from leaving the key out (which changes nothing).
export interface AppSettingsPatch {
  codeExecution?: boolean
  codeExecTimeoutMs?: number
  runDefaults?: { temperature?: number | null; maxOutputTokens?: number | null }
}

export const settingsApi = {
  get: () => apiFetch<AppSettings>('/api/settings'),
  update: (patch: AppSettingsPatch) =>
    apiFetch<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
}

// ─── metrics registry ─────────────────────────────────────────────────────────

export type MetricUpsert = {
  key: string; name: string; expression: string; unit?: string | null
  format?: MetricFormat; direction?: MetricDirection; scope?: MetricScope
  aggregate?: MetricAggregate | null; nullable?: boolean; enabled?: boolean
}
export interface MetricValidateResult {
  ok: boolean
  error?: { message: string; span?: [number, number]; suggestion?: string }
  refs: string[]
  usesAggregate: boolean
}
export interface MetricPreviewRow { item: string; inputs: string; value: number | null; note: string }
export interface MetricPreviewResult {
  ok: boolean
  error?: { message: string; span?: [number, number]; suggestion?: string }
  rows: MetricPreviewRow[]
  coverage: { have: number; total: number }
}

export const metricsApi = {
  list: (kind?: 'builtin' | 'custom') => apiFetch<MetricDef[]>(`/api/metrics${kind ? `?kind=${kind}` : ''}`),
  create: (body: MetricUpsert) => apiFetch<MetricDef>('/api/metrics', { method: 'POST', body: JSON.stringify(body) }),
  update: (key: string, body: Partial<MetricUpsert> & { enabled?: boolean }) =>
    apiFetch<MetricDef>(`/api/metrics/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (key: string) => fetch(`/api/metrics/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  validate: (expression: string, scope: MetricScope) =>
    apiFetch<MetricValidateResult>('/api/metrics/validate', { method: 'POST', body: JSON.stringify({ expression, scope }) }),
  preview: (expression: string, scope: MetricScope, aggregate?: MetricAggregate) =>
    apiFetch<MetricPreviewResult>('/api/metrics/preview', { method: 'POST', body: JSON.stringify({ expression, scope, aggregate }) }),
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
  // skipped counts runs still streaming, which the server refuses to delete.
  clearAll: () => apiFetch<{ deleted: number; skipped: number }>('/api/runs', { method: 'DELETE' }),
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
