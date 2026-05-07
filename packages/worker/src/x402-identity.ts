/**
 * x402 Identity Extension — AgentLair AAT embedding in payment payloads
 *
 * Extends x402 V2 PaymentPayload.extensions['agentlair.dev/identity'] with a
 * signed AAT (Agent Authentication Token) to prove "who paid" alongside
 * "that payment was made."
 *
 * Extension schema:
 *   { aat: string, jwks_uri: string, aud_bound: boolean }
 *
 * Verification flow (offline — no phone-home to AgentLair required):
 *   1. Extract extension from PaymentPayload
 *   2. Parse JWT header → locate matching JWK by kid
 *   3. Verify Ed25519 signature using JWKS public key
 *   4. Check exp (expiration)
 *   5. Check aud == resource URL (audience binding, if aud_bound=true)
 *   6. Return AATClaims or null
 *
 * Non-breaking addition: extensions slot is reserved in x402 V2 spec.
 * No protocol fork required.
 *
 * Ref: memory/knowledge/agentlair-aat-x402-identity-layer.md
 */

import { b64urlDecode, type AATClaims } from './jwt.js';
import { ed25519 } from '@noble/curves/ed25519.js';

export const IDENTITY_EXTENSION_KEY = 'agentlair.dev/identity';
export const DEFAULT_AGENTLAIR_JWKS_URI = 'https://agentlair.dev/.well-known/jwks.json';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Schema for the agentlair.dev/identity extension in x402 PaymentPayload. */
export interface AATIdentityExtension {
  aat: string;        // Ed25519-signed AgentLair AAT (compact JWT)
  jwks_uri: string;   // JWKS endpoint for offline verification (cacheable, 5-min TTL)
  aud_bound: boolean; // true if AAT.aud === resource URL being accessed
}

