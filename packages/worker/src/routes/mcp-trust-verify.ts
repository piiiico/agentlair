/**
 * POST /v1/trust/mcp/verify — MCP Server Attestation Verifier
 *
 * Public-good utility endpoint. Discovers and verifies BHC-S attestation at a given
 * MCP server URL. No auth required. Free.
 *
 * Flow:
 *   1. Validate input URL (HTTPS, max 256 chars)
 *   2. SSRF guard on hostname
 *   3. KV cache lookup (TTL 5min)
 *   4. Fetch /.well-known/agentlair-trust from target
 *   5. Parse + validate BHC-S descriptor shape
 *   6. Extract attestation JWT
 *   7. Fetch JWKS from descriptor.jwks_uri
 *   8. Verify JWT signature via verifyJWS / verifyJWT from ../jwt.js
 *   9. Check expiry
 *  10. Cache + return
 *
 * Pipeline: mcp-trust-verify-20260518-084931
 */

import { Hono } from 'hono';
import type { HonoEnv, Env } from '../types.js';
import { isBlockedHost } from '../lib/ssrf-guard.js';
import { isSelfHost } from '../lib/safe-fetch.js';
import { b64urlDecode, buildJWKS } from '../jwt.js';
import { verifyJWS, verifyJWT } from '../jwt.js';
import { TRUST_DESCRIPTOR } from './well-known-agentlair-trust.js';

export const mcpTrustVerifyRoutes = new Hono<HonoEnv>();

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_URL_LEN = 256;
const MAX_BODY_BYTES = 64 * 1024; // 64 KB
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_SECONDS = 300; // 5 minutes
const CACHE_KEY_PREFIX = 'mcp-trust-verify:v1:';
const WELL_KNOWN_PATH = '/.well-known/agentlair-trust';
const BHC_TOKEN_TYPE = 'urn:agentlair:bhc-s:v1';

// ─── Response type ────────────────────────────────────────────────────────────

interface VerifyResponse {
  verified: boolean;
  server_id: string | null;
  issued_at: string | null;
  expires_at: string | null;
  jwks_url: string | null;
  bhc_token_type: string | null;
  raw_descriptor: object | null;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
}

