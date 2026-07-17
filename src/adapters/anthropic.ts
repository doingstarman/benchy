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

    // Claude never thinks unless asked, so this is opt-in rather than passive
    // observation. Adaptive is the only accepted form on 4.6+ — `budget_tokens`
    // is rejected outright on Opus 4.8/4.7 and Fable 5.
    const thinking = config.settings?.extendedThinking === true

    try {
      const stream = client.messages.stream({
        model: config.model,
        max_tokens: config.settings?.maxOutputTokens ?? 4096,
        ...(system ? { system } : {}),
        // Thinking pins temperature to 1; sending benchy's default 0.7
        // alongside it is a 400 on every single request.
        ...(!thinking && config.settings?.temperature != null ? { temperature: config.settings.temperature } : {}),
        ...(!thinking && config.settings?.topP != null ? { top_p: config.settings.topP } : {}),
        ...(thinking ? { thinking: { type: 'adaptive' as const } } : {}),
        messages: chatMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: toAnthropicContent(m),
        })),
      })

      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue
        if (event.delta.type === 'text_delta') {
          yield { type: 'token', text: event.delta.text }
        } else if (event.delta.type === 'thinking_delta') {
          yield { type: 'reasoning', text: event.delta.thinking }
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
