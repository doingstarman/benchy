import { humanizeNetworkError, describeHttpError } from '../errors.js';
import { ThinkTagParser } from './think-tags.js';
// The chat completions API takes images as data-URL content parts; PDFs are
// not accepted there at all.
function toOpenAIMessage(msg) {
    // A tool result goes back as one message per call, keyed by tool_call_id.
    if (msg.role === 'tool') {
        return msg.toolResults?.length
            ? { role: 'tool', tool_call_id: msg.toolResults[0].id, content: msg.toolResults[0].content }
            : { role: 'tool', content: msg.content };
    }
    const base = msg.attachments?.length
        ? {
            role: msg.role,
            content: [
                { type: 'text', text: msg.content },
                ...msg.attachments.map(a => ({
                    type: 'image_url',
                    image_url: { url: `data:${a.mimeType};base64,${a.data}` },
                })),
            ],
        }
        : { role: msg.role, content: msg.content };
    // An assistant turn that called tools must replay those calls, or the model
    // can't match the tool results that follow to what it asked for.
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
        base.tool_calls = msg.toolCalls.map(c => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
        }));
    }
    return base;
}
// A tool result may itself be a message with several results (parallel calls);
// chat/completions wants one {role:'tool'} message per call.
function expandMessages(messages) {
    const out = [];
    for (const msg of messages) {
        if (msg.role === 'tool' && msg.toolResults && msg.toolResults.length > 1) {
            for (const r of msg.toolResults) {
                out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
            }
        }
        else {
            out.push(toOpenAIMessage(msg));
        }
    }
    return out;
}
export const openaiAdapter = {
    async *stream(messages, config) {
        const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
        const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
        const unsupported = messages.flatMap(m => m.attachments ?? []).find(a => !a.mimeType.startsWith('image/'));
        if (unsupported) {
            yield {
                type: 'error',
                message: `"${unsupported.name}" (${unsupported.mimeType}) is not supported by this provider's chat completions API — only images can be attached. See your provider's docs for supported input formats (OpenAI: https://platform.openai.com/docs/guides/images-vision)`,
            };
            return;
        }
        const t0 = Date.now();
        let firstToken = true;
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.apiKey ?? ''}`,
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: expandMessages(messages),
                    stream: true,
                    stream_options: { include_usage: true },
                    ...(config.settings?.temperature != null ? { temperature: config.settings.temperature } : {}),
                    ...(config.settings?.topP != null ? { top_p: config.settings.topP } : {}),
                    ...(config.settings?.maxOutputTokens != null ? { max_tokens: config.settings.maxOutputTokens } : {}),
                    // Absent when no tools are enabled — the request is then identical to
                    // a pre-tools benchy request.
                    ...(config.tools?.length
                        ? { tools: config.tools.map(t => ({ type: 'function', function: t })) }
                        : {}),
                }),
            });
        }
        catch (err) {
            yield { type: 'error', message: humanizeNetworkError(err, baseUrl) };
            return;
        }
        if (!response.ok || !response.body) {
            const text = await response.text().catch(() => response.statusText);
            yield { type: 'error', message: describeHttpError(response.status, text) };
            return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let usage = { inputTokens: 0, outputTokens: 0 };
        const think = new ThinkTagParser();
        // Tool-call fragments accumulate here, keyed by the delta's `index`.
        const partialCalls = new Map();
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]')
                    continue;
                let parsed;
                try {
                    parsed = JSON.parse(data);
                }
                catch {
                    continue;
                }
                // usage chunk (stream_options)
                if (parsed.usage && typeof parsed.usage === 'object') {
                    const u = parsed.usage;
                    const details = u.completion_tokens_details;
                    const reasoning = Number(details?.reasoning_tokens ?? 0);
                    usage = {
                        inputTokens: Number(u.prompt_tokens ?? 0),
                        outputTokens: Number(u.completion_tokens ?? 0),
                        // The only reasoning signal OpenAI itself gives over chat/completions:
                        // a count, never the text.
                        ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}),
                    };
                }
                const choices = parsed.choices;
                if (!choices?.length)
                    continue;
                const delta = choices[0].delta;
                // Providers disagree on the field name for the same thing: OpenRouter
                // sends `reasoning`, DeepSeek and vLLM send `reasoning_content`.
                const reasoning = delta?.reasoning_content ?? delta?.reasoning;
                if (typeof reasoning === 'string' && reasoning.length > 0) {
                    yield { type: 'reasoning', text: reasoning };
                }
                // Tool-call fragments: {index, id?, function:{name?, arguments?}}. The
                // id and name land in the first fragment for an index; the arguments
                // dribble in as raw JSON text across the rest.
                const toolDeltas = delta?.tool_calls;
                if (Array.isArray(toolDeltas)) {
                    for (const td of toolDeltas) {
                        const idx = Number(td.index ?? 0);
                        const fn = td.function;
                        const cur = partialCalls.get(idx) ?? { id: '', name: '', args: '' };
                        if (typeof td.id === 'string')
                            cur.id = td.id;
                        if (fn && typeof fn.name === 'string')
                            cur.name = fn.name;
                        if (fn && typeof fn.arguments === 'string')
                            cur.args += fn.arguments;
                        partialCalls.set(idx, cur);
                    }
                }
                const text = delta?.content;
                if (typeof text === 'string' && text.length > 0) {
                    if (firstToken) {
                        firstToken = false;
                        // ttfs is measured by benchmark.ts from the outside
                        void t0;
                    }
                    // Endpoints with no reasoning field inline it as <think>…</think>.
                    for (const part of think.push(text))
                        yield part;
                }
            }
        }
        for (const part of think.flush())
            yield part;
        // Emit assembled tool calls before done, so the loop can run them. A call
        // with unparseable arguments still goes out with {} — the tool will reject
        // it and the model gets an error result to react to, which is more useful
        // than a silent drop.
        for (const [, call] of partialCalls) {
            if (!call.name)
                continue;
            let args = {};
            try {
                const parsed = call.args ? JSON.parse(call.args) : {};
                if (parsed && typeof parsed === 'object')
                    args = parsed;
            }
            catch { /* leave args as {} */ }
            yield { type: 'tool_call', call: { id: call.id || `call_${Math.round(performance.now())}`, name: call.name, args } };
        }
        yield { type: 'done', usage };
    },
};
