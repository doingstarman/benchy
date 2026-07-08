// Node's fetch (undici) reports every network failure as a bare
// "fetch failed" TypeError with the real reason buried in err.cause.
// These helpers surface that reason as a message a human can act on.
function findCode(err, depth = 0) {
    if (!err || depth > 4)
        return undefined;
    return err.code ?? findCode(err.cause, depth + 1);
}
export function humanizeNetworkError(err, target) {
    const e = err;
    const code = findCode(e);
    const where = target ? ` (${target})` : '';
    switch (code) {
        case 'ECONNREFUSED':
            return `Connection refused${where} — nothing is listening at that address`;
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return `Host not found${where} — check the base URL`;
        case 'ETIMEDOUT':
        case 'UND_ERR_CONNECT_TIMEOUT':
        case 'UND_ERR_HEADERS_TIMEOUT':
            return `Connection timed out${where}`;
        case 'ECONNRESET':
        case 'UND_ERR_SOCKET':
            return `Connection dropped mid-request${where}`;
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'CERT_HAS_EXPIRED':
            return `TLS certificate problem${where}`;
    }
    if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
        return `Request timed out${where}`;
    }
    const msg = e?.message ?? String(err);
    if (msg === 'fetch failed' || msg === 'Connection error.') {
        return `Could not reach the endpoint${where} — network error`;
    }
    return msg;
}
// Providers wrap error details in different JSON envelopes — dig out the text.
function extractApiErrorMessage(body) {
    try {
        const parsed = JSON.parse(body);
        const raw = typeof parsed.error === 'string'
            ? parsed.error
            : parsed.error?.message ?? parsed.message;
        if (raw)
            return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
    }
    catch { /* not JSON — use raw body */ }
    const trimmed = body.trim();
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}
export function describeHttpError(status, body) {
    const hint = status === 401 ? 'invalid or missing API key' :
        status === 403 ? 'access denied — this key lacks permission' :
            status === 404 ? 'endpoint or model not found' :
                status === 429 ? 'rate limit or quota exceeded' :
                    status >= 500 ? 'provider-side server error — try again later' :
                        '';
    const detail = extractApiErrorMessage(body);
    return `HTTP ${status}${hint ? ` — ${hint}` : ''}${detail ? `: ${detail}` : ''}`;
}
