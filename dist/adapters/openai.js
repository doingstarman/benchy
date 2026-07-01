export const openaiAdapter = {
    async *stream(messages, config) {
        const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
        const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
        const t0 = Date.now();
        let firstToken = true;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey ?? ''}`,
            },
            body: JSON.stringify({
                model: config.model,
                messages,
                stream: true,
                stream_options: { include_usage: true },
                ...(config.settings?.temperature != null ? { temperature: config.settings.temperature } : {}),
                ...(config.settings?.topP != null ? { top_p: config.settings.topP } : {}),
                ...(config.settings?.maxOutputTokens != null ? { max_tokens: config.settings.maxOutputTokens } : {}),
            }),
        });
        if (!response.ok || !response.body) {
            const text = await response.text().catch(() => response.statusText);
            yield { type: 'error', message: `HTTP ${response.status}: ${text}` };
            return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let usage = { inputTokens: 0, outputTokens: 0 };
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
                    usage = {
                        inputTokens: Number(u.prompt_tokens ?? 0),
                        outputTokens: Number(u.completion_tokens ?? 0),
                    };
                }
                const choices = parsed.choices;
                if (!choices?.length)
                    continue;
                const delta = choices[0].delta;
                const text = delta?.content;
                if (typeof text === 'string' && text.length > 0) {
                    if (firstToken) {
                        firstToken = false;
                        // ttfs is measured by benchmark.ts from the outside
                        void t0;
                    }
                    yield { type: 'token', text };
                }
            }
        }
        yield { type: 'done', usage };
    },
};
