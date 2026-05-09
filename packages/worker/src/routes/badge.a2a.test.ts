// ─── Badge A2A Audit Route — Unit tests ──────────────────────────────────────
// Exercises the `/badge/a2a/:encoded` SVG endpoint and `/badge/a2a/:encoded/score.json`.
// Uses a stubbed fetch via globalThis.fetch override (per-test).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import {
  badgeRoutes,
  decodeBase64UrlCardUrl,
  isPublicHost,
} from './badge.js';

// ─── decodeBase64UrlCardUrl ─────────────────────────────────────────────────

describe('decodeBase64UrlCardUrl', () => {
  test('round-trips a normal HTTPS URL', () => {
    const url = 'https://agentlair.dev/.well-known/agent.json';
    // base64url (no padding)
    const encoded = btoa(url).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(decodeBase64UrlCardUrl(encoded)).toBe(url);
  });

  test('accepts .svg suffix and strips it', () => {
    const url = 'https://agentlair.dev/.well-known/agent.json';
    const encoded = btoa(url).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(decodeBase64UrlCardUrl(encoded + '.svg')).toBe(url);
  });

  test('rejects file:// urls', () => {
    const encoded = btoa('file:///etc/passwd').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(decodeBase64UrlCardUrl(encoded)).toBeNull();
  });

  test('rejects non-base64 input', () => {
    expect(decodeBase64UrlCardUrl('!!!')).toBeNull();
  });

  test('rejects private host (localhost SSRF)', () => {
    const encoded = btoa('http://localhost:8080/').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(decodeBase64UrlCardUrl(encoded)).toBeNull();
  });

  test('rejects 192.168.x.x', () => {
    const encoded = btoa('http://192.168.1.1/').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(decodeBase64UrlCardUrl(encoded)).toBeNull();
  });
});

describe('isPublicHost', () => {
  test('accepts agentlair.dev', () => expect(isPublicHost('agentlair.dev')).toBe(true));
  test('accepts example.com:443', () => expect(isPublicHost('example.com:443')).toBe(true));
  test('rejects 127.0.0.1', () => expect(isPublicHost('127.0.0.1')).toBe(false));
  test('rejects 10.0.0.1', () => expect(isPublicHost('10.0.0.1')).toBe(false));
  test('rejects 172.16.0.1', () => expect(isPublicHost('172.16.0.1')).toBe(false));
  test('rejects 192.168.1.1', () => expect(isPublicHost('192.168.1.1')).toBe(false));
  test('rejects localhost', () => expect(isPublicHost('localhost')).toBe(false));
  test('rejects ::1 IPv6 loopback', () => expect(isPublicHost('::1')).toBe(false));
  test('rejects [::1]', () => expect(isPublicHost('[::1]')).toBe(false));
  test('rejects .local', () => expect(isPublicHost('printer.local')).toBe(false));
});

// ─── Route handler tests ─────────────────────────────────────────────────────

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

const F_CARD = {
  name: 'BareAgent',
  url: 'http://example.com',
};

// Stub global fetch — return A_CARD for agentlair, F_CARD for example.com.
let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('agentlair.dev')) {
      return new Response(JSON.stringify(A_CARD), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('example.com')) {
      return new Response(JSON.stringify(F_CARD), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('badcard.example')) {
      return new Response('not found', { status: 404 });
    }
    return new Response('upstream missing', { status: 404 });
  }) as any;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeApp() {
  const app = new Hono();
  app.route('/badge', badgeRoutes);
  return app;
}

function b64url(s: string): string {
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

describe('GET /badge/a2a/:encoded', () => {
  test('renders A grade SVG for AgentLair card', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/badge/a2a/${encoded}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    const text = await res.text();
    expect(text).toContain('<svg');
    expect(text).toMatch(/A \d+/); // "A 92" or "A 90" etc.
  });

  test('renders F grade SVG for bare card', async () => {
    const app = makeApp();
    const encoded = b64url('https://example.com/.well-known/agent.json');
    const res = await app.request(`/badge/a2a/${encoded}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<svg');
    expect(text).toMatch(/F \d+/);
  });

  test('returns invalid-url badge for malformed encoded param', async () => {
    const app = makeApp();
    const res = await app.request('/badge/a2a/!!notbase64!!');
    expect(res.status).toBe(200); // Always 200 — badges never break the embedding page
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    const text = await res.text();
    expect(text).toContain('invalid url');
  });

  test('rejects SSRF to localhost', async () => {
    const app = makeApp();
    const encoded = b64url('http://localhost:8080/agent.json');
    const res = await app.request(`/badge/a2a/${encoded}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('invalid url');
  });

  test('returns error badge when fetch fails', async () => {
    const app = makeApp();
    const encoded = b64url('https://badcard.example/.well-known/agent.json');
    const res = await app.request(`/badge/a2a/${encoded}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<svg');
  });

  test('SVG has Cache-Control: public, max-age=3600 for valid audits', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/badge/a2a/${encoded}`);
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  test('Access-Control-Allow-Origin: * for cross-origin embeds', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/badge/a2a/${encoded}`);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('?label=Custom overrides the badge label', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/badge/a2a/${encoded}?label=Trust+Score`);
    const text = await res.text();
    expect(text).toContain('Trust Score');
  });
});

describe('GET /badge/a2a/:encoded/score.json', () => {
  test('returns JSON audit result for AgentLair card', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/badge/a2a/${encoded}/score.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const json = await res.json() as any;
    expect(json.grade).toBe('A');
    expect(json.scores.overall).toBeGreaterThanOrEqual(90);
    expect(json.checks.length).toBeGreaterThan(15);
  });

  test('returns 400 for invalid base64', async () => {
    const app = makeApp();
    const res = await app.request('/badge/a2a/!!!/score.json');
    expect(res.status).toBe(400);
  });
});
