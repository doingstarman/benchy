import { Agent } from 'undici';
import { assertPublicHost } from './ssrf.js';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 100_000;
const MAX_REDIRECTS = 5;
// Fetches a public web page for the model. Every hop is re-validated, because a
// public URL is free to 302 you straight to http://127.0.0.1:4242/api/providers
// — redirect: 'manual' is what makes each Location checkable instead of
// followed blindly.
async function fetchText(startUrl) {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            throw new Error(`invalid URL: ${url}`);
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`only http and https are allowed, got ${parsed.protocol}`);
        }
        const vetted = await assertPublicHost(parsed.hostname);
        // Pin the connection to the exact address we just vetted. Without this,
        // undici would resolve the hostname a SECOND time and a rebinding domain
        // could hand it 127.0.0.1 after we saw a public IP. SNI/Host stay the
        // hostname, so TLS and vhosts still work — only the IP is forced.
        const dispatcher = new Agent({
            connect: {
                lookup: (_hostname, options, cb) => {
                    if (options && options.all) {
                        cb(null, [{ address: vetted.address, family: vetted.family }]);
                    }
                    else {
                        cb(null, vetted.address, vetted.family);
                    }
                },
            },
        });
        // The dispatcher owns the pinned connection, so it must outlive the body
        // read — closed only after this hop is fully done, not right after headers.
        try {
            const res = await fetch(url, {
                redirect: 'manual',
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { 'user-agent': 'benchy-tool/1.0', accept: 'text/html,text/plain,application/json' },
                // @ts-expect-error dispatcher is an undici extension to RequestInit, not in the DOM lib types
                dispatcher,
            });
            if (res.status >= 300 && res.status < 400) {
                const loc = res.headers.get('location');
                if (!loc)
                    throw new Error(`redirect with no Location (status ${res.status})`);
                // Resolve relative redirects against the current URL before re-checking.
                url = new URL(loc, url).toString();
                continue;
            }
            if (!res.ok)
                throw new Error(`request failed with status ${res.status}`);
            // Cap the body by reading a bounded number of bytes rather than trusting
            // Content-Length, which a server can lie about or omit.
            const reader = res.body?.getReader();
            if (!reader)
                return '';
            const chunks = [];
            let total = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value) {
                    chunks.push(value);
                    total += value.length;
                    if (total >= MAX_BYTES) {
                        await reader.cancel().catch(() => { });
                        break;
                    }
                }
            }
            return new TextDecoder().decode(concat(chunks)).slice(0, MAX_BYTES);
        }
        finally {
            void dispatcher.close().catch(() => { void dispatcher.destroy().catch(() => { }); });
        }
    }
    throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
}
function concat(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}
export const fetchUrlTool = {
    spec: {
        name: 'fetch_url',
        description: 'Fetch the contents of a public web page over http/https and return its text (truncated to 100 KB). Cannot reach local or private addresses.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The absolute http(s) URL to fetch.' },
            },
            required: ['url'],
        },
    },
    async run(args) {
        const url = args.url;
        if (typeof url !== 'string' || !url.trim())
            throw new Error('url must be a non-empty string');
        return fetchText(url.trim());
    },
};
