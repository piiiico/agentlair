/**
 * PoPA COSE Helpers — shared between the daily emitter and the public
 * /v1/scitt/* read paths.
 *
 * The PoPA daily attestation is produced once per (DID, UTC day) by the
 * cron, then frozen forever in the SCITT log. Whenever a verifier needs
 * to RE-CONSTRUCT the signed statement (e.g. for /verify-receipt UX),
 * we replay the exact same encoding here.
 *
 * The reconstruction is deterministic: same row + same signing key →
 * byte-identical COSE_Sign1 envelope.
 *
 * Why not just store the bytes? The receipt table only stores the
 * Merkle inclusion proof; the signed statement itself is recomputable
 * from popa_attestations + the signing key. Adding a column would mean
 * a migration on a hot table; reconstruction is cheap (sub-ms) and
 * keeps the data model lean.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import {
  cborUint,
  cborNegint,
  cborBytes,
  cborText,
  cborArray,
  cborMap,
  cborTag,
} from '../caf-scitt.js';
import { sha256hex } from '../utils.js';

// ─── COSE / SCITT label constants ────────────────────────────────────────────
export const HDR_ALG = 1;
export const HDR_CONTENT_TYPE = 3;
export const ALG_EDDSA = -8;
export const TAG_COSE_SIGN1 = 18;

/** SCITT: issuer header label per draft-ietf-scitt-architecture-22 §6 */
export const HDR_ISSUER = 391;

/** AgentLair root DID — issuer for v1 PoPA attestations (single-key v1) */
export const AGENTLAIR_ROOT_DID = 'did:web:agentlair.dev';

// ─── Canonicalization (sorted-key JSON.stringify) ────────────────────────────
/**
 * Recursively serialize `value` to JSON with sorted object keys.
 *
 * NOT strict JCS (RFC 8785) — sufficient for our schemas because keys are
 * ASCII-only and we don't normalise Number formatting. Verifiers MUST use
 * the same algorithm.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k]));
  return '{' + parts.join(',') + '}';
}

// ─── PoPA-specific COSE assembly ─────────────────────────────────────────────
export function buildPoPAProtectedHeader(sequence: number): Uint8Array {
  return cborMap([
    [cborUint(HDR_ALG),          cborNegint(ALG_EDDSA)],
    [cborUint(HDR_CONTENT_TYPE), cborText('application/popa+json')],
    [cborUint(HDR_ISSUER),       cborText(AGENTLAIR_ROOT_DID)],
    [cborText('PoPA-sequence'),  cborUint(sequence)],
  ]);
}

export function buildSigStructure(
  protectedBytes: Uint8Array,
  payloadBytes: Uint8Array,
): Uint8Array {
  return cborArray([
    cborText('Signature1'),
    cborBytes(protectedBytes),
    cborBytes(new Uint8Array(0)),  // empty external_aad
    cborBytes(payloadBytes),
  ]);
}

export function arrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Minimal row shape needed to reconstruct the signed statement.
 * Matches the columns of popa_attestations + window arithmetic the
 * emitter performed at the time.
 */
export interface PopaAttestationRow {
  agent_did: string;
  entry_id: string;
  sequence: number;
  window_start: string;
  window_end: string;
  mcp_call_count: number;
  /** ISO timestamp the attestation was issued — equals popa_attestations row mtime */
  issued_at: string;
  /** Previous attestation ID for this DID (`scitt:popa_xxx`), or null on first */
  prev_attestation_id: string | null;
}

export interface ReconstructedSignedStatement {
  /** Full COSE_Sign1 envelope bytes (CBOR-tagged 18) */
  coseBytes: Uint8Array;
  /** Inner CBOR-encoded protected header (bstr contents) */
  protectedBytes: Uint8Array;
  /** Canonical JSON payload bytes (UTF-8) */
  payloadBytes: Uint8Array;
  /** Sig_Structure bytes — the input to Ed25519 verification */
  signingInputBytes: Uint8Array;
  /** Detached signature bytes */
  signatureBytes: Uint8Array;
  /** Parsed claim object (the JSON the user actually cares about) */
  claim: PopaAttestationCore;
}

export interface PopaAttestationCore {
  agent_did: string;
  timestamp: string;
  window_start: string;
  window_end: string;
  activity_proof: {
    type: 'mcp_call_count';
    count: number;
    window_hash: string;
  };
  prev_attestation_id: string | null;
  sequence: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Reconstruct the full signed statement (COSE_Sign1 with detached components
 * for verification) from a popa_attestations row.
 *
 * Determinism: given the same row + signing key, the output is byte-identical
 * to what the emitter wrote at attestation time.
 */
export async function reconstructPopaSignedStatement(
  row: PopaAttestationRow,
  signingKeyB64: string,
): Promise<ReconstructedSignedStatement> {
  // Recompute window_hash exactly as the emitter did
  const windowHashInput = canonicalJSON({
    count: row.mcp_call_count,
    window_start: row.window_start,
    window_end: row.window_end,
  });
  const windowHash = 'sha256:' + (await sha256hex(windowHashInput));

  const claim: PopaAttestationCore = {
    agent_did: row.agent_did,
    timestamp: row.issued_at,
    window_start: row.window_start,
    window_end: row.window_end,
    activity_proof: {
      type: 'mcp_call_count',
      count: row.mcp_call_count,
      window_hash: windowHash,
    },
    prev_attestation_id: row.prev_attestation_id,
    sequence: row.sequence,
  };

  const canonical = canonicalJSON(claim);
  const payloadBytes = new TextEncoder().encode(canonical);

  const protectedBytes = buildPoPAProtectedHeader(row.sequence);
  const signingInputBytes = buildSigStructure(protectedBytes, payloadBytes);

  const privBytes = Uint8Array.from(atob(signingKeyB64), (c) => c.charCodeAt(0));
  const signatureBytes = ed25519.sign(signingInputBytes, privBytes);

  const coseSign1 = cborArray([
    cborBytes(protectedBytes),         // protected: bstr (CBOR-encoded)
    cborMap([]),                       // unprotected: {}
    cborBytes(payloadBytes),           // payload: bstr
    cborBytes(signatureBytes),         // signature: bstr
  ]);
  const coseBytes = cborTag(TAG_COSE_SIGN1, coseSign1);

  return {
    coseBytes,
    protectedBytes,
    payloadBytes,
    signingInputBytes,
    signatureBytes,
    claim,
  };
}
