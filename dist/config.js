import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
};
function getBenchyDir() {
    return process.env.BENCHY_DIR ?? join(homedir(), '.benchy');
}
function getConfigPath() {
    return join(getBenchyDir(), 'config.json');
}
export async function readConfig() {
    try {
        const raw = await readFile(getConfigPath(), 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return { providers: [] };
    }
}
export async function writeConfig(config) {
    await mkdir(getBenchyDir(), { recursive: true });
    await writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
export async function getProviders() {
    const config = await readConfig();
    return config.providers;
}
export async function upsertProvider(provider) {
    const config = await readConfig();
    const idx = config.providers.findIndex(p => p.id === provider.id);
    if (idx >= 0) {
        config.providers[idx] = provider;
    }
    else {
        config.providers.push(provider);
    }
    await writeConfig(config);
}
export async function removeProvider(id) {
    const config = await readConfig();
    config.providers = config.providers.filter(p => p.id !== id);
    await writeConfig(config);
}
