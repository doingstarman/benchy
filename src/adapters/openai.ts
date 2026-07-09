import type { Adapter, AdapterConfig, Chunk, Message } from './base.js'
import { humanizeNetworkError, describeHttpError } from '../errors.js'

// The chat completions API takes images as data-URL content parts; PDFs are
// not accepted there at all.
function toOpenAIMessage(msg: Message): { role: string; content: string | unknown[] } {
  if (!msg.attachments?.length) return { role: msg.role, content: msg.content }
  return {
    role: msg.role,
    content: [
      { type: 'text', text: msg.content },
      ...msg.attachments.map(a => ({
        type: 'image_url',
        image_url: { url: `data:${a.mimeType};base64,${a.data}` },
      })),
    ],
  }
}

export const openaiAdapter: Adapter = {
  async *stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk> {
    const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`

    const unsupported = messages.flatMap(m => m.attachments ?? []).find(a => !a.mimeType.startsWith('image/'))
    if (unsupported) {
      yield {
        type: 'error',
        message: `"${unsupported.name}" (${unsupported.mimeType}) is not supported by this provider's chat completions API — only images can be attached. See your provider's docs for supported input formats (OpenAI: https://platform.openai.com/docs/guides/images-vision)`,
      }
      return
    }

    const t0 = Date.now()
    let firstToken = true

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey ?? ''}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map(toOpenAIMessage),
          stream: true,
          stream_options: { include_usage: true },
          ...(config.settings?.temperature != null ? { temperature: config.settings.temperature } : {}),
          ...(config.settings?.topP != null ? { top_p: config.settings.topP } : {}),
          ...(config.settings?.maxOutputTokens != null ? { max_tokens: config.settings.maxOutputTokens } : {}),
        }),
      })
    } catch (err) {
      yield { type: 'error', message: humanizeNetworkError(err, baseUrl) }
      return
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => response.statusText)
      yield { type: 'error', message: describeHttpError(response.status, text) }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let usage = { inputTokens: 0, outputTokens: 0 }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(data) as Record<string, unknown>
        } catch {
          continue
        }

        // usage chunk (stream_options)
        if (parsed.usage && typeof parsed.usage === 'object') {
          const u = parsed.usage as Record<string, unknown>
          usage = {
            inputTokens: Number(u.prompt_tokens ?? 0),
            outputTokens: Number(u.completion_tokens ?? 0),
          }
        }

        const choices = parsed.choices as Array<Record<string, unknown>> | undefined
        if (!choices?.length) continue

        const delta = choices[0].delta as Record<string, unknown> | undefined
        const text = delta?.content
        if (typeof text === 'string' && text.length > 0) {
          if (firstToken) {
            firstToken = false
            // ttfs is measured by benchmark.ts from the outside
            void t0
          }
          yield { type: 'token', text }
        }
      }
    }

    yield { type: 'done', usage }
  },
}
