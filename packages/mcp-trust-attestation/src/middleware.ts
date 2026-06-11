/**
 * @agentlair/mcp-trust-attestation — Hono middleware + helpers
 *
 * Implements the SEP-2133 unofficial extension
 * `dev.agentlair/trust-attestation` (BHC-S spec urn:agentlair:bhc-s:v1).
 *
 * Mount once at the descriptor path (`/.well-known/agentlair-trust`)
 * and once at a per-subject path (`/agentlair/trust-attestation/:subject`)
 * — the factory dispatches by request path.
 */

import type { MiddlewareHandler } from 'hono';
import { jwtVerify, createRemoteJWKSet, errors as joseErrors } from 'jose';
import type {
  AttestationMiddlewareOptions,
  TrustAttestationDescriptor,
  VerifyAttestationResult,
} from './types.js';

export const TRUST_ATTESTATION_EXTENSION = 'dev.agentlair/trust-attestation';

const DEFAULT_ISSUER = 'https://agentlair.dev';
const DEFAULT_ENDPOINT_BASE = 'https://agentlair.dev/v1/trust/server';
const DEFAULT_MIN_TOKEN_FRESHNESS_SECONDS = 900;
const DESCRIPTOR_PATH_SUFFIX = '/.well-known/agentlair-trust';
const SUPPORTED_SIGNALS = [
  'prompt_injection_indicators',
  'data_exfiltration_indicators',
  'tool_description_drift',
  'config_anomaly',
  'call_frequency_spike',
  'consent_violation_rate',
  'latency_anomaly',
  'origin_change',
] as const;
const SUPPORTED_SUBJECTS = ['mcp_server', 'http_api_server', 'shell_tool_server'] as const;
const SUPPORTED_SUBJECT_ID_FORMS = ['url_sha256', 'agentlair_alias', 'did_key'] as const;
const DESCRIPTOR_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
} as const;

/**
 * Build the static BHC-S descriptor object the SDK serves at
 * `/.well-known/agentlair-trust`. Byte-identical to the issuer descriptor
 * AgentLair serves at https://agentlair.dev/.well-known/agentlair-trust.
 */
export function buildDescriptor(opts: AttestationMiddlewareOptions = { serverId: '' }): TrustAttestationDescriptor {
  const issuer = opts.issuer ?? DEFAULT_ISSUER;
  const base = opts.attestationEndpointBase ?? `${issuer}/v1/trust/server`;
  return {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    attestation_endpoint_template: `${base}/{server_id}`,
    supported_signals: [...SUPPORTED_SIGNALS],
    supported_subjects: [...SUPPORTED_SUBJECTS],
    supported_subject_id_forms: [...SUPPORTED_SUBJECT_ID_FORMS],
    signal_algorithm_version: 'trust-engine-v2.5',
    max_token_ttl_seconds: 3600,
    bhc_token_type: 'urn:agentlair:bhc-s:v1',
    spec_version: '0.1.0',
    documentation_url: 'https://agentlair.dev/docs/bhc-s',
  };
}

/**
 * Build the MCP `initialize` `extensions` payload — keyed under the SEP-2133
 * unofficial-extension namespace `dev.agentlair/trust-attestation`.
 *
 * Spread the result into the `extensions` field of your server's
 * `initialize` response per SEP-2133:
 *
 * ```ts
 * const initializeResponse = {
 *   protocolVersion: '2025-03-26',
 *   capabilities: { tools: {} },
 *   serverInfo: { name: 'demo', version: '0.1.0' },
 *   extensions: { ...buildServerCardExtension({ serverId: 'url_sha256:...' }) },
 * };
 * ```
 */
export function buildServerCardExtension(
  opts: AttestationMiddlewareOptions,
): { [key: string]: unknown } {
  const issuer = opts.issuer ?? DEFAULT_ISSUER;
  const base = opts.attestationEndpointBase ?? `${issuer}/v1/trust/server`;
  return {
    [TRUST_ATTESTATION_EXTENSION]: {
      spec_version: '0.1.0',
      bhc_token_type: 'urn:agentlair:bhc-s:v1',
      issuer,
      descriptor_url: `${issuer}${DESCRIPTOR_PATH_SUFFIX}`,
      attestation_url: `${base}/${encodeURIComponent(opts.serverId)}`,
      server_id: opts.serverId,
    },
  };
}

// ─── JWKS resolver cache (per-issuer) ─────────────────────────────────────────

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let resolver = jwksCache.get(issuer);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksCache.set(issuer, resolver);
  }
  return resolver;
}

/**
 * Reset the cached JWKS resolvers. Exposed for tests.
 */
export function clearJwksCache(): void {
  jwksCache.clear();
}

