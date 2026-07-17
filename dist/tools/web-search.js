async function brave(query, apiKey) {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
        headers: { 'X-Subscription-Token': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok)
        throw new Error(`Brave search failed with status ${res.status}`);
    const data = await res.json();
    return (data.web?.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.description }));
}
async function tavily(query, apiKey) {
    const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok)
        throw new Error(`Tavily search failed with status ${res.status}`);
    const data = await res.json();
    return (data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.content }));
}
// Built only when a search key is configured, so a model is never offered a
// tool that would fail on the first call.
export function makeWebSearchTool(config) {
    return {
        spec: {
            name: 'web_search',
            description: 'Search the web and return the top results (title, URL, snippet) for a query.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'The search query.' },
                },
                required: ['query'],
            },
        },
        async run(args) {
            const query = args.query;
            if (typeof query !== 'string' || !query.trim())
                throw new Error('query must be a non-empty string');
            const hits = config.provider === 'brave'
                ? await brave(query.trim(), config.apiKey)
                : await tavily(query.trim(), config.apiKey);
            if (hits.length === 0)
                return 'No results.';
            return hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join('\n\n');
        },
    };
}
