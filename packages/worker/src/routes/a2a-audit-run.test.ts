// ─── A2A Audit Run Route — Unit tests ─────────────────────────────────────────
// Tests for GET /a2a-audit (HTML form) and POST /a2a-audit/run (x402-paywalled audit).
// Uses globalThis.fetch stubbing for x402 facilitator and audit target mocks.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { a2aAuditRunRoutes } from './a2a-audit-run.js';

// ─── Test app + mock env ──────────────────────────────────────────────────────

let mockKV: Record<string, string> = {};

function makeEnv(overrides?: Record<string, unknown>) {
  return {
    KEYS: {
      get: async (k: string) => mockKV[k] ?? null,
      put: async (k: string, v: string, _opts?: unknown) => { mockKV[k] = v; },
      delete: async (k: string) => { delete mockKV[k]; },
    },
    AUDIT_SIGNING_KEY: '0uLkhk5II9wlx1V8zyCS5I9aqSlh0hM+b5tdUVnDYLQ=',
    ...overrides,
  };
}

const mockExecutionCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
};

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/a2a-audit', a2aAuditRunRoutes);
  return app;
}

function doFetch(app: ReturnType<typeof makeApp>, req: Request, envOverrides?: Record<string, unknown>) {
  return app.fetch(req, makeEnv(envOverrides) as any, mockExecutionCtx as any);
}

// ─── Fetch stubbing ───────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
let auditCallCount = 0;

const MOCK_AGENT_CARD = {
  name: 'Test Agent',
  description: 'A test agent for unit testing the audit endpoint',
  url: 'https://example.com',
  version: '1.0.0',
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  capabilities: { streaming: true },
  skills: [{ id: 'test', name: 'Test', description: 'A test skill', tags: ['test'] }],
};

function stubFetch() {
  auditCallCount = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // x402 facilitator verify
    if (url.includes('facilitator') && url.includes('/verify')) {
      return new Response(JSON.stringify({ isValid: true, payer: '0xtest1234' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // x402 facilitator settle
    if (url.includes('facilitator') && url.includes('/settle')) {
      return new Response(JSON.stringify({ success: true, txHash: '0xabc' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Agent card fetch (audit target)
    if (url.includes('.well-known/agent') || url.endsWith('.json')) {
      auditCallCount++;
      return new Response(JSON.stringify(MOCK_AGENT_CARD), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ─── Mock payment header ──────────────────────────────────────────────────────

const MOCK_PAYMENT_HEADER = btoa(JSON.stringify({
  payload: {
    signature: '0xmocksig',
    authorization: { amount: '1000', network: 'eip155:8453' },
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('A2A Audit Run Routes', () => {
  beforeEach(() => {
    stubFetch();
    mockKV = {};
  });
  afterEach(() => restoreFetch());

  // 1. GET / returns 200 HTML with form
  test('GET / returns 200 HTML with form, agentlair.dev, input, and 0.001 USDC', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('agentlair.dev');
    expect(html).toContain('<input type="url"');
    expect(html).toContain('0.001 USDC');
  });

  // 2. POST /run with no payment returns 402
  test('POST /run with no payment returns 402 with correct x402 challenge', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
    }));
    expect(res.status).toBe(402);
    const data = await res.json() as any;
    expect(data.accepts[0].maxAmountRequired).toBe('1000');
    expect(data.accepts[0].asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  // 3. POST /run with valid payment returns 200 with audit
  test('POST /run with valid payment returns 200 with audit, receipt, and header', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': MOCK_PAYMENT_HEADER,
      },
      body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.audit.scores).toBeDefined();
    expect(data.audit.grade).toBeDefined();
    expect(data.payment_receipt).toBeDefined();
    expect(data.demo).toBe(false);
    expect(res.headers.get('X-Payment-Response')).toBeTruthy();
  });

  // 4. POST /run with self-card URL returns 200 with demo: true, no payment needed
  test('POST /run with self-card URL returns 200 demo without X-PAYMENT', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://agentlair.dev/.well-known/agent.json' }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.demo).toBe(true);
    expect(data.payment_receipt).toBeUndefined();
  });

  // 5. POST /run with private-IP URLs returns 400
  test('POST /run with private-IP URLs returns 400 invalid_url', async () => {
    const app = makeApp();
    const privateUrls = [
      'http://127.0.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/.well-known/agent.json',
    ];
    for (const url of privateUrls) {
      const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }));
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toBe('invalid_url');
    }
  });

  // 6. POST /run with malformed URLs returns 400
  test('POST /run with malformed URLs returns 400', async () => {
    const app = makeApp();
    const badUrls = ['not-a-url', '', 'ftp://example.com/x'];
    for (const url of badUrls) {
      const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }));
      expect(res.status).toBe(400);
    }
  });

  // 7. POST /run cache hit — second call skips audit, still requires payment
  test('POST /run cache hit skips audit call but still requires payment', async () => {
    const app = makeApp();

    // First call — should call auditCardUrl (which uses fetch)
    const res1 = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': MOCK_PAYMENT_HEADER,
      },
      body: JSON.stringify({ url: 'https://cache-test.example.com/.well-known/agent.json' }),
    }));
    expect(res1.status).toBe(200);
    const firstAuditCalls = auditCallCount;
    expect(firstAuditCalls).toBeGreaterThan(0);

    // Second call — same URL, should use cache (auditCallCount unchanged)
    const res2 = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': MOCK_PAYMENT_HEADER,
      },
      body: JSON.stringify({ url: 'https://cache-test.example.com/.well-known/agent.json' }),
    }));
    expect(res2.status).toBe(200);
    // Audit mock should NOT have been called again (cache hit)
    expect(auditCallCount).toBe(firstAuditCalls);
  });

  // 8. POST /run rate-limit — 31st call returns 429
  test('POST /run rate-limit returns 429 on 31st call', async () => {
    const app = makeApp();
    // Simulate 30 prior calls by pre-populating the rate limit counter
    const hour = new Date().toISOString().slice(0, 13);
    mockKV[`ip-rl:a2a-audit-run:unknown:${hour}`] = '30';

    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
    }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
  });

  // 9. Tone check — no banned words in HTML
  test('GET / response has no banned tone words', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit'));
    const html = await res.text();
    expect(html).not.toMatch(/shocking|embarrassing|terrible|awful|dangerous|risky/i);
  });
});
