import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const DEFAULT_PROVIDER_SETTINGS = {
    temperature: 0.7,
    topP: 1.0,
    topK: null,
    maxOutputTokens: 2048,
    contextBudget: null,
    truncation: 'auto',
    timeoutMs: 60000,
    retries: 2,
    streaming: true,
    extendedThinking: false,
};
export async function getSearchConfig() {
    const config = await readConfig();
    const s = config.search;
    if (!s || !s.apiKey || (s.provider !== 'brave' && s.provider !== 'tavily'))
        return undefined;
    return s;
}
export async function getCustomTools() {
    return (await readConfig()).customTools ?? [];
}
export async function getSkills() {
    return (await readConfig()).skills ?? [];
}
export async function getMcpServers() {
    return (await readConfig()).mcpServers ?? [];
}
// Whether 'code' datasets may execute a model's solution locally. Defaults to
// false: absent config, an unparseable value, anything but an explicit `true`
// keeps execution off, so a code run never fires by accident.
export async function getCodeExecutionEnabled() {
    return (await readConfig()).codeExecution === true;
}
export async function setCodeExecutionEnabled(enabled) {
    return serialize(async () => {
        const config = await readConfig();
        config.codeExecution = enabled;
        await writeConfig(config);
    });
}
function getBenchyDir() {
    return process.env.BENCHY_DIR ?? join(homedir(), '.benchy');
}
function getConfigPath() {
    return join(getBenchyDir(), 'config.json');
}
function isDevEnvironment() {
    return getBenchyDir().endsWith('.benchy-dev');
}
export async function readConfig() {
    const path = getConfigPath();
    let raw;
    try {
        raw = await readFile(path, 'utf-8');
    }
    catch {
        return { providers: [] }; // no config yet — a first run is legitimately empty
    }
    // A file that EXISTS but can't be understood must never be reported as "no
    // providers": upsert would then write a config containing only the new entry
    // and take every other provider's API key with it. Refuse instead — the file
    // stays on disk untouched, so the user can fix or restore it.
    const bail = (why) => {
        throw new Error(`Config at ${path} ${why} — refusing to overwrite it. Fix or move the file, then restart benchy.`);
    };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return bail('is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object')
        return bail('is not a JSON object');
    if (!Array.isArray(parsed.providers))
        return bail('has no providers array');
    return parsed;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function writeConfig(config) {
    await mkdir(getBenchyDir(), { recursive: true });
    const path = getConfigPath();
    // Write-then-rename: rename is atomic, so a crash or a full disk leaves the
    // previous config intact instead of a half-written file that reads as empty.
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8');
        // On Windows a rename onto an existing file loses to any transient lock — an
        // antivirus or the search indexer reading config.json is enough for EPERM.
        // Give it a few tries before admitting defeat.
        for (let attempt = 0;; attempt++) {
            try {
                await rename(tmp, path);
                return;
            }
            catch (err) {
                const code = err.code;
                if (attempt >= 4 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY'))
                    throw err;
                await sleep(20 * (attempt + 1));
            }
        }
    }
    finally {
        // The temp file holds every API key in cleartext. If the rename never
        // happened, it must not be left lying on disk.
        await unlink(tmp).catch(() => { });
    }
}
// Every writer does read → modify → write, which is only safe one at a time:
// twenty concurrent saves used to leave one provider and drop nineteen. The
// rename is atomic, but atomicity is not isolation.
let writeQueue = Promise.resolve();
function serialize(fn) {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => { });
    return run;
}
export async function getProviders() {
    const config = await readConfig();
    if (isDevEnvironment())
        return config.providers;
    return config.providers.filter(p => !p.id.startsWith('mock-'));
}
export async function upsertProvider(provider) {
    return serialize(async () => {
        const config = await readConfig();
        const idx = config.providers.findIndex(p => p.id === provider.id);
        if (idx >= 0) {
            config.providers[idx] = provider;
        }
        else {
            config.providers.push(provider);
        }
        await writeConfig(config);
    });
}
export async function removeProvider(id) {
    return serialize(async () => {
        const config = await readConfig();
        config.providers = config.providers.filter(p => p.id !== id);
        await writeConfig(config);
    });
}
export async function upsertCustomTool(tool) {
    return serialize(async () => {
        const config = await readConfig();
        const list = config.customTools ?? [];
        const idx = list.findIndex(t => t.id === tool.id);
        if (idx >= 0)
            list[idx] = tool;
        else
            list.push(tool);
        config.customTools = list;
        await writeConfig(config);
    });
}
export async function removeCustomTool(id) {
    return serialize(async () => {
        const config = await readConfig();
        config.customTools = (config.customTools ?? []).filter(t => t.id !== id);
        await writeConfig(config);
    });
}
export async function upsertSkill(skill) {
    return serialize(async () => {
        const config = await readConfig();
        const list = config.skills ?? [];
        const idx = list.findIndex(s => s.id === skill.id);
        if (idx >= 0)
            list[idx] = skill;
        else
            list.push(skill);
        config.skills = list;
        await writeConfig(config);
    });
}
export async function removeSkill(id) {
    return serialize(async () => {
        const config = await readConfig();
        config.skills = (config.skills ?? []).filter(s => s.id !== id);
        await writeConfig(config);
    });
}
export async function upsertMcpServer(server) {
    return serialize(async () => {
        const config = await readConfig();
        const list = config.mcpServers ?? [];
        const idx = list.findIndex(m => m.id === server.id);
        if (idx >= 0)
            list[idx] = server;
        else
            list.push(server);
        config.mcpServers = list;
        await writeConfig(config);
    });
}
export async function removeMcpServer(id) {
    return serialize(async () => {
        const config = await readConfig();
        config.mcpServers = (config.mcpServers ?? []).filter(m => m.id !== id);
        await writeConfig(config);
    });
}
