import { writeConfig, readConfig } from './config.js'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Provider } from './types.js'

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const inline = process.argv.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)

  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0) return process.argv[index + 1]
  return undefined
}

function resolveConfigDir(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return resolve(homedir(), path.slice(2))
  }
  return resolve(path)
}

const configDir = getArg('config-dir')
if (configDir) {
  process.env.BENCHY_DIR = resolveConfigDir(configDir)
}

const port = Number.parseInt(getArg('port') ?? '4243', 10)
const mockBaseUrl = `http://localhost:${port}/api/mock`

// Approximate real-world list prices (USD per 1M tokens, input / output) so the
// offline demo shows a plausible cost per answer. Not authoritative — mock data.
const MOCK_PROVIDERS: Provider[] = [
  {
    id: 'mock-openai',
    name: 'Mock OpenAI',
    type: 'openai',
    baseUrl: mockBaseUrl,
    apiKey: 'mock-key',
    models: ['gpt-4o', 'gpt-4o-mini'],
    pricing: {
      'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
      'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
    },
    enabled: true,
  },
  {
    id: 'mock-anthropic',
    name: 'Mock Anthropic',
    type: 'openai',
    baseUrl: mockBaseUrl,
    apiKey: 'mock-key',
    models: ['claude-3-5-sonnet', 'claude-3-haiku'],
    pricing: {
      'claude-3-5-sonnet': { inputPer1M: 3, outputPer1M: 15 },
      'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
    },
    enabled: true,
  },
  {
    id: 'mock-meta',
    name: 'Mock Llama (Groq)',
    type: 'openai',
    baseUrl: mockBaseUrl,
    apiKey: 'mock-key',
    models: ['llama-3.3-70b', 'llama-3.1-8b'],
    pricing: {
      'llama-3.3-70b': { inputPer1M: 0.59, outputPer1M: 0.79 },
      'llama-3.1-8b': { inputPer1M: 0.05, outputPer1M: 0.08 },
    },
    enabled: true,
  },
  {
    id: 'mock-google',
    name: 'Mock Google',
    type: 'openai',
    baseUrl: mockBaseUrl,
    apiKey: 'mock-key',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    pricing: {
      'gemini-2.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5 },
      'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
    },
    enabled: true,
  },
  {
    id: 'mock-deepseek',
    name: 'Mock DeepSeek',
    type: 'openai',
    baseUrl: mockBaseUrl,
    apiKey: 'mock-key',
    models: ['deepseek-chat'],
    pricing: {
      'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1 },
    },
    enabled: true,
  },
  {
    id: 'mock-reasoning',
    name: 'Mock Reasoning',
    type: 'openai',
    baseUrl: mockBaseUrl,
    apiKey: 'mock-key',
    // One model per shape reasoning actually arrives in, so the trace UI can be
    // exercised offline instead of against a paid provider: a reasoning field,
    // inline <think> tags, and a token count with no text.
    models: ['r1-think', 'qwen-tagged', 'o3-quiet'],
    pricing: {
      'r1-think': { inputPer1M: 0.55, outputPer1M: 2.19 },
      'qwen-tagged': { inputPer1M: 0.4, outputPer1M: 1.2 },
      'o3-quiet': { inputPer1M: 2, outputPer1M: 8 },
    },
    enabled: true,
  },
]

async function seed() {
  const config = await readConfig()

  // Remove any existing mock providers, then add fresh ones
  config.providers = config.providers.filter(p => !p.id.startsWith('mock-'))
  config.providers.push(...MOCK_PROVIDERS)

  await writeConfig(config)

  console.log(`Seeded ${MOCK_PROVIDERS.length} mock providers:`)
  for (const p of MOCK_PROVIDERS) {
    console.log(`  ${p.name} — ${p.models.join(', ')}`)
  }
  console.log(`\nConfig directory: ${process.env.BENCHY_DIR ?? '~/.benchy'}`)
  console.log('\nStart the dev server and open http://localhost:5173/run')
}

seed().catch(err => { console.error(err); process.exit(1) })

