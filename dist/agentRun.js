import { scriptAdapter } from './adapters/script.js';
import { httpJsonAdapter } from './adapters/http-json.js';
import { webhookAdapter } from './adapters/webhook.js';
import { resolveSecrets } from './config.js';
// Turns an agent target's config into an adapter + AdapterConfig, resolving named
// secrets into the child's env (command) or the auth header (http) at the last
// moment. Secrets never touch the target row — they are read here and handed
// straight to the transport.
export async function buildAgentCall(cfg, model) {
    const secrets = await resolveSecrets(cfg.secretRefs ?? []);
    const agent = {
        cwd: cfg.cwd,
        timeoutMs: cfg.timeoutMs,
        maxSteps: cfg.maxSteps,
        maxCostUsd: cfg.maxCostUsd,
    };
    if (cfg.transport === 'command') {
        agent.env = { ...(cfg.env ?? {}), ...secrets };
        return { adapter: scriptAdapter, config: { model, baseUrl: cfg.command, agent } };
    }
    // http: the first secret ref (if any) is the auth token.
    const firstRef = cfg.secretRefs?.[0];
    const apiKey = firstRef ? secrets[firstRef] : undefined;
    const adapter = cfg.url?.includes('/webhook') ? webhookAdapter : httpJsonAdapter;
    return { adapter, config: { model, baseUrl: cfg.url, apiKey, agent } };
}
// Drive an agent stream to completion, folding its chunks into an outcome. Pure
// consumption — no persistence — so the handshake and the run path share it.
export async function consumeAgentStream(stream, t0 = Date.now()) {
    const steps = [];
    let text = '';
    let reasoning = '';
    let ttfs = null;
    let inputTokens = 0, outputTokens = 0, reasoningTokens = 0;
    let reportedCost = null;
    let error = null;
    let errorScope = null;
    for await (const chunk of stream) {
        switch (chunk.type) {
            case 'token':
                if (ttfs === null && chunk.text)
                    ttfs = Date.now() - t0;
                text += chunk.text;
                break;
            case 'reasoning':
                reasoning += chunk.text;
                break;
            case 'step':
                steps.push(chunk.step);
                if (chunk.step.inputTokens)
                    inputTokens += chunk.step.inputTokens;
                if (chunk.step.outputTokens)
                    outputTokens += chunk.step.outputTokens;
                if (chunk.step.cost != null)
                    reportedCost = (reportedCost ?? 0) + chunk.step.cost;
                break;
            case 'done':
                inputTokens += chunk.usage.inputTokens;
                outputTokens += chunk.usage.outputTokens;
                reasoningTokens += chunk.usage.reasoningTokens ?? 0;
                break;
            case 'error':
                error = chunk.message;
                errorScope = chunk.scope === 'task' ? 'task' : 'agent';
                break;
        }
    }
    return {
        steps, text, reasoning, ttfs, reportedCost, error, errorScope,
        usage: { inputTokens, outputTokens, reasoningTokens },
    };
}
const DEFAULT_HANDSHAKE_PROMPT = 'What is 2+2? Answer with a single number.';
export async function handshakeAgent(cfg, model, prompt) {
    const messages = [{ role: 'user', content: prompt?.trim() || DEFAULT_HANDSHAKE_PROMPT }];
    const { adapter, config } = await buildAgentCall(cfg, model);
    const outcome = await consumeAgentStream(adapter.stream(messages, config));
    return {
        ok: outcome.error === null,
        spokeProtocol: outcome.steps.length > 0,
        steps: outcome.steps.length,
        reportedUsage: outcome.usage,
        output: outcome.text.trim(),
        error: outcome.error,
    };
}
