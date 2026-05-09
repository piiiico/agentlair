// ─── Dynamic A2A Sitemap — Unit Tests ────────────────────────────────────────
// Exercises GET /sitemap-a2a.xml with stubbed fetch and KV.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { sitemapA2aRoutes } from './sitemap-a2a.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

let originalFetch: typeof fetch;

function makeApp(kvStore?: Record<string, string>) {
  const app = new Hono();
  // Inject mock KV via env
  app.use('*', async (c, next) => {
    (c as any).env = {
      KEYS: kvStore
        ? {
            get: async (key: string) => kvStore[key] ?? null,
            put: async (key: string, val: string, _opts?: any) => { kvStore[key] = val; },
          }
        : undefined,
    };
    await next();
  });
  app.route('/', sitemapA2aRoutes);
  return app;
}

const REGISTRY_AGENTS = {
  agents: [
    {
      name: 'TestAgent',
      url: 'https://test.example.com/a2a',
      wellKnownURI: 'https://test.example.com/.well-known/agent.json',
    },
    {
      name: 'AnotherAgent',
      url: 'https://another.example.org/a2a',
      wellKnownURI: 'https://another.example.org/.well-known/agent.json',
    },
  ],
};

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /sitemap-a2a.xml', () => {
  test('1. returns valid XML with urlset and url entries for 2 cards', async () => {
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      if (url.includes('a2aregistry.org')) {
        return new Response(JSON.stringify(REGISTRY_AGENTS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as any;

    const app = makeApp({});
    const res = await app.request('/sitemap-a2a.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/xml');
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('<url>');
    expect(body).toContain('agentlair.dev/a2a/');
    // Two valid cards → at least 2 <url> entries
    const urlCount = (body.match(/<url>/g) || []).length;
    expect(urlCount).toBeGreaterThanOrEqual(2);
  });

  test('2. drops cards whose URL fails SSRF guard (localhost)', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        agents: [
          { name: 'Good', wellKnownURI: 'https://public.example.com/.well-known/agent.json' },
          { name: 'SSRF', wellKnownURI: 'http://localhost:8080/.well-known/agent.json' },
          { name: 'Private', wellKnownURI: 'http://192.168.1.1/.well-known/agent.json' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const app = makeApp({});
    const res = await app.request('/sitemap-a2a.xml');
    const body = await res.text();
    // Only the public card should appear — URLs are base64url-encoded in the sitemap
    const urlCount = (body.match(/<url>/g) || []).length;
    expect(urlCount).toBe(1);
    // Verify the loc contains the base64url encoding of the public card URL
    const expectedEncoded = btoa('https://public.example.com/.well-known/agent.json')
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(body).toContain(expectedEncoded);
  });

  test('3. on registry 5xx, returns last-known cached XML', async () => {
    const lastGoodXml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://agentlair.dev/a2a/cached</loc></url></urlset>';
    const kvStore: Record<string, string> = {
      'sitemap-a2a:last-good': lastGoodXml,
    };

    globalThis.fetch = (async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as any;

    const app = makeApp(kvStore);
    const res = await app.request('/sitemap-a2a.xml');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('cached');
    const cc = res.headers.get('Cache-Control') || '';
    expect(cc).toContain('max-age=60');
  });

  test('4. on registry 5xx and no cache, returns empty urlset with max-age=60', async () => {
    globalThis.fetch = (async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as any;

    const app = makeApp({});
    const res = await app.request('/sitemap-a2a.xml');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<urlset');
    // No <url> entries
    expect(body).not.toContain('<url>');
    const cc = res.headers.get('Cache-Control') || '';
    expect(cc).toContain('max-age=60');
  });

  test('5. caches result in KV after successful fetch', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify(REGISTRY_AGENTS), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const kvStore: Record<string, string> = {};
    const app = makeApp(kvStore);
    await app.request('/sitemap-a2a.xml');

    expect(kvStore['sitemap-a2a:v1']).toBeDefined();
    expect(kvStore['sitemap-a2a:last-good']).toBeDefined();
    expect(kvStore['sitemap-a2a:v1']).toContain('<urlset');
  });
});
