/**
 * OperatorProfile route tests — HTTP integration tests.
 *
 * Covers:
 *   PUT /profile — happy path, unauth, invalid JSON, body too large, validation failure,
 *                  replace-existing
 *   GET /profile — happy path after PUT, 404 when unset
 *
 * All tests are hermetic: in-memory D1 mock, no network, no live AUDIT secret.
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { operatorProfileRoutes } from './operator-profile.js';
import type { HonoEnv } from '../types.js';
import type { Account } from '../types.js';

// ─── D1 mock for operator_profiles ───────────────────────────────────────────

interface MockD1 extends D1Database {
  store: Map<string, Record<string, unknown>>;
}

function makeMockD1(): MockD1 {
  const store: Map<string, Record<string, unknown>> = new Map();

  const makeStmt = (sql: string) => {
    let bindings: unknown[] = [];

    const stmt = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        const q = sql.trim().toLowerCase();

        // SELECT
        if (q.includes('from operator_profiles') && q.includes('where account_id')) {
          const accountId = bindings[0] as string;
          const row = store.get(accountId);
          return (row ?? null) as T | null;
        }

        // INSERT ... ON CONFLICT ... RETURNING
        if (q.includes('insert into operator_profiles') && q.includes('returning')) {
          const [accountId, attestationWorkflowJson, reviewBandwidthJson] = bindings as string[];
          const now = new Date().toISOString();
          const existing = store.get(accountId!);
          const row: Record<string, unknown> = {
            account_id: accountId,
            attestation_workflow_json: attestationWorkflowJson,
            review_bandwidth_json: reviewBandwidthJson,
            created_at: existing ? (existing['created_at'] as string) : now,
            updated_at: now,
          };
          store.set(accountId!, row);
          return row as T;
        }

        return null as T | null;
      },
      async all<T>(): Promise<D1Result<T>> {
        return { results: [] as T[], success: true, meta: {} as D1ResultInfo };
      },
      async run(): Promise<D1Result<Record<string, unknown>>> {
        return { results: [], success: true, meta: {} as D1ResultInfo };
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
  } as unknown as MockD1;
}

// ─── Test app builder ─────────────────────────────────────────────────────────

function makeAccount(id: string): Account {
  return { id, plan: 'free' };
}

function makeTestApp(account: Account | null, db: MockD1 | null) {
  const app = new Hono<HonoEnv>();

  app.use('*', async (c, next) => {
    c.set('account', account);
    await next();
  });

  app.route('/', operatorProfileRoutes);

  const env: Record<string, unknown> = {};
  if (db) env['AUDIT'] = db;

  return { app, env };
}

// ─── Fixture body ─────────────────────────────────────────────────────────────

const FIXTURE_BODY = {
  attestationWorkflow: {
    declaredTier: 'automated_tooling',
    declaredTools: ['cargo-test', 'clippy', 'miri'],
    coverageEstimate: 0.85,
    priorCoverage: 0.4,
  },
  reviewBandwidth: {
    reviewersCount: 2,
    unitsPerHour: 200,
    timeToNextApprovalHours: 8,
    unitType: 'lines',
  },
};

// ─── PUT /profile tests ───────────────────────────────────────────────────────

describe('PUT /profile', () => {
  test('happy path — 200 with full response body', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_put_happy'), db);

    const res = await app.request('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE_BODY),
    }, env as unknown as Record<string, string>);

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('accountId');
    expect(body).toHaveProperty('attestationWorkflow');
    expect(body).toHaveProperty('reviewBandwidth');
    expect(body).toHaveProperty('createdAt');
    expect(body).toHaveProperty('updatedAt');
  });

  test('unauth — 401 unauthorized', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db);

    const res = await app.request('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE_BODY),
    }, env as unknown as Record<string, string>);

    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body['error']).toBe('unauthorized');
  });

  test('invalid JSON — 400 invalid_json', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_invalid_json'), db);

    const res = await app.request('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }, env as unknown as Record<string, string>);

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body['error']).toBe('invalid_json');
  });

  test('body too large — 413 body_too_large', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_too_large'), db);

    const largeBody = 'x'.repeat(8 * 1024 + 1);

    const res = await app.request('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: largeBody,
    }, env as unknown as Record<string, string>);

    expect(res.status).toBe(413);
    const body = await res.json() as Record<string, unknown>;
    expect(body['error']).toBe('body_too_large');
  });

  test('validation failure — missing declaredTier yields 400 invalid_declared_tier', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_invalid_tier'), db);

    const badBody = {
      attestationWorkflow: {
        // missing declaredTier
        declaredTools: [],
        coverageEstimate: 0.5,
      },
      reviewBandwidth: {
        reviewersCount: 1,
        unitsPerHour: 100,
        timeToNextApprovalHours: 4,
        unitType: 'lines',
      },
    };

    const res = await app.request('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(badBody),
    }, env as unknown as Record<string, string>);

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body['error']).toBe('invalid_declared_tier');
  });

  test('PUT replaces existing — second PUT reflects new values, subsequent GET returns second body', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_replace'), db);

    // First PUT
    const firstBody = { ...FIXTURE_BODY };
    await app.request('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(firstBody),
    }, env as unknown as Record<string, string>);

    // Second PUT with different values
    const secondBody = {
      attestationWorkflow: {
        declaredTier: 'independent_review',
        declaredTools: ['peer-review'],
        coverageEstimate: 0.6,
        priorCoverage: 0.3,
      },
      reviewBandwidth: {
        reviewersCount: 3,
        unitsPerHour: 50,
        timeToNextApprovalHours: 24,
        unitType: 'decisions',
      },
    };

    const secondRes = await app.request('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(secondBody),
    }, env as unknown as Record<string, string>);

    expect(secondRes.status).toBe(200);
    const secondData = await secondRes.json() as Record<string, unknown>;
    const aw = secondData['attestationWorkflow'] as Record<string, unknown>;
    expect(aw['declaredTier']).toBe('independent_review');

    // GET should return second body
    const getRes = await app.request('/profile', { method: 'GET' }, env as unknown as Record<string, string>);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json() as Record<string, unknown>;
    const awGet = getData['attestationWorkflow'] as Record<string, unknown>;
    expect(awGet['declaredTier']).toBe('independent_review');
  });
});

// ─── GET /profile tests ───────────────────────────────────────────────────────

describe('GET /profile', () => {
  test('happy path — after PUT returns stored row with identical nested structures', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_get_happy'), db);

    // PUT first
    await app.request('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE_BODY),
    }, env as unknown as Record<string, string>);

    // GET
    const res = await app.request('/profile', { method: 'GET' }, env as unknown as Record<string, string>);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['attestationWorkflow']).toEqual(FIXTURE_BODY.attestationWorkflow);
    expect(body['reviewBandwidth']).toEqual(FIXTURE_BODY.reviewBandwidth);
    expect(typeof body['createdAt']).toBe('string');
    expect((body['createdAt'] as string).length).toBeGreaterThan(0);
  });

  test('not found — fresh account, no PUT yields 404 not_found', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_get_not_found'), db);

    const res = await app.request('/profile', { method: 'GET' }, env as unknown as Record<string, string>);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body['error']).toBe('not_found');
  });
});
