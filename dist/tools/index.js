import { calcTool } from './calc.js';
import { fetchUrlTool } from './fetch-url.js';
import { makeWebSearchTool } from './web-search.js';
import { makeHttpTool } from './http-tool.js';
import { getSearchConfig } from '../config.js';
// The BUILT-IN tool ids. A run may also request user-defined tool ids, which are
// resolved against the supplied customTools — see resolveTools.
export const TOOL_IDS = ['calc', 'fetch_url', 'web_search'];
export function isToolId(x) {
    return typeof x === 'string' && TOOL_IDS.includes(x);
}
// Turns the ids a run enabled into ready-to-run tools, keyed by spec name so the
// loop can dispatch by name. Built-ins first, then any custom tool whose id was
// requested (and is enabled). web_search silently drops out when there's no key,
// so a model is never handed a tool that would fail on its first call.
export async function resolveTools(ids, customTools = []) {
    const wanted = new Set(ids);
    const out = new Map();
    if (wanted.has('calc'))
        out.set(calcTool.spec.name, calcTool);
    if (wanted.has('fetch_url'))
        out.set(fetchUrlTool.spec.name, fetchUrlTool);
    if (wanted.has('web_search')) {
        const search = await getSearchConfig();
        if (search) {
            const tool = makeWebSearchTool(search);
            out.set(tool.spec.name, tool);
        }
    }
    for (const ct of customTools) {
        if (ct.enabled && wanted.has(ct.id)) {
            const tool = makeHttpTool(ct);
            out.set(tool.spec.name, tool);
        }
    }
    return out;
}
