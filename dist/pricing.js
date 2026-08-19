// Per-1M-token USD prices — a convenience table, not an authority. Vendors change
// rates, so a model absent here shows "—" rather than a confidently-wrong number
// (a wrong cost reads as fact and is worse than no cost). A per-provider override
// (set on the Providers screen) wins over this table when present — see
// resolvePricing.
//
// Pure data + math, no node imports — the frontend bundles it directly.
export const DEFAULT_PRICING = {
    'claude-opus-4-5': { inputPer1M: 5, outputPer1M: 25 },
    'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15 },
    'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5 },
    'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
    'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
};
// A run's model id is "providerId:model"; price by the model part.
export function modelName(model) {
    return model.includes(':') ? model.slice(model.indexOf(':') + 1) : model;
}
export function pricingFor(model) {
    return DEFAULT_PRICING[modelName(model)] ?? null;
}
// The provider's own price for a model wins over the curated table; the table is
// the fallback, and null when neither has it. `overrides` is the provider's
// pricing map (model name → prices).
export function resolvePricing(model, overrides) {
    const name = modelName(model);
    return overrides?.[name] ?? DEFAULT_PRICING[name] ?? null;
}
// null when either token count is missing: a cost from half the usage reads as
// "cheap" when it actually means "unknown".
export function computeCost(pricing, inputTokens, outputTokens) {
    if (!pricing || inputTokens == null || outputTokens == null)
        return null;
    return (inputTokens / 1e6) * pricing.inputPer1M + (outputTokens / 1e6) * pricing.outputPer1M;
}
// Sub-cent costs are the common case for one answer, so a fixed 2 decimals would
// print "$0.00" for every one of them and look broken.
export function formatCost(cost) {
    if (cost == null)
        return '—';
    if (cost === 0)
        return '$0';
    if (cost < 0.01)
        return `$${cost.toFixed(4)}`;
    if (cost < 1)
        return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
}
