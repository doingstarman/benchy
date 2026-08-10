export function toProviderView({ apiKey, ...rest }) {
    return { ...rest, apiKeyMask: maskApiKey(apiKey) };
}
// Last four characters only. Enough to tell two keys apart when you have a
// couple of them; useless to anyone who obtains it.
function maskApiKey(key) {
    if (!key)
        return null;
    return key.length <= 4 ? '•'.repeat(key.length) : '•'.repeat(16) + key.slice(-4);
}
