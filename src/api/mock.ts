import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

// Prompt-specific dataset: matched against last user message (case-insensitive)
const DATASET: Array<{ match: RegExp; responses: Record<string, string> }> = [
  {
    match: /^привет[!.]?$/i,
    responses: {
      'gpt-4o':         'Привет! Я GPT-4o от OpenAI. Чем могу помочь сегодня?',
      'gpt-4o-mini':    'Привет! GPT-4o mini на связи — быстро и по делу. Что нужно?',
      'claude-3-5-sonnet': 'Привет! Это Клод от Anthropic. Рад познакомиться — расскажи, чем могу быть полезен?',
      'claude-3-haiku':    'Привет! Claude Haiku здесь. Коротко и ясно — чего хочешь?',
      'llama-3.3-70b':  'Привет! Llama 3.3 70B на связи. Готов к работе — что делаем?',
      'llama-3.1-8b':   'Привет! Слушаю.',
      'deepseek-chat':  'Привет! DeepSeek Chat готов к диалогу. Задай свой вопрос.',
      'gemini-2.5-flash': 'Привет! Gemini Flash слушает. Очень быстро помогу с чем угодно.',
      'gemini-2.5-pro': 'Привет! Gemini Pro к вашим услугам. Что будем делать?',
    },
  },
  {
    match: /как дела\??/i,
    responses: {
      'gpt-4o':         'Дела отлично, спасибо! Как языковая модель я не устаю и не скучаю — всегда в рабочем режиме. Обрабатываю запросы, генерирую текст, анализирую данные. А у тебя как дела? Могу чем-то помочь?',
      'gpt-4o-mini':    'Хорошо! Всегда готов. Что нужно сделать?',
      'claude-3-5-sonnet': 'Спасибо, что спросил! У меня всё замечательно — я языковая модель, у меня нет настроений в человеческом смысле, но если бы было — сейчас оно было бы отличным. Мне нравится помогать! А у тебя как дела? Есть что-то, с чем могу помочь?',
      'claude-3-haiku':    'Отлично. Готов помочь.',
      'llama-3.3-70b':  'Всё хорошо, спасибо! Обрабатываю задачи с максимальной точностью. Что нужно решить?',
      'llama-3.1-8b':   'Хорошо. Чем помочь?',
      'deepseek-chat':  'Спасибо за вопрос. Функционирую в штатном режиме. Готов к аналитическим задачам.',
      'gemini-2.5-flash': 'Отлично! Быстро и эффективно, как всегда. Давай задачу.',
      'gemini-2.5-pro': 'Всё хорошо, спасибо! Нахожусь в полной готовности. Какую задачу будем решать сегодня?',
    },
  },
  {
    match: /что ты умеешь|что умеешь|на что способен/i,
    responses: {
      'gpt-4o':         'Я умею писать, редактировать и переводить тексты, отвечать на вопросы, разбираться в коде, объяснять сложные концепции простыми словами, помогать с анализом данных и брейнштормингом. Мои сильные стороны — точность, широкий кругозор и способность поддерживать контекст длинного диалога.',
      'gpt-4o-mini':    'Отвечаю на вопросы, пишу текст, помогаю с кодом. Быстро и дёшево.',
      'claude-3-5-sonnet': 'Умею многое! Пишу и редактирую тексты, помогаю с кодом, объясняю сложные темы, провожу анализ, отвечаю на вопросы и поддерживаю длинные диалоги. Мне особенно нравится разбирать сложные задачи шаг за шагом и искать нестандартные решения. Что хочешь попробовать?',
      'claude-3-haiku':    'Текст, код, Q&A, анализ. Что нужно?',
      'llama-3.3-70b':  'Генерация и редактура текстов, программирование, ответы на вопросы, суммаризация, перевод. Поддерживаю длинный контекст. Открытые веса — работаю локально.',
      'llama-3.1-8b':   'Текст, код, ответы. Небольшая модель — быстро.',
      'deepseek-chat':  'Специализируюсь на логических задачах, коде, математике и аналитике. Также помогаю с написанием текстов и ответами на вопросы. Сильная сторона — пошаговые рассуждения.',
      'gemini-2.5-flash': 'Текст, код, анализ, Q&A — всё быстро. Оптимизирован для скорости.',
      'gemini-2.5-pro': 'Умею работать с текстом, кодом, изображениями и данными. Сильные стороны: длинный контекст, мультимодальность, точный анализ и структурированные ответы.',
    },
  },
  {
    match: /tic.?tac.?toe|крестик\S*\s*-?\s*нолик\S*/i,
    responses: {
      'gpt-4o': 'Here\'s a self-contained tic-tac-toe game:\n\n```html\n<!DOCTYPE html>\n<html>\n<head><style>\n  body { display:flex; align-items:center; justify-content:center; height:100vh; margin:0; font-family:sans-serif; background:#111; }\n  #board { display:grid; grid-template-columns:repeat(3,80px); grid-gap:4px; }\n  .cell { width:80px; height:80px; background:#222; color:#fff; font-size:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; }\n  #status { position:fixed; top:16px; color:#fff; font-family:sans-serif; }\n</style></head>\n<body>\n<div id="status">X\'s turn</div>\n<div id="board"></div>\n<script>\n  let cells = Array(9).fill(null);\n  let turn = "X";\n  const board = document.getElementById("board");\n  const status = document.getElementById("status");\n  function wins(p) {\n    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];\n    return lines.some(l => l.every(i => cells[i] === p));\n  }\n  function render() {\n    board.innerHTML = "";\n    cells.forEach((v, i) => {\n      const d = document.createElement("div");\n      d.className = "cell";\n      d.textContent = v || "";\n      d.onclick = () => {\n        if (cells[i] || wins("X") || wins("O")) return;\n        cells[i] = turn;\n        turn = turn === "X" ? "O" : "X";\n        status.textContent = wins("X") ? "X wins!" : wins("O") ? "O wins!" : turn + "\'s turn";\n        render();\n      };\n      board.appendChild(d);\n    });\n  }\n  render();\n</script>\n</body>\n</html>\n```',
      'claude-3-5-sonnet': 'Sure — a minimal playable tic-tac-toe:\n\n```html\n<!DOCTYPE html>\n<html>\n<head><style>\n  body { display:flex; align-items:center; justify-content:center; height:100vh; margin:0; font-family:sans-serif; background:#1a1a2e; }\n  #board { display:grid; grid-template-columns:repeat(3,80px); grid-gap:4px; }\n  .cell { width:80px; height:80px; background:#16213e; color:#e94560; font-size:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; }\n  #status { position:fixed; top:16px; color:#fff; font-family:sans-serif; }\n</style></head>\n<body>\n<div id="status">X\'s turn</div>\n<div id="board"></div>\n<script>\n  let cells = Array(9).fill(null);\n  let turn = "X";\n  const board = document.getElementById("board");\n  const status = document.getElementById("status");\n  function wins(p) {\n    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];\n    return lines.some(l => l.every(i => cells[i] === p));\n  }\n  function render() {\n    board.innerHTML = "";\n    cells.forEach((v, i) => {\n      const d = document.createElement("div");\n      d.className = "cell";\n      d.textContent = v || "";\n      d.onclick = () => {\n        if (cells[i] || wins("X") || wins("O")) return;\n        cells[i] = turn;\n        turn = turn === "X" ? "O" : "X";\n        status.textContent = wins("X") ? "X wins!" : wins("O") ? "O wins!" : turn + "\'s turn";\n        render();\n      };\n      board.appendChild(d);\n    });\n  }\n  render();\n</script>\n</body>\n</html>\n```',
    },
  },
]

