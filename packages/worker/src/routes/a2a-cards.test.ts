// ─── Per-A2A-card Landing Pages — Unit Tests ─────────────────────────────────
// Exercises GET /a2a/:thumbprint — HTML page and JSON response variants.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { a2aCardRoutes } from './a2a-cards.js';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const A_CARD = {
  name: 'AgentLair',
  description: 'Behavioral trust infrastructure for autonomous agents.',
  url: 'https://agentlair.dev',
  version: '1.0.0',
  did: 'did:web:agentlair.dev',
  contact: { email: 'security@agentlair.dev' },
  provider: { organization: 'AgentLair' },
  jwks_uri: 'https://agentlair.dev/.well-known/jwks.json',
  signatures: [{ protected: 'abc', signature: 'def' }],
  authentication: { schemes: ['oauth2', 'bearer'] },
  securitySchemes: { oauth: { type: 'oauth2' }, mtls: { type: 'mutualTLS' } },
  pricing: { perCallUsd: '0.01' },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  capabilities: { streaming: true },
  skills: [{ id: 'audit', name: 'Audit', description: 'Run trust audit', tags: ['trust'] }],
  trust_attestation: { score: 92, level: 'principal', confidence: 0.92 },
  audit_trail_url_template: 'https://agentlair.dev/v1/audit/{jti}',
  behavioral_monitoring: { endpoint: 'https://agentlair.dev/v1/telemetry' },
  delegation_chain: [{ from: 'a', to: 'b' }],
};

const SYNLIG_CARD = {
  name: 'SynligDigital',
  description: 'Digital agency agent.',
  url: 'https://synligdigital.no',
  version: '1.0.0',
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  capabilities: { streaming: false },
  skills: [{ id: 'seo', name: 'SEO', description: 'SEO services', tags: ['seo'] }],
};

// ─── Fetch stub ─────────────────────────────────────────────────────────────

let originalFetch: typeof fetch;
let fetchCallUrls: string[] = [];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchCallUrls = [];
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    fetchCallUrls.push(url);
    if (url.includes('agentlair.dev')) {
      return new Response(JSON.stringify(A_CARD), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('synligdigital.no')) {
      return new Response(JSON.stringify(SYNLIG_CARD), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono();
  app.route('/a2a', a2aCardRoutes);
  return app;
}

function b64url(s: string): string {
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /a2a/:thumbprint', () => {
  test('1. valid AgentLair card returns 200 HTML with layer table', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/a2a/${encoded}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('agentlair.dev');
    expect(body).toContain('L1');
    expect(body).toContain('L2');
    expect(body).toContain('L3');
    expect(body).toContain('L4');
  });

  test('2. SynligDigital card returns 200 HTML with grade letter', async () => {
    const app = makeApp();
    const encoded = b64url('https://synligdigital.no/.well-known/agent.json');
    const res = await app.request(`/a2a/${encoded}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/grade-letter/);
    expect(body).toMatch(/[ABCDF]/);
  });

  test('3. Accept: application/json returns JSON with scores and grade', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/a2a/${encoded}`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const json = await res.json() as any;
    expect(json.scores).toBeDefined();
    expect(json.grade).toBeDefined();
    expect(json.checks).toBeArray();
  });

  test('4. Accept: text/html, application/json;q=0.5 returns HTML (HTML wins)', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/a2a/${encoded}`, {
      headers: { Accept: 'text/html, application/json;q=0.5' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  test('5. malformed thumbprint returns 400 with "invalid url"', async () => {
    const app = makeApp();
    const res = await app.request('/a2a/!!!');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('invalid url');
  });

  test('6. localhost SSRF returns 400', async () => {
    const app = makeApp();
    const encoded = b64url('http://localhost:8080/');
    const res = await app.request(`/a2a/${encoded}`);
    expect(res.status).toBe(400);
  });

  test('7. private IP 192.168.x.x SSRF returns 400', async () => {
    const app = makeApp();
    const encoded = b64url('http://192.168.1.1/');
    const res = await app.request(`/a2a/${encoded}`);
    expect(res.status).toBe(400);
  });

  test('8. self-card with AUDIT_SIGNING_KEY uses in-memory bypass', async () => {
    const app = new Hono();
    // Provide env with AUDIT_SIGNING_KEY
    app.use('*', async (c, next) => {
      // Simulate CF env with signing key
      (c as any).env = { AUDIT_SIGNING_KEY: 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ' };
      await next();
    });
    app.route('/a2a', a2aCardRoutes);

    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/a2a/${encoded}`);
    // When AUDIT_SIGNING_KEY is set and URL is agentlair.dev,
    // fetchImpl should be the in-memory bypass, not globalThis.fetch.
    // The fetch stub would be called for agentlair.dev only if bypass failed.
    const agentlairFetches = fetchCallUrls.filter(u => u.includes('agentlair.dev'));
    expect(agentlairFetches.length).toBe(0);
  });

  test('9. rendered HTML does not contain banned tone words', async () => {
    const app = makeApp();
    const encoded = b64url('https://synligdigital.no/.well-known/agent.json');
    const res = await app.request(`/a2a/${encoded}`);
    const body = await res.text();
    expect(body).not.toMatch(/shocking|embarrassing|terrible|awful|dangerous|risky/i);
  });

  test('10. cache-control on success has max-age=3600', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/a2a/${encoded}`);
    expect(res.status).toBe(200);
    const cc = res.headers.get('Cache-Control') || '';
    expect(cc).toContain('max-age=3600');
  });

  test('10b. cache-control on 400 failure has max-age=60', async () => {
    const app = makeApp();
    const res = await app.request('/a2a/!!!');
    expect(res.status).toBe(400);
    const cc = res.headers.get('Cache-Control') || '';
    expect(cc).toContain('max-age=60');
  });

  test('11. 400 JSON error when Accept is application/json', async () => {
    const app = makeApp();
    const res = await app.request('/a2a/!!!', {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const json = await res.json() as any;
    expect(json.error).toBe('invalid url');
  });

  test('12. <script> in name field is HTML-escaped, not literal', async () => {
    // Override fetch for this test only — return a card with malicious name.
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      if (url.includes('agentlair.dev')) {
        return new Response(JSON.stringify({
          ...A_CARD,
          name: '<script>alert(1)</script>',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }) as any;

    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/a2a/${encoded}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    // Literal <script> from the name field MUST NOT appear in rendered HTML
    expect(body).not.toContain('<script>alert(1)</script>');
    // Escaped form MUST appear (proves escapeHtml ran on this field)
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
