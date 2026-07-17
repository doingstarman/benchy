import { describe, it, expect } from 'vitest'
import { isBlockedIp, assertPublicHost } from '../tools/ssrf.js'

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.5',
  ])('blocks private/local IPv4 %s', ip => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1'])(
    'allows public IPv4 %s',
    ip => { expect(isBlockedIp(ip)).toBe(false) },
  )

  it.each(['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', 'fec0::1'])(
    'blocks local/private IPv6 %s',
    ip => { expect(isBlockedIp(ip)).toBe(true) },
  )

  // The bypass a verify agent found: the WHATWG URL parser and getaddrinfo emit
  // the IPv4-mapped address in COMPRESSED HEX, not dotted decimal, and the old
  // regex only matched the dotted form — so http://[::ffff:127.0.0.1] reached
  // the key store. Every blocked v4 range must be caught in hex-mapped form too.
  it.each([
    '::ffff:7f00:1',      // 127.0.0.1
    '::ffff:a9fe:a9fe',   // 169.254.169.254 cloud metadata
    '::ffff:0a00:1',      // 10.0.0.1
    '::ffff:c0a8:1',      // 192.168.0.1
  ])('blocks the hex-mapped form %s', ip => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  it('allows a public hex-mapped address', () => {
    expect(isBlockedIp('::ffff:808:808')).toBe(false) // 8.8.8.8
  })

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])(
    'allows public IPv6 %s',
    ip => { expect(isBlockedIp(ip)).toBe(false) },
  )

  it.each(['fc2.com', 'fdn.org', 'example.com', 'localhost', 'not-an-ip'])(
    'does not treat the hostname %s as a blocked IP (it must be resolved first)',
    host => { expect(isBlockedIp(host)).toBe(false) },
  )
})

describe('assertPublicHost', () => {
  it('rejects a literal loopback address', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow(/blocked/)
  })

  it('rejects localhost — the name that reaches the key store', async () => {
    // "localhost" resolves to 127.0.0.1 / ::1, so the resolved-IP check catches
    // it even though the string looks innocent.
    await expect(assertPublicHost('localhost')).rejects.toThrow()
  })

  it('rejects the octal spelling of loopback', async () => {
    // getaddrinfo parses 0177.0.0.1 as 127.0.0.1 — string matching would miss it.
    await expect(assertPublicHost('0177.0.0.1')).rejects.toThrow()
  })

  it('rejects the IPv6 loopback literal', async () => {
    await expect(assertPublicHost('[::1]')).rejects.toThrow(/blocked/)
  })

  it('rejects the cloud metadata address', async () => {
    await expect(assertPublicHost('169.254.169.254')).rejects.toThrow(/blocked/)
  })

  it('allows a real public IP literal and pins to it', async () => {
    // Returns the vetted address so the caller can connect to exactly what was
    // checked — the pin that closes the rebinding window.
    await expect(assertPublicHost('1.1.1.1')).resolves.toEqual({ address: '1.1.1.1', family: 4 })
  })
})
