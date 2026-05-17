/**
 * POST /v1/rfc9421/verify — public RFC 9421 HTTP Message Signature verifier
 *
 * Free public read (rate-limited by IP). Verifies Ed25519 HTTP message signatures
 * per RFC 9421 — accepts did:key keyid or JWKS-URL keyid.
 *
 * Strategic anchor: Visa Trusted Agent Protocol uses the same Ed25519 + RFC 9421
 * shape. This route makes the claim demonstrable in a single curl.
 *
 * Security notes:
 *   - No side effects: only outbound call is JWKS fetch (when keyid is a URL).
 *   - DNS-named JWKS hosts bypass SSRF guard; downstream caller must trust the resolver.
 *   - Replay detection is the caller's responsibility (see X-AgentLair-Verifier-Scope header).
 *
 * Pipeline: rfc9421-verify-route-20260517-063126
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { verifyHttpSignature, type HttpMessage } from '../lib/rfc9421.js';
import { safeFetch } from '../lib/safe-fetch.js';
import { isBlockedHost } from '../lib/ssrf-guard.js';
import { base58btcDecode } from '../lib/base58btc.js';
import { checkIpRateLimit } from '../middleware/ratelimit.js';

export const rfc9421VerifyRoutes = new Hono<HonoEnv>();

// ─── Types ────────────────────────────────────────────────────────────────────

interface VerifyRequest {
  method?: unknown;
  target_uri?: unknown;
  headers?: unknown;
  body_base64?: unknown;
}

interface ParsedSigInput {
  label: string;
  components: string[];
  keyid: string;
  alg: string;
  created: number;
  expires?: number;
  nonce: string;
  tag: string;
  hasMultipleSignatures: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a signature-input string per RFC 9421.
 * Returns null if unparseable.
 * Only parses the FIRST label when multiple are present.
 */
function parseSigInput(raw: string): ParsedSigInput | null {
  // Detect multiple signatures: find all label=( occurrences
  const allLabels = raw.match(/\w+=\(/g) ?? [];
  const hasMultipleSignatures = allLabels.length > 1;

  // Parse first label only
  const match = raw.match(/^(\w+)=\(([^)]*)\);(.+?)(?:\s+\w+=\(|$)/s);
  if (!match) return null;

  const label = match[1];
  const componentPart = match[2];
  const paramsPart = match[3];

  // Parse component list (quoted strings)
  const components = componentPart
    .split(/\s+/)
    .map((c) => c.replace(/^"|"$/g, '').toLowerCase())
    .filter(Boolean);

  // Parse params key=value; pairs (values may be quoted)
  const params: Record<string, string> = {};
  for (const part of paramsPart.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (key) params[key] = val;
  }

  if (!params.keyid || !params.alg) return null;

  return {
    label,
    components,
    keyid: params.keyid,
    alg: params.alg,
    created: parseInt(params.created ?? '0', 10),
    expires: params.expires ? parseInt(params.expires, 10) : undefined,
    nonce: params.nonce ?? '',
    tag: params.tag ?? '',
    hasMultipleSignatures,
  };
}

/**
 * Resolve a did:key keyid to its 32-byte Ed25519 public key.
 * Returns the bytes or null if not a valid did:key Ed25519 key.
 */
function resolveDidKey(keyid: string): Uint8Array | null {
  // Extract the multibase-encoded part (strip 'did:key:')
  const nid = keyid.slice('did:key:'.length); // starts with 'z' (base58btc multibase prefix)
  if (!nid.startsWith('z')) return null;
  const decoded = base58btcDecode(nid.slice(1)); // strip 'z' multibase prefix
  if (!decoded || decoded.length < 34) return null;
  // Verify multicodec prefix: 0xed 0x01 = Ed25519 public key
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) return null;
  return decoded.slice(2); // 32-byte public key
}

const DID_KEY_ED25519_RE = /^did:key:z6Mk[A-Za-z0-9]{43,46}$/;

/**
 * Fetch a JWKS URL and extract the public key matching a kid.
 * Returns the 32-byte key bytes, or an error reason string.
 */
