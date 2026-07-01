import type { Adapter, AdapterConfig, Chunk, Message } from './base.js'

export const webhookAdapter: Adapter = {
  async *stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk> {
    const url = config.baseUrl
    if (!url) { yield { type: 'error', message: 'No webhook URL configured' }; return }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers['X-Webhook-Secret'] = config.apiKey

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.model, messages, timestamp: Date.now() }),
      })
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
      return
    }

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      yield { type: 'error', message: `Webhook returned HTTP ${response.status}: ${text}` }
      return
    }

    const contentType = response.headers.get('content-type') ?? ''
    let text: string

    if (contentType.includes('application/json')) {
      const json = await response.json() as {
        text?: string
        content?: string
        response?: string
        choices?: Array<{ message?: { content?: string } }>
      }
      text = json.text ?? json.content ?? json.response ?? json.choices?.[0]?.message?.content ?? JSON.stringify(json)
    } else {
      text = await response.text()
    }

    if (text) yield { type: 'token', text }
    yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }
  },
}