async function sha256hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function unverifiedResponse(errors: string[]): VerifyResponse {
  return {
    verified: false,
    server_id: null,
    issued_at: null,
    expires_at: null,
    jwks_url: null,
    bhc_token_type: null,
    raw_descriptor: null,
    errors,
  };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCapped(url: string): Promise<{ ok: boolean; body: string | null; status: number; error?: string }> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url);
  } catch (e) {
    return { ok: false, body: null, status: 0, error: `fetch error: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Check Content-Length before reading
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return { ok: false, body: null, status: res.status, error: 'descriptor response too large (max 64KB)' };
  }

  // Stream read with byte counter
  const reader = res.body?.getReader();
  if (!reader) {
    return { ok: false, body: null, status: res.status, error: 'empty response body' };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reader.cancel().catch(() => {});
        return { ok: false, body: null, status: res.status, error: 'descriptor response too large (max 64KB)' };
      }
      chunks.push(value);
    }
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const body = new TextDecoder().decode(combined);
  return { ok: res.ok, body, status: res.status };
}

function decodeJwtHeader(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const bytes = b64urlDecode(parts[0]);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const bytes = b64urlDecode(parts[1]);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// ─── Self-host-aware fetch helpers ───────────────────────────────────────────

/**
 * Fetch a URL via CF Service Binding (direct worker-to-worker RPC), bypassing
 * the CF zone HTTP stack. Used when the target hostname is another Worker in the
 * same CF zone (same-zone custom domain HTTP fetches return 403 from CF edge).
 *
 * Returns null if the binding is not available (graceful degradation to HTTP fetch).
 */
async function fetchViaBinding(
  url: string,
  binding: Fetcher | undefined,
): Promise<{ ok: boolean; body: string | null; status: number; error?: string } | null> {
  if (!binding) return null;
  let res: Response;
  try {
    res = await binding.fetch(url);
  } catch (e) {
    return {
      ok: false,
      body: null,
      status: 0,
      error: `service binding fetch error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  // Read body
  let body: string;
  try {
    body = await res.text();
  } catch {
    return { ok: false, body: null, status: res.status, error: 'binding response body read failed' };
  }
  return { ok: res.ok, body, status: res.status };
}

/**
 * Fetch the BHC-S descriptor, short-circuiting self-hosts to avoid CF Worker
 * self-subrequest abort (documented failure mode: 2026-05-13 self-card audit,
 * 2026-05-18 mcp-trust-verify F1).
 *
 * For same-zone agentlair.dev subdomain workers, uses a CF Service Binding if
 * available to bypass the CF edge 403 on same-zone cross-worker HTTP fetches.
 */
async function getDescriptorBody(
  wellKnownUrl: string,
  env: Env,
): Promise<{ ok: boolean; body: string | null; status: number; error?: string }> {
  let u: URL;
  try {
    u = new URL(wellKnownUrl);
  } catch {
    return { ok: false, body: null, status: 0, error: 'invalid URL' };
  }
  if (isSelfHost(u.hostname)) {
    // CF Workers cannot fetch their own origin — use in-process descriptor.
    return { ok: true, body: JSON.stringify(TRUST_DESCRIPTOR), status: 200 };
  }
  // Same-zone agentlair.dev subdomain workers: CF edge returns 403 for cross-worker
  // HTTP fetches within the same zone. Use Service Binding if available.
  if (u.hostname === 'mcp-demo.agentlair.dev' && env.MCP_DEMO) {
    const result = await fetchViaBinding(wellKnownUrl, env.MCP_DEMO);
    if (result) return result;
  }
  return fetchCapped(wellKnownUrl);
}

/**
 * Fetch the JWKS, short-circuiting self-hosts. Third-party MCP servers may
 * embed `https://agentlair.dev/.well-known/jwks.json` in their descriptors,
 * so this guard is forward-looking, not just for agentlair.dev itself.
 *
 * For same-zone agentlair.dev subdomain workers, uses a CF Service Binding if
 * available to bypass the CF edge 403 on same-zone cross-worker HTTP fetches.
 */
async function getJwksBody(
  jwksUri: string,
  env: Env,
): Promise<{ ok: boolean; body: string | null; status: number; error?: string }> {
  let u: URL;
  try {
    u = new URL(jwksUri);
  } catch {
    return { ok: false, body: null, status: 0, error: 'invalid jwks_uri URL' };
  }
  if (isSelfHost(u.hostname)) {
    if (!env.AUDIT_SIGNING_KEY) {
      return {
        ok: false,
        body: null,
        status: 503,
        error: 'self-host JWKS unavailable: AUDIT_SIGNING_KEY not configured',
      };
    }
    const jwks = await buildJWKS(env.AUDIT_SIGNING_KEY);
    return { ok: true, body: JSON.stringify(jwks), status: 200 };
  }
  // Same-zone agentlair.dev subdomain workers: use Service Binding if available.
  if (u.hostname === 'mcp-demo.agentlair.dev' && env.MCP_DEMO) {
    const result = await fetchViaBinding(jwksUri, env.MCP_DEMO);
    if (result) return result;
  }
  return fetchCapped(jwksUri);
}

// ─── Core verification logic ──────────────────────────────────────────────────

async function verifyMcpServer(normalizedUrl: string, env: Env): Promise<VerifyResponse> {
  // Fetch .well-known/agentlair-trust
  const wellKnownUrl = `${normalizedUrl}${WELL_KNOWN_PATH}`;
  const { ok: fetchOk, body: rawBody, status, error: fetchErr } = await getDescriptorBody(wellKnownUrl, env);

  if (fetchErr) {
    // Size errors returned verbatim
    if (fetchErr.includes('too large')) {
      return unverifiedResponse([fetchErr]);
    }
    return unverifiedResponse([`no agentlair-trust descriptor found at ${WELL_KNOWN_PATH}: ${fetchErr}`]);
  }

  if (!fetchOk || !rawBody) {
    return unverifiedResponse([`no agentlair-trust descriptor found at ${WELL_KNOWN_PATH} (HTTP ${status})`]);
  }

  // Parse JSON
  let descriptor: Record<string, unknown>;
  try {
    descriptor = JSON.parse(rawBody) as Record<string, unknown>;
  } catch (e) {
    return unverifiedResponse([`descriptor parse error: ${e instanceof Error ? e.message : String(e)}`]);
  }

  // Validate BHC-S descriptor shape
  if (descriptor.bhc_token_type !== BHC_TOKEN_TYPE) {
    return unverifiedResponse([`invalid BHC-S descriptor shape: missing or wrong bhc_token_type (expected ${BHC_TOKEN_TYPE})`]);
  }
  if (typeof descriptor.jwks_uri !== 'string' || !descriptor.jwks_uri) {
    return unverifiedResponse(['invalid BHC-S descriptor shape: missing jwks_uri']);
  }

  // Extract JWT from descriptor
  let attestationToken: string | null = null;
  if (typeof descriptor.attestation_token === 'string' && descriptor.attestation_token) {
    attestationToken = descriptor.attestation_token;
  } else if (Array.isArray(descriptor.server_attestations) && descriptor.server_attestations.length > 0) {
    const first = descriptor.server_attestations[0];
    if (first && typeof first === 'object' && 'token' in first && typeof first.token === 'string') {
      attestationToken = first.token;
    }
  }

  if (!attestationToken) {
    return {
      verified: false,
      server_id: null,
      issued_at: null,
      expires_at: null,
      jwks_url: descriptor.jwks_uri as string,
      bhc_token_type: BHC_TOKEN_TYPE,
      raw_descriptor: descriptor,
      errors: ['no attestation token in descriptor'],
    };
  }

  // SSRF guard on jwks_uri
  let jwksUrl: URL;
  try {
    jwksUrl = new URL(descriptor.jwks_uri as string);
  } catch {
    return {
      verified: false,
      server_id: null,
      issued_at: null,
      expires_at: null,
      jwks_url: descriptor.jwks_uri as string,
      bhc_token_type: BHC_TOKEN_TYPE,
      raw_descriptor: descriptor,
      errors: ['invalid jwks_uri URL'],
    };
  }

  if (isBlockedHost(jwksUrl.hostname)) {
    return {
      verified: false,
      server_id: null,
      issued_at: null,
      expires_at: null,
      jwks_url: descriptor.jwks_uri as string,
      bhc_token_type: BHC_TOKEN_TYPE,
      raw_descriptor: descriptor,
      errors: ['JWKS URI blocked: private IP rejected'],
    };
  }

  // Fetch JWKS
  const { ok: jwksOk, body: jwksBody, status: jwksStatus, error: jwksErr } = await getJwksBody(descriptor.jwks_uri as string, env);

  if (jwksErr || !jwksOk || !jwksBody) {
    const msg = jwksErr ?? `JWKS fetch failed (HTTP ${jwksStatus})`;
    return {
      verified: false,
      server_id: null,
      issued_at: null,
      expires_at: null,
      jwks_url: descriptor.jwks_uri as string,
      bhc_token_type: BHC_TOKEN_TYPE,
      raw_descriptor: descriptor,
      errors: [`JWKS fetch error: ${msg}`],
    };
  }

  let jwks: { keys: Array<{ kid?: string; x?: string; kty?: string; crv?: string }> };
  try {
    jwks = JSON.parse(jwksBody) as typeof jwks;
  } catch {
    return {
      verified: false,
      server_id: null,
      issued_at: null,
      expires_at: null,
      jwks_url: descriptor.jwks_uri as string,
      bhc_token_type: BHC_TOKEN_TYPE,
      raw_descriptor: descriptor,
      errors: ['JWKS parse error'],
    };
  }

  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    return {
      verified: false,
      server_id: null,
      issued_at: null,
      expires_at: null,
      jwks_url: descriptor.jwks_uri as string,
      bhc_token_type: BHC_TOKEN_TYPE,
      raw_descriptor: descriptor,
      errors: ['JWKS has no keys'],
    };
  }

  // Decode JWT header to get kid
  const jwtHeader = decodeJwtHeader(attestationToken);
  const kidHint = jwtHeader?.kid as string | undefined;

  // Build candidate key list: kid-match first, then all keys as fallback
  const matchingKeys = kidHint
    ? jwks.keys.filter((k) => k.kid === kidHint)
    : [];
  const candidateKeys = matchingKeys.length > 0 ? matchingKeys : jwks.keys;

  // Try each candidate key
  let verifiedPayload: Record<string, unknown> | null = null;
  for (const jwk of candidateKeys) {
    if (!jwk.x || jwk.kty !== 'OKP') continue;
    let pubKeyBytes: Uint8Array;
    try {
      pubKeyBytes = b64urlDecode(jwk.x);
    } catch {
      continue;
    }
    if (pubKeyBytes.length !== 32) continue;

    // Try verifyJWS first, then verifyJWT
    const jwsResult = verifyJWS(attestationToken, pubKeyBytes);
    if (jwsResult) {
      verifiedPayload = jwsResult;
      break;
    }
    const jwtResult = verifyJWT(attestationToken, pubKeyBytes);
    if (jwtResult) {
      verifiedPayload = jwtResult as unknown as Record<string, unknown>;
      break;
    }
  }

  if (!verifiedPayload) {
    return {
      verified: false,
      server_id: null,
      issued_at: null,
      expires_at: null,
      jwks_url: descriptor.jwks_uri as string,
      bhc_token_type: BHC_TOKEN_TYPE,
      raw_descriptor: descriptor,
      errors: ['JWT signature verification failed'],
    };
  }

  // Extract claims
  const sub = typeof verifiedPayload.sub === 'string' ? verifiedPayload.sub : null;
  const iatNum = typeof verifiedPayload.iat === 'number' ? verifiedPayload.iat : null;
  const expNum = typeof verifiedPayload.exp === 'number' ? verifiedPayload.exp : null;

  const issuedAt = iatNum ? new Date(iatNum * 1000).toISOString() : null;
  const expiresAt = expNum ? new Date(expNum * 1000).toISOString() : null;

  const errors: string[] = [];

  // Check expiry
  if (expNum !== null && expNum < Math.floor(Date.now() / 1000)) {
    errors.push('JWT is expired');
  }

  return {
    verified: errors.length === 0,
    server_id: sub,
    issued_at: issuedAt,
    expires_at: expiresAt,
    jwks_url: descriptor.jwks_uri as string,
    bhc_token_type: BHC_TOKEN_TYPE,
    raw_descriptor: descriptor,
    errors,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

mcpTrustVerifyRoutes.post('/mcp/verify', async (c) => {
  // Parse body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body', errors: ['invalid JSON body'] }, 400);
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'request body must be a JSON object', errors: ['request body must be a JSON object'] }, 400);
  }

  const { url } = body as Record<string, unknown>;

  // Validate url
  if (!url || typeof url !== 'string') {
    return c.json({ error: 'url is required', errors: ['url is required'] }, 400);
  }

  if (url.length > MAX_URL_LEN) {
    return c.json({ error: `url must be at most ${MAX_URL_LEN} characters`, errors: [`url must be at most ${MAX_URL_LEN} characters`] }, 400);
  }

  if (!url.startsWith('https://')) {
    return c.json({ error: 'url must use https://', errors: ['url must use https://'] }, 400);
  }

  // Parse URL to extract hostname
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return c.json({ error: 'invalid url', errors: ['invalid url'] }, 400);
  }

  // SSRF guard
  if (isBlockedHost(parsedUrl.hostname)) {
    return c.json({ error: 'private IP rejected', errors: ['private IP rejected'] }, 400);
  }

  // Normalize URL
  const normalizedUrl = normalizeUrl(url);

  // Cache lookup
  const env = c.env;
  const cacheKey = `${CACHE_KEY_PREFIX}${await sha256hex(normalizedUrl)}`;

  if (env.TRUST_VERIFY_CACHE) {
    const cached = await env.TRUST_VERIFY_CACHE.get(cacheKey);
    if (cached) {
      try {
        const cachedResponse = JSON.parse(cached) as VerifyResponse;
        return c.json(cachedResponse, 200, { 'X-Cache': 'HIT' });
      } catch {
        // Corrupted cache entry — fall through to fresh fetch
      }
    }
  } else {
    // Binding unavailable — graceful degradation
    c.header('X-Cache', 'UNAVAILABLE');
  }

  // Compute response
  let response: VerifyResponse;
  try {
    response = await verifyMcpServer(normalizedUrl, c.env);
  } catch (e) {
    return c.json({ error: 'internal error', errors: ['internal error'] }, 500);
  }

  // Cache result (even negative) — skip if binding unavailable
  if (env.TRUST_VERIFY_CACHE) {
    await env.TRUST_VERIFY_CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: CACHE_TTL_SECONDS });
    c.header('X-Cache', 'MISS');
  }

  return c.json(response, 200);
});
