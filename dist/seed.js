import { writeConfig, readConfig } from './config.js';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
function getArg(name) {
    const prefix = `--${name}=`;
    const inline = process.argv.find(arg => arg.startsWith(prefix));
    if (inline)
        return inline.slice(prefix.length);
    const index = process.argv.indexOf(`--${name}`);
    if (index >= 0)
        return process.argv[index + 1];
    return undefined;
}
function resolveConfigDir(path) {
    if (path === '~')
        return homedir();
    if (path.startsWith('~/') || path.startsWith('~\\')) {
        return resolve(homedir(), path.slice(2));
    }
    return resolve(path);
}
const configDir = getArg('config-dir');
if (configDir) {
    process.env.BENCHY_DIR = resolveConfigDir(configDir);
}
const port = Number.parseInt(getArg('port') ?? '4243', 10);
const mockBaseUrl = `http://localhost:${port}/api/mock`;
const MOCK_PROVIDERS = [
    {
        id: 'mock-openai',
        name: 'Mock OpenAI',
        type: 'openai',
        baseUrl: mockBaseUrl,
        apiKey: 'mock-key',
        models: ['gpt-4o', 'gpt-4o-mini'],
        enabled: true,
    },
    {
        id: 'mock-anthropic',
        name: 'Mock Anthropic',
        type: 'openai',
        baseUrl: mockBaseUrl,
        apiKey: 'mock-key',
        models: ['claude-3-5-sonnet', 'claude-3-haiku'],
        enabled: true,
    },
    {
        id: 'mock-meta',
        name: 'Mock Llama (Groq)',
        type: 'openai',
        baseUrl: mockBaseUrl,
        apiKey: 'mock-key',
        models: ['llama-3.3-70b', 'llama-3.1-8b'],
        enabled: true,
    },
    {
        id: 'mock-google',
        name: 'Mock Google',
        type: 'openai',
        baseUrl: mockBaseUrl,
        apiKey: 'mock-key',
        models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
        enabled: true,
    },
    {
        id: 'mock-deepseek',
        name: 'Mock DeepSeek',
        type: 'openai',
        baseUrl: mockBaseUrl,
        apiKey: 'mock-key',
        models: ['deepseek-chat'],
        enabled: true,
    },
];
async function seed() {
    const config = await readConfig();
    // Remove any existing mock providers, then add fresh ones
    config.providers = config.providers.filter(p => !p.id.startsWith('mock-'));
    config.providers.push(...MOCK_PROVIDERS);
    await writeConfig(config);
    console.log(`Seeded ${MOCK_PROVIDERS.length} mock providers:`);
    for (const p of MOCK_PROVIDERS) {
        console.log(`  ${p.name} — ${p.models.join(', ')}`);
    }
    console.log(`\nConfig directory: ${process.env.BENCHY_DIR ?? '~/.benchy'}`);
    console.log('\nStart the dev server and open http://localhost:5173/run');
}
seed().catch(err => { console.error(err); process.exit(1); });
