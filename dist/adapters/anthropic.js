import Anthropic from '@anthropic-ai/sdk';
import { humanizeNetworkError } from '../errors.js';
// Images become image blocks, PDFs become document blocks — both native here.
function toAnthropicContent(msg) {
    if (!msg.attachments?.length)
        return msg.content;
    const blocks = msg.attachments.map(a => a.mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
        : { type: 'image', source: { type: 'base64', media_type: a.mimeType, data: a.data } });
    blocks.push({ type: 'text', text: msg.content });
    return blocks;
}
// benchy's neutral messages → Anthropic's shape. Tool results are a `user`
// message of tool_result blocks; an assistant turn that called tools replays
// them as tool_use blocks so the model can match results to its requests.
function toAnthropicMessage(msg) {
    if (msg.role === 'tool' && msg.toolResults?.length) {
        return {
            role: 'user',
            content: msg.toolResults.map(r => ({
                type: 'tool_result',
                tool_use_id: r.id,
                content: r.content,
                ...(r.isError ? { is_error: true } : {}),
            })),
        };
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const blocks = [];
        if (msg.content)
            blocks.push({ type: 'text', text: msg.content });
        for (const c of msg.toolCalls) {
            blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
        }
        return { role: 'assistant', content: blocks };
    }
    return { role: msg.role, content: toAnthropicContent(msg) };
}
export const anthropicAdapter = {
    async *stream(messages, config) {
        const client = new Anthropic({
            apiKey: config.apiKey ?? '',
            ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        });
        const systemMessages = messages.filter(m => m.role === 'system');
        const chatMessages = messages.filter(m => m.role !== 'system');
        const system = systemMessages.map(m => m.content).join('\n') || undefined;
        // Claude never thinks unless asked, so this is opt-in rather than passive
        // observation. Adaptive is the only accepted form on 4.6+ — `budget_tokens`
        // is rejected outright on Opus 4.8/4.7 and Fable 5.
        //
        // NOT combined with tools: a thinking turn that calls a tool must replay its
        // thinking block — signature and all — in the assistant message on the next
        // round, or Anthropic 400s. benchy's neutral Message can't carry that opaque
        // block through the tool loop, so when tools are on, thinking stays off and
        // the tool round works. (OpenAI-compatible providers are unaffected — their
        // reasoning rides the stream and is never replayed.)
        const thinking = config.settings?.extendedThinking === true && !config.tools?.length;
        try {
            const stream = client.messages.stream({
                model: config.model,
                max_tokens: config.settings?.maxOutputTokens ?? 4096,
                ...(system ? { system } : {}),
                // Thinking pins temperature to 1; sending benchy's default 0.7
                // alongside it is a 400 on every single request.
                ...(!thinking && config.settings?.temperature != null ? { temperature: config.settings.temperature } : {}),
                ...(!thinking && config.settings?.topP != null ? { top_p: config.settings.topP } : {}),
                ...(thinking ? { thinking: { type: 'adaptive' } } : {}),
                ...(config.tools?.length
                    ? { tools: config.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
                    : {}),
                messages: chatMessages.map(toAnthropicMessage),
            });
            for await (const event of stream) {
                if (event.type !== 'content_block_delta')
                    continue;
                if (event.delta.type === 'text_delta') {
                    yield { type: 'token', text: event.delta.text };
                }
                else if (event.delta.type === 'thinking_delta') {
                    yield { type: 'reasoning', text: event.delta.thinking };
                }
            }
            const final = await stream.finalMessage();
            // The assembled message carries fully-parsed tool_use blocks — far cleaner
            // than reassembling input_json_delta fragments by hand.
            for (const block of final.content) {
                if (block.type === 'tool_use') {
                    yield {
                        type: 'tool_call',
                        call: { id: block.id, name: block.name, args: (block.input ?? {}) },
                    };
                }
            }
            yield {
                type: 'done',
                usage: {
                    inputTokens: final.usage.input_tokens,
                    outputTokens: final.usage.output_tokens,
                },
            };
        }
        catch (err) {
            yield { type: 'error', message: humanizeNetworkError(err, config.baseUrl) };
        }
    },
};
