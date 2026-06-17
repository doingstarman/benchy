import { writeConfig, readConfig } from './config.js'
import type { Provider } from './types.js'

const MOCK_PROVIDERS: Provider[] = [
  {
    id: 'mock-openai',
    name: 'Mock OpenAI',
    type: 'openai',
    baseUrl: 'http://localhost:4242/api/mock',
    apiKey: 'mock-key',
    models: ['gpt-4o', 'gpt-4o-mini'],
    enabled: true,
  },
  {
    id: 'mock-anthropic',
    name: 'Mock Anthropic',
    type: 'openai',
    baseUrl: 'http://localhost:4242/api/mock',
    apiKey: 'mock-key',
    models: ['claude-3-5-sonnet', 'claude-3-haiku'],
    enabled: true,
  },
  {
    id: 'mock-meta',
    name: 'Mock Llama (Groq)',
    type: 'openai',
    baseUrl: 'http://localhost:4242/api/mock',
    apiKey: 'mock-key',
    models: ['llama-3.3-70b', 'llama-3.1-8b'],
    enabled: true,
  },
  {
    id: 'mock-google',
    name: 'Mock Google',
    type: 'openai',
    baseUrl: 'http://localhost:4242/api/mock',
    apiKey: 'mock-key',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    enabled: true,
  },
  {
    id: 'mock-deepseek',
    name: 'Mock DeepSeek',
    type: 'openai',
    baseUrl: 'http://localhost:4242/api/mock',
    apiKey: 'mock-key',
    models: ['deepseek-chat'],
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
  console.log('\nStart the dev server and open http://localhost:5173/run')
}

seed().catch(err => { console.error(err); process.exit(1) })
