import type { Adapter, AdapterConfig, AgentAdapterOptions, Chunk, Message, TraceStep, Usage } from './adapters/base.js'
import { scriptAdapter } from './adapters/script.js'
import { httpJsonAdapter } from './adapters/http-json.js'
import { webhookAdapter } from './adapters/webhook.js'
import { resolveSecrets } from './config.js'
import type { AgentTargetConfig } from './types.js'

// Turns an agent target's config into an adapter + AdapterConfig, resolving named
// secrets into the child's env (command) or the auth header (http) at the last
// moment. Secrets never touch the target row — they are read here and handed
// straight to the transport.
export async function buildAgentCall(
  cfg: AgentTargetConfig,
  model: string,
): Promise<{ adapter: Adapter; config: AdapterConfig }> {
  const secrets = await resolveSecrets(cfg.secretRefs ?? [])
  const agent: AgentAdapterOptions = {
    cwd: cfg.cwd,
    timeoutMs: cfg.timeoutMs,
    maxSteps: cfg.maxSteps,
    maxCostUsd: cfg.maxCostUsd,
  }
  if (cfg.transport === 'command') {
    agent.env = { ...(cfg.env ?? {}), ...secrets }
    return { adapter: scriptAdapter, config: { model, baseUrl: cfg.command, agent } }
  }
  // http: the first secret ref (if any) is the auth token.
  const firstRef = cfg.secretRefs?.[0]
  const apiKey = firstRef ? secrets[firstRef] : undefined
  const adapter = cfg.url?.includes('/webhook') ? webhookAdapter : httpJsonAdapter
  return { adapter, config: { model, baseUrl: cfg.url, apiKey, agent } }
}

// What one agent run produced, in a shape both the handshake and the benchmark
// cell consume.
export interface AgentRunOutcome {
  steps: TraceStep[]
  text: string
  reasoning: string
  usage: Usage
  reportedCost: number | null
  ttfs: number | null
  // Set to the fatal error's message; scope tells process-death from declared
  // task failure. null when the run completed.
  error: string | null
  errorScope: 'agent' | 'task' | null
}

// Drive an agent stream to completion, folding its chunks into an outcome. Pure
// consumption — no persistence — so the handshake and the run path share it.
export async function consumeAgentStream(stream: AsyncIterable<Chunk>, t0 = Date.now()): Promise<AgentRunOutcome> {
  const steps: TraceStep[] = []
  let text = ''
  let reasoning = ''
  let ttfs: number | null = null
  let inputTokens = 0, outputTokens = 0, reasoningTokens = 0
  let reportedCost: number | null = null
  let error: string | null = null
  let errorScope: 'agent' | 'task' | null = null

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'token':
        if (ttfs === null && chunk.text) ttfs = Date.now() - t0
        text += chunk.text
        break
      case 'reasoning':
        reasoning += chunk.text
        break
      case 'step':
        steps.push(chunk.step)
        if (chunk.step.inputTokens) inputTokens += chunk.step.inputTokens
        if (chunk.step.outputTokens) outputTokens += chunk.step.outputTokens
        if (chunk.step.cost != null) reportedCost = (reportedCost ?? 0) + chunk.step.cost
        break
      case 'done':
        inputTokens += chunk.usage.inputTokens
        outputTokens += chunk.usage.outputTokens
        reasoningTokens += chunk.usage.reasoningTokens ?? 0
        break
      case 'error':
        error = chunk.message
        errorScope = chunk.scope === 'task' ? 'task' : 'agent'
        break
    }
  }

  return {
    steps, text, reasoning, ttfs, reportedCost, error, errorScope,
    usage: { inputTokens, outputTokens, reasoningTokens },
  }
}

// A once-off diagnostic run on a trivial prompt. Reports on TWO axes: did the
// process work (ran, exit, wall) and did it speak the protocol (how many step
// events). That is why there are three outcomes, not two: full trace / ran but no
// structure (degraded) / process died.
export interface HandshakeResult {
  ok: boolean
  spokeProtocol: boolean
  steps: number
  reportedUsage: Usage
  output: string
  error: string | null
}

const DEFAULT_HANDSHAKE_PROMPT = 'What is 2+2? Answer with a single number.'

export async function handshakeAgent(cfg: AgentTargetConfig, model: string, prompt?: string): Promise<HandshakeResult> {
  const messages: Message[] = [{ role: 'user', content: prompt?.trim() || DEFAULT_HANDSHAKE_PROMPT }]
  const { adapter, config } = await buildAgentCall(cfg, model)
  const outcome = await consumeAgentStream(adapter.stream(messages, config))
  return {
    ok: outcome.error === null,
    spokeProtocol: outcome.steps.length > 0,
    steps: outcome.steps.length,
    reportedUsage: outcome.usage,
    output: outcome.text.trim(),
    error: outcome.error,
  }
}
