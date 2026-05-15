/**
 * TEAL Ingest Route — POST /v1/teal/ingest
 *
 * Accepts Lyrie ATP v2 (TEAL) hash-chained behavioral records.
 * Validates chain integrity, optionally verifies Ed25519 agent signatures,
 * and dual-writes to teal_records + behavioral_events.
 *
 * Auth: authenticateAny middleware (API key or session token)
 * Spec: agentlair-teal-ingest-20260515
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { json, err, nanoid } from '../utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { b64urlDecode } from '../jwt.js';

export const tealIngestRoutes = new Hono<HonoEnv>();

// ─── Types ────────────────────────────────────────────────────────────────────

interface TealRecord {
  seq: number;
  timestamp: string;
  action_type: string;
  payload_hash: string;
  prev_hash: string | null;
  agent_sig?: string;
  subject_agent_id?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RECORDS = 100;

// subject_agent_id validation: acc_ or a2a_ prefix, 1–128 alphanumeric/hyphen/underscore chars
const SUBJECT_AGENT_ID_RE = /^(?:acc_[A-Za-z0-9_-]{1,128}|a2a_[A-Za-z0-9-]{1,128})$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Canonical record hash: sha256: + hex(SHA-256(JSON.stringify({seq, timestamp, action_type, payload_hash, prev_hash})))
 */
async function canonicalHash(record: Pick<TealRecord, 'seq' | 'timestamp' | 'action_type' | 'payload_hash' | 'prev_hash'>): Promise<string> {
  const canonical = JSON.stringify({
    seq: record.seq,
    timestamp: record.timestamp,
    action_type: record.action_type,
    payload_hash: record.payload_hash,
    prev_hash: record.prev_hash,
  });
  return 'sha256:' + await sha256hex(canonical);
}

/**
 * Sig message: seq|timestamp|action_type|payload_hash|(prev_hash ?? 'null')
 */
function sigMessage(record: Pick<TealRecord, 'seq' | 'timestamp' | 'action_type' | 'payload_hash' | 'prev_hash'>): Uint8Array {
  const msg = [
    String(record.seq),
    record.timestamp,
    record.action_type,
    record.payload_hash,
    record.prev_hash ?? 'null',
  ].join('|');
  return new TextEncoder().encode(msg);
}

function isValidString(v: unknown, maxLen = 1024): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

function validateRecordSchema(r: unknown, idx: number): { ok: true; record: TealRecord } | { ok: false; error: string; index: number } {
  if (typeof r !== 'object' || r === null || Array.isArray(r)) {
    return { ok: false, error: 'invalid_record_schema', index: idx };
  }
  const rec = r as Record<string, unknown>;

  if (typeof rec.seq !== 'number' || !Number.isInteger(rec.seq) || rec.seq < 0) {
    return { ok: false, error: 'invalid_record_schema', index: idx };
  }
  if (!isValidString(rec.timestamp)) {
    return { ok: false, error: 'invalid_record_schema', index: idx };
  }
  if (isNaN(new Date(rec.timestamp as string).getTime())) {
    return { ok: false, error: 'invalid_record_schema', index: idx };
  }
  if (!isValidString(rec.action_type, 256)) {
    return { ok: false, error: 'invalid_record_schema', index: idx };
  }
  if (!isValidString(rec.payload_hash, 512)) {
    return { ok: false, error: 'invalid_record_schema', index: idx };
  }
  if (rec.prev_hash !== null && rec.prev_hash !== undefined && typeof rec.prev_hash !== 'string') {
    return { ok: false, error: 'invalid_record_schema', index: idx };
  }
  if (rec.agent_sig !== undefined && rec.agent_sig !== null && typeof rec.agent_sig !== 'string') {
    return { ok: false, error: 'invalid_record_schema', index: idx };
  }
  if (rec.subject_agent_id !== undefined && rec.subject_agent_id !== null) {
    if (typeof rec.subject_agent_id !== 'string' || !SUBJECT_AGENT_ID_RE.test(rec.subject_agent_id)) {
      return { ok: false, error: 'invalid_subject_agent_id', index: idx };
    }
  }

  return {
    ok: true,
    record: {
      seq: rec.seq as number,
      timestamp: rec.timestamp as string,
      action_type: rec.action_type as string,
      payload_hash: rec.payload_hash as string,
      prev_hash: (rec.prev_hash as string | null) ?? null,
      agent_sig: typeof rec.agent_sig === 'string' ? rec.agent_sig : undefined,
      subject_agent_id: typeof rec.subject_agent_id === 'string' ? rec.subject_agent_id : undefined,
    },
  };
}

