/**
 * AgentLair JWT Module — Agent Token (AAT) signing and verification
 *
 * Creates EdDSA-signed JWTs using Ed25519 (via @noble/curves).
 * Public key exposed via JWKS endpoint for third-party verification.
 *
 * Design:
 * - Reuses AUDIT_SIGNING_KEY (same Ed25519 key used for audit log signing)
 * - Key ID (kid) is first 8 chars of SHA-256 hash of the public key
 * - JWTs include AgentLair-specific claims (al_name, al_email, al_scopes)
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { base58btcEncode } from './lib/base58btc.js';

// ─── Base64url helpers ────────────────────────────────────────────────────────

export function b64urlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(b64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

// ─── Key operations ───────────────────────────────────────────────────────────

/**
 * Derive Ed25519 public key from base64-encoded 32-byte private key.
 */
export function getPublicKey(privateKeyB64: string): Uint8Array {
  const privateKeyBytes = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));
  return ed25519.getPublicKey(privateKeyBytes);
}

/**
 * Compute a deterministic key ID from the public key.
 * First 8 chars of SHA-256 hex — short but unique enough for key rotation.
 */
export async function computeKeyId(publicKeyBytes: Uint8Array): Promise<string> {
  // Convert to ArrayBuffer for CF Workers type compatibility
  const buf = ArrayBuffer.prototype.slice.call(
    publicKeyBytes.buffer,
    publicKeyBytes.byteOffset,
    publicKeyBytes.byteOffset + publicKeyBytes.byteLength,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 8);
}

/**
 * Convert Ed25519 public key to JWK format (RFC 8037).
 */
export async function publicKeyToJWK(
  publicKeyBytes: Uint8Array,
  kid: string,
): Promise<Record<string, string>> {
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: b64urlEncode(publicKeyBytes),
    kid,
    use: 'sig',
    alg: 'EdDSA',
  };
}

// ─── JWT claims ───────────────────────────────────────────────────────────────

export interface AATClaims {
  // Standard JWT claims
  iss: string; // "https://agentlair.dev"
  sub: string; // AgentLair account ID
  aud: string; // Target audience URL
  exp: number; // Expiration (Unix seconds)
  iat: number; // Issued at (Unix seconds)
  jti: string; // Unique token ID

  // DID claim — MCP-I Level 2 interop (did:web anchored to JWKS at .well-known)
  did?: string; // e.g. "did:web:agentlair.dev:agents:acc_xxx"

  // AgentLair-specific claims
  al_name?: string; // Agent's registered name
  al_email?: string; // Agent's email address
  al_scopes: string[]; // Requested scopes
  al_audit_url: string; // Audit trail link

  // Radicle NID binding — present iff the agent has registered an RFC 9421
  // signing key. Format: did:key:z6Mk... (Ed25519 → multicodec 0xed01 → base58btc).
  // External verifiers cross-reference this against Radicle repo delegate lists.
  al_nid?: string;

  // Trust attestation — RFC-001 IdP: embedded trust score snapshot
  // Present when agent has sufficient behavioral history (>= 10 observations)
  al_trust?: {
    score: number; // [0, 100]
    level: 'intern' | 'junior' | 'senior' | 'principal';
    confidence: number; // [0.0, 1.0]
    computed_at: string; // ISO 8601
    trend: 'improving' | 'stable' | 'declining';
  };

  // L3 credential claims — VI-compatible transaction-scoped (FIDO Agentic Auth Gap 2)
  // Present only in tokens issued via POST /v1/tokens/issue-l3
  al_l3?: true; // Marker: this is a transaction-scoped L3 credential
  al_transaction_id?: string; // VI transaction ID (mirrors aud for routing)
  al_checkout_hash?: string; // Hash of checkout payload (opaque string, stored as-is)
  al_mandate_hash?: string; // SHA-256 of l2_mandate, base64url-encoded
}

// ─── JWT creation ─────────────────────────────────────────────────────────────

/**
 * Create and sign a JWT with Ed25519 (EdDSA algorithm).
 *
 * @param claims   JWT payload claims
 * @param privateKeyB64  Base64-encoded 32-byte Ed25519 private key
 * @param kid      Key ID for the JWKS endpoint
 * @returns Compact JWT string (header.payload.signature)
 */
export function createJWT(claims: AATClaims, privateKeyB64: string, kid: string): string {
  // Header
  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid,
  };

  // Encode header and payload
  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(claims));

  // Sign header.payload
  const signingInput = `${headerB64}.${payloadB64}`;
  const messageBytes = new TextEncoder().encode(signingInput);
  const privateKeyBytes = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));
  const signatureBytes = ed25519.sign(messageBytes, privateKeyBytes);

  // Encode signature
  const signatureB64 = b64urlEncode(signatureBytes);

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Verify a JWT signature (for testing / introspection).
 *
 * @param token          Compact JWT string
 * @param publicKeyBytes Ed25519 public key (32 bytes)
 * @returns Parsed claims if valid, null if signature invalid
 */
