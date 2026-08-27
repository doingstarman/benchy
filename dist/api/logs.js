import { isLocalRequest } from './csrf.js';
import { queryLogs, countLogs, clearLogs } from '../logStore.js';
const LEVELS = ['debug', 'info', 'warn', 'error'];
const CATEGORIES = ['api', 'run', 'cell', 'agent', 'pipeline', 'system'];
function parseQuery(q) {
    const num = (v) => (v != null && /^\d+$/.test(v) ? Number(v) : undefined);
    return {
        since: num(q.since),
        until: num(q.until),
        level: LEVELS.includes(q.level) ? q.level : undefined,
        category: CATEGORIES.includes(q.category) ? q.category : undefined,
        q: q.q?.trim() || undefined,
        limit: num(q.limit),
    };
}
const iso = (ts) => new Date(ts).toISOString();
function toCsv(rows) {
    const esc = (s) => `"${s.replace(/"/g, '""')}"`;
    const head = 'ts,level,category,message,meta';
    const body = rows.map(r => [iso(r.ts), r.level, r.category, r.message, r.meta != null ? JSON.stringify(r.meta) : ''].map(v => esc(String(v))).join(','));
    return [head, ...body].join('\n');
}
function toTxt(rows) {
    return rows.map(r => `${iso(r.ts)} ${r.level.toUpperCase().padEnd(5)} ${r.category.padEnd(8)} ${r.message}${r.meta != null ? ' ' + JSON.stringify(r.meta) : ''}`).join('\n');
}
export async function registerLogsRoutes(app) {
    app.get('/api/logs', async (req) => {
        const rows = queryLogs(parseQuery(req.query));
        return { data: { rows, total: countLogs() } };
    });
    // Export the CURRENT filter (not just the page) in one of several formats. Raised
    // limit so an export covers the range, not the on-screen page.
    app.get('/api/logs/export', async (req, reply) => {
        const q = req.query;
        const rows = queryLogs({ ...parseQuery(q), limit: 5000 });
        const format = (q.format ?? 'json').toLowerCase();
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const send = (body, ext, type) => reply.header('Content-Type', `${type}; charset=utf-8`).header('Content-Disposition', `attachment; filename="benchy-logs-${stamp}.${ext}"`).send(body);
        switch (format) {
            case 'csv': return send(toCsv(rows), 'csv', 'text/csv');
            case 'txt': return send(toTxt(rows), 'txt', 'text/plain');
            case 'ndjson': return send(rows.map(r => JSON.stringify(r)).join('\n'), 'ndjson', 'application/x-ndjson');
            default: return send(JSON.stringify(rows, null, 2), 'json', 'application/json');
        }
    });
    app.delete('/api/logs', async (req, reply) => {
        if (!isLocalRequest(req))
            return reply.code(403).send({ error: 'cross-site request refused' });
        clearLogs();
        return reply.code(204).send();
    });
}
