// Discriminators over the config union. A pipeline carries `mode` (agents never do), so
// it is checked FIRST — an external pipeline also has `transport`, which must not read as
// an agent.
export function isPipelineConfig(c) {
    return 'mode' in c;
}
export function isAgentConfig(c) {
    return 'transport' in c && !('mode' in c);
}
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
export function toCustomToolView({ apiKey, ...rest }) {
    return { ...rest, apiKeyMask: maskApiKey(apiKey) };
}
export function toMcpServerView({ apiKey, ...rest }) {
    return { ...rest, apiKeyMask: maskApiKey(apiKey) };
}
