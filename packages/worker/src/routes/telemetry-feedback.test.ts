/**
 * HTTP integration tests for POST /v1/telemetry/feedback.
 * Phase 2.5 Component 4 — spec: agentlair-trust-telemetry-feedback-20260515
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { telemetryFeedbackRoutes } from './telemetry-feedback.js';
import type { HonoEnv } from '../types.js';
import type { Account } from '../types.js';

// ─── Mock D1 ──────────────────────────────────────────────────────────────────

function makeMockD1() {
  const store: Map<string, unknown> = new Map();

  const makeStmt = (sql: string) => {
    let bindings: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async run(): Promise<{ success: boolean; meta: object }> {
        const q = sql.trim().toLowerCase();
        if (q.includes('insert into telemetry_feedback')) {
          const account_id = bindings[1] as string;
          const claim_id = bindings[2] as string;
          const key = `${account_id}::${claim_id}`;
          if (store.has(key)) {
            throw new Error('UNIQUE constraint failed: telemetry_feedback.account_id, telemetry_feedback.claim_id');
          }
          store.set(key, { account_id, claim_id });
          return { success: true, meta: {} };
        }
        return { success: true, meta: {} };
      },
      async first<T>(): Promise<T | null> {
        return null as T | null;
      },
      async all<T>(): Promise<{ results: T[]; success: boolean; meta: object }> {
        return { results: [], success: true, meta: {} };
      },
    };
    return stmt;
  };

  return {
    prepare: makeStmt,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    store,
  } as unknown as D1Database;
}

// ─── Test app builder ─────────────────────────────────────────────────────────

function makeAccount(id: string): Account {
  return { id, plan: 'free' };
}

function makeTestApp(account: Account | null, db: D1Database | null) {
  const app = new Hono<HonoEnv>();

  app.use('*', async (c, next) => {
    c.set('account', account);
    await next();
  });

  app.route('/', telemetryFeedbackRoutes);

  const env: Record<string, unknown> = {};
  if (db) env['AUDIT'] = db;

  return { app, env };
}

const VALID_BODY = {
  claim_id: 'claim_abc_001',
  outcome_correct: true,
  evidence_type: 'integration_test',
  confidence_stated: 0.9,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /feedback', () => {
  test('unauth → 401 unauthorized', async () => {
    const { app, env } = makeTestApp(null, makeMockD1());
    const res = await app.request('/feedback', { method: 'POST', body: JSON.stringify(VALID_BODY) }, env);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  test('happy path → 200 with ok:true and id', async () => {
    const { app, env } = makeTestApp(makeAccount('acc_test'), makeMockD1());
    const res = await app.request(
      '/feedback',
      { method: 'POST', body: JSON.stringify(VALID_BODY), headers: { 'Content-Type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
  });

  test('invalid JSON → 400 invalid_json', async () => {
    const { app, env } = makeTestApp(makeAccount('acc_test'), makeMockD1());
    const res = await app.request('/feedback', { method: 'POST', body: 'not-json' }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_json');
  });

  test('validation failure (missing claim_id) → 400 invalid_claim_id', async () => {
    const { app, env } = makeTestApp(makeAccount('acc_test'), makeMockD1());
    const badBody = { outcome_correct: true, evidence_type: 'integration_test' };
    const res = await app.request(
      '/feedback',
      { method: 'POST', body: JSON.stringify(badBody) },
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_claim_id');
  });

  test('duplicate claim_id → 409 duplicate_claim_feedback', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db);
    const postOnce = () =>
      app.request(
        '/feedback',
        { method: 'POST', body: JSON.stringify(VALID_BODY), headers: { 'Content-Type': 'application/json' } },
        env,
      );
    await postOnce();
    const res2 = await postOnce();
    expect(res2.status).toBe(409);
    const body = await res2.json() as { error: string };
    expect(body.error).toBe('duplicate_claim_feedback');
  });

  test('audit_unavailable → 503', async () => {
    const { app, env } = makeTestApp(makeAccount('acc_test'), null);
    const res = await app.request(
      '/feedback',
      { method: 'POST', body: JSON.stringify(VALID_BODY) },
      env,
    );
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('audit_unavailable');
  });

  test('GET /feedback → 404 (no GET handler mounted)', async () => {
    const { app, env } = makeTestApp(makeAccount('acc_test'), makeMockD1());
    const res = await app.request('/feedback', { method: 'GET' }, env);
    expect(res.status).toBe(404);
  });
});
