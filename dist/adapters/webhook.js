import { humanizeNetworkError, describeHttpError } from '../errors.js';
export const webhookAdapter = {
    async *stream(messages, config) {
        const url = config.baseUrl;
        if (!url) {
            yield { type: 'error', message: 'No webhook URL configured' };
            return;
        }
        const headers = { 'Content-Type': 'application/json' };
        if (config.apiKey)
            headers['X-Webhook-Secret'] = config.apiKey;
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({ model: config.model, messages, timestamp: Date.now() }),
            });
        }
        catch (err) {
            yield { type: 'error', message: humanizeNetworkError(err, url) };
            return;
        }
        if (!response.ok) {
            const text = await response.text().catch(() => response.statusText);
            yield { type: 'error', message: `Webhook: ${describeHttpError(response.status, text)}` };
            return;
        }
        const contentType = response.headers.get('content-type') ?? '';
        let text;
        if (contentType.includes('application/json')) {
            const json = await response.json();
            text = json.text ?? json.content ?? json.response ?? json.choices?.[0]?.message?.content ?? JSON.stringify(json);
        }
        else {
            text = await response.text();
        }
        if (text)
            yield { type: 'token', text };
        yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } };
    },
};