// Canned responses keyed by model name fragment → streamed word-by-word via SSE
const RESPONSES: Record<string, string> = {
  'gpt-4o': `The transformer architecture uses self-attention to process sequences in parallel. Each token attends to all others via Query, Key, and Value matrices. Attention(Q,K,V) = softmax(QK^T/√d_k)V. Multi-head attention runs several attention functions simultaneously, capturing different representation subspaces. Residual connections and layer normalization stabilize training. This design enables far better parallelism than RNNs and captures long-range dependencies efficiently.`,

  'gpt-4o-mini': `Transformers process sequences using self-attention: each token computes relationships with every other token at once. The formula is softmax(QK^T/√d_k)V. Unlike RNNs, this is fully parallel — no sequential bottleneck. The result is faster training and stronger long-range context modeling.`,

  'claude-3-5-sonnet': `Think of a transformer like a room full of people where everyone can whisper to everyone else simultaneously. Each word (token) asks "who should I pay attention to?" and listens to the answers from all other words at once. Mathematically, this is self-attention: we compute a weighted sum of values, where the weights come from how well queries match keys. The brilliant insight is that this all happens in parallel — no one has to wait their turn. That's why transformers scaled so dramatically while recurrent networks hit a wall.`,

  'claude-3-haiku': `Transformers use self-attention to let each token directly attend to every other token in the sequence. Unlike RNNs with their sequential bottleneck, transformers process everything in parallel. The core operation: Attention(Q,K,V) = softmax(QK^T/√d_k)V. Stack this with feed-forward layers and residual connections and you have the architecture powering essentially every frontier model today.`,

  'llama-3.3-70b': `Self-attention is the core operation in transformers. For each token, you project the input into Q, K, V vectors. Compute dot products between Q and all K vectors, scale by √d_k, apply softmax to get attention weights, then take a weighted sum of V. Do this in parallel across N heads. Stack ~96 such layers for a large model. That's it. The parallelism over sequence length is what made this architecture dominate — GPUs love it.`,

  'llama-3.1-8b': `Transformers work by computing attention between all pairs of tokens simultaneously. Given query Q, key K, and value V matrices, output = softmax(QK^T/√d_k)·V. Each position can directly attend to any other position in one step. Multiple attention heads capture different patterns in parallel. Much faster to train than RNNs and scales better with compute.`,

  'deepseek-chat': `The transformer architecture solves the sequence modeling problem through global self-attention. Every token simultaneously computes its relationship to every other token: Attention(Q,K,V) = softmax(QK^T/√d_k)V. This O(n²) operation over sequence length enables direct gradient flow between any two positions — eliminating the vanishing gradient problem inherent to RNNs. Multi-head attention further enriches representations by attending in multiple subspaces concurrently.`,

  'gemini-2.5-flash': `Transformers replace sequential computation with parallel attention. The key innovation: each token can directly "look at" every other token in a single layer, rather than passing information step-by-step like an RNN. Formally, self-attention computes a weighted average of value vectors, with weights determined by query-key similarity. This design scales naturally with both model size and compute, which is why it became the dominant architecture for language, vision, and multimodal models.`,

  'gemini-2.5-pro': `The transformer's core contribution is replacing recurrence with attention as the primary sequence-modeling mechanism. Self-attention allows direct interaction between any two positions in O(1) sequential operations rather than O(n) for RNNs. The scaled dot-product attention, Attention(Q,K,V)=softmax(QK^T/√d_k)V, can be computed efficiently with matrix multiplication — a natural fit for GPU parallelism. Combined with positional encodings and feed-forward sublayers, this produces a deeply representational architecture that has generalized far beyond its NLP origins.`,
}