/** Minimal x402 V2 PaymentPayload shape (full spec: coinbase/x402 V2). */
export interface X402PaymentPayload {
  x402Version?: number;
  scheme?: string;
  network?: string;
  payload?: unknown;
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Pack ─────────────────────────────────────────────────────────────────────

/**
 * Embed an AgentLair AAT into x402 PaymentPayload.extensions.
 * Non-destructive — merges with any existing extensions.
 *
 * The AAT must already be issued with aud = resource URL if aud_bound = true.
 * Audience binding happens at AAT issuance time (POST /v1/tokens/issue),
 * not at packing time.
 *
 * @param aat     Compact JWT from AgentLair (POST /v1/tokens/issue)
 * @param payload x402 PaymentPayload to extend
 * @param opts.jwksUri   Override JWKS URI (default: agentlair.dev)
 * @param opts.audBound  Whether to assert aud binding (default: true)
 */
export function packAATIntoX402Extensions(
  aat: string,
  payload: X402PaymentPayload,
  opts?: { jwksUri?: string; audBound?: boolean },
): X402PaymentPayload {
  const extension: AATIdentityExtension = {
    aat,
    jwks_uri: opts?.jwksUri ?? DEFAULT_AGENTLAIR_JWKS_URI,
    aud_bound: opts?.audBound ?? true,
  };
  return {
    ...payload,
    extensions: {
      ...(payload.extensions ?? {}),
      [IDENTITY_EXTENSION_KEY]: extension,
    },
  };
}

// ─── Verify ───────────────────────────────────────────────────────────────────

interface JWK {
  kty: string;
  crv?: string;
  x?: string;
  kid?: string;
  use?: string;
  alg?: string;
}

/**
 * Verify the AgentLair AAT embedded in x402 PaymentPayload.extensions.
 *
 * Fetches JWKS from the URI embedded in the extension (or provided override).
 * Signature verification is offline — no phone-home to AgentLair beyond
 * the initial JWKS fetch (cacheable, 5-minute TTL in CF Workers).
 *
 * In Cloudflare Workers, add `cf: { cacheTtl: 300 }` to the fetch options
 * to cache the JWKS response and avoid a network round-trip per request.
 *
 * Returns null (not throw) on any failure — payment still succeeds without
 * identity. Call sites can choose whether to require or just enrich identity.
 *
 * @param payload          Decoded x402 PaymentPayload
 * @param opts.jwksUri     Override JWKS URI (e.g. for testing with local mock)
 * @param opts.resourceUrl Expected aud claim (the URL being accessed)
 * @returns AATClaims if valid, null if missing / invalid / expired / aud-mismatch
 */
export async function verifyAATFromX402Extensions(
  payload: X402PaymentPayload,
  opts?: { jwksUri?: string; resourceUrl?: string },
): Promise<AATClaims | null> {
  // Extract identity extension
  const ext = payload.extensions?.[IDENTITY_EXTENSION_KEY] as AATIdentityExtension | undefined;
  if (!ext?.aat) return null;

  const jwksUri = opts?.jwksUri ?? ext.jwks_uri ?? DEFAULT_AGENTLAIR_JWKS_URI;

  // Fetch JWKS
  // In CF Workers production: add cf: { cacheTtl: 300 } to avoid per-request network cost
  let jwks: { keys: JWK[] };
  try {
    const res = await fetch(jwksUri, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    jwks = (await res.json()) as { keys: JWK[] };
  } catch {
    return null;
  }

  // Parse JWT parts
  const parts = ext.aat.split('.');
  if (parts.length !== 3) return null;

  // Decode header → kid
  let header: { kid?: string; alg?: string };
  try {
    const json = new TextDecoder().decode(b64urlDecode(parts[0]));
    header = JSON.parse(json) as { kid?: string; alg?: string };
  } catch {
    return null;
  }

  // Locate matching JWK by kid + crv
  const jwk = jwks.keys.find((k) => k.kid === header.kid && k.crv === 'Ed25519');
  if (!jwk?.x) return null;

  // Decode signature and public key bytes
  let signatureBytes: Uint8Array;
  let publicKeyBytes: Uint8Array;
  try {
    signatureBytes = b64urlDecode(parts[2]);
    publicKeyBytes = b64urlDecode(jwk.x);
  } catch {
    return null;
  }

  // Verify Ed25519 signature (offline)
  try {
    const message = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = ed25519.verify(signatureBytes, message, publicKeyBytes);
    if (!valid) return null;
  } catch {
    return null;
  }

  // Decode claims
  let claims: AATClaims;
  try {
    const json = new TextDecoder().decode(b64urlDecode(parts[1]));
    claims = JSON.parse(json) as AATClaims;
  } catch {
    return null;
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) return null;

  // Audience binding: AAT.aud must match the resource URL
  if (ext.aud_bound && opts?.resourceUrl) {
    if (claims.aud !== opts.resourceUrl) return null;
  }

  return claims;
}

// ─── Convenience ─────────────────────────────────────────────────────────────

/**
 * Convenience wrapper: pack an already-issued, audience-bound AAT into a
 * payment payload. The AAT must already have aud = resourceUrl.
 *
 * Example usage:
 *
 *   // 1. Issue AAT from AgentLair with aud = resource URL
 *   const aat = await fetch('https://agentlair.dev/v1/tokens/issue', {
 *     method: 'POST',
 *     headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ aud: resourceUrl, scopes: ['data:read'] }),
 *   }).then(r => r.json()).then(r => r.token);
 *
 *   // 2. Pack AAT into payment payload before sending X-PAYMENT header
 *   const payload = buildAATAudienceBoundPayment(aat, resourceUrl, basePayment);
 *   const xPaymentHeader = btoa(JSON.stringify(payload));
 */
export function buildAATAudienceBoundPayment(
  aat: string,
  _resourceUrl: string,
  paymentPayload: X402PaymentPayload,
  opts?: { jwksUri?: string },
): X402PaymentPayload {
  // Audience binding happens at AAT issuance. This helper just packs it in.
  return packAATIntoX402Extensions(aat, paymentPayload, {
    jwksUri: opts?.jwksUri,
    audBound: true,
  });
}
