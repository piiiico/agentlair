/**
 * Unit tests for POST /v1/trust/mcp/verify — self-host short-circuit
 *
 * All tests run hermetically: no real network access.
 * The self-host short-circuit must work without any network call (Test 2 proves this).
 *
 * Pipeline: fitness-fix-mcp-trust-verify-self-fetch-20260518-100930
 * Run: bun test src/routes/__test__/mcp-trust-verify.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { mcpTrustVerifyRoutes } from '../mcp-trust-verify.js';
import type { HonoEnv } from '../../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/v1/trust', mcpTrustVerifyRoutes);
  return app;
}

/** Build a minimal env bindings object for Hono CF Workers test pattern. */
function makeEnv(overrides: Partial<HonoEnv['Bindings']> = {}): Record<string, unknown> {
  return {
    KEYS: {},
    EMAILS: {},
    VAULT: {},
    AE_ANALYTICS: {},
    INBOX_NOTIFIER: {},
    ...overrides,
  } as Record<string, unknown>;
}

/**
 * Invoke app with env injected via the CF Workers second-argument pattern:
 * app.fetch(request, env) — bindings are available as c.env in the handler.
 */
function appFetch(
  app: Hono<HonoEnv>,
  req: Request,
  env: Record<string, unknown> = makeEnv(),
): Promise<Response> {
  return app.fetch(req, env as unknown as Record<string, string>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mcp-trust-verify: self-host short-circuit', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('Test 1: self-host descriptor short-circuit returns inline TRUST_DESCRIPTOR fields', async () => {
    // Replace fetch with a throwing stub — self-host should NOT call it
    globalThis.fetch = () => Promise.reject(new Error('network not allowed in this test'));

    const app = makeApp();
    const req = new Request('http://localhost/v1/trust/mcp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://agentlair.dev' }),
    });
    const res = await appFetch(app, req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // raw_descriptor must be the inline TRUST_DESCRIPTOR
    expect(body.raw_descriptor).not.toBeNull();
    const rd = body.raw_descriptor as Record<string, unknown>;
    expect(rd.issuer).toBe('https://agentlair.dev');
    expect(rd.jwks_uri).toBe('https://agentlair.dev/.well-known/jwks.json');
    // No attestation_token → correctly returns unverified with error
    expect(body.verified).toBe(false);
    expect(Array.isArray(body.errors)).toBe(true);
    const errors = body.errors as string[];
    expect(errors.some((e) => e.includes('attestation token'))).toBe(true);
  });

  test('Test 2: self-host short-circuit does not hit the network (regression)', async () => {
    // The critical regression guard. If fetch is called, the test throws.
    let fetchCalled = false;
    globalThis.fetch = () => {
      fetchCalled = true;
      throw new Error('network access forbidden — self-host must not call fetch');
    };

    const app = makeApp();
    const req = new Request('http://localhost/v1/trust/mcp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://agentlair.dev' }),
    });
    const res = await appFetch(app, req);
    expect(res.status).toBe(200);
    expect(fetchCalled).toBe(false);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.verified).toBe(false);
    const errors = body.errors as string[];
    expect(errors.some((e) => e.includes('attestation token'))).toBe(true);
  });

  test('Test 3: subdomain self-host is short-circuited', async () => {
    globalThis.fetch = () => Promise.reject(new Error('network not allowed in this test'));

    const app = makeApp();
    const req = new Request('http://localhost/v1/trust/mcp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://api.agentlair.dev' }),
    });
    const res = await appFetch(app, req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.raw_descriptor).not.toBeNull();
    const rd = body.raw_descriptor as Record<string, unknown>;
    expect(rd.issuer).toBe('https://agentlair.dev');
    expect(rd.jwks_uri).toBe('https://agentlair.dev/.well-known/jwks.json');
    expect(body.verified).toBe(false);
    const errors = body.errors as string[];
    expect(errors.some((e) => e.includes('attestation token'))).toBe(true);
  });

  test('Test 4: non-self-host falls through to fetchCapped (404 → descriptor not found)', async () => {
    // Stub fetch to return 404 for third-party URL
    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('example.com')) {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('Not Found'));
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 404,
            headers: { 'Content-Type': 'text/plain' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    };

    const app = makeApp();
    const req = new Request('http://localhost/v1/trust/mcp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    const res = await appFetch(app, req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.verified).toBe(false);
    const errors = body.errors as string[];
    // Should include "no agentlair-trust descriptor found" with HTTP 404
    expect(errors.some((e) => /no agentlair-trust descriptor found.*HTTP 404/i.test(e))).toBe(true);
  });

  test('Test 5: self-host JWKS short-circuit synthesizes JWKS when AUDIT_SIGNING_KEY is configured', async () => {
    // A synthetic third-party descriptor whose jwks_uri points to agentlair.dev
    const syntheticDescriptor = {
      bhc_token_type: 'urn:agentlair:bhc-s:v1',
      jwks_uri: 'https://agentlair.dev/.well-known/jwks.json',
      // A fake JWT — it won't verify, but we're only checking fetch call count here
      attestation_token:
        'eyJhbGciOiJFZERTQSIsImtpZCI6InRlc3QifQ.eyJzdWIiOiJodHRwczovL290aGVyLmV4YW1wbGUuY29tIiwiaWF0IjoxNzE2MDAwMDAwLCJleHAiOjk5OTk5OTk5OTl9.invalidsig',
    };

    let fetchCallCount = 0;
    globalThis.fetch = (input: RequestInfo | URL) => {
      fetchCallCount++;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // Only the descriptor fetch for other.example.com should come through
      if (url.includes('other.example.com/.well-known/agentlair-trust')) {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(syntheticDescriptor)));
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      // JWKS fetch should NOT come through — it should be short-circuited
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    };

    // 32-byte raw Ed25519 private key, base64-encoded (all 0x2A bytes = valid scalar)
    const testPrivKey = 'KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio=';

    const app = makeApp();
    const req = new Request('http://localhost/v1/trust/mcp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://other.example.com' }),
    });
    const res = await appFetch(app, req, makeEnv({ AUDIT_SIGNING_KEY: testPrivKey }));
    expect(res.status).toBe(200);
    // fetch was called exactly once (descriptor), not twice (descriptor + JWKS)
    expect(fetchCallCount).toBe(1);
  });

  test('Test 6: self-host JWKS returns error when AUDIT_SIGNING_KEY is absent', async () => {
    const syntheticDescriptor = {
      bhc_token_type: 'urn:agentlair:bhc-s:v1',
      jwks_uri: 'https://agentlair.dev/.well-known/jwks.json',
      attestation_token:
        'eyJhbGciOiJFZERTQSIsImtpZCI6InRlc3QifQ.eyJzdWIiOiJodHRwczovL290aGVyLmV4YW1wbGUuY29tIn0.invalidsig',
    };

    globalThis.fetch = (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('other2.example.com/.well-known/agentlair-trust')) {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(syntheticDescriptor)));
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    };

    // No AUDIT_SIGNING_KEY
    const app = makeApp();
    const req = new Request('http://localhost/v1/trust/mcp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://other2.example.com' }),
    });
    const res = await appFetch(app, req, makeEnv({ AUDIT_SIGNING_KEY: undefined }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.verified).toBe(false);
    const errors = body.errors as string[];
    expect(errors.some((e) => e.includes('self-host JWKS unavailable'))).toBe(true);
  });
});