/**
 * Verify an AgentLair BHC-S attestation JWT.
 *
 * Fetches the JWKS at `${issuer}/.well-known/jwks.json` (cached per issuer),
 * verifies the EdDSA signature, and checks `iss` (and optionally `aud`).
 *
 * @example
 * ```ts
 * const result = await verifyAttestation(token, { issuer: 'https://agentlair.dev' });
 * if (result.ok) {
 *   const claims = result.payload as { sub: string; signals: string[] };
 *   // …
 * }
 * ```
 */
export async function verifyAttestation(
  jwt: string,
  opts: { issuer: string; audience?: string },
): Promise<VerifyAttestationResult> {
  if (!jwt || typeof jwt !== 'string') {
    return { ok: false, reason: 'malformed', error: 'token must be a non-empty string' };
  }
  if (jwt.split('.').length !== 3) {
    return { ok: false, reason: 'malformed', error: 'expected a 3-part JWT' };
  }
  try {
    const resolver = getJwks(opts.issuer);
    const verifyOptions: Parameters<typeof jwtVerify>[2] = {
      algorithms: ['EdDSA'],
      issuer: opts.issuer,
    };
    if (opts.audience) {
      verifyOptions.audience = opts.audience;
    }
    const { payload } = await jwtVerify(jwt, resolver, verifyOptions);
    return { ok: true, payload };
  } catch (err) {
    return classifyVerifyError(err);
  }
}

function classifyVerifyError(err: unknown): VerifyAttestationResult {
  if (err instanceof joseErrors.JWTExpired) {
    return { ok: false, reason: 'expired', error: 'token expired' };
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return { ok: false, reason: 'signature', error: 'signature verification failed' };
  }
  if (err instanceof joseErrors.JWKSNoMatchingKey) {
    return { ok: false, reason: 'signature', error: 'no matching key in JWKS' };
  }
  if (err instanceof joseErrors.JWKSMultipleMatchingKeys) {
    return { ok: false, reason: 'signature', error: 'multiple matching keys in JWKS' };
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    const claim = (err as joseErrors.JWTClaimValidationFailed).claim;
    if (claim === 'iss') {
      return { ok: false, reason: 'issuer', error: `invalid issuer claim` };
    }
    if (claim === 'aud') {
      return { ok: false, reason: 'audience', error: `invalid audience claim` };
    }
    return { ok: false, reason: 'other', error: `claim "${claim}" invalid` };
  }
  if (err instanceof joseErrors.JWTInvalid) {
    return { ok: false, reason: 'malformed', error: err.message };
  }
  if (err instanceof Error) {
    if (/fetch|ENOTFOUND|ECONNREFUSED|network/i.test(err.message)) {
      return { ok: false, reason: 'fetch', error: err.message };
    }
    return { ok: false, reason: 'other', error: err.message };
  }
  return { ok: false, reason: 'other', error: 'unknown verification error' };
}

// ─── Per-subject attestation cache ────────────────────────────────────────────

interface CachedAttestation {
  body: string;
  contentType: string;
  status: number;
  cachedAt: number;
}

const attestationCache = new Map<string, CachedAttestation>();

/**
 * Reset the per-subject attestation cache. Exposed for tests.
 */
export function clearAttestationCache(): void {
  attestationCache.clear();
}

// ─── Hono middleware factory ──────────────────────────────────────────────────

/**
 * Build a Hono middleware that mounts:
 *  - the BHC-S descriptor at `/.well-known/agentlair-trust` (GET / HEAD), and
 *  - the per-subject attestation proxy at the second mount point.
 *
 * The middleware dispatches by request path — mount it twice on your app
 * using the same factory result or two separate invocations:
 *
 * ```ts
 * app.use('/.well-known/agentlair-trust', createAttestationMiddleware({ serverId }));
 * app.use('/agentlair/trust-attestation/:subject', createAttestationMiddleware({ serverId }));
 * ```
 */
