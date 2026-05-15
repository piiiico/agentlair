/**
 * TEAL Ingest Route — Unit Tests
 *
 * Covers G1-G12 from the spec:
 * G1:  Valid 3-record chain with unsigned_ok=1 → 200, chain_signed: false
 * G2:  Chain break → 403, chain_break
 * G3:  Bad agent_sig → 422, sig_invalid
 * G4:  Duplicate seq re-POST → 409, duplicate_seq
 * G5:  Missing Authorization → 401, unauthorized
 * G6:  Continuation across two POSTs → 200, session_id_continued: true
 * G7:  Records flow to behavioral_events (3 rows, category='session', signed=0)
 * G9:  Missing seq field → 400, invalid_record_schema
 * G10: Non-monotonic seq → 400, seq_not_monotonic
 * G11: 101 records → 400, records_too_many
 * G12: unsigned_ok=1 with no signing key → 200, chain_signed: false
 *
 * Run: bun test src/routes/teal-ingest.test.ts
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { tealIngestRoutes } from './teal-ingest.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { Account } from '../types.js';

// ─── Crypto helpers ───────────────────────────────────────────────────────────

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(b64);
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

async function canonicalHash(record: {
  seq: number;
  timestamp: string;
  action_type: string;
  payload_hash: string;
  prev_hash: string | null;
}): Promise<string> {
  const canonical = JSON.stringify({
    seq: record.seq,
    timestamp: record.timestamp,
    action_type: record.action_type,
    payload_hash: record.payload_hash,
    prev_hash: record.prev_hash,
  });
  return 'sha256:' + await sha256hex(canonical);
}

function sigMessage(record: {
  seq: number;
  timestamp: string;
  action_type: string;
  payload_hash: string;
  prev_hash: string | null;
}): Uint8Array {
  const msg = [
    String(record.seq),
    record.timestamp,
    record.action_type,
    record.payload_hash,
    record.prev_hash ?? 'null',
  ].join('|');
  return new TextEncoder().encode(msg);
}

// ─── Mock KV ─────────────────────────────────────────────────────────────────

class MockKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  _set(key: string, value: string): void {
    this.store.set(key, value);
  }
}

// ─── Mock D1 ─────────────────────────────────────────────────────────────────

interface MockD1Row {
  [key: string]: unknown;
}

class MockD1Stmt {
  private sql: string;
  private bindings: unknown[] = [];
  private db: MockD1;

  constructor(sql: string, db: MockD1) {
    this.sql = sql;
    this.db = db;
  }

  bind(...values: unknown[]): this {
    this.bindings = values;
    return this;
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    if (this.sql.includes('INSERT') && this.sql.includes('teal_records')) {
      const operatorId = String(this.bindings[0]);
      const sessionId = String(this.bindings[1]);
      const seq = Number(this.bindings[2]);
      const key = `${operatorId}:${sessionId}:${seq}`;
      if (!this.db._tealInserted.has(key)) {
        this.db._tealInserted.add(key);
        this.db._tealRows.push({
          operator_id: operatorId,
          session_id: sessionId,
          seq,
          timestamp: String(this.bindings[3]),
          action_type: String(this.bindings[4]),
          payload_hash: String(this.bindings[5]),
          prev_hash: this.bindings[6] as string | null,
          agent_sig: this.bindings[7] as string | null,
          signed: this.bindings[8] as number,
          received_at: String(this.bindings[9]),
        });
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.includes('INSERT') && this.sql.includes('behavioral_events')) {
      const id = String(this.bindings[0]);
      const eventId = String(this.bindings[1]);
      const agentId = String(this.bindings[2]);
      const category = String(this.bindings[4]);
      const signed = Number(this.bindings[13]);
      const sessionId = String(this.bindings[12]);
      this.db._beRows.push({ id, event_id: eventId, agent_id: agentId, category, signed, session_id: sessionId });
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }

  async all<T = MockD1Row>(): Promise<{ results: T[] }> {
    if (this.sql.includes('FROM teal_records') && this.sql.includes('ORDER BY seq DESC LIMIT 1')) {
      // Last row query for continuation
      const operatorId = String(this.bindings[0]);
      const sessionId = String(this.bindings[1]);
      const rows = this.db._tealRows.filter(
        r => r.operator_id === operatorId && r.session_id === sessionId,
      );
      if (rows.length === 0) return { results: [] };
      const sorted = [...rows].sort((a, b) => (b.seq as number) - (a.seq as number));
      return { results: [sorted[0]] as unknown as T[] };
    }
    if (this.sql.includes('FROM teal_records') && this.sql.includes('seq IN')) {
      // Duplicate seq check
      const operatorId = String(this.bindings[0]);
      const sessionId = String(this.bindings[1]);
      const seqs = this.bindings.slice(2).map(Number);
      const rows = this.db._tealRows.filter(
        r => r.operator_id === operatorId && r.session_id === sessionId && seqs.includes(r.seq as number),
      );
      return { results: rows as unknown as T[] };
    }
    return { results: [] };
  }

  async first<T = MockD1Row>(): Promise<T | null> {
    const result = await this.all<T>();
    return result.results[0] ?? null;
  }
}

class MockD1 {
  _tealRows: MockD1Row[] = [];
  _beRows: MockD1Row[] = [];
  _tealInserted = new Set<string>();

  prepare(sql: string): MockD1Stmt {
    return new MockD1Stmt(sql, this);
  }
}

// ─── MockExecutionContext ────────────────────────────────────────────────────

class MockExecutionContext {
  waitUntil(promise: Promise<unknown>): void {
    promise.catch(() => {});
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeAccount(id = 'acc_test123'): Account {
  return { id, tier: 'free' };
}

async function buildChain(
  n: number,
  actionType = 'tool.invoke',
): Promise<Array<{
  seq: number;
  timestamp: string;
  action_type: string;
  payload_hash: string;
  prev_hash: string | null;
}>> {
  const records = [];
  let prevHash: string | null = null;
  for (let i = 0; i < n; i++) {
    const rec = {
      seq: i,
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      action_type: actionType,
      payload_hash: 'sha256:' + await sha256hex(`payload-${i}`),
      prev_hash: prevHash,
    };
    prevHash = await canonicalHash(rec);
    records.push(rec);
  }
  return records;
}

async function callIngest(
  body: unknown,
  opts: {
    kv?: MockKV;
    d1?: MockD1;
    accountId?: string;
    noAuth?: boolean;
    unsignedOk?: boolean;
    auditSigningKey?: string;
  } = {},
): Promise<{ status: number; body: unknown; d1: MockD1 }> {
  const kv = opts.kv ?? new MockKV();
  const d1 = opts.d1 ?? new MockD1();
  const account = opts.noAuth ? null : makeAccount(opts.accountId ?? 'acc_test123');

  const url = opts.unsignedOk ? 'http://localhost/ingest?unsigned_ok=1' : 'http://localhost/ingest';
  const req = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const env = {
    KEYS: kv as unknown as KVNamespace,
    AUDIT: d1 as unknown as D1Database,
    AUDIT_SIGNING_KEY: opts.auditSigningKey,
  };

  const ctx = new MockExecutionContext() as unknown as ExecutionContext;

  const wrappedApp = new (await import('hono').then(m => m.Hono))();
  wrappedApp.use('*', async (c, next) => {
    c.set('account', account);
    await next();
  });
  wrappedApp.route('/', tealIngestRoutes as unknown as Parameters<typeof wrappedApp.route>[1]);

  const response = await wrappedApp.fetch(req, env, ctx);
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }
  return { status: response.status, body: responseBody, d1 };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /v1/teal/ingest', () => {
  describe('G1: Valid 3-record chain with unsigned_ok=1', () => {
    test('returns 200 with chain_signed: false', async () => {
      const records = await buildChain(3);
      const { status, body } = await callIngest(
        { session_id: 'sess_g1', records },
        { unsignedOk: true },
      );
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(b.ok).toBe(true);
      expect(b.records_accepted).toBe(3);
      expect(b.records_idempotent).toBe(0);
      expect(b.chain_valid).toBe(true);
      expect(b.chain_signed).toBe(false);
      expect(b.session_id_continued).toBe(false);
      expect(typeof b.telemetry_id_first).toBe('string');
      expect(typeof b.telemetry_id_last).toBe('string');
      expect((b.telemetry_id_first as string).startsWith('be_')).toBe(true);
    });
  });

  describe('G2: Chain break', () => {
    test('returns 403 with chain_break error', async () => {
      const records = await buildChain(3);
      // Break the chain by corrupting the second record's prev_hash
      records[1] = { ...records[1], prev_hash: 'sha256:badhash' };
      const { status, body } = await callIngest(
        { session_id: 'sess_g2', records },
        { unsignedOk: true },
      );
      expect(status).toBe(403);
      expect((body as Record<string, unknown>).error).toBe('chain_break');
    });
  });

  describe('G3: Bad agent_sig', () => {
    test('returns 422 with sig_invalid error', async () => {
      // Register a signing key in KV
      const privKey = ed25519.utils.randomSecretKey();
      const pubKey = ed25519.getPublicKey(privKey);
      const pubKeyB64url = b64urlEncode(pubKey);
      const keyid = 'test-keyid-g3';

      const kv = new MockKV();
      kv._set(`signing-key-by-account:acc_test123`, keyid);
      kv._set(`signing-key:${keyid}`, JSON.stringify({ public_key: pubKeyB64url }));

      const records = await buildChain(2);
      // Add invalid agent_sig
      records[0] = { ...records[0], agent_sig: b64urlEncode(new Uint8Array(64)) };
      records[1] = { ...records[1], agent_sig: b64urlEncode(new Uint8Array(64)) };

      const { status, body } = await callIngest(
        { session_id: 'sess_g3', records: records as unknown[] },
        { kv, unsignedOk: false },
      );
      expect(status).toBe(422);
      expect((body as Record<string, unknown>).error).toBe('sig_invalid');
    });
  });

  describe('G4: Duplicate seq re-POST', () => {
    test('returns 409 with duplicate_seq error on re-POST', async () => {
      const records = await buildChain(2);
      const d1 = new MockD1();

      // First POST succeeds
      const first = await callIngest(
        { session_id: 'sess_g4', records },
        { d1, unsignedOk: true },
      );
      expect(first.status).toBe(200);

      // Second POST with same records → duplicate
      const second = await callIngest(
        { session_id: 'sess_g4', records },
        { d1, unsignedOk: true },
      );
      expect(second.status).toBe(409);
      expect((second.body as Record<string, unknown>).error).toBe('duplicate_seq');
    });
  });

  describe('G5: Missing Authorization', () => {
    test('returns 401 unauthorized', async () => {
      const records = await buildChain(1);
      const { status, body } = await callIngest(
        { session_id: 'sess_g5', records },
        { noAuth: true, unsignedOk: true },
      );
      expect(status).toBe(401);
      expect((body as Record<string, unknown>).error).toBe('unauthorized');
    });
  });

  describe('G6: Continuation across two POSTs', () => {
    test('second POST returns session_id_continued: true', async () => {
      const allRecords = await buildChain(4);
      const batch1 = allRecords.slice(0, 2);
      const batch2 = allRecords.slice(2);
      const d1 = new MockD1();

      // First POST
      const first = await callIngest(
        { session_id: 'sess_g6', records: batch1 },
        { d1, unsignedOk: true },
      );
      expect(first.status).toBe(200);
      expect((first.body as Record<string, unknown>).session_id_continued).toBe(false);

      // Second POST (continuation)
      const second = await callIngest(
        { session_id: 'sess_g6', records: batch2 },
        { d1, unsignedOk: true },
      );
      expect(second.status).toBe(200);
      const b = second.body as Record<string, unknown>;
      expect(b.session_id_continued).toBe(true);
      expect(b.records_accepted).toBe(2);
    });
  });

  describe('G7: Records flow to behavioral_events', () => {
    test('3 rows written with agent_id=operator_id, category=session, signed=0', async () => {
      const records = await buildChain(3);
      const d1 = new MockD1();

      const { status } = await callIngest(
        { session_id: 'sess_g7', records },
        { d1, accountId: 'acc_opg7', unsignedOk: true },
      );
      expect(status).toBe(200);

      expect(d1._beRows).toHaveLength(3);
      for (const row of d1._beRows) {
        expect(row.agent_id).toBe('acc_opg7');
        expect(row.category).toBe('session');
        expect(row.signed).toBe(0);
      }
    });
  });

  describe('G9: Missing seq field', () => {
    test('returns 400 with invalid_record_schema', async () => {
      const records = await buildChain(2);
      // Remove seq from first record
      const bad = [{ ...records[0], seq: undefined }, records[1]];
      const { status, body } = await callIngest(
        { session_id: 'sess_g9', records: bad },
        { unsignedOk: true },
      );
      expect(status).toBe(400);
      expect((body as Record<string, unknown>).error).toBe('invalid_record_schema');
    });
  });

  describe('G10: Non-monotonic seq', () => {
    test('returns 400 with seq_not_monotonic', async () => {
      const records = await buildChain(3);
      // Swap seq order to make non-monotonic
      const bad = [records[0], { ...records[1], seq: 0 }, records[2]];
      const { status, body } = await callIngest(
        { session_id: 'sess_g10', records: bad },
        { unsignedOk: true },
      );
      expect(status).toBe(400);
      expect((body as Record<string, unknown>).error).toBe('seq_not_monotonic');
    });
  });

  describe('G11: 101 records', () => {
    test('returns 400 with records_too_many', async () => {
      // Build 101 records without full chain (just need the count check to fire first)
      const records = Array.from({ length: 101 }, (_, i) => ({
        seq: i,
        timestamp: new Date().toISOString(),
        action_type: 'tool.invoke',
        payload_hash: 'sha256:abc',
        prev_hash: null,
      }));
      const { status, body } = await callIngest(
        { session_id: 'sess_g11', records },
        { unsignedOk: true },
      );
      expect(status).toBe(400);
      expect((body as Record<string, unknown>).error).toBe('records_too_many');
    });
  });

  describe('G12: unsigned_ok=1 with no signing key', () => {
    test('returns 200 with chain_signed: false', async () => {
      const records = await buildChain(2);
      const kv = new MockKV();
      // No signing key registered in KV

      const { status, body } = await callIngest(
        { session_id: 'sess_g12', records },
        { kv, unsignedOk: true },
      );
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(b.chain_signed).toBe(false);
    });
  });

  describe('body validation', () => {
    test('missing session_id → 400', async () => {
      const { status, body } = await callIngest(
        { records: [] },
        { unsignedOk: true },
      );
      expect(status).toBe(400);
      expect((body as Record<string, unknown>).error).toBe('missing_session_id');
    });

    test('missing records → 400', async () => {
      const { status, body } = await callIngest(
        { session_id: 'sess_x' },
        { unsignedOk: true },
      );
      expect(status).toBe(400);
    });

    test('empty records → 400', async () => {
      const { status, body } = await callIngest(
        { session_id: 'sess_x', records: [] },
        { unsignedOk: true },
      );
      expect(status).toBe(400);
    });

    test('invalid JSON → 400', async () => {
      const kv = new MockKV();
      const d1 = new MockD1();
      const account = makeAccount();
      const req = new Request('http://localhost/ingest?unsigned_ok=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      const env = {
        KEYS: kv as unknown as KVNamespace,
        AUDIT: d1 as unknown as D1Database,
      };
      const wrappedApp = new (await import('hono').then(m => m.Hono))();
      wrappedApp.use('*', async (c, next) => { c.set('account', account); await next(); });
      wrappedApp.route('/', tealIngestRoutes as unknown as Parameters<typeof wrappedApp.route>[1]);
      const response = await wrappedApp.fetch(req, env, new MockExecutionContext() as unknown as ExecutionContext);
      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect(body.error).toBe('invalid_json');
    });
  });

  describe('valid signed chain', () => {
    test('valid Ed25519 signatures are accepted → 200, chain_signed: true', async () => {
      const privKey = ed25519.utils.randomSecretKey();
      const pubKey = ed25519.getPublicKey(privKey);
      const pubKeyB64url = b64urlEncode(pubKey);
      const keyid = 'test-keyid-signed';

      const kv = new MockKV();
      kv._set(`signing-key-by-account:acc_test123`, keyid);
      kv._set(`signing-key:${keyid}`, JSON.stringify({ public_key: pubKeyB64url }));

      const rawRecords = await buildChain(2);
      // Sign each record
      const signedRecords = rawRecords.map(rec => {
        const msg = [
          String(rec.seq),
          rec.timestamp,
          rec.action_type,
          rec.payload_hash,
          rec.prev_hash ?? 'null',
        ].join('|');
        const msgBytes = new TextEncoder().encode(msg);
        const sigBytes = ed25519.sign(msgBytes, privKey);
        return { ...rec, agent_sig: b64urlEncode(sigBytes) };
      });

      const { status, body } = await callIngest(
        { session_id: 'sess_signed', records: signedRecords },
        { kv, unsignedOk: false },
      );
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(b.chain_signed).toBe(true);
      expect(b.records_accepted).toBe(2);
    });
  });
});
