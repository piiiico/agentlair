// ─── Per-A2A-card OG Image — Unit Tests ───────────────────────────────────────
// Exercises GET /og/a2a/:thumbprint[.png] — PNG OG image generation via resvg-wasm.
// WASM works in Bun, so tests get real PNG responses.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { ogA2aRoutes, renderOgSvg, renderErrorOgSvg } from './og-a2a.js';

// ─── PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A ─────────────────────────────
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function hasPngMagic(buf: ArrayBuffer): boolean {
  const view = new Uint8Array(buf);
  return PNG_MAGIC.every((byte, i) => view[i] === byte);
}

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

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
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
  app.route('/og/a2a', ogA2aRoutes);
  return app;
}

function b64url(s: string): string {
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /og/a2a/:thumbprint[.png]', () => {
  test('1. valid AgentLair card returns 200 PNG with substantial body', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/og/a2a/${encoded}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(5000);
    expect(hasPngMagic(buf)).toBe(true);
  });

  test('2. SynligDigital card returns 200 with different body than AgentLair', async () => {
    const app = makeApp();
    const agentlair = b64url('https://agentlair.dev/.well-known/agent.json');
    const synlig = b64url('https://synligdigital.no/.well-known/agent.json');

    const resA = await app.request(`/og/a2a/${agentlair}.png`);
    const resB = await app.request(`/og/a2a/${synlig}.png`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bufA = await resA.arrayBuffer();
    const bufB = await resB.arrayBuffer();

    // Different cards produce different images (different byte lengths or content)
    const bytesA = new Uint8Array(bufA);
    const bytesB = new Uint8Array(bufB);
    const areDifferent = bytesA.length !== bytesB.length ||
      bytesA.some((b, i) => b !== bytesB[i]);
    expect(areDifferent).toBe(true);
  });

  test('3. malformed thumbprint returns 400 PNG (not empty)', async () => {
    const app = makeApp();
    const res = await app.request('/og/a2a/malformed.png');
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const cc = res.headers.get('Cache-Control') || '';
    expect(cc).toContain('max-age=60');
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(500);
    expect(hasPngMagic(buf)).toBe(true);
  });

  test('4. no extension also returns the image', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/og/a2a/${encoded}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  test('5. cache-control on success has max-age=86400', async () => {
    const app = makeApp();
    const encoded = b64url('https://agentlair.dev/.well-known/agent.json');
    const res = await app.request(`/og/a2a/${encoded}.png`);
    expect(res.status).toBe(200);
    const cc = res.headers.get('Cache-Control') || '';
    expect(cc).toContain('max-age=86400');
  });

  test('6. SVG template does NOT contain banned tone words', () => {
    // Test the SVG template directly (PNG binary wouldn't contain readable text)
    const svg = renderOgSvg('Test Agent', 'F', 15, '#e53935');
    expect(svg).not.toMatch(/shocking|embarrassing|terrible|awful|dangerous|risky/i);
    const errorSvg = renderErrorOgSvg();
    expect(errorSvg).not.toMatch(/shocking|embarrassing|terrible|awful|dangerous|risky/i);
  });

  test('7. SSRF: localhost URL returns 400 fallback image', async () => {
    const app = makeApp();
    const encoded = b64url('http://localhost:8080/');
    const res = await app.request(`/og/a2a/${encoded}.png`);
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  test('8. XSS in name field is escaped in SVG template', () => {
    // Test the SVG template directly for proper escaping
    const svg = renderOgSvg('<script>alert(1)</script>', 'A', 92, '#22c55e');
    // Literal <script> must NOT appear
    expect(svg).not.toContain('<script>alert(1)</script>');
    // Escaped form must appear
    expect(svg).toContain('&lt;script&gt;');
  });

  test('9. XSS name still produces valid PNG', async () => {
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
    const res = await app.request(`/og/a2a/${encoded}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const buf = await res.arrayBuffer();
    expect(hasPngMagic(buf)).toBe(true);
  });
});
