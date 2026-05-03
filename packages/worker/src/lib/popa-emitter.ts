/**
 * PoPA Emitter — produces one daily Proof-of-Presence attestation per DID.
 *
 * Pipeline:
 *   1. Idempotency check (skip if row already exists for this window)
 *   2. Count platform activity in [windowStart, windowEnd) from audit_log
 *   3. Look up previous attestation for the same DID (for sequence + gap)
 *   4. Build attestation JSON per popa-spec-v1.md §"Attestation Format"
 *   5. Sign with EdDSA over canonicalized JSON (sorted-key JSON, NOT strict
 *      JCS — see "Canonicalization" note below)
 *   6. Wrap in COSE_Sign1 with PoPA-specific protected header
 *   7. Submit to the TransparencyService Durable Object's /append endpoint
 *   8. Compute gap_hours/gap_detected vs the previous attestation
 *   9. INSERT into popa_attestations
 *  10. Invalidate the KV cache for this DID
 *
 * Errors at any step return {status:'error', reason}. The function NEVER
 * throws — the daily cron must continue iterating other subscribers even
 * when one fails.
 *
 * Canonicalization (v1 limitation): the spec calls for JCS (RFC 8785).
 * v1 uses recursive `JSON.stringify` with sorted keys, which is
 * deterministic for our consumers but not strictly JCS-compliant
 * (no Number.toString(radix) normalization, no Unicode escape rules).
 * Verifiers must use the SAME serialization to recompute the signature.
 * Document this in coding-output.md.
 */

import type { Env } from '../types.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { nanoid, sha256hex } from '../utils.js';
import {
  cborUint,
  cborNegint,
  cborBytes,
  cborText,
  cborArray,
  cborMap,
  cborTag,
} from '../caf-scitt.js';

// ─── COSE / SCITT label constants (matches caf-scitt.ts) ─────────────────────
const HDR_ALG = 1;
const HDR_CONTENT_TYPE = 3;
const ALG_EDDSA = -8;
const TAG_COSE_SIGN1 = 18;

// SCITT: issuer header label per draft-ietf-scitt-architecture-22 §6
const HDR_ISSUER = 391;

// AgentLair root DID — issuer for v1 attestations (single-key v1)
const AGENTLAIR_ROOT_DID = 'did:web:agentlair.dev';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface EmitResult {
  status: 'emitted' | 'skipped' | 'error';
  entry_id?: string;
  sequence?: number;
  reason?: string;
}

interface PrevRow {
  entry_id: string;
  sequence: number;
  window_end: string;
}

// ─── Canonicalization (sorted-key JSON.stringify) ────────────────────────────
/**
 * Recursively serialize `value` to JSON with sorted object keys.
 * NOT strict JCS — see the "Canonicalization" note in the file header.
 *
 * Arrays preserve order. Object keys are sorted lexicographically (UTF-16,
 * which matches `String.prototype.localeCompare` for ASCII-only keys —
 * which is all our schemas use).
 */
