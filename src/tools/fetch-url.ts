import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { LookupFunction } from 'node:net'
import type { Tool } from './types.js'
import { assertPublicHost, type VettedAddress } from './ssrf.js'

const TIMEOUT_MS = 10_000
const MAX_BYTES = 100_000
const MAX_REDIRECTS = 5

// A DNS lookup that always returns the one address we already vetted, so the
// connection goes to exactly the IP we checked. Built on node:http/https rather
// than undici on purpose: undici is only importable when installed as a package,
// and it is NOT a benchy dependency — importing it crashed every global install
// on startup. The `lookup` option is a built-in of http(s).request.
function pinnedLookup(vetted: VettedAddress): LookupFunction {
  return ((_hostname: string, options: unknown, cb: unknown) => {
    if (options && (options as { all?: boolean }).all) {
      (cb as (e: Error | null, a: { address: string; family: number }[]) => void)(null, [{ address: vetted.address, family: vetted.family }])
    } else {
      (cb as (e: Error | null, a: string, f: number) => void)(null, vetted.address, vetted.family)
    }
  }) as unknown as LookupFunction
}

function requestOnce(url: string, vetted: VettedAddress): Promise<IncomingMessage> {
  const mod = new URL(url).protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: 'GET',
        lookup: pinnedLookup(vetted),
        headers: { 'user-agent': 'benchy-tool/1.0', accept: 'text/html,text/plain,application/json' },
        timeout: TIMEOUT_MS,
      },
      resolve,
    )
    req.on('error', reject)
    // Fires on connect/idle timeout; destroy so a slow or dead server can't hang
    // the whole cell.
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${TIMEOUT_MS}ms`)))
    req.end()
  })
}

// Reads at most MAX_BYTES, then tears the socket down — never trusts
// Content-Length, which a server can lie about or omit.
function readCapped(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    res.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      total += chunk.length
      if (total >= MAX_BYTES) { res.destroy(); resolve(Buffer.concat(chunks).toString('utf8').slice(0, MAX_BYTES)) }
    })
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').slice(0, MAX_BYTES)))
    res.on('error', reject)
  })
}

// Fetches a public web page for the model. Every hop is re-validated, because a
// public URL is free to 302 you straight to http://127.0.0.1:4242/api/providers
// — reading redirects manually is what makes each Location checkable instead of
// followed blindly.
async function fetchText(startUrl: string): Promise<string> {
  let url = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`invalid URL: ${url}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`only http and https are allowed, got ${parsed.protocol}`)
    }
    // Vets the host and pins the connection to the checked IP — closes the
    // DNS-rebinding window where a second resolution could return 127.0.0.1.
    const vetted = await assertPublicHost(parsed.hostname)
    const res = await requestOnce(url, vetted)
    const status = res.statusCode ?? 0

    if (status >= 300 && status < 400) {
      const loc = res.headers.location
      res.destroy()
      if (!loc) throw new Error(`redirect with no Location (status ${status})`)
      // Resolve relative redirects against the current URL before re-checking.
      url = new URL(loc, url).toString()
      continue
    }

    if (status < 200 || status >= 300) {
      res.destroy()
      throw new Error(`request failed with status ${status}`)
    }

    return readCapped(res)
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`)
}

export const fetchUrlTool: Tool = {
  spec: {
    name: 'fetch_url',
    description: 'Fetch the contents of a public web page over http/https and return its text (truncated to 100 KB). Cannot reach local or private addresses.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The absolute http(s) URL to fetch.' },
      },
      required: ['url'],
    },
  },
  async run(args) {
    const url = args.url
    if (typeof url !== 'string' || !url.trim()) throw new Error('url must be a non-empty string')
    return fetchText(url.trim())
  },
}
