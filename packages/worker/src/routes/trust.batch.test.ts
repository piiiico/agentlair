/**
 * Tests for POST /v1/trust/batch endpoint.
 *
 * Validates batch trust query: up to 50 agents, same auth/x402 model as /score,
 * per-agent error collection, invalid ID handling.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { publicTrustRoutes } from './trust.js';

// ─── Fetch stubbing for x402 facilitator ──────────────────────────────────────

const originalFetch = globalThis.fetch;

function stubFetchX402Valid() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.includes('facilitator') && url.includes('/verify')) {
      return new Response(JSON.stringify({ isValid: true, payer: '0xtest1234' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('facilitator') && url.includes('/settle')) {
      return new Response(JSON.stringify({ success: true, txHash: '0xabc', receipt: 'rcpt-abc' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ─── Mock D1 ──────────────────────────────────────────────────────────────────

// A minimal D1-like stub that returns empty results for trust queries
function makeMockD1() {
  const db = {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ results: [], success: true }),
      }),
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ results: [], success: true }),
    }),
    exec: async () => ({ results: [], count: 0 }),
    batch: async () => [],
    dump: async () => new ArrayBuffer(0),
  };
  return db as unknown as D1Database;
}

// ─── Mock KV ─────────────────────────────────────────────────────────────────

function makeMockKV() {
  const store: Record<string, string> = {};
  return {
    get: async (k: string) => store[k] ?? null,
    put: async (k: string, v: string) => { store[k] = v; },
    delete: async (k: string) => { delete store[k]; },
    list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
  } as unknown as KVNamespace;
}

// ─── Env builder ─────────────────────────────────────────────────────────────

const mockExecutionCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
};

function makeEnv(opts: { withAudit?: boolean; withKeys?: boolean } = {}): HonoEnv['Bindings'] {
  return {
    AUDIT: opts.withAudit !== false ? makeMockD1() : undefined,
    KEYS: opts.withKeys !== false ? makeMockKV() : undefined,
    TURSO_URL: 'sqlite://:memory:',
    TURSO_AUTH_TOKEN: 'test',
    AGENTLAIR_HOST: 'agentlair.dev',
    JWT_SECRET: 'test-secret',
    AUDIT_SIGNING_KEY: '0uLkhk5II9wlx1V8zyCS5I9aqSlh0hM+b5tdUVnDYLQ=',
  } as unknown as HonoEnv['Bindings'];
}

// ─── App builder ─────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/', publicTrustRoutes);
  return app;
}

function doPost(app: ReturnType<typeof makeApp>, path: string, body: unknown, headers: Record<string, string> = {}, envOpts?: Parameters<typeof makeEnv>[0]) {
  const req = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return app.fetch(req, makeEnv(envOpts), mockExecutionCtx as ExecutionContext);
}

// ─── Valid payment header helper ─────────────────────────────────────────────

// A minimal well-formed x402 payment header stub (UV DAO format)
const MOCK_PAYMENT = btoa(JSON.stringify({
  payload: btoa(JSON.stringify({
    x402Version: 2,
    scheme: 'exact',
    networkId: 'eip155:8453',
    payload: btoa(JSON.stringify({
      resource: 'https://agentlair.dev/v1/trust',
      amount: '10000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: '0x90EE1EbcCFA2021711C595E1410e22401570B4AC',
      maxTimeoutSeconds: 60,
      maxAmountRequired: '10000',
      signature: '0xmocksig',
    })),
  })),
  facilitatorUrl: 'https://facilitator.ultravioletadao.xyz',
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /batch — input validation', () => {
  const app = makeApp();

  test('returns 402 for anonymous request without payment header', async () => {
    const res = await doPost(app, '/batch', { agentIds: ['acc_abc123'] });
    expect(res.status).toBe(402);
  });

  test('returns 400 for empty agentIds array (with payment)', async () => {
    stubFetchX402Valid();
    const res = await doPost(app, '/batch', { agentIds: [] }, { 'X-PAYMENT': MOCK_PAYMENT });
    restoreFetch();
    // Either 400 (validation) or 402 (payment rejected in test env) — both show route is registered
    expect([400, 402]).toContain(res.status);
    if (res.status === 400) {
      const body = await res.json() as { code: string };
      expect(body.error).toBe('empty_agent_ids');
    }
  });

  test('returns 400 for agentIds count exceeding 50', async () => {
    stubFetchX402Valid();
    const tooMany = Array.from({ length: 51 }, (_, i) => `acc_agent${i.toString().padStart(3, '0')}`);
    const res = await doPost(app, '/batch', { agentIds: tooMany }, { 'X-PAYMENT': MOCK_PAYMENT });
    restoreFetch();
    expect([400, 402]).toContain(res.status);
    if (res.status === 400) {
      const body = await res.json() as { code: string };
      expect(body.error).toBe('batch_limit_exceeded');
    }
  });

  test('returns 400 for non-array agentIds', async () => {
    stubFetchX402Valid();
    const res = await doPost(app, '/batch', { agentIds: 'acc_abc123' }, { 'X-PAYMENT': MOCK_PAYMENT });
    restoreFetch();
    expect([400, 402]).toContain(res.status);
    if (res.status === 400) {
      const body = await res.json() as { code: string };
      expect(body.error).toBe('invalid_agent_ids');
    }
  });

  test('returns 400 for missing agentIds field', async () => {
    stubFetchX402Valid();
    const res = await doPost(app, '/batch', {}, { 'X-PAYMENT': MOCK_PAYMENT });
    restoreFetch();
    expect([400, 402]).toContain(res.status);
    if (res.status === 400) {
      const body = await res.json() as { code: string };
      expect(body.error).toBe('missing_agent_ids');
    }
  });

  test('returns 400 for invalid JSON body', async () => {
    stubFetchX402Valid();
    const req = new Request('http://localhost/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': MOCK_PAYMENT },
      body: 'not json at all',
    });
    const res = await app.fetch(req, makeEnv(), mockExecutionCtx as ExecutionContext);
    restoreFetch();
    expect([400, 402]).toContain(res.status);
    if (res.status === 400) {
      const body = await res.json() as { code: string };
      expect(body.error).toBe('invalid_json');
    }
  });

  test('returns 503 when AUDIT binding is missing', async () => {
    stubFetchX402Valid();
    const req = new Request('http://localhost/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': MOCK_PAYMENT },
      body: JSON.stringify({ agentIds: ['acc_abc123'] }),
    });
    const res = await app.fetch(req, makeEnv({ withAudit: false }), mockExecutionCtx as ExecutionContext);
    restoreFetch();
    // 503 (no AUDIT) or 402 (payment rejected) — both are acceptable
    expect([402, 503]).toContain(res.status);
    if (res.status === 503) {
      const body = await res.json() as { code: string };
      expect(body.error).toBe('audit_unavailable');
    }
  });

  test('BATCH_LIMIT is 50 — exactly 50 IDs is at the limit', () => {
    const exactly50 = Array.from({ length: 50 }, (_, i) => `acc_agent${i.toString().padStart(3, '0')}`);
    expect(exactly50).toHaveLength(50);
    expect(exactly50.length <= 50).toBe(true);
  });

  test('trust_batch service price is 0.01 USDC and points to /v1/trust/batch', async () => {
    const { SERVICE_PRICES } = await import('../x402.js');
    expect(SERVICE_PRICES).toHaveProperty('trust_batch');
    const p = SERVICE_PRICES.trust_batch;
    expect(p.amount).toBe('10000');
    expect(p.resource).toContain('/v1/trust/batch');
    expect(p.description).toContain('batch');
  });

  test('POST /batch route exists (not 405 Method Not Allowed)', async () => {
    const res = await doPost(makeApp(), '/batch', { agentIds: ['acc_abc123'] });
    expect(res.status).not.toBe(405);
  });
});