const DEFAULT_RESPONSE = `The transformer architecture processes sequences using self-attention, allowing each token to attend to all others in parallel. Attention(Q,K,V) = softmax(QK^T/√d_k)V. This parallelism over the sequence — unlike the sequential computation in RNNs — made transformers the foundation of modern large language models.`

// Simulate realistic latency: first token delay varies per "provider"
const TTFS_MS: Record<string, number> = {
  'gpt-4o': 420,
  'gpt-4o-mini': 310,
  'claude-3-5-sonnet': 580,
  'claude-3-haiku': 280,
  'llama-3.3-70b': 190,
  'llama-3.1-8b': 140,
  'deepseek-chat': 460,
  'gemini-2.5-flash': 350,
  'gemini-2.5-pro': 510,
}

function getResponse(model: string, lastUserMessage?: string): string {
  if (lastUserMessage) {
    const entry = DATASET.find(d => d.match.test(lastUserMessage.trim()))
    if (entry) {
      for (const [key, text] of Object.entries(entry.responses)) {
        if (model.includes(key)) return text
      }
      // Model not in dataset entry — return a generic reply for the prompt
      const first = Object.values(entry.responses)[0]
      if (first) return first
    }
  }
  for (const [key, text] of Object.entries(RESPONSES)) {
    if (model.includes(key)) return text
  }
  return DEFAULT_RESPONSE
}

