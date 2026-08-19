// For kind='model' a target id IS the model key `providerId:model` (e.g.
// `openai:gpt-4o`), so every historical result maps to a target with no ambiguity.
// A user-created variant appends `#slug` (`openai:gpt-4o#creative`). The provider id
// is everything before the FIRST colon; the model name may itself contain `:`
// (HF-style ids), so it is the rest. The variant is after the last `#`.
export function modelTargetId(providerId, model) {
    return `${providerId}:${model}`;
}
export function parseTargetId(id) {
    const hash = id.lastIndexOf('#');
    const variant = hash >= 0 ? id.slice(hash + 1) : undefined;
    const base = hash >= 0 ? id.slice(0, hash) : id;
    const colon = base.indexOf(':');
    const providerId = colon >= 0 ? base.slice(0, colon) : '';
    const model = colon >= 0 ? base.slice(colon + 1) : base;
    return { providerId, model, variant };
}
// Slugify a display name into a `#variant` suffix (a-z0-9, dashes collapsed).
export function variantSlug(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    return slug || 'variant';
}
