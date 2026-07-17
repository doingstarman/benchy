import { lookup } from 'node:dns/promises'

// The threat this exists to stop: benchy keeps every provider API key readable
// at http://127.0.0.1:4242/api/providers. A model told to `fetch_url` that
// address would get all of them and print them into its answer. So fetch_url
// must refuse to reach anything on this machine or the local network.
//
// The check is on the resolved IP, never the string. "localhost", "127.0.0.1",
// "0177.0.0.1" (octal), "2130706433" (integer), "[::1]", and a public hostname
// whose DNS record points at 127.0.0.1 all denote the same forbidden address,
// and only IP-level checking catches every spelling at once.

// Parse dotted-quad IPv4 to a 32-bit unsigned int, or null if not v4.
function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some(p => p > 255)) return null
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  if (n === null) return false
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) === (b & mask)
  }
  return (
    inRange('0.0.0.0', 8) ||       // "this network" / unspecified
    inRange('10.0.0.0', 8) ||      // private
    inRange('100.64.0.0', 10) ||   // CGNAT
    inRange('127.0.0.0', 8) ||     // loopback
    inRange('169.254.0.0', 16) ||  // link-local (incl. cloud metadata 169.254.169.254)
    inRange('172.16.0.0', 12) ||   // private
    inRange('192.0.0.0', 24) ||    // IETF protocol assignments
    inRange('192.168.0.0', 16) ||  // private
    inRange('198.18.0.0', 15) ||   // benchmarking
    inRange('224.0.0.0', 4) ||     // multicast
    inRange('240.0.0.0', 4)        // reserved
  )
}

// IPv6 comes back from getaddrinfo already normalized (lowercase, :: collapsed).
function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] // strip any zone id
  if (addr === '::1' || addr === '::') return true
  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible — judge by the v4 part.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr)
  if (mapped) return isBlockedIpv4(mapped[1])
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true // fc00::/7 ULA
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) return true // fe80::/10 link-local
  return false
}

export function isBlockedIp(ip: string): boolean {
  return ipv4ToInt(ip) !== null ? isBlockedIpv4(ip) : isBlockedIpv6(ip)
}

// Resolves the host and throws if it, or any address it maps to, is local or
// private. A hostname with several A/AAAA records is only safe if EVERY one is
// safe — a single public record beside a 127.0.0.1 record is a classic bypass.
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '') // unwrap [::1] literal form
  if (isBlockedIp(host)) throw new Error(`blocked address: ${host}`)

  let records: { address: string }[]
  try {
    records = await lookup(host, { all: true })
  } catch {
    throw new Error(`could not resolve host: ${host}`)
  }
  if (records.length === 0) throw new Error(`could not resolve host: ${host}`)
  for (const { address } of records) {
    if (isBlockedIp(address)) throw new Error(`host ${host} resolves to a blocked address (${address})`)
  }
}
