/**
 * CAF → COSE_Sign1 (SCITT Wrapper)
 *
 * Implements Option A from the SCITT alignment audit:
 * Wraps CAF attestations in COSE_Sign1 envelopes for SCITT interoperability.
 *
 * No external CBOR/COSE dependencies — uses a hand-rolled minimal encoder
 * that covers exactly what COSE_Sign1 requires. Zero new npm packages.
 *
 * References:
 * - RFC 9052: COSE structures (CBOR Object Signing and Encryption)
 * - RFC 8392: CWT (CBOR Web Tokens)
 * - RFC 9597: CWT Claims in COSE Headers (label 13)
 * - draft-ietf-scitt-architecture-22: Signed Statements
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import type { CommitmentAttestation, SubjectId } from './caf.js';

// ─── COSE / CWT Label Constants ───────────────────────────────────────────────

/** COSE protected header label: algorithm */
const HDR_ALG = 1;
/** COSE protected header label: content-type */
const HDR_CONTENT_TYPE = 3;
/** COSE protected header label: kid (key ID) */
const HDR_KID = 4;
/** COSE protected header label: CWT Claims (RFC 9597) — label 15 */
const HDR_CWT_CLAIMS = 15;

/** COSE algorithm value: EdDSA (Ed25519, OKP curve) — RFC 9053 §2.2 */
const ALG_EDDSA = -8;

/** CWT claim labels (RFC 8392 §4) */
const CWT_ISS = 1;  // issuer
const CWT_SUB = 2;  // subject
const CWT_IAT = 6;  // issued-at (NumericDate)

/** CBOR tag for COSE_Sign1 (RFC 9052 §4.2) */
const TAG_COSE_SIGN1 = 18;

// ─── Minimal CBOR Encoder ─────────────────────────────────────────────────────
//
// Covers only the subset needed for COSE_Sign1:
//   - Unsigned integers (for header labels and timestamps)
//   - Negative integers (for algorithm values like EdDSA = -8)
//   - Byte strings  (for protected header blob, payload, signature)
//   - Text strings  (for content-type, kid, CWT URI values)
//   - Arrays        (for COSE_Sign1 structure and Sig_Structure)
//   - Maps          (for headers and CWT claims)
//   - Tags          (for COSE_Sign1 tag 18)

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

/** Encode CBOR initial byte + argument (up to 32-bit values). */
function cborHead(mt: number, arg: number): Uint8Array {
  const base = mt << 5;
  if (arg <= 23)    return new Uint8Array([base | arg]);
  if (arg <= 0xff)  return new Uint8Array([base | 24, arg]);
  if (arg <= 0xffff) return new Uint8Array([base | 25, arg >> 8, arg & 0xff]);
  if (arg <= 0xffffffff) return new Uint8Array([
    base | 26,
    (arg >>> 24) & 0xff, (arg >>> 16) & 0xff,
    (arg >>> 8)  & 0xff,  arg         & 0xff,
  ]);
  throw new Error('cborHead: value exceeds 32 bits');
}

export function cborUint(n: number): Uint8Array {
  if (n < 0) throw new Error('cborUint: negative value');
  return cborHead(0, n);
}

export function cborNegint(n: number): Uint8Array {
  if (n >= 0) throw new Error('cborNegint: expected negative value');
  return cborHead(1, -n - 1);  // CBOR major type 1: value = (-n - 1)
}

export function cborBytes(bytes: Uint8Array): Uint8Array {
  return concat(cborHead(2, bytes.length), bytes);
}

export function cborText(s: string): Uint8Array {
  const encoded = new TextEncoder().encode(s);
  return concat(cborHead(3, encoded.length), encoded);
}

export function cborArray(items: Uint8Array[]): Uint8Array {
  return concat(cborHead(4, items.length), ...items);
}

/** Encode a CBOR map from key-value pairs (already CBOR-encoded). */
export function cborMap(pairs: Array<[Uint8Array, Uint8Array]>): Uint8Array {
  return concat(cborHead(5, pairs.length), ...pairs.flatMap(([k, v]) => [k, v]));
}

export function cborTag(tag: number, value: Uint8Array): Uint8Array {
  return concat(cborHead(6, tag), value);
}

// ─── URI Mapping ──────────────────────────────────────────────────────────────

/**
 * Map a SubjectId / AttesterId to a URI string suitable for CWT iss/sub claims.
 *
 * Mapping rules (per SCITT alignment audit §3):
 * - agent   → "agentlair:acc_xxx"         (custom URI scheme)
 * - did     → pass through ("did:web:...") (already a DID URI)
 * - human   → pass through ("bankid:...") (provider-scoped URI)
 * - business → pass through ("brreg:...") (registry-scoped URI)
 * - url     → pass through ("https://...") (already a URI)
 */
export function subjectIdToUri(id: SubjectId): string {
  switch (id.type) {
    case 'agent':    return `agentlair:${id.id}`;
    case 'did':      return id.id;       // already a URI
    case 'human':    return id.id;       // e.g. "bankid:pno-NO-xxx"
    case 'business': return id.id;       // e.g. "brreg:923456789"
    case 'url':      return id.id;       // e.g. "https://example.com"
    default:         return (id as { id: string }).id;
  }
}

// ─── Internal COSE helpers ────────────────────────────────────────────────────