// ─── POST /ingest ─────────────────────────────────────────────────────────────

tealIngestRoutes.post('/ingest', async (c) => {
  // Step 1: Auth gate
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  // Step 2: AUDIT binding gate
  if (!c.env.AUDIT) return err('Audit DB not configured.', 503, 'audit_unavailable');

  const operatorId = account.id;

  // Step 3: Body parse + schema validate
  let raw: string;
  try {
    raw = await c.req.text();
  } catch {
    return err('Failed to read request body.', 400, 'invalid_body');
  }
  if (raw.length > 512 * 1024) {
    return err('Request body exceeds 512 KB.', 413, 'body_too_large');
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return err('Body is not valid JSON.', 400, 'invalid_json');
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return err('Body must be a JSON object.', 400, 'invalid_body');
  }
  const bodyObj = body as Record<string, unknown>;

  if (!isValidString(bodyObj.session_id, 256)) {
    return err('session_id is required (non-empty string, max 256 chars).', 400, 'missing_session_id');
  }
  const sessionId = bodyObj.session_id as string;

  if (!Array.isArray(bodyObj.records)) {
    return err('records must be an array.', 400, 'missing_records');
  }
  const rawRecords = bodyObj.records;

  if (rawRecords.length === 0) {
    return err('records must contain at least one entry.', 400, 'records_empty');
  }
  if (rawRecords.length > MAX_RECORDS) {
    return err(`records exceeds maximum of ${MAX_RECORDS} per request.`, 400, 'records_too_many');
  }

  // Step 4: Per-record schema validate
  const records: TealRecord[] = [];
  for (let i = 0; i < rawRecords.length; i++) {
    const validated = validateRecordSchema(rawRecords[i], i);
    if (!validated.ok) {
      return c.json({ error: validated.error, index: validated.index, message: 'Record failed schema validation.' }, 400);
    }
    records.push(validated.record);
  }

  // Step 5: Seq monotonicity — records must be strictly increasing
  for (let i = 1; i < records.length; i++) {
    if (records[i].seq <= records[i - 1].seq) {
      return c.json({
        error: 'seq_not_monotonic',
        index: i,
        message: `Record at index ${i} has seq ${records[i].seq} which is not greater than previous seq ${records[i - 1].seq}.`,
      }, 400);
    }
  }

  // Step 7 (moved before chain check): Duplicate-seq guard
  const seqs = records.map(r => r.seq);
  let existingSeqs: Set<number> = new Set();
  try {
    const placeholders = seqs.map(() => '?').join(', ');
    const rows = await c.env.AUDIT
      .prepare(`SELECT seq FROM teal_records WHERE operator_id = ? AND session_id = ? AND seq IN (${placeholders})`)
      .bind(operatorId, sessionId, ...seqs)
      .all<{ seq: number }>();
    existingSeqs = new Set((rows.results ?? []).map(r => r.seq));
  } catch {
    // Table may not exist (migration not yet applied) — proceed
  }

  // If all records are duplicates → 409
  if (existingSeqs.size === records.length) {
    return c.json({
      error: 'duplicate_seq',
      message: 'All submitted records already exist for this session.',
    }, 409);
  }

  // Partition: new records vs already-persisted (idempotent)
  const newRecords = records.filter(r => !existingSeqs.has(r.seq));
  const idempotentCount = records.length - newRecords.length;

  // Step 6: Chain-link verification
  // Check cross-POST continuation: look up the last persisted record for this session
  let lastPersistedCanonical: string | null = null;
  let sessionContinued = false;
  try {
    const lastRow = await c.env.AUDIT
      .prepare('SELECT seq, timestamp, action_type, payload_hash, prev_hash FROM teal_records WHERE operator_id = ? AND session_id = ? ORDER BY seq DESC LIMIT 1')
      .bind(operatorId, sessionId)
      .first<{ seq: number; timestamp: string; action_type: string; payload_hash: string; prev_hash: string | null }>();

    if (lastRow) {
      sessionContinued = true;
      lastPersistedCanonical = await canonicalHash(lastRow);
    }
  } catch {
    // Table may not exist — treat as new session
  }

  // Validate chain: first NEW record's prev_hash must link to last persisted record
  // Only enforce if session is being continued
  if (sessionContinued && lastPersistedCanonical !== null && newRecords.length > 0) {
    const firstNew = newRecords[0];
    if (firstNew.prev_hash !== lastPersistedCanonical) {
      return c.json({
        error: 'chain_break',
        index: records.indexOf(firstNew),
        message: 'First new record prev_hash does not match the canonical hash of the last persisted record for this session.',
      }, 403);
    }
  }

  // Validate internal chain links among all submitted records (including idempotent ones)
  const recordHashes: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const h = await canonicalHash(records[i]);
    recordHashes.push(h);
    if (i > 0) {
      const expectedPrev = recordHashes[i - 1];
      if (records[i].prev_hash !== expectedPrev) {
        return c.json({
          error: 'chain_break',
          index: i,
          message: `Record at index ${i} prev_hash does not match canonical hash of record at index ${i - 1}.`,
        }, 403);
      }
    }
  }

  // Step 8: Signature verification
  const url = new URL(c.req.url);
  const unsignedOk = url.searchParams.get('unsigned_ok') === '1';

  let chainSigned = false;

  if (!unsignedOk) {
    // Look up signing key from KV
    const keyidRaw = await c.env.KEYS.get(`signing-key-by-account:${operatorId}`);
    if (!keyidRaw) {
      return c.json({ error: 'no_signing_key_registered', message: 'No Ed25519 signing key registered for this operator. Register via POST /v1/agents/signing-keys.' }, 422);
    }
    let keyid: string;
    try {
      const parsed = JSON.parse(keyidRaw);
      keyid = typeof parsed === 'string' ? parsed : (parsed as { keyid: string }).keyid;
    } catch {
      keyid = keyidRaw;
    }

    const keyRecordRaw = await c.env.KEYS.get(`signing-key:${keyid}`);
    if (!keyRecordRaw) {
      return c.json({ error: 'no_signing_key_registered', message: 'Signing key record not found.' }, 422);
    }
    let publicKeyB64url: string;
    try {
      const keyRecord = JSON.parse(keyRecordRaw) as { public_key: string };
      publicKeyB64url = keyRecord.public_key;
    } catch {
      return c.json({ error: 'no_signing_key_registered', message: 'Signing key record is malformed.' }, 422);
    }

    let signingKeyPublicBytes: Uint8Array;
    try {
      signingKeyPublicBytes = b64urlDecode(publicKeyB64url);
    } catch {
      return c.json({ error: 'no_signing_key_registered', message: 'Signing key is not valid base64url.' }, 422);
    }

    // Verify all new records
    for (let i = 0; i < newRecords.length; i++) {
      const record = newRecords[i];
      const recordIdx = records.indexOf(record);
      if (!record.agent_sig) {
        return c.json({ error: 'sig_invalid', index: recordIdx, message: `Record at index ${recordIdx} (seq ${record.seq}) is missing agent_sig.` }, 422);
      }
      const msgBytes = sigMessage(record);
      let sigBytes: Uint8Array;
      try {
        sigBytes = b64urlDecode(record.agent_sig);
      } catch {
        return c.json({ error: 'sig_invalid', index: recordIdx, message: `Record at index ${recordIdx} (seq ${record.seq}) agent_sig is not valid base64url.` }, 422);
      }
      try {
        const valid = ed25519.verify(sigBytes, msgBytes, signingKeyPublicBytes);
        if (!valid) {
          return c.json({ error: 'sig_invalid', index: recordIdx, message: `Record at index ${recordIdx} (seq ${record.seq}) agent_sig failed verification.` }, 422);
        }
      } catch {
        return c.json({ error: 'sig_invalid', index: recordIdx, message: `Record at index ${recordIdx} (seq ${record.seq}) agent_sig verification error.` }, 422);
      }
    }
    chainSigned = true;
  }

  // Step 9: Persist to both tables
  const beIds: string[] = [];
  const now = new Date().toISOString();

  for (const record of newRecords) {
    const beId = 'be_' + nanoid(16);
    beIds.push(beId);

    // Insert into teal_records
    try {
      await c.env.AUDIT.prepare(
        `INSERT OR IGNORE INTO teal_records
           (operator_id, session_id, seq, timestamp, action_type, payload_hash, prev_hash, agent_sig, signed, received_at, subject_agent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        operatorId,      // 0
        sessionId,       // 1
        record.seq,      // 2
        record.timestamp, // 3
        record.action_type, // 4
        record.payload_hash, // 5
        record.prev_hash, // 6
        record.agent_sig ?? null, // 7
        chainSigned ? 1 : 0, // 8
        now,             // 9
        record.subject_agent_id ?? null, // 10
      ).run();
    } catch (e) {
      console.error('teal_records insert failed:', e instanceof Error ? e.message : String(e));
    }

    // Dual-write to behavioral_events
    // Columns: id(0), event_id(1), agent_id(2), timestamp(3), category(4), action(5), result(6),
    //          resource_type(7), duration_ms(8), error_code(9), scope_used(10), metadata_json(11),
    //          session_id(12), signed(13), source(14)
    // D3: agent_id = subject (per-record subject_agent_id ?? fallback to operatorId)
    //     metadata_json includes operator_id (the SUBMITTER) for cross-org auditability
    const subjectAgentId = record.subject_agent_id ?? operatorId;
    const beEventId = `teal_${sessionId}_${record.seq}`;
    try {
      await c.env.AUDIT.prepare(
        `INSERT OR IGNORE INTO behavioral_events
           (id, event_id, agent_id, timestamp, category, action, result,
            resource_type, duration_ms, error_code, scope_used, metadata_json,
            session_id, signed, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        beId,            // 0
        beEventId,       // 1
        subjectAgentId,  // 2: was operatorId; now per-record subject (or fallback)
        record.timestamp, // 3
        'session',       // 4: category
        record.action_type, // 5: action
        'success',       // 6: result
        null,            // 7: resource_type
        null,            // 8: duration_ms
        null,            // 9: error_code
        null,            // 10: scope_used
        JSON.stringify({
          payload_hash: record.payload_hash,
          seq: record.seq,
          operator_id: operatorId,  // NEW: submitter retained even when agent_id diverges
        }), // 11: metadata_json
        sessionId,       // 12: session_id
        chainSigned ? 1 : 0, // 13: signed
        'teal',          // 14: source
      ).run();
    } catch (e) {
      console.error('behavioral_events teal insert failed:', e instanceof Error ? e.message : String(e));
    }
  }

  // Step 10: Receipt + 200 response
  const firstBeId = beIds[0] ?? null;
  const lastBeId = beIds[beIds.length - 1] ?? null;

  // Receipt sig: sign the session_id + accepted count with AUDIT_SIGNING_KEY if available
  let receiptSig: string | undefined;
  if (c.env.AUDIT_SIGNING_KEY) {
    try {
      const receiptMsg = `${operatorId}|${sessionId}|${newRecords.length}|${now}`;
      const privBytes = Uint8Array.from(atob(c.env.AUDIT_SIGNING_KEY), ch => ch.charCodeAt(0));
      const sigBytes = ed25519.sign(new TextEncoder().encode(receiptMsg), privBytes);
      const sigHex = Array.from(sigBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      receiptSig = `ed25519:${sigHex}`;
    } catch (e) {
      console.error('receipt sig failed:', e instanceof Error ? e.message : String(e));
    }
  }

  return json({
    ok: true,
    operator_id: operatorId,
    session_id: sessionId,
    records_accepted: newRecords.length,
    records_idempotent: idempotentCount,
    chain_valid: true,
    chain_signed: chainSigned,
    session_id_continued: sessionContinued,
    telemetry_id_first: firstBeId,
    telemetry_id_last: lastBeId,
    ...(receiptSig ? { receipt_sig: receiptSig } : {}),
  });
});
