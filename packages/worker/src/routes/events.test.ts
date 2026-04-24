/**
 * RFC-003 Behavioral Event Ingestion — Unit Tests
 *
 * Tests for:
 * 1. validateEvent — schema, timestamp bounds, metadata limits
 * 2. POST /v1/events — successful ingestion via mocked D1 + KV
 * 3. POST /v1/events — deduplication (KV hit skips D1, still counts as accepted)
 * 4. POST /v1/events — rate limiting (1,000/hour ceiling)
 * 5. POST /v1/events — batch size limit (>100 rejected)
 * 6. POST /v1/events — mixed valid + invalid events in one batch
 *
 * Run: bun test src/routes/events.test.ts
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { eventRoutes, validateEvent } from './events.js';
import { EVENT_LIMITS } from '../middleware/ratelimit.js';

// Free-tier hourly event limit (used in rate limiting tests below)
const FREE_HOURLY_LIMIT = EVENT_LIMITS.free.hourly; // 50
import type { EventCategory, EventResult } from './events.js';
import type { Account } from '../types.js';

// ─── Mock KV ─────────────────────────────────────────────────────────────────

class MockKV {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && Date.now() / 1000 > entry.expiration) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiration = options?.expirationTtl
      ? Math.floor(Date.now() / 1000) + options.expirationTtl
      : undefined;
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  // Test helper: seed the store directly
  _set(key: string, value: string): void {
    this.store.set(key, { value });
  }

  _dump(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.store) out[k] = v.value;
    return out;
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
    if (this.sql.includes('INSERT') && this.sql.includes('behavioral_events')) {
      // Extract id (position 0) and event_id (position 1) from bindings
      const id = String(this.bindings[0] ?? '');
      const eventId = String(this.bindings[1] ?? '');
      const agentId = String(this.bindings[2] ?? '');

      // Simulate UNIQUE constraint on (agent_id, event_id)
      const dupeKey = `${agentId}:${eventId}`;
      if (this.db._inserted.has(dupeKey)) {
        // INSERT OR IGNORE — no-op, not an error
        return { success: true, meta: { changes: 0 } };
      }
      this.db._inserted.add(dupeKey);
      this.db._rows.push({ id, event_id: eventId, agent_id: agentId });
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }

  async all(): Promise<{ results: MockD1Row[] }> {
    return { results: this.db._rows };
  }

  async first(): Promise<MockD1Row | null> {
    return this.db._rows[0] ?? null;
  }
}

class MockD1 {
  _rows: MockD1Row[] = [];
  _inserted = new Set<string>();

  prepare(sql: string): MockD1Stmt {
    return new MockD1Stmt(sql, this);
  }
}

// ─── Mock ExecutionContext ────────────────────────────────────────────────────

class MockExecutionContext {
  waitUntil(promise: Promise<unknown>): void {
    // Fire-and-forget in tests — swallow errors
    promise.catch(() => {});
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let eventCounter = 0;

function makeEvent(overrides: Partial<{
  event_id: string;
  timestamp: string;
  category: EventCategory;
  action: string;
  result: EventResult;
  resource_type?: string;
  duration_ms?: number;
  error_code?: string;
  scope_used?: string;
  metadata?: Record<string, string | number | boolean>;
  signature?: string;
}> = {}) {
  return {
    event_id: `evt-${++eventCounter}`,
    timestamp: new Date().toISOString(),
    category: 'tool' as EventCategory,
    action: 'tool.invoke',
    result: 'success' as EventResult,
    ...overrides,
  };
}

function makeAccount(id = 'acc_test123'): Account {
  return { id, tier: 'free' };
}

// Build a Request for POST /
// eventRoutes registers at '/', so the wrapped app mounts at '/' too.
function makeRequest(body: unknown): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Call the route handler with the given env
async function callEvents(
  body: unknown,
  opts: {
    kv?: MockKV;
    d1?: MockD1;
    accountId?: string;
    noAuth?: boolean;
  } = {},
): Promise<{ status: number; body: unknown }> {
  const kv = opts.kv ?? new MockKV();
  const d1 = opts.d1 ?? new MockD1();
  const accountId = opts.accountId ?? 'acc_test123';

  const req = makeRequest(body);
  const env = {
    KEYS: kv as unknown as KVNamespace,
    AUDIT: d1 as unknown as D1Database,
    EMAILS: {} as KVNamespace,
    VAULT: {} as KVNamespace,
  };

  const account = opts.noAuth ? null : makeAccount(accountId);

  // Inject the account into context via Hono's middleware variable system.
  // We simulate the auth middleware by directly setting the context variable.
  const ctx = new MockExecutionContext() as unknown as ExecutionContext;

  // Hono apps can be called via .fetch() with an env that includes Variables.
  // We need to inject account into the context. The easiest way is to pass it
  // via a custom header that we intercept, or we pre-set it via app.use().
  //
  // Since the eventRoutes app reads `c.get('account')` which was set by auth
  // middleware in the parent app, we need a way to inject it. We'll use a
  // wrapper that pre-sets the account variable.
  const wrappedApp = new (await import('hono').then(m => m.Hono))();

  // Set account before routing to events
  wrappedApp.use('*', async (c, next) => {
    c.set('account', account);
    await next();
  });
  wrappedApp.route('/', eventRoutes as unknown as Parameters<typeof wrappedApp.route>[1]);

  const response = await wrappedApp.fetch(req, env, ctx);
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }
  return { status: response.status, body: responseBody };
}

// ─── validateEvent Unit Tests ─────────────────────────────────────────────────

describe('validateEvent', () => {
  describe('required fields', () => {
    test('valid minimal event passes', () => {
      const result = validateEvent(makeEvent());
      expect(result.valid).toBe(true);
    });

    test('missing event_id → invalid_schema', () => {
      const event = makeEvent();
      // @ts-expect-error — intentionally omitting required field
      delete event.event_id;
      const result = validateEvent(event);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('invalid_schema');
        expect(result.message).toContain('event_id');
      }
    });

    test('missing timestamp → invalid_schema', () => {
      const event = makeEvent();
      // @ts-expect-error
      delete event.timestamp;
      const result = validateEvent(event);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('invalid_schema');
    });

    test('invalid timestamp string → invalid_schema', () => {
      const result = validateEvent(makeEvent({ timestamp: 'not-a-date' }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('invalid_schema');
    });

    test('missing category → invalid_schema', () => {
      const event = makeEvent();
      // @ts-expect-error
      delete event.category;
      const result = validateEvent(event);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('invalid_schema');
    });

    test('invalid category value → invalid_schema', () => {
      // @ts-expect-error
      const result = validateEvent(makeEvent({ category: 'not_a_category' }));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('invalid_schema');
        expect(result.message).toContain('category');
      }
    });

    test('missing action → invalid_schema', () => {
      const event = makeEvent();
      // @ts-expect-error
      delete event.action;
      const result = validateEvent(event);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('invalid_schema');
    });

    test('missing result → invalid_schema', () => {
      const event = makeEvent();
      // @ts-expect-error
      delete event.result;
      const result = validateEvent(event);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('invalid_schema');
    });

    test('invalid result value → invalid_schema', () => {
      // @ts-expect-error
      const result = validateEvent(makeEvent({ result: 'not_a_result' }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('invalid_schema');
    });
  });

  describe('all valid categories accepted', () => {
    const categories: EventCategory[] = ['tool', 'resource', 'auth', 'session', 'escalation', 'delegation', 'error'];
    for (const cat of categories) {
      test(`category "${cat}" → valid`, () => {
        const result = validateEvent(makeEvent({ category: cat }));
        expect(result.valid).toBe(true);
      });
    }
  });

  describe('all valid results accepted', () => {
    const results: EventResult[] = ['success', 'failure', 'denied', 'timeout'];
    for (const res of results) {
      test(`result "${res}" → valid`, () => {
        const result = validateEvent(makeEvent({ result: res }));
        expect(result.valid).toBe(true);
      });
    }
  });

  describe('timestamp bounds', () => {
    test('timestamp 8 days in the past → too_old', () => {
      const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const result = validateEvent(makeEvent({ timestamp: oldTs }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('too_old');
    });

    test('timestamp 6 days in the past → valid (within 7d window)', () => {
      const ts = new Date(Date.now() - 6 * 86_400_000).toISOString();
      const result = validateEvent(makeEvent({ timestamp: ts }));
      expect(result.valid).toBe(true);
    });

    test('timestamp 6 minutes in the future → future_timestamp', () => {
      const futureTs = new Date(Date.now() + 6 * 60_000).toISOString();
      const result = validateEvent(makeEvent({ timestamp: futureTs }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('future_timestamp');
    });

    test('timestamp 4 minutes in the future → valid (within 5min tolerance)', () => {
      const ts = new Date(Date.now() + 4 * 60_000).toISOString();
      const result = validateEvent(makeEvent({ timestamp: ts }));
      expect(result.valid).toBe(true);
    });

    test('timestamp exactly now → valid', () => {
      const result = validateEvent(makeEvent({ timestamp: new Date().toISOString() }));
      expect(result.valid).toBe(true);
    });
  });

  describe('optional fields', () => {
    test('negative duration_ms → invalid_schema', () => {
      const result = validateEvent(makeEvent({ duration_ms: -1 }));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('invalid_schema');
        expect(result.message).toContain('duration_ms');
      }
    });

    test('zero duration_ms → valid', () => {
      const result = validateEvent(makeEvent({ duration_ms: 0 }));
      expect(result.valid).toBe(true);
    });

    test('positive duration_ms → valid', () => {
      const result = validateEvent(makeEvent({ duration_ms: 1500 }));
      expect(result.valid).toBe(true);
    });
  });

  describe('metadata limits', () => {
    test('10 metadata keys → valid (at limit)', () => {
      const metadata: Record<string, string> = {};
      for (let i = 0; i < 10; i++) metadata[`key_${i}`] = 'value';
      const result = validateEvent(makeEvent({ metadata }));
      expect(result.valid).toBe(true);
    });

    test('11 metadata keys → invalid_schema', () => {
      const metadata: Record<string, string> = {};
      for (let i = 0; i < 11; i++) metadata[`key_${i}`] = 'value';
      const result = validateEvent(makeEvent({ metadata }));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('invalid_schema');
        expect(result.message).toContain('10 key');
      }
    });

    test('metadata value of exactly 256 chars → valid', () => {
      const metadata = { key: 'a'.repeat(256) };
      const result = validateEvent(makeEvent({ metadata }));
      expect(result.valid).toBe(true);
    });

    test('metadata value of 257 chars → invalid_schema', () => {
      const metadata = { key: 'a'.repeat(257) };
      const result = validateEvent(makeEvent({ metadata }));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('invalid_schema');
        expect(result.message).toContain('256');
      }
    });

    test('metadata with numeric values → valid', () => {
      const result = validateEvent(makeEvent({ metadata: { count: 42, ratio: 0.95 } }));
      expect(result.valid).toBe(true);
    });

    test('metadata with boolean values → valid', () => {
      const result = validateEvent(makeEvent({ metadata: { is_cached: true } }));
      expect(result.valid).toBe(true);
    });

    test('metadata as array → invalid_schema', () => {
      // @ts-expect-error — arrays should be rejected
      const result = validateEvent(makeEvent({ metadata: ['a', 'b'] }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe('invalid_schema');
    });
  });
});

// ─── Route Handler Tests ───────────────────────────────────────────────────────

describe('POST /v1/events', () => {
  let kv: MockKV;
  let d1: MockD1;

  beforeEach(() => {
    kv = new MockKV();
    d1 = new MockD1();
  });

  describe('authentication', () => {
    test('missing account without X-PAYMENT → 402 (anonymous x402 required)', async () => {
      // Anonymous callers now get 402 (payment required) instead of 401,
      // because POST /v1/events supports anonymous access via x402 payment.
      const r = await callEvents({ events: [makeEvent()] }, { kv, d1, noAuth: true });
      expect(r.status).toBe(402);
      expect((r.body as Record<string, unknown>).x402Version).toBe(2);
    });
  });

  describe('request validation', () => {
    test('missing AUDIT binding → 503', async () => {
      const kv = new MockKV();
      // Pass no D1 — simulates missing binding
      const req = makeRequest({ events: [makeEvent()] });
      const env = {
        KEYS: kv as unknown as KVNamespace,
        // AUDIT intentionally omitted
        EMAILS: {} as KVNamespace,
        VAULT: {} as KVNamespace,
      };

      const { Hono } = await import('hono');
      const wrappedApp = new Hono();
      wrappedApp.use('*', async (c, next) => { c.set('account', makeAccount()); await next(); });
      wrappedApp.route('/', eventRoutes as unknown as Parameters<typeof wrappedApp.route>[1]);

      const ctx = new MockExecutionContext() as unknown as ExecutionContext;
      const resp = await wrappedApp.fetch(req, env, ctx);
      expect(resp.status).toBe(503);
    });

    test('invalid JSON body → 400', async () => {
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json at all',
      });
      const env = {
        KEYS: kv as unknown as KVNamespace,
        AUDIT: d1 as unknown as D1Database,
        EMAILS: {} as KVNamespace,
        VAULT: {} as KVNamespace,
      };
      const { Hono } = await import('hono');
      const wrappedApp = new Hono();
      wrappedApp.use('*', async (c, next) => { c.set('account', makeAccount()); await next(); });
      wrappedApp.route('/', eventRoutes as unknown as Parameters<typeof wrappedApp.route>[1]);
      const ctx = new MockExecutionContext() as unknown as ExecutionContext;
      const resp = await wrappedApp.fetch(req, env, ctx);
      expect(resp.status).toBe(400);
    });

    test('events is not an array → 400', async () => {
      const r = await callEvents({ events: 'not-an-array' }, { kv, d1 });
      expect(r.status).toBe(400);
    });

    test('empty events array → 400', async () => {
      const r = await callEvents({ events: [] }, { kv, d1 });
      expect(r.status).toBe(400);
    });

    test('batch exceeds 100 → 400', async () => {
      const events = Array.from({ length: 101 }, () => makeEvent());
      const r = await callEvents({ events }, { kv, d1 });
      expect(r.status).toBe(400);
      expect((r.body as { error?: string })?.error).toBe('batch_too_large');
    });
  });

  describe('successful ingestion', () => {
    test('single valid event → 202 with accepted: 1', async () => {
      const r = await callEvents({ events: [makeEvent()] }, { kv, d1 });
      expect(r.status).toBe(202);
      const body = r.body as { accepted: number; rejected: number; rate_limit: { remaining: number; reset_at: string } };
      expect(body.accepted).toBe(1);
      expect(body.rejected).toBe(0);
      expect(d1._rows.length).toBe(1);
    });

    test('multiple valid events → 202 with correct accepted count', async () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      const r = await callEvents({ events }, { kv, d1 });
      expect(r.status).toBe(202);
      const body = r.body as { accepted: number; rejected: number };
      expect(body.accepted).toBe(3);
      expect(body.rejected).toBe(0);
      expect(d1._rows.length).toBe(3);
    });

    test('response includes rate_limit.remaining and reset_at', async () => {
      const r = await callEvents({ events: [makeEvent()] }, { kv, d1 });
      const body = r.body as { rate_limit: { remaining: number; reset_at: string } };
      expect(typeof body.rate_limit.remaining).toBe('number');
      expect(body.rate_limit.remaining).toBe(FREE_HOURLY_LIMIT - 1);
      expect(typeof body.rate_limit.reset_at).toBe('string');
      // reset_at should be a valid ISO 8601 date in the future
      expect(new Date(body.rate_limit.reset_at).getTime()).toBeGreaterThan(Date.now());
    });

    test('response omits errors field when all accepted', async () => {
      const r = await callEvents({ events: [makeEvent()] }, { kv, d1 });
      const body = r.body as Record<string, unknown>;
      expect('errors' in body).toBe(false);
    });

    test('optional session_id is stored with events', async () => {
      const r = await callEvents({ events: [makeEvent()], session_id: 'session_xyz' }, { kv, d1 });
      expect(r.status).toBe(202);
      // We can verify D1 received the insert (the row exists)
      expect(d1._rows.length).toBe(1);
    });

    test('signed event (with signature field) is accepted', async () => {
      const event = makeEvent({ signature: 'base64sighere' });
      const r = await callEvents({ events: [event] }, { kv, d1 });
      expect(r.status).toBe(202);
      const body = r.body as { accepted: number };
      expect(body.accepted).toBe(1);
    });
  });

  describe('validation rejection', () => {
    test('event with too_old timestamp → rejected with error', async () => {
      const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const r = await callEvents({ events: [makeEvent({ timestamp: oldTs })] }, { kv, d1 });
      expect(r.status).toBe(202);
      const body = r.body as { accepted: number; rejected: number; errors: { event_id: string; reason: string }[] };
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(1);
      expect(body.errors[0].reason).toBe('too_old');
      expect(d1._rows.length).toBe(0);
    });

    test('event with future timestamp → rejected with error', async () => {
      const futureTs = new Date(Date.now() + 10 * 60_000).toISOString();
      const r = await callEvents({ events: [makeEvent({ timestamp: futureTs })] }, { kv, d1 });
      expect(r.status).toBe(202);
      const body = r.body as { accepted: number; rejected: number; errors: { event_id: string; reason: string }[] };
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(1);
      expect(body.errors[0].reason).toBe('future_timestamp');
    });

    test('mixed batch: valid + invalid → partial acceptance', async () => {
      const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const events = [
        makeEvent(),                              // valid
        makeEvent({ timestamp: oldTs }),           // too_old
        makeEvent(),                              // valid
      ];
      const r = await callEvents({ events }, { kv, d1 });
      expect(r.status).toBe(202);
      const body = r.body as { accepted: number; rejected: number; errors: { reason: string }[] };
      expect(body.accepted).toBe(2);
      expect(body.rejected).toBe(1);
      expect(body.errors.length).toBe(1);
      expect(body.errors[0].reason).toBe('too_old');
      expect(d1._rows.length).toBe(2);
    });
  });

  describe('deduplication', () => {
    test('same event_id submitted twice → second is idempotent (accepted: 1, no D1 insert)', async () => {
      const event = makeEvent();

      // First submission
      const r1 = await callEvents({ events: [event] }, { kv, d1 });
      expect(r1.status).toBe(202);
      expect((r1.body as { accepted: number }).accepted).toBe(1);
      expect(d1._rows.length).toBe(1);

      // KV now has the dedup key set
      // Second submission with same event_id
      const r2 = await callEvents({ events: [event] }, { kv, d1 });
      expect(r2.status).toBe(202);
      const body2 = r2.body as { accepted: number; rejected: number };
      // Idempotent: still "accepted" but no new D1 row
      expect(body2.accepted).toBe(1);
      expect(body2.rejected).toBe(0);
      // D1 still has only 1 row (dedup at KV level)
      expect(d1._rows.length).toBe(1);
    });

    test('different event_ids → both inserted (no false dedup)', async () => {
      const event1 = makeEvent();
      const event2 = makeEvent();

      const r = await callEvents({ events: [event1, event2] }, { kv, d1 });
      expect(r.status).toBe(202);
      const body = r.body as { accepted: number };
      expect(body.accepted).toBe(2);
      expect(d1._rows.length).toBe(2);
    });

    test('KV dedup key expires and event_id is re-accepted', async () => {
      const event = makeEvent();

      // First submission
      await callEvents({ events: [event] }, { kv, d1 });
      expect(d1._rows.length).toBe(1);

      // Manually clear the KV store to simulate TTL expiry
      const dedupKey = `event-dedup:acc_test123:${event.event_id}`;
      await kv.delete(dedupKey);

      // D1 has the UNIQUE constraint — INSERT OR IGNORE means re-submission
      // after KV expiry won't duplicate in D1, just returns 0 changes.
      // But the KV-level check passes, so it's counted as idempotent.
      // This is safe: the UNIQUE index catches true duplicates.
      const r2 = await callEvents({ events: [event] }, { kv, d1 });
      expect(r2.status).toBe(202);
      // D1's INSERT OR IGNORE prevents actual duplication
      expect(d1._rows.length).toBe(1); // Still 1 due to UNIQUE constraint
    });
  });

  describe('rate limiting', () => {
    test('batch accepted when count is below hourly limit', async () => {
      // Free tier: 50 events/hour. Seed with 20, which is below the limit.
      const hourKey = new Date().toISOString().slice(0, 13);
      kv._set(`event-rl:acc_test123:hour:${hourKey}`, '20');

      const r = await callEvents({ events: [makeEvent()] }, { kv, d1 });
      expect(r.status).toBe(202);
      const body = r.body as { accepted: number; rate_limit: { remaining: number } };
      expect(body.accepted).toBe(1);
      // hourly_remaining = FREE_HOURLY_LIMIT - 20 (seeded) - 1 (this event) = 29
      expect(body.rate_limit.remaining).toBe(FREE_HOURLY_LIMIT - 21);
    });

    test('batch returns 402 (x402 payment required) when hourly limit is reached', async () => {
      // Seed KV at the exact free-tier hourly limit
      const hourKey = new Date().toISOString().slice(0, 13);
      kv._set(`event-rl:acc_test123:hour:${hourKey}`, String(FREE_HOURLY_LIMIT));

      const events = [makeEvent(), makeEvent()];
      const r = await callEvents({ events }, { kv, d1 });
      // x402: rate limit exceeded with no X-PAYMENT header → 402 Payment Required
      expect(r.status).toBe(402);
      const body = r.body as { x402Version: number; error: string; accepts: unknown[] };
      expect(typeof body.x402Version).toBe('number');
      expect(typeof body.error).toBe('string');
      expect(Array.isArray(body.accepts)).toBe(true);
      // No events should be inserted when rate limited
      expect(d1._rows.length).toBe(0);
    });

    test('rate limit counter is updated after successful inserts', async () => {
      const hourKey = new Date().toISOString().slice(0, 13);
      const rlKey = `event-rl:acc_test123:hour:${hourKey}`;

      // Start fresh (no prior events this hour)
      await callEvents({ events: [makeEvent(), makeEvent()] }, { kv, d1 });

      // Check KV was updated (waitUntil runs synchronously enough in test)
      // Note: waitUntil runs the promise but we need to wait for it
      await new Promise(resolve => setTimeout(resolve, 10));

      const storedCount = await kv.get(rlKey);
      // The counter should have been updated to 2
      expect(parseInt(storedCount ?? '0', 10)).toBe(2);
    });
  });

  describe('response shape', () => {
    test('errors field absent when no rejections', async () => {
      const r = await callEvents({ events: [makeEvent()] }, { kv, d1 });
      const body = r.body as Record<string, unknown>;
      expect('errors' in body).toBe(false);
    });

    test('errors field present when some rejected', async () => {
      const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const r = await callEvents({
        events: [makeEvent({ timestamp: oldTs })],
      }, { kv, d1 });
      const body = r.body as { errors: unknown[] };
      expect(Array.isArray(body.errors)).toBe(true);
    });

    test('at most 10 errors reported regardless of batch size', async () => {
      const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const events = Array.from({ length: 20 }, () => makeEvent({ timestamp: oldTs }));
      const r = await callEvents({ events }, { kv, d1 });
      const body = r.body as { errors: unknown[] };
      expect(body.errors.length).toBeLessThanOrEqual(10);
    });

    test('each error entry has event_id and reason fields', async () => {
      const oldTs = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const event = makeEvent({ timestamp: oldTs });
      const r = await callEvents({ events: [event] }, { kv, d1 });
      const body = r.body as { errors: { event_id: string; reason: string }[] };
      expect(body.errors[0].event_id).toBe(event.event_id);
      expect(typeof body.errors[0].reason).toBe('string');
    });
  });
});
