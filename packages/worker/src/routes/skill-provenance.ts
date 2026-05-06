/**
 * skill-provenance.ts — POST /v1/verify-skill
 *
 * Public endpoint. Verifies a Skill Provenance Attestation (SPA) JWT.
 * Checks:
 *   1. JWT is well-formed (3 parts, EdDSA/spa+jwt header)
 *   2. Ed25519 signature verifies against agentlair.dev JWKS
 *   3. Computed skill_digest matches the digest in JWT claims
 *
 * Exports pure functions for unit testing without HTTP overhead.
 */

import { Hono } from 'hono';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  digest_match: boolean;
  signer: string | null;
  errors: string[];
  computed_digest: string;
  claimed_digest: string;
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

function b64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── Pure functions (exported for testing) ───────────────────────────────────

/**
 * Compute the canonical SPA skill_digest for a set of uploaded files.
 *
 * Algorithm (from SPA spec):
 *   for each file in files, sorted by path (lexicographic):
 *     digest_input += path_utf8 || 0x00 || sha256(content) || 0x0A
 *   skill_digest = "sha256-" + base64url(sha256(digest_input))
 */
export async function computeSkillDigest(
  files: { path: string; content: Uint8Array }[],
): Promise<string> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const parts: Uint8Array[] = [];
  for (const file of sorted) {
    const fileHash = new Uint8Array(await crypto.subtle.digest('SHA-256', file.content));
    const pathBytes = new TextEncoder().encode(file.path);
    // relpath (UTF-8) || 0x00 || sha256(content) (32 bytes) || 0x0A
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
  return `sha256-${b64urlEncode(digest.buffer)}`;
}

/**
 * Verify a SPA JWT string against a JWKS source.
 *
 * @param jwtStr      The raw spa+jwt string from SKILL.sig
 * @param jwksFetcher Injectable function that returns the JWKS — lets tests mock network
 * @param files       Decoded skill files for digest computation
 */
export async function verifySkillJwt(
  jwtStr: string,
  jwksFetcher: () => Promise<{ keys?: unknown[] }>,
  files: { path: string; content: Uint8Array }[],
): Promise<VerifyResult> {
  const parts = jwtStr.trim().split('.');
  if (parts.length !== 3) {
    return {
      valid: false,
      digest_match: false,
      signer: null,
      errors: [`invalid_jwt: expected 3 parts, got ${parts.length}`],
      computed_digest: '',
      claimed_digest: '',
    };
  }

  const [headerB64, claimsB64, sigB64] = parts;

  let header: { alg?: string; kid?: string; typ?: string };
  let claims: { skill_digest?: string; publisher?: { handle?: string }; exp?: number };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64)));
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(claimsB64)));
  } catch {
    return {
      valid: false,
      digest_match: false,
      signer: null,
      errors: ['invalid_jwt: failed to parse header or claims'],
      computed_digest: '',
      claimed_digest: '',
    };
  }

  const claimed_digest = claims.skill_digest ?? '';
  const signer = claims.publisher?.handle ?? null;

  // Compute digest from uploaded files
  const computed_digest = await computeSkillDigest(files);
  const digest_match = computed_digest === claimed_digest;

  // Validate header fields
  const errors: string[] = [];
  if (header.typ !== 'spa+jwt') {
    errors.push(`invalid_typ: expected spa+jwt, got ${header.typ}`);
  }
  if (header.alg !== 'EdDSA') {
    errors.push(`invalid_alg: expected EdDSA, got ${header.alg}`);
  }
  if (errors.length > 0) {
    return { valid: false, digest_match, signer, errors, computed_digest, claimed_digest };
  }

  // Fetch JWKS
  let jwks: { keys?: unknown[] };
  try {
    jwks = await jwksFetcher();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      valid: false,
      digest_match,
      signer,
      errors: [`jwks_fetch_failed: ${msg}`],
      computed_digest,
      claimed_digest,
    };
  }

  // Find matching key
  const kid = header.kid;
  const jwkKey = (jwks.keys ?? []).find((k: unknown) => {
    const key = k as { kid?: string };
    return key.kid === kid;
  });

  if (!jwkKey) {
    return {
      valid: false,
      digest_match,
      signer,
      errors: ['kid_not_found'],
      computed_digest,
      claimed_digest,
    };
  }

  // Import Ed25519 public key and verify signature
  let pubKey: CryptoKey;
  try {
    pubKey = await crypto.subtle.importKey(
      'jwk',
      jwkKey as JsonWebKey,
      { name: 'Ed25519' } as Algorithm,
      false,
      ['verify'],
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      valid: false,
      digest_match,
      signer,
      errors: [`key_import_failed: ${msg}`],
      computed_digest,
      claimed_digest,
    };
  }

  const signingInput = `${headerB64}.${claimsB64}`;
  const sigBytes = b64urlDecode(sigB64);
  const signingInputBytes = new TextEncoder().encode(signingInput);

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      { name: 'Ed25519' } as Algorithm,
      pubKey,
      sigBytes,
      signingInputBytes,
    );
  } catch {
    // treat as invalid
  }

  if (!valid) {
    errors.push('signature_invalid');
  }

  return { valid, digest_match, signer, errors, computed_digest, claimed_digest };
}

// ─── Hono router ─────────────────────────────────────────────────────────────

export const skillProvenanceRoutes = new Hono();

const AGENTLAIR_JWKS_URL = 'https://agentlair.dev/.well-known/jwks.json';

skillProvenanceRoutes.post('/verify-skill', async (c) => {
  let body: { skill_sig?: unknown; files?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ valid: false, errors: ['invalid_json'] }, 400);
  }

  const { skill_sig, files } = body;

  if (typeof skill_sig !== 'string' || !Array.isArray(files)) {
    return c.json(
      { valid: false, errors: ['invalid_request: skill_sig (string) and files (array) required'] },
      400,
    );
  }

  // Decode each file's base64 content
  const decodedFiles: { path: string; content: Uint8Array }[] = [];
  for (const f of files) {
    const file = f as { path?: unknown; content_base64?: unknown };
    if (typeof file.path !== 'string' || typeof file.content_base64 !== 'string') {
      return c.json(
        { valid: false, errors: ['invalid_file: each file needs path (string) and content_base64 (string)'] },
        400,
      );
    }
    try {
      const bin = atob(file.content_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      decodedFiles.push({ path: file.path, content: bytes });
    } catch {
      return c.json({ valid: false, errors: [`invalid_base64: ${file.path}`] }, 400);
    }
  }

  const jwksFetcher = async (): Promise<{ keys?: unknown[] }> => {
    const res = await fetch(AGENTLAIR_JWKS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const result = await verifySkillJwt(skill_sig, jwksFetcher, decodedFiles);
  return c.json(result);
});