function getTtfsMs(model: string): number {
  for (const [key, ms] of Object.entries(TTFS_MS)) {
    if (model.includes(key)) return ms
  }
  return 400
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

interface ChatBody {
  model: string
  messages: { role: string; content: string | ContentPart[] }[]
  stream?: boolean
  tools?: { function?: { name?: string } }[]
}

// The openai adapter sends attachment messages as content-part arrays —
// pull out the text and count the images so mocks can acknowledge them.
function flattenContent(content: string | ContentPart[]): { text: string; imageCount: number } {
  if (typeof content === 'string') return { text: content, imageCount: 0 }
  const text = content.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('\n')
  const imageCount = content.filter(p => p.type === 'image_url').length
  return { text, imageCount }
}

export async function registerMockRoutes(app: FastifyInstance): Promise<void> {
  // OpenAI-compatible chat completions — streaming only
  app.post<{ Body: ChatBody }>(
    '/api/mock/chat/completions',
    async (req: FastifyRequest<{ Body: ChatBody }>, reply: FastifyReply) => {
      const { model = 'mock', messages = [], stream, tools = [] } = req.body

      if (!stream) {
        return reply.code(400).send({ error: { message: 'mock adapter requires stream: true' } })
      }

      // Tool demo: when tools are offered and the model hasn't been given a
      // result yet, ask for one. On the next pass (a tool message is present)
      // it answers normally. Lets the whole tool UI be exercised offline.
      const offered = new Set(tools.map(t => t.function?.name).filter(Boolean))
      const alreadyRan = messages.some(m => m.role === 'tool')
      const created0 = Math.floor(Date.now() / 1000)
      const streamId = `chatcmpl-mock-${Date.now()}`
      if (offered.size > 0 && !alreadyRan) {
        const tool = offered.has('calc') ? { name: 'calc', arguments: '{"expression":"6 * 7 + 1"}' }
          : offered.has('web_search') ? { name: 'web_search', arguments: '{"query":"benchy llm benchmarking"}' }
          : { name: 'fetch_url', arguments: '{"url":"https://example.com"}' }
        reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
        reply.raw.flushHeaders()
        await new Promise(r => setTimeout(r, getTtfsMs(model)))
        reply.raw.write(`data: ${JSON.stringify({
          id: streamId, object: 'chat.completion.chunk', created: created0, model,
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${created0}`, type: 'function', function: tool }] }, finish_reason: null }],
        })}\n\n`)
        reply.raw.write(`data: ${JSON.stringify({
          id: streamId, object: 'chat.completion.chunk', created: created0, model,
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
        })}\n\n`)
        reply.raw.write('data: [DONE]\n\n')
        reply.raw.end()
        return
      }

      const lastUserContent = [...messages].reverse().find(m => m.role === 'user')?.content
      const { text: lastUserMsg, imageCount } = lastUserContent != null
        ? flattenContent(lastUserContent)
        : { text: undefined, imageCount: 0 }
      const ack = imageCount > 0
        ? `Вижу ${imageCount} ${imageCount === 1 ? 'вложение' : 'вложения'} — принял. `
        : ''
      // Second pass of a tool run: answer using the result the tool returned, so
      // the demo visibly closes the loop.
      const toolResult = alreadyRan
        ? [...messages].reverse().find(m => m.role === 'tool')?.content
        : undefined
      const toolAck = typeof toolResult === 'string' ? `Инструмент вернул: ${toolResult}. ` : ''
      const text = ack + toolAck + getResponse(model, lastUserMsg)
      const words = text.split(' ')
      const ttfsDelay = getTtfsMs(model)
      const wordDelay = Math.max(20, Math.min(60, (3000 - ttfsDelay) / words.length))
      const inputTokens = Math.floor(20 + Math.random() * 30)
      const outputTokens = Math.floor(words.length * 1.3)
      const created = Math.floor(Date.now() / 1000)
      const id = `chatcmpl-mock-${Date.now()}`

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      reply.raw.flushHeaders()

      const write = (data: unknown) => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
      }

      const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

      // A mock model whose name says it thinks, thinks — otherwise the reasoning
      // UI can only be exercised against a real paid provider, and each of the
      // three shapes is emitted by a different one. `-think` streams a reasoning
      // field (OpenRouter/DeepSeek), `-tagged` inlines <think> tags (qwen/Ollama),
      // and `-quiet` reports a token count with no text at all (OpenAI o-series).
      const thinkStyle = /-think/.test(model) ? 'field'
        : /-tagged/.test(model) ? 'tags'
        : /-quiet/.test(model) ? 'quiet'
        : null
      const thoughts = ['Разбираю вопрос по частям.', ' Взвешиваю варианты.', ' Выбираю самый прямой ответ.']
      const emit = (delta: Record<string, unknown>) => write({
        id, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta, finish_reason: null }],
      })

      // Simulate time-to-first-token
      await sleep(ttfsDelay)

      if (thinkStyle === 'field') {
        for (const th of thoughts) { emit({ reasoning_content: th }); await sleep(220) }
      } else if (thinkStyle === 'tags') {
        // Deliberately split the tag across chunks — that is exactly how it
        // arrives from a real endpoint, and what the parser exists for.
        emit({ content: '<thi' })
        emit({ content: 'nk>' })
        for (const th of thoughts) { emit({ content: th }); await sleep(220) }
        emit({ content: '</think>' })
      } else if (thinkStyle === 'quiet') {
        await sleep(900)
      }

      // Stream words one by one
      for (let i = 0; i < words.length; i++) {
        const token = i === 0 ? words[i] : ' ' + words[i]
        write({
          id, object: 'chat.completion.chunk', created, model,
          choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
        })
        await sleep(wordDelay)
      }

      // Final chunk with usage
      write({
        id, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
          ...(thinkStyle ? { completion_tokens_details: { reasoning_tokens: 128 } } : {}),
        },
      })

      reply.raw.write('data: [DONE]\n\n')
      reply.raw.end()
    }
  )
}
