/**
 * @agentlair/spa-verifier — Pure verification core
 *
 * Web Crypto + zero deps. Runs in Node.js, Bun, Deno, Cloudflare Workers,
 * Vercel Edge, browsers — anywhere `crypto.subtle` exists.
 *
 * No filesystem access here. If you have a skill on disk, use the top-level
 * `verifySpa(skillDir, ...)` from `@agentlair/spa-verifier`. If you have files
 * already in memory (registry servers, scanners), use this module directly.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * One file from a skill directory, with its content as raw bytes.
 * `path` MUST be a forward-slash-joined relative path (POSIX), NOT a Windows path.
 */
export interface SkillFile {
  path: string;
  content: Uint8Array;
}

/**
 * Decoded SPA JWT header.
 *
 * Spec: alg = "EdDSA", typ = "spa+jwt", kid is required.
 */
export interface SpaHeader {
  alg: string;
  typ: string;
  kid: string;
}

/**
 * Publisher block from SPA claims.
 */
export interface SpaPublisher {
  handle: string;
  display_name?: string;
  domain?: string;
  verified_at?: string;
}

/**
 * SPA JWT claim set. Fields beyond the spec are preserved for forward compat.
 *
 * @see https://agentlair.dev/blog/skill-provenance-attestation/
 */
export interface SpaClaims {
  iss: string;
  sub?: string;
  aud?: string;
  iat: number;
  exp: number;
  jti?: string;
  skill_name: string;
  skill_version?: string;
  skill_digest: string;
  publisher: SpaPublisher;
  revocation_url?: string;
  /** Set by the demo issuer to mark a non-production attestation. */
  _test?: boolean;
  [k: string]: unknown;
}

/**
 * A parsed (but not verified) SPA token. Use `verifySpaJwt` to validate.
 */
export interface ParsedSpa {
  header: SpaHeader;
  claims: SpaClaims;
  signingInput: string;
  signature: Uint8Array;
}

/**
 * JSON Web Key Set as fetched from a JWKS endpoint.
 */
export interface Jwks {
  keys?: unknown[];
}

/**
 * Result returned by `verifySpaJwt` and `verifySpa`.
 *
 * - `verified` = true means the signature is valid AND the digest in the
 *   claims matches what was computed from the supplied files.
 * - `verified` = false means at least one check failed; see `errors` and
 *   `digest_match` / `signature_valid` for the breakdown.
 */
export interface SpaVerifyResult {
  verified: boolean;
  signature_valid: boolean;
  digest_match: boolean;
  signer: string | null;
  computed_digest: string;
  claimed_digest: string;
  /** Decoded claims if the JWT was well-formed; `null` on parse failure. */
  claims: SpaClaims | null;
  errors: string[];
}

/**
 * Options for `verifySpaJwt`.
 */
export interface VerifySpaJwtOptions {
  /**
   * URL to fetch the JWKS from. Default is the issuer in the JWT claims:
   * `${claims.iss}/.well-known/jwks.json`.
   */
  jwksUrl?: string;
  /**
   * Pre-loaded JWKS object. If supplied, no network fetch is performed.
   * Useful for offline verification, tests, and edge environments where
   * the JWKS is bundled.
   */
  localJwks?: Jwks;
}

// ─── Encoding helpers ────────────────────────────────────────────────────────

function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── Pure functions ──────────────────────────────────────────────────────────

/**
 * Compute the canonical SPA `skill_digest` from a set of files.
 *
 * Algorithm (from the SPA spec — must be byte-for-byte identical to the
 * AgentLair `/v1/verify-skill` endpoint):
 *
 * 1. Sort files by `path` (lexicographic, UTF-8 bytewise).
 * 2. For each file, append: `path_bytes` || `0x00` || `sha256(content)` (32 bytes) || `0x0A`.
 * 3. `skill_digest` = `"sha256-" + base64url(sha256(concatenated_input))`.
 *
 * Caller is responsible for filtering out excluded paths (`SKILL.sig`, top-level
 * dotfiles, `.git/**`). The `readSkillDir` helper in the main entry point does this.
 *
 * @param files - Files to digest. `path` must be a POSIX relative path.
 * @returns A `sha256-<base64url>` digest string.
 */
export async function computeDigest(files: SkillFile[]): Promise<string> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const parts: Uint8Array[] = [];
  for (const file of sorted) {
    // Cast: Web Crypto types use Uint8Array<ArrayBuffer>, but Uint8Array<ArrayBufferLike>
    // is fine at runtime — node:fs and TextEncoder both produce ArrayBuffer-backed views.
    const fileHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', file.content as BufferSource),
    );
    const pathBytes = new TextEncoder().encode(file.path);
    parts.push(pathBytes, new Uint8Array([0x00]), fileHash, new Uint8Array([0x0a]));
  }

  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const digestInput = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    digestInput.set(p, offset);
    offset += p.length;
  }

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput));
  return `sha256-${b64urlEncode(digest)}`;
}

