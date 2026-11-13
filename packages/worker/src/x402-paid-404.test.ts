/**
 * Pipeline x402-paid-404-20261113 — settle only on delivery + advertised examples resolve.
 *
 * Rule A: a paid request for an id that does not exist returns 4xx and the facilitator
 *         /settle endpoint is called 0 times (the EIP-3009 authorization never executes).
 * Rule B: every id advertised in /.well-known/x402 resources and the bazaar.json /
 *         402 discovery `input` resolves to a paid 200 carrying every key of the
 *         listing's output example.
 *
 * Runs through the real worker entry (index.ts default export) with only the I/O seams
 * stubbed: globalThis.fetch (facilitator) and the KV / D1 bindings.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import worker from './index.js';
import { SERVICE_PRICES, settleOnDelivery } from './x402.js';
import { createJWT } from './jwt.js';
import { DEMO_AAT_JTI, DEMO_AGENT_ID } from './demo-records.js';
import { Hono } from 'hono';
import type { HonoEnv } from './types.js';
import { a2aAuditRunRoutes } from './routes/a2a-audit-run.js';

// ─── Facilitator fetch stub (counts /settle) ─────────────────────────────────

const originalFetch = globalThis.fetch;
let settleCalls = 0;
let verifyCalls = 0;

function stubFacilitator(opts: { failOther?: boolean } = {}) {
  settleCalls = 0;
  verifyCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.endsWith('/verify')) {
      verifyCalls++;
      return new Response(JSON.stringify({ isValid: true, payer: '0xa1d1c0cf717402ff3651aa4873ccf96410b01978' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/settle')) {
      settleCalls++;
      return new Response(JSON.stringify({ success: true, transaction: '0xabc', network: 'eip155:8453' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (opts.failOther) throw new Error('Failed to fetch target: connection refused');
    return new Response('not stubbed', { status: 599 });
  }) as typeof fetch;
}

// ─── Bindings ────────────────────────────────────────────────────────────────

function makeKV(seed: Record<string, string> = {}) {
  const store: Record<string, string> = { ...seed };
  return {
    get: async (k: string) => store[k] ?? null,
    put: async (k: string, v: string) => { store[k] = v; },
    delete: async (k: string) => { delete store[k]; },
    list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
    getWithMetadata: async (k: string) => ({ value: store[k] ?? null, metadata: null }),
  } as unknown as KVNamespace;
}

function makeD1() {
  const stmt = {
    bind: (..._a: unknown[]) => stmt,
    all: async () => ({ results: [] }),
    first: async () => null,
    run: async () => ({ results: [], success: true, meta: {} }),
    raw: async () => [],
  };
  return {
    prepare: (_sql: string) => stmt,
    exec: async () => ({ results: [], count: 0 }),
    batch: async () => [],
  } as unknown as D1Database;
}

function makeEnv() {
  return {
    KEYS: makeKV(),
    EMAILS: makeKV(),
    AUDIT: makeD1(),
    AGENTLAIR_HOST: 'agentlair.dev',
    JWT_SECRET: 'test-secret',
    AUDIT_SIGNING_KEY: '0uLkhk5II9wlx1V8zyCS5I9aqSlh0hM+b5tdUVnDYLQ=',
    PLATFORM_ENCRYPTION_KEY: 'x',
  } as unknown as HonoEnv['Bindings'];
}

const ctx = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const PAYMENT = btoa(JSON.stringify({
  x402Version: 2,
  payload: {
    signature: '0x' + '11'.repeat(65),
    authorization: {
      from: '0xa1d1c0cf717402ff3651aa4873ccf96410b01978',
      to: '0x90EE1EbcCFA2021711C595E1410e22401570B4AC',
      value: '10000', validAfter: '0', validBefore: '9999999999', nonce: '0x' + '22'.repeat(32),
    },
  },
}));

function get(path: string, paid = true) {
  return worker.fetch(
    new Request(`https://agentlair.dev${path}`, {
      headers: { Accept: 'application/json', ...(paid ? { 'X-PAYMENT': PAYMENT } : {}) },
    }),
    makeEnv() as never,
    ctx,
  );
}

function post(path: string, body: unknown) {
  return worker.fetch(
    new Request(`https://agentlair.dev${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-PAYMENT': PAYMENT },
      body: JSON.stringify(body),
    }),
    makeEnv() as never,
    ctx,
  );
}

beforeEach(() => stubFacilitator());
afterEach(() => { globalThis.fetch = originalFetch; });

// ─── Rule A ──────────────────────────────────────────────────────────────────

describe('Rule A — a miss never settles', () => {
  const misses: Array<[string, string]> = [
    ['audit_lookup: unknown jti', '/v1/audit/aat_ZZZZZZZZZZZZZZZZ'],
    ['memory_trust: unknown agent', '/v1/agents/acc_doesnotexist99/memory-trust'],
    ['agent_lookup: unknown id', '/v1/agents/lookup?id=acc_doesnotexist99'],
    ['agent_lookup: unknown handle', '/v1/agents/lookup?handle=no-such-agent'],
    ['agent_lookup: missing query param', '/v1/agents/lookup'],
    ['agent_lookup by name: unknown', '/agents/no-such-agent'],
  ];
  for (const [label, path] of misses) {
    test(`${label} → 4xx, verify called, settle called 0×`, async () => {
      const res = await get(path);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.status).not.toBe(402);
      expect(verifyCalls).toBe(1);
      expect(settleCalls).toBe(0);
      expect(res.headers.get('X-Payment-Response')).toBeNull();
    });
  }

  test('trust_query batch: bad body → 400, settle 0×', async () => {
    const res = await post('/v1/trust/batch', { agent_id: DEMO_AGENT_ID });
    expect(res.status).toBe(400);
    expect(verifyCalls).toBe(1);
    expect(settleCalls).toBe(0);
  });

  test('trust_query: backend missing → 503, settle 0×', async () => {
    const env = makeEnv() as unknown as Record<string, unknown>;
    delete env.AUDIT;
    const res = await worker.fetch(
      new Request(`https://agentlair.dev/v1/trust/${DEMO_AGENT_ID}`, { headers: { 'X-PAYMENT': PAYMENT } }),
      env as never, ctx,
    );
    expect(res.status).toBe(503);
    expect(settleCalls).toBe(0);
  });

  test('a2a_audit_run: audit fetch fails after reachability → 502, settle 0×', async () => {
    // HEAD succeeds, GET of the card fails → old code settled first, then 502'd.
    settleCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.endsWith('/verify')) return new Response(JSON.stringify({ isValid: true, payer: '0xa1d1' }), { status: 200 });
      if (url.endsWith('/settle')) { settleCalls++; return new Response(JSON.stringify({ success: true }), { status: 200 }); }
      if (init?.method === 'HEAD') return new Response(null, { status: 200 });
      throw new Error('Failed to fetch https://example.com/.well-known/agent.json: 500');
    }) as typeof fetch;
    const app = new Hono<HonoEnv>();
    app.route('/a2a-audit', a2aAuditRunRoutes);
    const res = await app.fetch(
      new Request('https://agentlair.dev/a2a-audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PAYMENT': PAYMENT, Accept: 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
      }),
      makeEnv() as never, ctx,
    );
    expect(res.status).toBe(502);
    expect(settleCalls).toBe(0);
  });

  test('positive control: delivered response settles exactly once', async () => {
    const res = await get(`/v1/audit/${DEMO_AAT_JTI}`);
    expect(res.status).toBe(200);
    expect(settleCalls).toBe(1);
  });

  test('unpaid request still 402 (format check unchanged, nonexistent id too)', async () => {
    const res = await get('/v1/audit/aat_ZZZZZZZZZZZZZZZZ', false);
    expect(res.status).toBe(402);
    expect(verifyCalls).toBe(0);
  });
});

describe('settleOnDelivery helper', () => {
  const paid = { xPayment: PAYMENT, service: SERVICE_PRICES.audit_lookup, serviceName: 'audit_lookup' };
  test('status >= 400 passes through unsettled', async () => {
    for (const status of [400, 404, 500, 503]) {
      const res = await settleOnDelivery(makeEnv() as never, () => {}, paid, new Response('{}', { status }));
      expect(res.status).toBe(status);
    }
    expect(settleCalls).toBe(0);
  });
  test('2xx settles once and carries X-Payment-Response', async () => {
    const res = await settleOnDelivery(makeEnv() as never, () => {}, paid, new Response('{}', { status: 200 }));
    expect(res.status).toBe(200);
    expect(settleCalls).toBe(1);
    expect(res.headers.get('X-Payment-Response')).not.toBeNull();
  });
});

// ─── Rule B ──────────────────────────────────────────────────────────────────

function outputKeys(service: keyof typeof SERVICE_PRICES): string[] {
  const d = SERVICE_PRICES[service].discovery as { output?: { example?: Record<string, unknown> } } | undefined;
  return Object.keys(d?.output?.example ?? {});
}

async function expectDelivered(res: Response, keys: string[]) {
  expect(res.status).toBe(200);
  expect(settleCalls).toBe(1);
  const body = await res.json() as Record<string, unknown>;
  expect(keys.length).toBeGreaterThan(0); // floor: an empty example would pass vacuously
  for (const k of keys) expect(Object.keys(body)).toContain(k);
  return body;
}

describe('Rule B — every advertised example resolves', () => {
  test('/.well-known/x402 resources: each paid GET → 200 with listing output keys', async () => {
    const wk = await (await get('/.well-known/x402', false)).json() as { resources: string[] };
    expect(wk.resources.length).toBeGreaterThanOrEqual(2);
    const keysFor = (u: string) =>
      u.includes('/v1/audit/') ? outputKeys('audit_lookup')
        : u.includes('/memory-trust') ? outputKeys('memory_trust')
          : null;
    for (const u of wk.resources) {
      const keys = keysFor(u);
      expect(keys).not.toBeNull(); // a new resource must be mapped here, not skipped
      stubFacilitator();
      const body = await expectDelivered(await get(new URL(u).pathname), keys!);
      expect(body.demo).toBe(true);
    }
  });

  test('bazaar.json id-keyed services: discovery input → paid 200 with output keys', async () => {
    const bz = await (await get('/.well-known/bazaar.json', false)).json() as {
      services: Array<{ endpoint: string; method: string; discovery?: { input?: Record<string, string> } }>;
    };
    const idKeyed = bz.services.filter((s) => s.method === 'GET');
    expect(idKeyed.length).toBeGreaterThanOrEqual(3);
    for (const s of idKeyed) {
      const input = s.discovery?.input ?? {};
      let path = s.endpoint;
      let service: keyof typeof SERVICE_PRICES;
      if (path === '/v1/trust/{agentId}') { path = `/v1/trust/${input.agent_id}`; service = 'trust_query'; }
      else if (path === '/v1/audit/{jti}') { path = `/v1/audit/${input.jti}`; service = 'audit_lookup'; }
      else if (path === '/v1/agents/lookup') { path = `${path}?${new URLSearchParams(input)}`; service = 'agent_lookup'; }
      else throw new Error(`unmapped bazaar GET service ${s.endpoint}`);
      stubFacilitator();
      await expectDelivered(await get(path), outputKeys(service));
    }
  });

  test('bazaar.json POST services: discovery input → paid 200 with output keys', async () => {
    const bz = await (await get('/.well-known/bazaar.json', false)).json() as {
      services: Array<{ endpoint: string; method: string; discovery?: { input?: Record<string, unknown>; output?: { example?: Record<string, unknown> } } }>;
    };
    const posts = bz.services.filter((s) => s.method === 'POST');
    expect(posts.length).toBeGreaterThanOrEqual(2);
    for (const s of posts) {
      const input = s.discovery?.input;
      const keys = Object.keys(s.discovery?.output?.example ?? {});
      stubFacilitator();
      const res = await post(s.endpoint, input);
      if (s.endpoint === '/v1/trust/batch') {
        const body = await expectDelivered(res, keys);
        expect(body.computed).toBe(1);
        expect((body.errors as unknown[]).length).toBe(0);
      } else if (s.endpoint === '/v1/auth/verify') {
        // Example token is not ours → a delivered verdict {active:false}; the listed
        // keys are checked against a live AAT below.
        const body = await expectDelivered(res, ['active']);
        expect(body.active).toBe(false);
        const now = Math.floor(Date.now() / 1000);
        const aat = createJWT({
          iss: 'https://agentlair.dev', sub: 'acc_demoid12345', aud: 'https://example.com',
          exp: now + 600, iat: now, jti: 'aat_demo1234567890ab',
          al_scopes: ['email'], al_audit_url: 'https://agentlair.dev/v1/audit/aat_demo1234567890ab',
        }, makeEnv().AUDIT_SIGNING_KEY, 'k1');
        stubFacilitator();
        const live = await expectDelivered(await post(s.endpoint, { token: aat }), keys);
        expect(live.active).toBe(true);
        expect(Object.keys(live).sort()).toEqual([...keys].sort()); // no undocumented keys either
      } else throw new Error(`unmapped bazaar POST service ${s.endpoint}`);
    }
  });

  test('402 discovery inputs use the single demo id per type', () => {
    expect((SERVICE_PRICES.audit_lookup.discovery as { input: Record<string, string> }).input.jti).toBe(DEMO_AAT_JTI);
    expect((SERVICE_PRICES.agent_lookup.discovery as { input: Record<string, string> }).input.id).toBe(DEMO_AGENT_ID);
    expect((SERVICE_PRICES.trust_query.discovery as { input: Record<string, string> }).input.agent_id).toBe(DEMO_AGENT_ID);
    expect((SERVICE_PRICES.memory_trust.discovery as { input: Record<string, string> }).input.agent_id).toBe(DEMO_AGENT_ID);
  });
});
