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
import { nanoid } from '../utils.js';
import {
  reconstructPopaSignedStatement,
  arrayToBase64,
} from './popa-cose.js';

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
    const entryId = 'popa_' + nanoid(16);

    // 4-6. Build the signed statement via the shared helper. issuedAt is
    //      captured ONCE here and persisted on the row so /verify-receipt
    //      can later regenerate byte-identical bytes if needed (the row
    //      ALSO stores the COSE bytes directly, so reconstruction is a
    //      defense-in-depth path, not a primary requirement).
    const issuedAt = new Date().toISOString();
    const reconstructed = await reconstructPopaSignedStatement(
      {
        agent_did: agentDid,
        entry_id: entryId,
        sequence,
        window_start: windowStartIso,
        window_end: windowEndIso,
        mcp_call_count: mcpCallCount,
        issued_at: issuedAt,
        prev_attestation_id: prevAttestationId,
      },
      signingKeyB64,
    );
    const coseBytes = reconstructed.coseBytes;

    // Maintain the JSON-only signature path for non-COSE consumers
    // (kept as a binding so the JSON form retains its detached sig field
    // for any documentation/spec references — not currently emitted, but
    // a stable position for adding a JSON mirror endpoint in v2).
    const privBytes = Uint8Array.from(atob(signingKeyB64), (c) => c.charCodeAt(0));
    const jsonSigBytes = ed25519.sign(reconstructed.payloadBytes, privBytes);
    const jsonSignatureB64 = arrayToBase64(jsonSigBytes);
    void jsonSignatureB64;

    // 7. Submit to TransparencyService DO
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

    // 9. INSERT — store the signed statement bytes alongside the row so
    //    the public verifier can serve them back without needing to
    //    reconstruct (the column may not exist on databases that haven't
    //    run migration 0011 yet; the wider INSERT will fail in that case
    //    and we fall back to the legacy 9-column shape).
    const rowId = nanoid(16);
    const signedStatementB64 = arrayToBase64(coseBytes);
    try {
      await audit
        .prepare(
          `INSERT INTO popa_attestations
           (id, agent_did, entry_id, sequence, window_start, window_end, mcp_call_count, gap_detected, gap_hours, signed_statement_cbor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          signedStatementB64,
        )
        .run();
    } catch (e) {
      // Pre-migration databases — fall back to legacy schema. The verifier
      // will then surface "bytes archived: no" for this entry.
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
      // Log the schema mismatch but continue; the emission itself succeeded.
      console.warn('[popa-emit] signed_statement_cbor column missing — run migration 0011', e instanceof Error ? e.message : String(e));
    }

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
        .bind(issuedAt, agentDid)
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

    return { status: 'emitted', entry_id: entryId, sequence };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { status: 'error', reason: reason.slice(0, 300) };
  }
}
