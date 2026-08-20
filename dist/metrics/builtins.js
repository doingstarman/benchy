export const BUILTIN_METRICS = [
    { key: 'ttfs', name: 'Time to first token', unit: 'ms', format: 'ms', direction: 'lower', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true },
    { key: 'total_time', name: 'Total time', unit: 's', format: 's', direction: 'lower', scope: 'answer', aggregate: null, nullable: false, defaultEnabled: true },
    { key: 'input_tokens', name: 'Input tokens', unit: 'tokens', format: 'tokens', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true },
    { key: 'output_tokens', name: 'Output tokens', unit: 'tokens', format: 'tokens', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true },
    { key: 'reasoning_tokens', name: 'Reasoning tokens', unit: 'tokens', format: 'tokens', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: true },
    { key: 'reasoning_ms', name: 'Reasoning time', unit: 's', format: 's', direction: 'neutral', scope: 'answer', aggregate: null, nullable: true, defaultEnabled: false },
    { key: 'score', name: 'Score', unit: '%', format: 'pct', direction: 'higher', scope: 'run', aggregate: 'mean', nullable: true, defaultEnabled: true },
    { key: 'cost', name: 'Cost', unit: 'USD', format: 'usd', direction: 'lower', scope: 'run', aggregate: 'sum', nullable: true, defaultEnabled: true },
    { key: 'elo', name: 'Elo', unit: 'rating', format: 'raw', direction: 'higher', scope: 'run', aggregate: null, nullable: true, defaultEnabled: true },
];
export const BUILTIN_KEYS = BUILTIN_METRICS.map(m => m.key);
export const DEFAULT_DISABLED_METRICS = BUILTIN_METRICS.filter(m => !m.defaultEnabled).map(m => m.key);
// Built-ins a custom expression may reference: exactly those `resolveBuiltins`
// provides per answer. `elo` is per-run only (from arena standings) and has no
// per-answer value, so referencing it would materialize to null — keep it out.
export const RESOLVABLE_BUILTIN_KEYS = [
    'ttfs', 'total_time', 'input_tokens', 'output_tokens', 'reasoning_tokens', 'reasoning_ms', 'score', 'cost',
];
export function isBuiltinKey(key) {
    return BUILTIN_KEYS.includes(key);
}
// The registry view of the built-ins, with enabled applied from config.
export function builtinDefs(disabled) {
    return BUILTIN_METRICS.map(m => ({
        key: m.key,
        name: m.name,
        kind: 'builtin',
        expression: null,
        unit: m.unit,
        format: m.format,
        direction: m.direction,
        scope: m.scope,
        aggregate: m.aggregate,
        nullable: m.nullable,
        enabled: !disabled.includes(m.key),
    }));
}
