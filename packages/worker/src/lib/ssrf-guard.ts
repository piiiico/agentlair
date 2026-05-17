/**
 * SSRF Guard — blocks private, loopback, and link-local hosts.
 *
 * Used by the RFC 9421 verifier to prevent the worker from being used
 * as a proxy to internal services via JWKS URL injection.
 *
 * LIMITATION: DNS-named hosts bypass this guard; the worker cannot resolve
 * DNS names (CF Workers has no dns.lookup). For DNS names, only the literal
 * hostname string is checked:
 *   - "localhost" is blocked
 *   - any hostname ending in ".local" or ".internal" is blocked
 * Downstream callers must trust the resolver for all other DNS names.
 *
 * Blocked CIDR ranges (v1):
 *   10.0.0.0/8
 *   127.0.0.0/8
 *   169.254.0.0/16   (link-local; CF metadata)
 *   172.16.0.0/12
 *   192.168.0.0/16
 *   ::1
 *   fc00::/7
 *   fe80::/10
 */

// ─── IPv4 helpers ─────────────────────────────────────────────────────────────

/** Parse dotted-decimal IPv4 address to 32-bit unsigned integer, or null on failure. */
function parseIPv4(addr: string): number | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const byte = parseInt(part, 10);
    if (isNaN(byte) || byte < 0 || byte > 255 || String(byte) !== part) return null;
    n = (n << 8) | byte;
  }
  return n >>> 0;
}

function ipv4InCIDR(addr: number, base: number, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (addr & mask) === (base & mask);
}

function isBlockedIPv4(addr: number): boolean {
  // 10.0.0.0/8
  if (ipv4InCIDR(addr, parseIPv4('10.0.0.0')!, 8)) return true;
  // 127.0.0.0/8
  if (ipv4InCIDR(addr, parseIPv4('127.0.0.0')!, 8)) return true;
  // 169.254.0.0/16 — link-local / CF metadata
  if (ipv4InCIDR(addr, parseIPv4('169.254.0.0')!, 16)) return true;
  // 172.16.0.0/12
  if (ipv4InCIDR(addr, parseIPv4('172.16.0.0')!, 12)) return true;
  // 192.168.0.0/16
  if (ipv4InCIDR(addr, parseIPv4('192.168.0.0')!, 16)) return true;
  return false;
}

// ─── IPv6 helpers ─────────────────────────────────────────────────────────────

/** Parse IPv6 address string to 16-byte Uint8Array, or null on failure. */
function parseIPv6(addr: string): Uint8Array | null {
  // Strip brackets if present
  let s = addr;
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const expandGroup = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(':');
    const result: number[] = [];
    for (const g of groups) {
      if (g.length === 0 || g.length > 4) return null;
      const v = parseInt(g, 16);
      if (isNaN(v)) return null;
      result.push((v >> 8) & 0xff, v & 0xff);
    }
    return result;
  };

  if (halves.length === 1) {
    const bytes = expandGroup(halves[0]);
    if (!bytes || bytes.length !== 16) return null;
    return new Uint8Array(bytes);
  }

  // Has ::
  const left = expandGroup(halves[0]);
  const right = expandGroup(halves[1]);
  if (!left || !right) return null;
  const zeroPad = 16 - left.length - right.length;
  if (zeroPad < 0) return null;
  return new Uint8Array([...left, ...new Array(zeroPad).fill(0), ...right]);
}

function isBlockedIPv6(bytes: Uint8Array): boolean {
  // ::1 (loopback)
  if (bytes.every((b, i) => i < 15 ? b === 0 : b === 1)) return true;

  // fc00::/7 — first byte: 0b11111100 to 0b11111101 → top 7 bits = 0xfc
  if ((bytes[0] & 0xfe) === 0xfc) return true;

  // fe80::/10 — first byte 0xfe, second byte top 2 bits = 0b10 → 0x80..0xbf
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;

  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the hostname should be blocked by the SSRF guard.
 *
 * Handles:
 *   - IPv4 dotted-decimal literals → CIDR check
 *   - IPv6 literals (with or without brackets) → CIDR check
 *   - DNS names: block localhost, *.local, *.internal
 */
export function isBlockedHost(host: string): boolean {
  if (!host) return false;

  let h = host.toLowerCase();

  // IPv6 bracket form (e.g. "[::1]" or "[::1]:8080")
  if (h.startsWith('[')) {
    const close = h.indexOf(']');
    if (close < 0) return false; // malformed
    h = h.slice(1, close);
    const bytes = parseIPv6(h);
    if (!bytes) return false;
    return isBlockedIPv6(bytes);
  }

  // Strip port for IPv4:port or hostname:port (exactly one colon)
  const colonCount = (h.match(/:/g) || []).length;
  if (colonCount === 1) {
    h = h.split(':')[0]!;
  }

  // IPv4 literal check
  const ipv4 = parseIPv4(h);
  if (ipv4 !== null) {
    return isBlockedIPv4(ipv4);
  }

  // IPv6 literal without brackets (multiple colons)
  if (colonCount > 1) {
    const bytes = parseIPv6(h);
    if (bytes) return isBlockedIPv6(bytes);
    return false;
  }

  // DNS name checks (no DNS resolution — see module-level LIMITATION comment)
  if (h === 'localhost') return true;
  if (h.endsWith('.local')) return true;
  if (h.endsWith('.internal')) return true;

  return false;
}
