import { describe, it, expect } from 'vitest'
import { calcTool } from '../tools/calc.js'
import { fetchUrlTool } from '../tools/fetch-url.js'
import { resolveTools } from '../tools/index.js'

describe('calc', () => {
  it.each([
    ['2 + 3', '5'],
    ['(2 + 3) * 4', '20'],
    ['2 ^ 3 ^ 2', '512'],       // right-associative
    ['10 % 3', '1'],
    ['-5 + 2', '-3'],
    ['1.5 * 2', '3'],
    ['100 / 4 / 5', '5'],       // left-associative
  ])('evaluates %s = %s', async (expr, want) => {
    expect(await calcTool.run({ expression: expr })).toBe(want)
  })

  it('never executes code in the argument', async () => {
    // The argument is model-controlled text. If calc ever reached eval, this is
    // the payload that would prove it — it must throw as a parse error instead.
    await expect(calcTool.run({ expression: 'process.exit(1)' })).rejects.toThrow()
    await expect(calcTool.run({ expression: 'require("fs")' })).rejects.toThrow()
    await expect(calcTool.run({ expression: '1; console.log(1)' })).rejects.toThrow()
  })

  it('rejects division by zero rather than returning Infinity', async () => {
    await expect(calcTool.run({ expression: '1 / 0' })).rejects.toThrow(/zero/)
  })

  it('rejects malformed input', async () => {
    await expect(calcTool.run({ expression: '2 +' })).rejects.toThrow()
    await expect(calcTool.run({ expression: '' })).rejects.toThrow()
  })
})

describe('fetch_url — SSRF refusal', () => {
  it('refuses the key store on localhost', async () => {
    // The whole reason the tool has an allowlist: this URL would return every
    // provider API key.
    await expect(fetchUrlTool.run({ url: 'http://127.0.0.1:4242/api/providers' })).rejects.toThrow()
  })

  it('refuses localhost by name', async () => {
    await expect(fetchUrlTool.run({ url: 'http://localhost:4242/api/providers' })).rejects.toThrow()
  })

  it('refuses the IPv4-mapped-IPv6 spelling of loopback end-to-end', async () => {
    // The exact bypass a verify agent found: the URL parser normalizes this to
    // the hex form ::ffff:7f00:1, which the old regex missed. Full path — URL
    // parse → assertPublicHost — must reject it.
    await expect(fetchUrlTool.run({ url: 'http://[::ffff:127.0.0.1]:4242/api/providers' })).rejects.toThrow()
  })

  it('refuses the cloud metadata endpoint', async () => {
    await expect(fetchUrlTool.run({ url: 'http://169.254.169.254/latest/meta-data/' })).rejects.toThrow()
  })

  it('refuses non-http schemes', async () => {
    await expect(fetchUrlTool.run({ url: 'file:///etc/passwd' })).rejects.toThrow(/http/)
  })
})

describe('resolveTools', () => {
  it('builds the safe tools by id', async () => {
    const tools = await resolveTools(['calc', 'fetch_url'])
    expect([...tools.keys()].sort()).toEqual(['calc', 'fetch_url'])
  })

  it('omits web_search when no search key is configured', async () => {
    // Without a key the tool must not be offered — a model handed it would fail
    // on the first call.
    const tools = await resolveTools(['calc', 'web_search'])
    expect(tools.has('web_search')).toBe(false)
    expect(tools.has('calc')).toBe(true)
  })

  it('ignores unknown ids', async () => {
    const tools = await resolveTools(['calc', 'rm_rf'])
    expect([...tools.keys()]).toEqual(['calc'])
  })
})
