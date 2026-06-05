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
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = ((init?.method) ?? 'GET').toUpperCase();

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
    // Pre-flight HEAD for audit target — return 200 without counting as audit call
    if (method === 'HEAD' && (url.includes('.well-known/agent') || url.endsWith('.json'))) {
      return new Response(null, { status: 200 });
    }
    // Agent card GET fetch (audit target) — count as audit call
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
    expect(data.accepts[0].amount).toBe('1000');
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

  // 10. Share buttons exist in the HTML (DOM markup check)
  test('GET / contains share button and viral flow markup', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit'));
    const html = await res.text();
    expect(html).toContain('id="share-x"');
    expect(html).toContain('id="share-fc"');
    expect(html).toContain('id="audit-another"');
    expect(html).toContain('id="permalink-link"');
    expect(html).toContain('<details id="embed-panel">');
    expect(html).toContain('id="copy-permalink"');
  });

  // 11. Share copy templates literally present in HTML JS
  test('GET / contains voice-checked share copy templates', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit'));
    const html = await res.text();
    expect(html).toContain('I audited my A2A agent card on @agentlair_dev — grade ');
    expect(html).toContain('/100. Audit yours: agentlair.dev/a2a-audit');
    expect(html).toContain('Audited ');
    expect(html).toContain(' — A2A trust grade ');
    expect(html).toContain(', L1 to L4 broken down. Run yours at agentlair.dev/a2a-audit');
    expect(html).toContain('View on AgentLair');
    expect(html).toContain('Audit another card');
    expect(html).toContain('Embed your badge');
  });

  // 12. Share URLs construct correctly (intent URL formats)
  test('GET / contains correct share intent URL prefixes', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit'));
    const html = await res.text();
    expect(html).toContain('https://twitter.com/intent/tweet?text=');
    expect(html).toContain('https://warpcast.com/~/compose?text=');
    expect(html).toContain('&embeds[]=');
    expect(html).toContain('https://agentlair.dev/a2a/');
    expect(html).toContain('https://agentlair.dev/badge/a2a/');
  });

  // 13. Banned voice words absent (extended set)
  test('GET / response has no banned voice words (extended set)', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit'));
    const html = await res.text();
    expect(html).not.toMatch(/shocking|embarrassing|terrible|awful|dangerous|risky|cringe|lame|stupid/i);
  });

  // 14. b64url helper unchanged & reused (exactly one definition)
  test('GET / contains exactly one b64url helper definition', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit'));
    const html = await res.text();
    const matches = html.match(/function b64url\(s\)\{/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  // 15. Pre-existing assertions still pass (implicit via test 1, explicit check here)
  test('GET / still contains pre-existing form elements and pricing', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit'));
    const html = await res.text();
    expect(html).toContain('agentlair.dev');
    expect(html).toContain('<input type="url"');
    expect(html).toContain('0.001 USDC');
    expect(html).toContain('id="audit-form"');
    expect(html).toContain('id="demo-btn"');
  });

  // 16. WHY-CARE lede present + broken /blog/x402 link absent
  test('GET / contains WHY-CARE lede and has no bare /blog/x402 link', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit'));
    const html = await res.text();
    expect(html).toContain('skin in the game');
    expect(html).not.toContain('href="/blog/x402"');
  });

  // 17. Pre-flight rejects unreachable target without settling
  test('pre-flight rejects unreachable target without settling', async () => {
    let settleCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = ((init?.method) ?? 'GET').toUpperCase();
      if (url.includes('facilitator') && url.includes('/verify')) {
        return new Response(JSON.stringify({ isValid: true, payer: '0xtest1234' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('facilitator') && url.includes('/settle')) {
        settleCalled = true;
        return new Response(JSON.stringify({ success: true, txHash: '0xabc' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'HEAD') {
        // Target unreachable
        return new Response(null, { status: 404 });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': MOCK_PAYMENT_HEADER },
      body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
    }));

    expect(settleCalled).toBe(false);
    expect(res.status).toBe(402);
    const data = await res.json() as any;
    expect(data.payment_error).toBe('target_unreachable');
  });

  // 18. Pre-flight allows reachable target through to settle
  test('pre-flight allows reachable target through to settle', async () => {
    // Default stubFetch handles HEAD (via .well-known/agent match → 200) + verify + settle
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': MOCK_PAYMENT_HEADER },
      body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
    }));

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.audit?.scores).toBeDefined();
    expect(res.headers.get('X-Payment-Response')).toBeTruthy();
  });

  // 19. Post-settle audit_failed returns settlement receipt in body and header
  test('post-settle audit_failed returns settlement receipt in body and header', async () => {
    let auditFetchCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = ((init?.method) ?? 'GET').toUpperCase();
      if (url.includes('facilitator') && url.includes('/verify')) {
        return new Response(JSON.stringify({ isValid: true, payer: '0xtest1234' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('facilitator') && url.includes('/settle')) {
        return new Response(JSON.stringify({ success: true, txHash: '0xdeadbeef' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'HEAD') {
        // Pre-flight succeeds
        return new Response(null, { status: 200 });
      }
      // GET (audit fetch) — simulate unreachable / bad JSON to trigger auditCardUrl throw
      auditFetchCount++;
      throw new Error('simulated fetch failure after settlement');
    }) as typeof fetch;

    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': MOCK_PAYMENT_HEADER },
      body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
    }));

    expect(res.status).toBe(502);
    const data = await res.json() as any;
    expect(data.error).toBe('audit_failed');
    // payment_receipt = btoa(JSON.stringify({ success: true, txHash: '0xdeadbeef' }))
    expect(data.payment_receipt).toBeDefined();
    expect(data.settlement_tx).toBe('0xdeadbeef');
    expect(data.refund_note).toContain('api@agentlair.dev');
    expect(res.headers.get('X-Payment-Response')).toBeTruthy();
  });

  // A2A-F2-1: api.agentlair.dev target returns 200 demo audit (isSelfUrl covers subdomain)
  // Verifies the CF inside-zone fix: api.agentlair.dev is now treated as self-card,
  // so the worker never attempts a network fetch to its own zone.
  test('A2A-F2-1: api.agentlair.dev target returns 200 demo audit without payment', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No X-PAYMENT header — should be free demo, same as agentlair.dev apex
      body: JSON.stringify({ url: 'https://api.agentlair.dev/.well-known/agent.json' }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.demo).toBe(true);
    expect(data.audit).toBeDefined();
    expect(data.audit.scores).toBeDefined();
    expect(data.audit.grade).toBeDefined();
    // Confirm no network fetch was made to api.agentlair.dev (auditCallCount unchanged)
    expect(auditCallCount).toBe(0);
  });

  // ─── Spread HTML tests ──────────────────────────────────────────────────────

  // SPREAD-1: JSON unchanged by default (no Accept / no ?spread=1)
  test('SPREAD-1 JSON-UNCHANGED-DEFAULT: POST with no Accept returns JSON', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://agentlair.dev/' }),
    }));
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('application/json');
    const data = await res.json() as any;
    expect(data.audit).toBeDefined();
    expect(data.demo).toBe(true);
  });

  // SPREAD-2: HTML on Accept: text/html
  test('SPREAD-2 HTML-ON-ACCEPT: POST with Accept text/html returns HTML spread panel', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ url: 'https://agentlair.dev/' }),
    }));
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/html');
    expect(ct).toContain('charset=utf-8');
    const html = await res.text();
    expect(html).toContain('<section data-spread>');
  });

  // SPREAD-3: HTML on ?spread=1 even with Accept: application/json
  test('SPREAD-3 HTML-ON-QUERY: POST with ?spread=1 overrides Accept application/json', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run?spread=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url: 'https://agentlair.dev/' }),
    }));
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<section data-spread>');
  });

  // SPREAD-4: permalink href is base64url-encoded target URL
  test('SPREAD-4 PERMALINK-PRESENT: HTML contains correct /a2a/<b64url> permalink', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ url: 'https://agentlair.dev/' }),
    }));
    const html = await res.text();
    // btoa('https://agentlair.dev/').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    expect(html).toContain('href="/a2a/aHR0cHM6Ly9hZ2VudGxhaXIuZGV2Lw"');
  });

  // SPREAD-5: tweet intent URL is encoded correctly
  test('SPREAD-5 TWEET-INTENT-ENCODED: tweet URL is encoded and contains grade + score', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ url: 'https://agentlair.dev/' }),
    }));
    const html = await res.text();
    expect(html).toContain('https://twitter.com/intent/tweet?text=');
    // URL-encoded space (%20) must be present — proves encodeURIComponent was applied
    expect(html).toContain('%20');
    // Extract the tweet text param
    const match = html.match(/href="https:\/\/twitter\.com\/intent\/tweet\?text=([^"]+)"/);
    expect(match).not.toBeNull();
    const decoded = decodeURIComponent(match![1]);
    // Must contain grade letter and score
    expect(decoded).toMatch(/grade [A-Z][+-]?, \d+\/100/);
  });

  // SPREAD-6: embed snippet matches leaderboard format byte-for-byte
  test('SPREAD-6 EMBED-MATCHES-LEADERBOARD: embed snippet has exact leaderboard structure', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ url: 'https://agentlair.dev/' }),
    }));
    const html = await res.text();
    // em-dash prefix (U+2014)
    expect(html).toContain('![AgentLair L4 — ');
    // badge URL with b64url-encoded target
    expect(html).toContain('](https://agentlair.dev/badge/a2a/aHR0cHM6Ly9hZ2VudGxhaXIuZGV2Lw.svg)');
    // leaderboard link
    expect(html).toContain('](https://agentlair.dev/leaderboard/a2a)');
  });

  // SPREAD-7: blog link present with correct slug
  test('SPREAD-7 BLOG-LINK: HTML contains correct blog href', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ url: 'https://agentlair.dev/' }),
    }));
    const html = await res.text();
    expect(html).toContain('href="/blog/agents-are-shrinking-trust-problem-isnt/"');
  });

  // SPREAD-8: raw JSON pre block is parseable and correct
  test('SPREAD-8 PRESERVES-RAW-JSON: <pre data-raw-json> contains parseable JSON with audit+demo', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ url: 'https://agentlair.dev/' }),
    }));
    const html = await res.text();
    expect(html).toContain('<pre data-raw-json>');
    const start = html.indexOf('<pre data-raw-json>') + '<pre data-raw-json>'.length;
    const end = html.indexOf('</pre>', start);
    const raw = html.slice(start, end)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    const parsed = JSON.parse(raw) as any;
    expect(parsed.audit).toBeDefined();
    expect(parsed.demo).toBe(true);
  });

  // SPREAD-9: embed snippet HTML-escapes adversarial agent card names
  test('SPREAD-9-EMBED-XSS-ESCAPED: embed snippet escapes < > & in agent card name', async () => {
    const app = makeApp();
    const maliciousName = '<script>alert(1)</script> & "evil"';
    // Override fetch to return a card with the malicious name
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = ((init?.method) ?? 'GET').toUpperCase();
      if (url.includes('facilitator') && url.includes('/verify')) {
        return new Response(JSON.stringify({ isValid: true, payer: '0xtest1234' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('facilitator') && url.includes('/settle')) {
        return new Response(JSON.stringify({ success: true, txHash: '0xabc' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'HEAD' && (url.includes('.well-known/agent') || url.endsWith('.json'))) {
        return new Response(null, { status: 200 });
      }
      if (url.includes('.well-known/agent') || url.endsWith('.json')) {
        return new Response(JSON.stringify({ ...{ name: maliciousName, description: 'xss test', url: 'https://xss-test.example.com', version: '1.0.0', defaultInputModes: ['text'], defaultOutputModes: ['text'], capabilities: { streaming: false }, skills: [] } }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/html',
        'X-PAYMENT': MOCK_PAYMENT_HEADER,
      },
      body: JSON.stringify({ url: 'https://xss-test.example.com/.well-known/agent.json' }),
    }));
    expect(res.status).toBe(200);
    const html = await res.text();
    // The embed snippet must NOT contain raw < or > from the malicious name
    expect(html).not.toContain('<script>alert(1)</script>');
    // Must contain HTML-escaped versions
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  // REGRESSION-ACCEPT-WILDCARD-IS-JSON
  test('REGRESSION-ACCEPT-WILDCARD-IS-JSON: Accept: */* stays JSON', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': '*/*' },
      body: JSON.stringify({ url: 'https://agentlair.dev/' }),
    }));
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('application/json');
    expect(ct).not.toContain('text/html');
  });

  // REGRESSION-PAYMENT-RESPONSE-HEADER: X-Payment-Response header present on HTML paid response
  test('REGRESSION-PAYMENT-RESPONSE-HEADER: X-Payment-Response header still present on HTML paid response', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/html',
        'X-PAYMENT': MOCK_PAYMENT_HEADER,
      },
      body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
    }));
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/html');
    expect(res.headers.get('X-Payment-Response')).toBeTruthy();
  });

  // REGRESSION-402-STAYS-JSON: 402 stays JSON even with Accept: text/html
  test('REGRESSION-402-STAYS-JSON: 402 response stays JSON with Accept text/html', async () => {
    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
    }));
    expect(res.status).toBe(402);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('application/json');
    expect(ct).not.toContain('text/html');
  });

  // ─── A2A-F2-2: pre-flight 522 from *.agentlair.dev returns 400 cf_inside_zone_limit (not 402)
  test('A2A-F2-2: pre-flight 522 from agentlair.dev subdomain returns 400 cf_inside_zone_limit', async () => {
    let settleCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = ((init?.method) ?? 'GET').toUpperCase();
      if (url.includes('facilitator') && url.includes('/verify')) {
        return new Response(JSON.stringify({ isValid: true, payer: '0xtest1234' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('facilitator') && url.includes('/settle')) {
        settleCalled = true;
        return new Response(JSON.stringify({ success: true, txHash: '0xabc' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'HEAD') {
        // Simulate CF inside-zone 522 on agentlair.dev subdomain
        return new Response(null, { status: 522 });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': MOCK_PAYMENT_HEADER },
      body: JSON.stringify({ url: 'https://other.agentlair.dev/.well-known/agent.json' }),
    }));

    expect(settleCalled).toBe(false);
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBe('cf_inside_zone_limit');
    expect(data.message).toContain('Cloudflare zone');
  });

  // 20. Pre-flight HEAD timeout treated as unreachable
  test('pre-flight HEAD timeout treated as unreachable (no settle)', async () => {
    let settleCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = ((init?.method) ?? 'GET').toUpperCase();
      if (url.includes('facilitator') && url.includes('/verify')) {
        return new Response(JSON.stringify({ isValid: true, payer: '0xtest1234' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('facilitator') && url.includes('/settle')) {
        settleCalled = true;
        return new Response(JSON.stringify({ success: true, txHash: '0xabc' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'HEAD') {
        // Simulate abort (timeout)
        const abortErr = new DOMException('The operation was aborted', 'AbortError');
        throw abortErr;
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const app = makeApp();
    const res = await doFetch(app, new Request('http://localhost/a2a-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': MOCK_PAYMENT_HEADER },
      body: JSON.stringify({ url: 'https://example.com/.well-known/agent.json' }),
    }));

    expect(settleCalled).toBe(false);
    expect(res.status).toBe(402);
    const data = await res.json() as any;
    expect(data.payment_error).toBe('target_unreachable');
  });
});