/**
 * Derive the key ID used in the COSE header (matches computeKid in caf.ts).
 * First 8 hex chars of SHA-256 of the Ed25519 public key.
 */
async function deriveKid(privateKeyB64: string): Promise<string> {
  const privBytes = Uint8Array.from(atob(privateKeyB64), c => c.charCodeAt(0));
  const pubBytes  = ed25519.getPublicKey(privBytes);
  // ArrayBuffer.prototype.slice creates a proper ArrayBuffer (not ArrayBufferLike)
  const buf = ArrayBuffer.prototype.slice.call(
    pubBytes.buffer, pubBytes.byteOffset, pubBytes.byteOffset + pubBytes.byteLength,
  ) as ArrayBuffer;
  const hashBuf   = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8);
}

/**
 * Build and CBOR-encode the COSE protected header map.
 *
 * Structure (integer-keyed CBOR map):
 *   { 1: -8,                      // alg: EdDSA
 *     3: "application/caf+json",  // content-type
 *     4: "<kid>",                 // key ID (text)
 *    13: { 1: "<iss>",            // cwt_claims.iss
 *           2: "<sub>",           //            sub
 *           6: <iat> } }          //            iat (NumericDate)
 */
function buildProtectedHeader(opts: {
  kid: string;
  iss: string;
  sub: string;
  iat: number;
}): Uint8Array {
  const cwtClaims = cborMap([
    [cborUint(CWT_ISS), cborText(opts.iss)],
    [cborUint(CWT_SUB), cborText(opts.sub)],
    [cborUint(CWT_IAT), cborUint(opts.iat)],
  ]);

  return cborMap([
    [cborUint(HDR_ALG),          cborNegint(ALG_EDDSA)],
    [cborUint(HDR_CONTENT_TYPE), cborText('application/caf+json')],
    [cborUint(HDR_KID),          cborText(opts.kid)],
    [cborUint(HDR_CWT_CLAIMS),   cwtClaims],
  ]);
}

/**
 * Build the COSE Sig_Structure used as the signing input (RFC 9052 §4.4).
 *
 *   Sig_Structure = [
 *     "Signature1",     ; context string
 *     bstr(protected),  ; CBOR-encoded protected header bytes
 *     bstr(""),         ; external_aad — empty for our use case
 *     bstr(payload),    ; payload bytes
 *   ]
 */
function buildSigStructure(protectedBytes: Uint8Array, payloadBytes: Uint8Array): Uint8Array {
  return cborArray([
    cborText('Signature1'),
    cborBytes(protectedBytes),
    cborBytes(new Uint8Array(0)),  // empty external_aad
    cborBytes(payloadBytes),
  ]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Wrap a CAF attestation in a COSE_Sign1 envelope (SCITT Signed Statement).
 *
 * The COSE_Sign1 structure:
 *   tag(18, [
 *     bstr(protected_header),   // CBOR map with alg, content-type, kid, CWT claims
 *     {},                       // empty unprotected header
 *     bstr(payload),            // full CAF attestation JSON (UTF-8)
 *     bstr(signature),          // Ed25519 over Sig_Structure
 *   ])
 *
 * The signing input follows RFC 9052 §4.4:
 *   Ed25519( Sig_Structure(protected_header_bytes, payload_bytes) )
 *
 * @param attestation  - Complete CAF attestation (including id and sig fields)
 * @param signingKeyB64 - Base64-encoded Ed25519 private key (same key used for CAF sig)
 * @returns            - CBOR-encoded COSE_Sign1 bytes with tag 18
 */
export async function cafToSignedStatement(
  attestation: CommitmentAttestation,
  signingKeyB64: string,
): Promise<Uint8Array> {
  // Derive kid (deterministic, matches JWKS endpoint)
  const kid = await deriveKid(signingKeyB64);

  // Map CAF identity fields to CWT URIs
  const iss = subjectIdToUri(attestation.attester);
  const sub = subjectIdToUri(attestation.subject);

  // CWT iat = ISO 8601 timestamp → Unix seconds (NumericDate)
  const iat = Math.floor(new Date(attestation.timestamp).getTime() / 1000);

  // Build and encode the protected header
  const protectedBytes = buildProtectedHeader({ kid, iss, sub, iat });

  // Payload = full CAF attestation as UTF-8 JSON
  // Including id and sig so the COSE envelope carries the complete auditable record
  const payloadBytes = new TextEncoder().encode(JSON.stringify(attestation));

  // Compute Ed25519 signature over Sig_Structure (RFC 9052 §4.4)
  const sigStructure  = buildSigStructure(protectedBytes, payloadBytes);
  const privBytes     = Uint8Array.from(atob(signingKeyB64), c => c.charCodeAt(0));
  const signatureBytes = ed25519.sign(sigStructure, privBytes);

  // Assemble COSE_Sign1 array with CBOR tag 18
  const coseSign1 = cborArray([
    cborBytes(protectedBytes),         // protected: bstr (CBOR-encoded)
    cborMap([]),                       // unprotected: {} (empty map)
    cborBytes(payloadBytes),           // payload: bstr
    cborBytes(signatureBytes),         // signature: bstr
  ]);

  return cborTag(TAG_COSE_SIGN1, coseSign1);
}