/**
 * Parse an SPA JWT into its three parts WITHOUT verifying the signature.
 *
 * Throws on malformed input. Use this for header inspection (e.g. choosing
 * a JWKS URL) before calling `verifySpaJwt`.
 */
export function parseSpaToken(jwtStr: string): ParsedSpa {
  const parts = jwtStr.trim().split('.');
  if (parts.length !== 3) {
    throw new Error(`invalid_jwt: expected 3 parts, got ${parts.length}`);
  }

  const [headerB64, claimsB64, sigB64] = parts;

  let header: SpaHeader;
  let claims: SpaClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64))) as SpaHeader;
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(claimsB64))) as SpaClaims;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid_jwt: failed to parse header or claims: ${msg}`);
  }

  return {
    header,
    claims,
    signingInput: `${headerB64}.${claimsB64}`,
    signature: b64urlDecode(sigB64),
  };
}

/**
 * Verify an SPA JWT against a JWKS source AND a set of files.
 *
 * The result is `verified: true` only if both:
 *   1. The Ed25519 signature on the JWT is valid (signed by a key in the JWKS).
 *   2. `computeDigest(files)` matches `claims.skill_digest`.
 *
 * Either failure populates `errors` and sets `verified: false`. Inspect
 * `digest_match` / `signature_valid` to know which check failed.
 *
 * Network: by default, fetches `${claims.iss}/.well-known/jwks.json`. Pass
 * `localJwks` to skip the fetch entirely.
 *
 * @example Offline verification with bundled JWKS
 * ```ts
 * import { verifySpaJwt } from '@agentlair/spa-verifier/core';
 * import jwks from './agentlair-jwks.json' with { type: 'json' };
 *
 * const result = await verifySpaJwt(skillSig, files, { localJwks: jwks });
 * ```
 */
export async function verifySpaJwt(
  jwtStr: string,
  files: SkillFile[],
  opts: VerifySpaJwtOptions = {},
): Promise<SpaVerifyResult> {
  const errors: string[] = [];

  // Parse JWT
  let parsed: ParsedSpa;
  try {
    parsed = parseSpaToken(jwtStr);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      verified: false,
      signature_valid: false,
      digest_match: false,
      signer: null,
      computed_digest: '',
      claimed_digest: '',
      claims: null,
      errors: [msg],
    };
  }

  const { header, claims, signingInput, signature } = parsed;
  const claimed_digest = claims.skill_digest ?? '';
  const signer = claims.publisher?.handle ?? null;

  // Compute digest from supplied files
  const computed_digest = await computeDigest(files);
  const digest_match = computed_digest === claimed_digest;
  if (!digest_match) {
    errors.push('digest_mismatch');
  }

  // Header sanity
  if (header.typ !== 'spa+jwt') {
    errors.push(`invalid_typ: expected spa+jwt, got ${header.typ}`);
  }
  if (header.alg !== 'EdDSA') {
    errors.push(`invalid_alg: expected EdDSA, got ${header.alg}`);
  }

  // exp check
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < now) {
    errors.push(`expired: exp=${claims.exp} now=${now}`);
  }

  // Resolve JWKS source
  let jwks: Jwks | null = null;
  if (opts.localJwks) {
    jwks = opts.localJwks;
  } else {
    const jwksUrl = opts.jwksUrl ?? `${claims.iss}/.well-known/jwks.json`;
    try {
      const res = await fetch(jwksUrl);
      if (!res.ok) {
        errors.push(`jwks_fetch_failed: HTTP ${res.status}`);
      } else {
        jwks = (await res.json()) as Jwks;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`jwks_fetch_failed: ${msg}`);
    }
  }

  // Verify signature
  let signature_valid = false;
  if (jwks) {
    const jwkKey = (jwks.keys ?? []).find((k: unknown) => {
      const key = k as { kid?: string };
      return key.kid === header.kid;
    });

    if (!jwkKey) {
      errors.push(`kid_not_found: ${header.kid}`);
    } else {
      try {
        const pubKey = await crypto.subtle.importKey(
          'jwk',
          jwkKey as JsonWebKey,
          { name: 'Ed25519' } as Algorithm,
          false,
          ['verify'],
        );
        const signingInputBytes = new TextEncoder().encode(signingInput);
        signature_valid = await crypto.subtle.verify(
          { name: 'Ed25519' } as Algorithm,
          pubKey,
          signature as BufferSource,
          signingInputBytes,
        );
        if (!signature_valid) {
          errors.push('signature_invalid');
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`signature_verify_failed: ${msg}`);
      }
    }
  }

  return {
    verified: signature_valid && digest_match && errors.length === 0,
    signature_valid,
    digest_match,
    signer,
    computed_digest,
    claimed_digest,
    claims,
    errors,
  };
}