export function verifyJWT(token: string, publicKeyBytes: Uint8Array): AATClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const messageBytes = new TextEncoder().encode(signingInput);

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = b64urlDecode(signatureB64);
  } catch {
    return null; // Invalid base64url
  }

  try {
    const valid = ed25519.verify(signatureBytes, messageBytes, publicKeyBytes);
    if (!valid) return null;
  } catch {
    return null;
  }

  // Decode payload
  try {
    const payloadJson = new TextDecoder().decode(b64urlDecode(payloadB64));
    return JSON.parse(payloadJson) as AATClaims;
  } catch {
    return null;
  }
}

// ─── JWS signing (generic JSON payloads) ─────────────────────────────────────

/**
 * Sign an arbitrary JSON payload using JWS Compact Serialization (RFC 7515).
 * Uses EdDSA / Ed25519 — same key as AAT signing.
 *
 * Returns a JWS compact string: header.payload.signature
 *
 * Header includes `jku` (JWK Set URL) so verifiers can resolve the key
 * without prior configuration.
 */
export function signJWS(
  payload: Record<string, unknown>,
  privateKeyB64: string,
  kid: string,
  jku?: string,
): string {
  const header: Record<string, string> = {
    alg: 'EdDSA',
    kid,
  };
  if (jku) header.jku = jku;

  const headerB64 = b64urlEncode(JSON.stringify(header));
  const payloadB64 = b64urlEncode(JSON.stringify(payload));

  const signingInput = `${headerB64}.${payloadB64}`;
  const messageBytes = new TextEncoder().encode(signingInput);
  const privateKeyBytes = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));
  const signatureBytes = ed25519.sign(messageBytes, privateKeyBytes);

  return `${headerB64}.${payloadB64}.${b64urlEncode(signatureBytes)}`;
}

/**
 * Verify a JWS compact string against a known Ed25519 public key.
 * Returns parsed payload if valid, null otherwise.
 */
export function verifyJWS(jws: string, publicKeyBytes: Uint8Array): Record<string, unknown> | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const messageBytes = new TextEncoder().encode(signingInput);

  try {
    const signatureBytes = b64urlDecode(signatureB64);
    if (!ed25519.verify(signatureBytes, messageBytes, publicKeyBytes)) return null;
  } catch {
    return null;
  }

  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── JWKS document builder ────────────────────────────────────────────────────

/**
 * Build a JWKS document containing the AgentLair signing public key(s).
 *
 * Multi-key design (algorithm agility):
 * The `keys` array intentionally supports multiple entries. When a future
 * ML-DSA (FIPS 204, PQ Phase 1) key is added alongside the EdDSA key,
 * existing verifiers will continue to work without modification — they
 * simply ignore keys whose `alg` or `kid` they don't recognise.
 *
 * Verifier contract:
 * - Verifiers MUST select the key by matching `kid` from the JWT header
 *   against the `kid` field of each JWK entry. Do NOT select by position.
 * - Verifiers MUST reject tokens whose `kid` has no matching entry in the set.
 * - Each JWK entry includes an explicit `alg` field so verifiers can assert
 *   the expected algorithm before processing the key material.
 *
 * Current keys:
 * - EdDSA / Ed25519 (AUDIT_SIGNING_KEY)  — active, all AATs signed with this
 * - ML-DSA / FIPS 204                    — planned, PQ Phase 1 (post-2028)
 */
// Multicodec prefix for ed25519-pub: 0xed 0x01 (varint)
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

/**
 * Derive a Radicle-compatible Node ID (did:key encoded Ed25519 pubkey) from
 * raw 32-byte Ed25519 public key material.
 *
 * Format: "did:key:z" + base58btc(multicodec(0xed01) || pubkey)
 *
 * Verified against the Radicle reference standard (z6Mk prefix). Pure
 * deterministic transform — no I/O, no key generation.
 *
 * Source: /workspace/tools/radicle-nid-poc.ts (2026-05-15 PoC).
 */
export function pubkeyToRadicleNid(publicKeyBytes: Uint8Array): string {
  // Prepend multicodec prefix
  const prefixed = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + publicKeyBytes.length);
  prefixed.set(ED25519_MULTICODEC_PREFIX);
  prefixed.set(publicKeyBytes, ED25519_MULTICODEC_PREFIX.length);
  // Base58btc encode with `z` multibase prefix
  return 'did:key:z' + base58btcEncode(prefixed);
}

export async function buildJWKS(privateKeyB64: string): Promise<{ keys: Record<string, string>[] }> {
  const publicKeyBytes = getPublicKey(privateKeyB64);
  const kid = await computeKeyId(publicKeyBytes);
  const jwk = await publicKeyToJWK(publicKeyBytes, kid);
  // Future PQ key goes here: push({ kty:'OKP', crv:'ML-DSA-65', alg:'MLDSA65', ... })
  return { keys: [jwk] };
}