export function createAttestationMiddleware(
  opts: AttestationMiddlewareOptions,
): MiddlewareHandler {
  const issuer = opts.issuer ?? DEFAULT_ISSUER;
  const base = opts.attestationEndpointBase ?? DEFAULT_ENDPOINT_BASE;
  const minFreshness = Math.max(
    0,
    opts.minTokenFreshnessSeconds ?? DEFAULT_MIN_TOKEN_FRESHNESS_SECONDS,
  );
  const descriptor = buildDescriptor({ ...opts, issuer, attestationEndpointBase: base });
  const descriptorBody = JSON.stringify(descriptor);

  return async function attestationMiddleware(c, next) {
    const method = c.req.method.toUpperCase();
    const path = c.req.path;

    // Descriptor route — fixed path
    if (path === DESCRIPTOR_PATH_SUFFIX || path.endsWith(DESCRIPTOR_PATH_SUFFIX)) {
      if (method === 'GET') {
        return new Response(descriptorBody, {
          status: 200,
          headers: { ...DESCRIPTOR_HEADERS },
        });
      }
      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { ...DESCRIPTOR_HEADERS },
        });
      }
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', Allow: 'GET, HEAD' },
      });
    }

    // Per-subject route — proxy to AgentLair and cache.
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', Allow: 'GET, HEAD' },
      });
    }

    const targetUrl = `${base}/${encodeURIComponent(opts.serverId)}`;
    const cacheKey = targetUrl;
    const now = Date.now();
    const cached = attestationCache.get(cacheKey);
    if (cached && now - cached.cachedAt < minFreshness * 1000) {
      const headers = {
        'Content-Type': cached.contentType,
        'Cache-Control': `public, max-age=${minFreshness}`,
        'X-Agentlair-Attestation-Cache': 'hit',
      };
      return new Response(method === 'HEAD' ? null : cached.body, {
        status: cached.status,
        headers,
      });
    }

    try {
      const upstream = await fetch(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const body = await upstream.text();
      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      attestationCache.set(cacheKey, {
        body,
        contentType,
        status: upstream.status,
        cachedAt: now,
      });
      return new Response(method === 'HEAD' ? null : body, {
        status: upstream.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': `public, max-age=${minFreshness}`,
          'X-Agentlair-Attestation-Cache': 'miss',
        },
      });
    } catch (err) {
      // Don't crash the host server — surface a 502 and let the caller retry.
      const message = err instanceof Error ? err.message : 'upstream fetch failed';
      // Suppress lint about unused next when upstream errors short-circuit.
      void next;
      return new Response(
        JSON.stringify({ error: 'upstream fetch failed', detail: message }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
  };
}

// ─── Minimal node:http adapter ────────────────────────────────────────────────

/**
 * Headers shape used by the node:http adapter.
 */
type NodeHeaders = Record<string, string | string[] | undefined>;

interface NodeHttpRequest {
  url?: string;
  method?: string;
  headers: NodeHeaders;
}

interface NodeHttpResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string | Uint8Array): void;
}

/**
 * Thin adapter for node:http servers that don't use Hono.
 *
 * ```ts
 * import http from 'node:http';
 * import { createNodeHttpHandler } from '@agentlair/mcp-trust-attestation';
 *
 * const handler = createNodeHttpHandler({ serverId: 'url_sha256:...' });
 * http.createServer(handler).listen(3000);
 * ```
 */
export function createNodeHttpHandler(
  opts: AttestationMiddlewareOptions,
): (req: NodeHttpRequest, res: NodeHttpResponse) => Promise<void> {
  const issuer = opts.issuer ?? DEFAULT_ISSUER;
  const base = opts.attestationEndpointBase ?? DEFAULT_ENDPOINT_BASE;
  const minFreshness = Math.max(
    0,
    opts.minTokenFreshnessSeconds ?? DEFAULT_MIN_TOKEN_FRESHNESS_SECONDS,
  );
  const descriptor = buildDescriptor({ ...opts, issuer, attestationEndpointBase: base });
  const descriptorBody = JSON.stringify(descriptor);

  return async function nodeHttpHandler(req, res) {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';

    if (path === DESCRIPTOR_PATH_SUFFIX || path.endsWith(DESCRIPTOR_PATH_SUFFIX)) {
      if (method === 'GET' || method === 'HEAD') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.end(method === 'HEAD' ? '' : descriptorBody);
        return;
      }
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Allow', 'GET, HEAD');
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Allow', 'GET, HEAD');
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    const targetUrl = `${base}/${encodeURIComponent(opts.serverId)}`;
    const now = Date.now();
    const cached = attestationCache.get(targetUrl);
    if (cached && now - cached.cachedAt < minFreshness * 1000) {
      res.statusCode = cached.status;
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', `public, max-age=${minFreshness}`);
      res.setHeader('X-Agentlair-Attestation-Cache', 'hit');
      res.end(method === 'HEAD' ? '' : cached.body);
      return;
    }

    try {
      const upstream = await fetch(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const body = await upstream.text();
      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      attestationCache.set(targetUrl, {
        body,
        contentType,
        status: upstream.status,
        cachedAt: now,
      });
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', `public, max-age=${minFreshness}`);
      res.setHeader('X-Agentlair-Attestation-Cache', 'miss');
      res.end(method === 'HEAD' ? '' : body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'upstream fetch failed';
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'upstream fetch failed', detail: message }));
    }
  };
}
