import type { Adapter, AdapterConfig, Chunk, Message } from './base.js'

export const httpJsonAdapter: Adapter = {
  async *stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk> {
    const url = config.baseUrl
    if (!url) { yield { type: 'error', message: 'No endpoint URL configured' }; return }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages, model: config.model }),
      })
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
      return
    }

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      yield { type: 'error', message: `HTTP ${response.status}: ${text}` }
      return
    }

    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('text/event-stream') && response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') break
          try {
            const json = JSON.parse(data) as {
              text?: string
              delta?: string
              choices?: Array<{ delta?: { content?: string } }>
            }
            const text = json.text ?? json.delta ?? json.choices?.[0]?.delta?.content ?? ''
            if (text) yield { type: 'token', text }
          } catch { /* skip malformed lines */ }
        }
      }
    } else {
      const json = await response.json() as {
        text?: string
        content?: string
        response?: string
        choices?: Array<{ message?: { content?: string } }>
      }
      const text = json.text ?? json.content ?? json.response ?? json.choices?.[0]?.message?.content ?? ''
      if (text) yield { type: 'token', text }
    }

    yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }
  },
}