async function resolveJwksKey(
  keyidUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Uint8Array | { error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(keyidUrl);
  } catch {
    return { error: 'keyid unparseable' };
  }

  // SSRF guard — block private/loopback hosts
  if (isBlockedHost(parsed.hostname)) {
    return { error: 'jwks url blocked' };
  }

  // Extract the expected kid from hash fragment or 'kid' query param
  const expectedKid = parsed.hash ? parsed.hash.slice(1) : parsed.searchParams.get('kid') ?? '';

  // Fetch JWKS (3s timeout, no retry on 4xx/5xx, one retry on network error)
  let response: Response;
  try {
    response = await safeFetch(parsed.toString(), {
      signal: AbortSignal.timeout(3000),
    }, fetchImpl);
  } catch {
    return { error: 'jwks fetch failed' };
  }

  if (!response.ok) return { error: 'jwks fetch failed' };

  // Size-limit: abort after 65536 bytes
  const MAX_BYTES = 65536;
  const reader = response.body?.getReader();
  if (!reader) return { error: 'jwks fetch failed' };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BYTES) {
      reader.cancel();
      return { error: 'jwks too large' };
    }
    chunks.push(value);
  }

  const body = new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const combined = new Uint8Array(acc.length + chunk.length);
      combined.set(acc);
      combined.set(chunk, acc.length);
      return combined;
    }, new Uint8Array(0)),
  );

  let jwks: { keys?: unknown[] };
  try {
    jwks = JSON.parse(body);
  } catch {
    return { error: 'jwks fetch failed' };
  }

  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const key = keys.find(
    (k: unknown) =>
      k &&
      typeof k === 'object' &&
      (k as Record<string, unknown>).kid === expectedKid &&
      (k as Record<string, unknown>).kty === 'OKP' &&
      (k as Record<string, unknown>).crv === 'Ed25519',
  ) as Record<string, unknown> | undefined;

  if (!key) return { error: 'jwks key not found' };

  const xB64 = key.x as string;
  if (!xB64) return { error: 'jwks key not found' };

  // Decode base64url x parameter to 32-byte public key
  try {
    const padded = xB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      xB64.length + ((4 - (xB64.length % 4)) % 4),
      '=',
    );
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    if (bytes.length !== 32) return { error: 'jwks key not found' };
    return bytes;
  } catch {
    return { error: 'jwks key not found' };
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

rfc9421VerifyRoutes.post('/', async (c) => {
  // Rate limit by client IP
  const ip = c.req.header('cf-connecting-ip') ?? '';
  const rl = await checkIpRateLimit(c.env, ip, 'rfc9421-verify', 60);
  if (!rl.allowed) {
    const retryAfter = new Date(Date.now() + 3600_000).toISOString();
    return c.json({ error: 'rate_limited', retry_after: retryAfter }, 429);
  }

  // Parse request body
  let body: VerifyRequest;
  try {
    body = await c.req.json<VerifyRequest>();
  } catch {
    return c.json({ error: 'malformed_request', reason: 'request body is not valid JSON' }, 400);
  }

  // Validate required fields
  if (typeof body.method !== 'string' || !body.method) {
    return c.json({ error: 'malformed_request', reason: 'missing required field: method' }, 400);
  }
  if (typeof body.target_uri !== 'string' || !body.target_uri) {
    return c.json({ error: 'malformed_request', reason: 'missing required field: target_uri' }, 400);
  }
  if (typeof body.headers !== 'object' || !body.headers || Array.isArray(body.headers)) {
    return c.json({ error: 'malformed_request', reason: 'missing required field: headers' }, 400);
  }

  const headers = body.headers as Record<string, unknown>;

  if (typeof headers['signature-input'] !== 'string' || !headers['signature-input']) {
    return c.json({ error: 'malformed_request', reason: 'missing required field: headers.signature-input' }, 400);
  }
  if (typeof headers['signature'] !== 'string' || !headers['signature']) {
    return c.json({ error: 'malformed_request', reason: 'missing required field: headers.signature' }, 400);
  }

  // Validate target_uri is an absolute URL
  try {
    new URL(body.target_uri);
  } catch {
    return c.json({ error: 'malformed_request', reason: 'target_uri is not a parseable absolute URL' }, 400);
  }

  // Validate body_base64 if present
  if (body.body_base64 !== undefined) {
    if (typeof body.body_base64 !== 'string') {
      return c.json({ error: 'malformed_request', reason: 'body_base64 must be a string' }, 400);
    }
    try {
      atob(body.body_base64);
    } catch {
      return c.json({ error: 'malformed_request', reason: 'body_base64 is not valid base64' }, 400);
    }
  }

  // Validate signature format
  const sigHeader = headers['signature'] as string;
  if (!/^\w+=:[A-Za-z0-9+/=]*:$/.test(sigHeader)) {
    return c.json({ error: 'malformed_request', reason: 'headers.signature does not match <label>=:<base64>: envelope' }, 400);
  }

  // Parse signature-input
  const sigInput = headers['signature-input'] as string;
  const parsed = parseSigInput(sigInput);
  if (!parsed) {
    return c.json({ error: 'malformed_request', reason: 'headers.signature-input is not a parseable RFC 9421 signature-input string' }, 400);
  }

  // Add warning header if multiple signatures present
  const responseHeaders: Record<string, string> = {
    'X-AgentLair-Verifier-Scope': 'stateless; replay-detection-is-callers-responsibility',
  };
  if (parsed.hasMultipleSignatures) {
    responseHeaders['Warning'] = 'multiple signatures present; only the first is verified';
  }

  const now = Math.floor(Date.now() / 1000);
  const signatureAgeMs = Math.max(0, (now - parsed.created) * 1000);

  // Step 2: Algorithm guard — BEFORE key resolution
  if (parsed.alg !== 'ed25519') {
    return c.json(
      { error: 'key_resolution_failed', reason: 'unsupported algorithm' },
      422,
      responseHeaders,
    );
  }

  // Step 3: Expiry / skew guard
  if (parsed.expires !== undefined && parsed.expires < now) {
    return c.json(
      {
        valid: false,
        key_id: parsed.keyid,
        algorithm: 'ed25519',
        created: parsed.created,
        expires: parsed.expires,
        covered_fields: parsed.components,
        reason: 'signature expired',
        signature_age_ms: signatureAgeMs,
      },
      200,
      responseHeaders,
    );
  }
  if (parsed.created > now + 600) {
    return c.json(
      {
        valid: false,
        key_id: parsed.keyid,
        algorithm: 'ed25519',
        created: parsed.created,
        covered_fields: parsed.components,
        reason: 'clock skew too large',
        signature_age_ms: 0,
      },
      200,
      responseHeaders,
    );
  }

  // Step 4: Resolve key
  let publicKeyBytes: Uint8Array;

  if (DID_KEY_ED25519_RE.test(parsed.keyid)) {
    // did:key Ed25519
    const keyBytes = resolveDidKey(parsed.keyid);
    if (!keyBytes) {
      return c.json(
        { error: 'key_resolution_failed', reason: 'unsupported did method' },
        422,
        responseHeaders,
      );
    }
    publicKeyBytes = keyBytes;
  } else if (parsed.keyid.startsWith('did:')) {
    // starts with 'did:' but not a valid did:key Ed25519 (checked above)
    return c.json(
      { error: 'key_resolution_failed', reason: 'unsupported did method' },
      422,
      responseHeaders,
    );
  } else {
    // Try parsing as URL for JWKS resolution
    let isUrl = false;
    try {
      const u = new URL(parsed.keyid);
      // Only treat as JWKS URL if scheme is http/https
      isUrl = u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      // Not a URL
    }

    if (isUrl) {
      const result = await resolveJwksKey(parsed.keyid);
      if (result instanceof Uint8Array) {
        publicKeyBytes = result;
      } else {
        return c.json(
          { error: 'key_resolution_failed', reason: result.error },
          422,
          responseHeaders,
        );
      }
    } else {
      return c.json(
        { error: 'key_resolution_failed', reason: 'keyid unparseable' },
        422,
        responseHeaders,
      );
    }
  }

  // Build HttpMessage for verification
  const stringHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') stringHeaders[k] = v;
  }
  const httpMessage: HttpMessage = {
    method: body.method as string,
    url: body.target_uri as string,
    headers: stringHeaders,
  };

  // Step 5: Content-digest check
  const contentDigestHeader = stringHeaders['content-digest'];
  const coversContentDigest = parsed.components.includes('content-digest');
  if (coversContentDigest && contentDigestHeader) {
    if (!body.body_base64) {
      return c.json(
        {
          valid: false,
          key_id: parsed.keyid,
          algorithm: 'ed25519',
          created: parsed.created,
          expires: parsed.expires,
          covered_fields: parsed.components,
          reason: 'content-digest missing body',
          signature_age_ms: signatureAgeMs,
        },
        200,
        responseHeaders,
      );
    }
    // Compute actual digest
    const bodyBytes = Uint8Array.from(atob(body.body_base64 as string), (c) => c.charCodeAt(0));
    const digestBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
    const digestB64 = btoa(String.fromCharCode(...new Uint8Array(digestBuffer)));
    const expected = `sha-256=:${digestB64}:`;
    if (expected.trim() !== contentDigestHeader.trim()) {
      return c.json(
        {
          valid: false,
          key_id: parsed.keyid,
          algorithm: 'ed25519',
          created: parsed.created,
          expires: parsed.expires,
          covered_fields: parsed.components,
          reason: 'content-digest mismatch',
          signature_age_ms: signatureAgeMs,
        },
        200,
        responseHeaders,
      );
    }
  }

  // Step 6: Signature verify
  const isValid = verifyHttpSignature(
    httpMessage,
    sigInput,
    sigHeader,
    publicKeyBytes,
  );

  if (!isValid) {
    return c.json(
      {
        valid: false,
        key_id: parsed.keyid,
        algorithm: 'ed25519',
        created: parsed.created,
        expires: parsed.expires,
        covered_fields: parsed.components,
        reason: 'signature mismatch',
        signature_age_ms: signatureAgeMs,
      },
      200,
      responseHeaders,
    );
  }

  return c.json(
    {
      valid: true,
      key_id: parsed.keyid,
      algorithm: 'ed25519',
      created: parsed.created,
      expires: parsed.expires,
      covered_fields: parsed.components,
      signature_age_ms: signatureAgeMs,
    },
    200,
    responseHeaders,
  );
});
