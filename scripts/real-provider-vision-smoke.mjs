// Real-provider image/PDF passthrough smoke for benchy.
// Needs your live providers configured + VPN/keys — this DOES call paid APIs.
//
// Usage (from anywhere, Node 18+):
//   node real-provider-vision-smoke.mjs [--base http://localhost:4242] [--image path/to/pic.png] [--model providerId:model] [--pdf path/to/doc.pdf]
//
// Defaults: base=:4242 (prod). If --model is omitted it prints your providers/models and asks you to pick.
// If --image is omitted it uploads a valid 1x1 PNG (proves passthrough, but has no content to "see" —
// pass a real screenshot for a meaningful capability test).

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true])
  return acc
}, []))
const BASE = args.base || 'http://localhost:4242'
const { readFile } = await import('node:fs/promises')
const { basename } = await import('node:path')

// valid 1x1 transparent PNG
const ONE_PX_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init); const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${j.error ?? ''}`); return j.data
}
async function waitDone(runId, ms = 120000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const r = await api(`/api/runs/${runId}`); if (r.status === 'done' || r.status === 'error') return r; await sleep(500) }
  throw new Error('run did not finish in time')
}
async function upload(bytes, name, mime) {
  const f = new FormData(); f.append('file', new File([bytes], name, { type: mime }))
  return api('/api/uploads', { method: 'POST', body: f })
}

const providers = await api('/api/providers')
if (!args.model) {
  console.log('Configured provider:model keys (pass one with --model):')
  for (const p of providers) for (const m of p.models) console.log(`  ${p.id}:${m}   (${p.name}, ${p.type})`)
  console.log('\nRe-run e.g.:  node real-provider-vision-smoke.mjs --model <id:model> --image shot.png')
  process.exit(0)
}

async function runOne(label, fileBytes, fileName, mime, prompt, model) {
  const meta = await upload(fileBytes, fileName, mime)
  const { runId } = await api('/api/benchmark', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompts: [prompt], models: [model], attachments: [meta.id] }),
  })
  const run = await waitDone(runId)
  const cell = run.results[0]
  console.log(`\n── ${label} → ${model}`)
  if (cell.error) console.log(`   ERROR: ${cell.error}`)
  else console.log(`   REPLY: ${cell.text.slice(0, 400)}${cell.text.length > 400 ? '…' : ''}`)
  await fetch(`${BASE}/api/runs/${runId}`, { method: 'DELETE' })
  return cell
}

// 1. image passthrough
let imgBytes = ONE_PX_PNG, imgName = 'smoke-1x1.png', imgMime = 'image/png'
if (typeof args.image === 'string') {
  imgBytes = await readFile(args.image); imgName = basename(args.image)
  imgMime = MIME[imgName.split('.').pop().toLowerCase()] || 'image/png'
}
await runOne('IMAGE', imgBytes, imgName, imgMime, 'Опиши, что изображено на картинке. Если картинка пустая/1x1 — так и скажи.', args.model)

// 2. optional PDF — tests native (Anthropic/Google) vs honest error (OpenAI chat completions)
if (typeof args.pdf === 'string') {
  const pdfBytes = await readFile(args.pdf)
  await runOne('PDF', pdfBytes, basename(args.pdf), 'application/pdf', 'Кратко перескажи содержание документа.', args.model)
}

console.log('\nDone. A non-vision model should return an honest per-card error; a vision model should describe the image.')
