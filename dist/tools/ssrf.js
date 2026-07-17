import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
function ipv4ToInt(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (!m)
        return null;
    const parts = m.slice(1).map(Number);
    if (parts.some(p => p > 255))
        return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}
function isBlockedIpv4Int(n) {
    const inRange = (base, bits) => {
        const b = ipv4ToInt(base);
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        return (n & mask) === (b & mask);
    };
    return (inRange('0.0.0.0', 8) || // "this network" / unspecified
        inRange('10.0.0.0', 8) || // private
        inRange('100.64.0.0', 10) || // CGNAT
        inRange('127.0.0.0', 8) || // loopback
        inRange('169.254.0.0', 16) || // link-local (incl. cloud metadata 169.254.169.254)
        inRange('172.16.0.0', 12) || // private
        inRange('192.0.0.0', 24) || // IETF protocol assignments
        inRange('192.168.0.0', 16) || // private
        inRange('198.18.0.0', 15) || // benchmarking
        inRange('224.0.0.0', 4) || // multicast
        inRange('240.0.0.0', 4) // reserved
    );
}
function isBlockedIpv4(ip) {
    const n = ipv4ToInt(ip);
    return n !== null && isBlockedIpv4Int(n);
}
// Expand any valid IPv6 spelling to its 16 bytes. net.isIP guarantees the input
// is well-formed IPv6 first, so the expansion only has to handle "::" and an
// optional embedded dotted-quad tail — no malformed input reaches it.
function ipv6ToBytes(ip) {
    const s = ip.toLowerCase().split('%')[0]; // strip any zone id
    if (isIP(s) !== 6)
        return null;
    // An embedded IPv4 tail (…:127.0.0.1) becomes two hex groups so the rest of
    // the expansion is uniform.
    let text = s;
    const lastColon = s.lastIndexOf(':');
    const tail = s.slice(lastColon + 1);
    if (tail.includes('.')) {
        const v4 = ipv4ToInt(tail);
        if (v4 === null)
            return null;
        const hi = ((v4 >>> 16) & 0xffff).toString(16);
        const lo = (v4 & 0xffff).toString(16);
        text = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
    }
    const halves = text.split('::');
    if (halves.length > 2)
        return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const groups = halves.length === 2
        ? [...head, ...Array(8 - head.length - (halves[1] ? halves[1].split(':').length : 0)).fill('0'), ...(halves[1] ? halves[1].split(':') : [])]
        : head;
    if (groups.length !== 8)
        return null;
    const bytes = [];
    for (const g of groups) {
        const v = parseInt(g || '0', 16);
        if (Number.isNaN(v) || v < 0 || v > 0xffff)
            return null;
        bytes.push((v >> 8) & 0xff, v & 0xff);
    }
    return bytes;
}
function isBlockedIpv6(ip) {
    const b = ipv6ToBytes(ip);
    if (!b)
        return false;
    if (b.every((x, i) => (i === 15 ? x === 1 : x === 0)))
        return true; // ::1 loopback
    if (b.every(x => x === 0))
        return true; // :: unspecified
    // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 — judge by the v4 tail,
    // in whatever spelling it arrived (this is the hole the old regex left open).
    const mapped = b.slice(0, 10).every(x => x === 0) && b[10] === 0xff && b[11] === 0xff;
    const compat = b.slice(0, 12).every(x => x === 0);
    if (mapped || compat)
        return isBlockedIpv4Int(((b[12] << 24) >>> 0) + (b[13] << 16) + (b[14] << 8) + b[15]);
    if ((b[0] & 0xfe) === 0xfc)
        return true; // fc00::/7 ULA
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80)
        return true; // fe80::/10 link-local
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0)
        return true; // fec0::/10 site-local (deprecated)
    return false;
}
// Only ever called with an actual IP literal or a resolved address. A hostname
// (net.isIP === 0) is not judged here — it must be resolved first, or a real
// domain like "fc2.com" would be wrongly blocked by a string prefix.
export function isBlockedIp(ip) {
    const v = isIP(ip);
    if (v === 4)
        return isBlockedIpv4(ip);
    if (v === 6)
        return isBlockedIpv6(ip);
    return false;
}
// Resolves the host, refuses it if it — or any address it maps to — is local or
// private, and returns one vetted address for the caller to CONNECT to directly.
// Pinning the connection to the address we checked closes the DNS-rebinding
// window: without it, fetch would resolve a second time and could get 127.0.0.1
// after we saw a public IP. A host with several records is safe only if EVERY
// record is safe.
export async function assertPublicHost(hostname) {
    const host = hostname.replace(/^\[|\]$/g, ''); // unwrap [::1] literal form
    if (isIP(host)) {
        if (isBlockedIp(host))
            throw new Error(`blocked address: ${host}`);
        return { address: host, family: isIP(host) };
    }
    let records;
    try {
        records = await lookup(host, { all: true });
    }
    catch {
        throw new Error(`could not resolve host: ${host}`);
    }
    if (records.length === 0)
        throw new Error(`could not resolve host: ${host}`);
    for (const { address } of records) {
        if (isBlockedIp(address))
            throw new Error(`host ${host} resolves to a blocked address (${address})`);
    }
    return { address: records[0].address, family: records[0].family };
}