function canonicalJSON(value: unknown): string {
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

// ─── COSE_Sign1 construction (PoPA-specific protected header) ────────────────
function buildPoPAProtectedHeader(sequence: number): Uint8Array {
  return cborMap([
    [cborUint(HDR_ALG),          cborNegint(ALG_EDDSA)],
    [cborUint(HDR_CONTENT_TYPE), cborText('application/popa+json')],
    [cborUint(HDR_ISSUER),       cborText(AGENTLAIR_ROOT_DID)],
    [cborText('PoPA-sequence'),  cborUint(sequence)],
  ]);
}

function buildSigStructure(protectedBytes: Uint8Array, payloadBytes: Uint8Array): Uint8Array {
  return cborArray([
    cborText('Signature1'),
    cborBytes(protectedBytes),
    cborBytes(new Uint8Array(0)),  // empty external_aad
    cborBytes(payloadBytes),
  ]);
}

function arrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

// ─── Main entrypoint ─────────────────────────────────────────────────────────
export async function emitAttestation(
  env: Env,
  agentDid: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<EmitResult> {
  if (!env.AUDIT || !env.AUDIT_SIGNING_KEY || !env.TRANSPARENCY_SERVICE) {
    return { status: 'error', reason: 'missing_bindings' };
  }
  const audit = env.AUDIT;
  const signingKeyB64 = env.AUDIT_SIGNING_KEY;

  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();

  try {
    // 1. Idempotency
    const existing = await audit
      .prepare('SELECT 1 AS one FROM popa_attestations WHERE agent_did = ? AND window_start = ? LIMIT 1')
      .bind(agentDid, windowStartIso)
      .first<{ one: number }>();
    if (existing) {
      return { status: 'skipped', reason: 'already_attested' };
    }

    // 2. Activity count (global for v1 root DID — see spec §"Activity Proof")
    const countRow = await audit
      .prepare('SELECT COUNT(*) AS c FROM audit_log WHERE timestamp >= ? AND timestamp < ?')
      .bind(windowStartIso, windowEndIso)
      .first<{ c: number }>();
    const mcpCallCount = Number(countRow?.c ?? 0);

    // 3. Previous attestation
    const prev = await audit
      .prepare(
        'SELECT entry_id, sequence, window_end FROM popa_attestations WHERE agent_did = ? ORDER BY sequence DESC LIMIT 1',
      )
      .bind(agentDid)
      .first<PrevRow>();

    const sequence = (prev?.sequence ?? 0) + 1;
    const prevAttestationId: string | null = prev ? 'scitt:' + prev.entry_id : null;

    // 4. Construct attestation JSON
    //
    // window_hash for v1: sha256 of {count, window_start, window_end}.
    // No call IDs are exposed (privacy-preserving; spec §"Activity Proof").
    const windowHashInput = canonicalJSON({
      count: mcpCallCount,
      window_start: windowStartIso,
      window_end: windowEndIso,
    });
    const windowHash = 'sha256:' + (await sha256hex(windowHashInput));

    const attestationCore = {
      agent_did: agentDid,
      timestamp: new Date().toISOString(),
      window_start: windowStartIso,
      window_end: windowEndIso,
      activity_proof: {
        type: 'mcp_call_count',
        count: mcpCallCount,
        window_hash: windowHash,
      },
      prev_attestation_id: prevAttestationId,
      sequence,
    };

    // 5. Sign canonicalized core (signature is over the core, not including itself)
    const canonical = canonicalJSON(attestationCore);
    const payloadBytes = new TextEncoder().encode(canonical);
    const privBytes = Uint8Array.from(atob(signingKeyB64), (c) => c.charCodeAt(0));
    const sigBytes = ed25519.sign(payloadBytes, privBytes);
    const signatureB64 = arrayToBase64(sigBytes);

    // Final attestation JSON (with signature appended).
    // The COSE payload is the SIGNED core (without signature) — the
    // signature field in the JSON form is for non-COSE consumers.
    const attestationFull = { ...attestationCore, signature: signatureB64 };

    // 6. COSE_Sign1 wrapper
    const protectedBytes = buildPoPAProtectedHeader(sequence);
    const sigStructure = buildSigStructure(protectedBytes, payloadBytes);
    const coseSignatureBytes = ed25519.sign(sigStructure, privBytes);

    const coseSign1 = cborArray([
      cborBytes(protectedBytes),         // protected: bstr (CBOR-encoded)
      cborMap([]),                       // unprotected: {}
      cborBytes(payloadBytes),           // payload: bstr (canonical attestation core)
      cborBytes(coseSignatureBytes),     // signature: bstr
    ]);
    const coseBytes = cborTag(TAG_COSE_SIGN1, coseSign1);

    // 7. Submit to TransparencyService DO
    const entryId = 'popa_' + nanoid(16);
    const tsId = env.TRANSPARENCY_SERVICE.idFromName('global');
    const tsStub = env.TRANSPARENCY_SERVICE.get(tsId);

    const doResponse = await tsStub.fetch(
      new Request('https://ts/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedStatement: arrayToBase64(coseBytes),
          entryId,
        }),
      }),
    );
    if (!doResponse.ok) {
      const text = await doResponse.text();
      return { status: 'error', reason: 'ts_error: ' + text.slice(0, 200) };
    }

    // 8. Gap math
    let gapHours = 0;
    let gapDetected = 0;
    if (prev) {
      const prevEnd = new Date(prev.window_end).getTime();
      gapHours = Math.max(0, (windowStart.getTime() - prevEnd) / 3_600_000);
      gapDetected = gapHours > 0 ? 1 : 0;
    }

    // 9. INSERT
    const rowId = nanoid(16);
    await audit
      .prepare(
        `INSERT INTO popa_attestations
         (id, agent_did, entry_id, sequence, window_start, window_end, mcp_call_count, gap_detected, gap_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        rowId,
        agentDid,
        entryId,
        sequence,
        windowStartIso,
        windowEndIso,
        mcpCallCount,
        gapDetected,
        gapHours,
      )
      .run();

    // 9b. Update subscriber's last_attested_at (PoPA v2). Best-effort:
    // a stale value still lets the dashboard render correctly because
    // popa_attestations is the source of truth — this column is a denormalised
    // hint for cheap "is this enrollment fresh?" lookups (e.g. the eventual
    // /v1/popa/enrollments admin view, planned for a follow-up).
    try {
      await audit
        .prepare(
          `UPDATE popa_subscribers SET last_attested_at = ? WHERE agent_did = ?`,
        )
        .bind(new Date().toISOString(), agentDid)
        .run();
    } catch {
      // Non-fatal — column may not exist yet on first deploy of v2 migration.
    }

    // 10. Cache invalidate (KEYS namespace doubles as the popa cache)
    try {
      await env.KEYS.delete('popa:' + agentDid);
    } catch {
      // Cache delete failure should not fail the emission
    }

    // Reference attestationFull so it's not a dead binding (and so a
    // future verifier-mode can return it). Intentionally not returned to
    // the caller — emission summary is intentionally minimal.
    void attestationFull;

    return { status: 'emitted', entry_id: entryId, sequence };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { status: 'error', reason: reason.slice(0, 300) };
  }
}
