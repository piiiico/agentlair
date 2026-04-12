/**
 * @agentlair/mastra — JWKS client and JWT verification
 *
 * Fetches Ed25519 public keys from AgentLair's JWKS endpoint and verifies
 * EdDSA-signed JWTs (Agent Authentication Tokens / AATs).
 *
 * Design: Pure fetch + Web Crypto API. No dependencies on @noble/curves
 * at verification time — uses the standard Web Crypto Ed25519 API.
 * Falls back to manual base64url decoding for environments without atob.
 */

import type { AATClaims, JWK, JWKS } from './types.js';

// ─── Base64url helpers ───────────────────────────────────────────────────────

function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(b64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

// ─── JWKS cache ──────────────────────────────────────────────────────────────

interface CachedJWKS {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

const cache = new Map<string, CachedJWKS>();

/**
 * Fetch and cache JWKS keys from an endpoint.
 * Keys are cached per-URL with configurable TTL.
 */
export async function getSigningKey(
  jwksUrl: string,
  kid: string,
  cacheTtlMs: number = 3600_000,
): Promise<CryptoKey | null> {
  const now = Date.now();
  let cached = cache.get(jwksUrl);

  // Refresh if stale or missing
  if (!cached || now - cached.fetchedAt > cacheTtlMs) {
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS from ${jwksUrl}: HTTP ${response.status}`);
    }
    const jwks: JWKS = await response.json();

    const keys = new Map<string, CryptoKey>();
    for (const jwk of jwks.keys) {
      if (jwk.alg === 'EdDSA' && jwk.crv === 'Ed25519' && jwk.x) {
        try {
          const key = await importEdDSAPublicKey(jwk);
          keys.set(jwk.kid, key);
        } catch {
          // Skip malformed keys
        }
      }
    }

    cached = { keys, fetchedAt: now };
    cache.set(jwksUrl, cached);
  }

  return cached.keys.get(kid) ?? null;
}

/**
 * Import an Ed25519 JWK as a CryptoKey for verification.
 */
async function importEdDSAPublicKey(jwk: JWK): Promise<CryptoKey> {
  // Web Crypto Ed25519 import — supported in Node 20+, CF Workers, Deno, Bun
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'OKP',
      crv: 'Ed25519',
      x: jwk.x,
    },
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
}

// ─── JWT verification ────────────────────────────────────────────────────────

export interface VerifyOptions {
  /** JWKS endpoint URL */
  jwksUrl: string;
  /** Expected audience (optional — skip aud check if not provided) */
  audience?: string;
  /** Expected issuer @default "https://agentlair.dev" */
  issuer?: string;
  /** Clock skew tolerance in seconds @default 60 */
  clockSkew?: number;
  /** JWKS cache TTL in seconds @default 3600 */
  cacheTtl?: number;
}

/**
 * Verify an AgentLair JWT (AAT) and return decoded claims.
 *
 * Steps:
 * 1. Parse JWT structure (header.payload.signature)
 * 2. Extract `kid` from header and fetch matching key from JWKS
 * 3. Verify EdDSA signature using Web Crypto API
 * 4. Validate standard claims (iss, aud, exp, iat)
 * 5. Return decoded AATClaims
 *
 * @throws Error if token is invalid, expired, or signature verification fails
 */
export async function verifyAAT(token: string, options: VerifyOptions): Promise<AATClaims> {
  // 1. Parse structure
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to get kid
  let header: { alg?: string; kid?: string; typ?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64)));
  } catch {
    throw new Error('Invalid JWT: malformed header');
  }

  if (header.alg !== 'EdDSA') {
    throw new Error(`Invalid JWT: unsupported algorithm "${header.alg}"`);
  }

  if (!header.kid) {
    throw new Error('Invalid JWT: missing kid in header');
  }

  // 2. Fetch signing key
  const cacheTtlMs = (options.cacheTtl ?? 3600) * 1000;
  const key = await getSigningKey(options.jwksUrl, header.kid, cacheTtlMs);
  if (!key) {
    throw new Error(`Invalid JWT: no matching key for kid "${header.kid}"`);
  }

  // 3. Verify signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = b64urlDecode(signatureB64);

  // Use new ArrayBuffer copy to satisfy TS 5.9+ BufferSource type (SharedArrayBuffer compat)
  const sigBuf = new Uint8Array(signature).buffer as ArrayBuffer;
  const dataBuf = new Uint8Array(signingInput).buffer as ArrayBuffer;
  const valid = await crypto.subtle.verify('Ed25519', key, sigBuf, dataBuf);
  if (!valid) {
    throw new Error('Invalid JWT: signature verification failed');
  }

  // 4. Decode and validate claims
  let claims: AATClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    throw new Error('Invalid JWT: malformed payload');
  }

  const now = Math.floor(Date.now() / 1000);
  const skew = options.clockSkew ?? 60;

  // Check expiration
  if (claims.exp && claims.exp + skew < now) {
    throw new Error('Invalid JWT: token expired');
  }

  // Check not-before (iat)
  if (claims.iat && claims.iat - skew > now) {
    throw new Error('Invalid JWT: token not yet valid');
  }

  // Check issuer
  const expectedIssuer = options.issuer ?? 'https://agentlair.dev';
  if (claims.iss !== expectedIssuer) {
    throw new Error(`Invalid JWT: unexpected issuer "${claims.iss}"`);
  }

  // Check audience (if configured)
  if (options.audience && claims.aud !== options.audience) {
    throw new Error(`Invalid JWT: unexpected audience "${claims.aud}"`);
  }

  return claims;
}

/**
 * Clear the JWKS cache (useful for testing or key rotation).
 */
export function clearJWKSCache(): void {
  cache.clear();
}
