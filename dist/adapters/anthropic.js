import Anthropic from '@anthropic-ai/sdk';
import { humanizeNetworkError } from '../errors.js';
export const anthropicAdapter = {
    async *stream(messages, config) {
        const client = new Anthropic({
            apiKey: config.apiKey ?? '',
            ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        });
        const systemMessages = messages.filter(m => m.role === 'system');
        const chatMessages = messages.filter(m => m.role !== 'system');
        const system = systemMessages.map(m => m.content).join('\n') || undefined;
        try {
            const stream = client.messages.stream({
                model: config.model,
                max_tokens: config.settings?.maxOutputTokens ?? 4096,
                ...(system ? { system } : {}),
                ...(config.settings?.temperature != null ? { temperature: config.settings.temperature } : {}),
                ...(config.settings?.topP != null ? { top_p: config.settings.topP } : {}),
                messages: chatMessages.map(m => ({
                    role: m.role,
                    content: m.content,
                })),
            });
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                    yield { type: 'token', text: event.delta.text };
                }
            }
            const final = await stream.finalMessage();
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
