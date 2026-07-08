import { describe, expect, it } from 'vitest'
import { humanizeNetworkError, describeHttpError } from './errors.js'

describe('humanizeNetworkError', () => {
  it('unwraps undici "fetch failed" with ECONNREFUSED cause', () => {
    const err = new TypeError('fetch failed') as TypeError & { cause?: unknown }
    err.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1234'), { code: 'ECONNREFUSED' })
    expect(humanizeNetworkError(err, 'http://localhost:1234/v1'))
      .toBe('Connection refused (http://localhost:1234/v1) — nothing is listening at that address')
  })

  it('maps unknown-host errors to a base-URL hint', () => {
    const err = new TypeError('fetch failed') as TypeError & { cause?: unknown }
    err.cause = Object.assign(new Error('getaddrinfo ENOTFOUND nope.example'), { code: 'ENOTFOUND' })
    expect(humanizeNetworkError(err)).toBe('Host not found — check the base URL')
  })

  it('falls back to a generic reachability message for bare "fetch failed"', () => {
    expect(humanizeNetworkError(new TypeError('fetch failed'), 'https://api.x.ai/v1'))
      .toBe('Could not reach the endpoint (https://api.x.ai/v1) — network error')
  })

  it('passes through already-meaningful messages untouched', () => {
    expect(humanizeNetworkError(new Error('model not supported'))).toBe('model not supported')
  })
})

describe('describeHttpError', () => {
  it('adds an API-key hint for 401 and extracts the provider message', () => {
    const body = JSON.stringify({ error: { message: 'Incorrect API key provided' } })
    expect(describeHttpError(401, body)).toBe('HTTP 401 — invalid or missing API key: Incorrect API key provided')
  })

  it('handles non-JSON bodies and truncates long ones', () => {
    const long = 'x'.repeat(300)
    const out = describeHttpError(502, long)
    expect(out).toContain('HTTP 502 — provider-side server error')
    expect(out.length).toBeLessThan(280)
  })
})
