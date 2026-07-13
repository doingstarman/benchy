import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Update discovery: the running build carries an identity (dist/version.json,
// stamped at build time), and the latest installable build's identity is the
// same file served from GitHub raw — exactly what `benchy update` installs.
// Comparing builtAt (not sha) sidesteps the build-vs-commit ordering: every
// release's pack produces a fresh, monotonic builtAt.
const REPO = 'doingstarman/benchy';
export const REPO_URL = `https://github.com/${REPO}`;
const RAW_VERSION_URL = `https://raw.githubusercontent.com/${REPO}/main/dist/version.json`;
const COMMITS_URL = `https://api.github.com/repos/${REPO}/commits?per_page=5&sha=main`;
const REMOTE_TTL_MS = 30 * 60 * 1000;
// A failed check is cached only briefly: one flaky request must not blind the
// app for half an hour.
const REMOTE_FAIL_TTL_MS = 2 * 60 * 1000;
const DEV_VERSION = { sha: 'dev', commitDate: null, builtAt: null };
let localCache;
// The compiled module lives next to dist/version.json; in dev (tsx over src/)
// the file is absent, which we treat as "dev build — never offer an update".
async function readLocalVersion() {
    if (localCache)
        return localCache;
    try {
        const path = join(dirname(fileURLToPath(import.meta.url)), 'version.json');
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        localCache = parsed;
    }
    catch {
        localCache = DEV_VERSION;
    }
    return localCache;
}
let remoteCache = null;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// The remote file is attacker-adjacent only in theory, but it IS unvalidated
// JSON: a malformed builtAt (a number, "unknown", a non-ISO string) must never
// be compared, or a lexically-large value pins a phantom banner forever.
function toBuildVersion(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const v = raw;
    if (typeof v.builtAt !== 'string' || !ISO_UTC.test(v.builtAt))
        return null;
    return {
        sha: typeof v.sha === 'string' ? v.sha : 'unknown',
        commitDate: typeof v.commitDate === 'string' ? v.commitDate : null,
        builtAt: v.builtAt,
    };
}
async function fetchRemote() {
    const ttl = remoteCache?.checkError === 'network' ? REMOTE_FAIL_TTL_MS : REMOTE_TTL_MS;
    if (remoteCache && Date.now() - remoteCache.fetchedAt < ttl)
        return remoteCache;
    // Each request gets its own signal: a slow commits API must not abort the
    // version fetch that actually decides hasUpdate.
    const get = async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
            if (!res.ok)
                return null;
            return await res.json();
        }
        finally {
            clearTimeout(timer);
        }
    };
    let latest = null;
    let checkError = null;
    try {
        const raw = await get(RAW_VERSION_URL);
        // Reached GitHub but there's no (valid) version.json published yet.
        latest = toBuildVersion(raw);
        if (!latest)
            checkError = 'missing';
    }
    catch {
        checkError = 'network';
    }
    let changes = [];
    try {
        const commits = await get(COMMITS_URL);
        changes = (commits ?? [])
            .filter(c => typeof c?.sha === 'string' && typeof c.commit?.message === 'string')
            .map(c => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0] }));
    }
    catch { /* changelog is a nicety — never let it decide anything */ }
    remoteCache = { latest, changes, checkError, fetchedAt: Date.now() };
    return remoteCache;
}
// Exported for tests: the banner can't be exercised end-to-end until a newer
// build actually exists upstream, so the comparison itself is what we pin down.
export function isNewer(latest, current) {
    // A dev build (no stamp) never nags. Both sides must be well-formed ISO UTC —
    // toISOString() is fixed-width, so lexicographic order == chronological order.
    if (typeof latest?.builtAt !== 'string' || !ISO_UTC.test(latest.builtAt))
        return false;
    if (typeof current.builtAt !== 'string' || !ISO_UTC.test(current.builtAt))
        return false;
    return latest.builtAt > current.builtAt;
}
// The CLI only needs "is there an update"; the API adds runtime paths on top.
export async function getUpdateStatus(force = false) {
    if (force)
        remoteCache = null;
    const current = await readLocalVersion();
    const remote = await fetchRemote();
    return {
        current,
        latest: remote.latest,
        hasUpdate: isNewer(remote.latest, current),
        changes: remote.changes,
        checkError: remote.checkError,
        checkedAt: remote.fetchedAt,
    };
}
export async function getVersionInfo(runtime, force = false) {
    return { ...await getUpdateStatus(force), repoUrl: REPO_URL, runtime };
}
