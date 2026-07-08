import { GoogleGenerativeAI } from '@google/generative-ai';
import { humanizeNetworkError } from '../errors.js';
export const googleAdapter = {
    async *stream(messages, config) {
        try {
            const genAI = new GoogleGenerativeAI(config.apiKey ?? '');
            const model = genAI.getGenerativeModel({ model: config.model });
            const systemMessages = messages.filter(m => m.role === 'system');
            const chatMessages = messages.filter(m => m.role !== 'system');
            const systemInstruction = systemMessages.map(m => m.content).join('\n') || undefined;
            const geminiModel = systemInstruction
                ? genAI.getGenerativeModel({ model: config.model, systemInstruction })
                : model;
            // Build history (all but last message)
            const history = chatMessages.slice(0, -1).map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }],
            }));
            const lastMessage = chatMessages.at(-1);
            if (!lastMessage) {
                yield { type: 'error', message: 'No user message provided' };
                return;
            }
            const generationConfig = {
                ...(config.settings?.temperature != null ? { temperature: config.settings.temperature } : {}),
                ...(config.settings?.topP != null ? { topP: config.settings.topP } : {}),
                ...(config.settings?.topK != null ? { topK: config.settings.topK } : {}),
                ...(config.settings?.maxOutputTokens != null ? { maxOutputTokens: config.settings.maxOutputTokens } : {}),
            };
            const chat = geminiModel.startChat({
                history,
                ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
            });
            const result = await chat.sendMessageStream(lastMessage.content);
            let inputTokens = 0;
            let outputTokens = 0;
            for await (const chunk of result.stream) {
                const text = chunk.text();
                if (text)
                    yield { type: 'token', text };
                if (chunk.usageMetadata) {
                    inputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
                    outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
                }
            }
            yield { type: 'done', usage: { inputTokens, outputTokens } };
        }
        catch (err) {
            yield { type: 'error', message: humanizeNetworkError(err, config.baseUrl) };
        }
    },
};
