import Anthropic from '@anthropic-ai/sdk'
import type { Adapter, AdapterConfig, Chunk, Message } from './base.js'
import { humanizeNetworkError } from '../errors.js'

// Images become image blocks, PDFs become document blocks — both native here.
function toAnthropicContent(msg: Message): string | Anthropic.ContentBlockParam[] {
  if (!msg.attachments?.length) return msg.content
  const blocks: Anthropic.ContentBlockParam[] = msg.attachments.map(a =>
    a.mimeType === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: a.data } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: a.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: a.data } }
  )
  blocks.push({ type: 'text', text: msg.content })
  return blocks
}

export const anthropicAdapter: Adapter = {
  async *stream(messages: Message[], config: AdapterConfig): AsyncIterable<Chunk> {
    const client = new Anthropic({
      apiKey: config.apiKey ?? '',
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    })

    const systemMessages = messages.filter(m => m.role === 'system')
    const chatMessages = messages.filter(m => m.role !== 'system')
    const system = systemMessages.map(m => m.content).join('\n') || undefined

    try {
      const stream = client.messages.stream({
        model: config.model,
        max_tokens: config.settings?.maxOutputTokens ?? 4096,
        ...(system ? { system } : {}),
        ...(config.settings?.temperature != null ? { temperature: config.settings.temperature } : {}),
        ...(config.settings?.topP != null ? { top_p: config.settings.topP } : {}),
        messages: chatMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: toAnthropicContent(m),
        })),
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'token', text: event.delta.text }
        }
      }

      const final = await stream.finalMessage()
      yield {
        type: 'done',
        usage: {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
        },
      }
    } catch (err) {
      yield { type: 'error', message: humanizeNetworkError(err, config.baseUrl) }
    }
  },
}
