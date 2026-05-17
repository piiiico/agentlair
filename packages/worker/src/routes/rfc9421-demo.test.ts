/**
 * Tests for GET /v1/rfc9421/demo — self-verifying RFC 9421 example endpoint
 *
 * 11 hermetic test cases per spec.md "Hermetic test enumeration" §1-11.
 * No live network required. Rate limiter stubbed via c.env.
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { rfc9421DemoRoutes } from './rfc9421-demo.js';
import { verifyHttpSignature, type HttpMessage } from '../lib/rfc9421.js';
import { base58btcDecode } from '../lib/base58btc.js';

// ─── Test app factory ─────────────────────────────────────────────────────────

// Fake KV stub that always returns the limit value (triggers 429)
const AT_LIMIT_KV = {
  get: async (_key: string) => '100',
  put: async () => {},
};

function makeApp() {
  const app = new Hono();
  app.route('/v1/rfc9421/demo', rfc9421DemoRoutes);
  return app;
}

// ─── Test 1: shape-stable ─────────────────────────────────────────────────────

test('1: shape-stable — call twice, stable fields are byte-identical', async () => {
  const app = makeApp();
  const req1 = new Request('http://localhost/v1/rfc9421/demo');
  const req2 = new Request('http://localhost/v1/rfc9421/demo');

  const res1 = await app.fetch(req1);
  const res2 = await app.fetch(req2);

  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);

  expect(res1.headers.get('content-type')).toContain('application/json');
  expect(res2.headers.get('content-type')).toContain('application/json');

  expect(res1.headers.get('cache-control')).toBe('no-store');
  expect(res2.headers.get('cache-control')).toBe('no-store');

  const body1 = await res1.json() as Record<string, unknown>;
  const body2 = await res2.json() as Record<string, unknown>;

  // Top-level keys exactly: documentation + example
  expect(Object.keys(body1).sort()).toEqual(['documentation', 'example']);
  expect(Object.keys(body2).sort()).toEqual(['documentation', 'example']);

  const ex1 = body1.example as Record<string, unknown>;
  const ex2 = body2.example as Record<string, unknown>;

  // Stable fields are byte-identical
  expect(ex1.keyId).toBe(ex2.keyId);
  expect((ex1.privateKey as Record<string, unknown>).value).toBe(
    (ex2.privateKey as Record<string, unknown>).value,
  );
  expect(JSON.stringify(ex1.request)).toBe(JSON.stringify(ex2.request));
});

// ─── Test 2: keyid-format ─────────────────────────────────────────────────────

test('2: keyid-format — did:key:z6Mk… shape, length ≥ 48', async () => {
  const app = makeApp();
  const res = await app.fetch(new Request('http://localhost/v1/rfc9421/demo'));
  const body = await res.json() as Record<string, unknown>;
  const ex = body.example as Record<string, unknown>;
  const keyId = ex.keyId as string;

  expect(keyId.startsWith('did:key:z6Mk')).toBe(true);
  expect(keyId.length).toBeGreaterThanOrEqual(48);
});

// ─── Test 3: sig-input-format ─────────────────────────────────────────────────

test('3: sig-input-format — signature-input matches expected regex', async () => {
  const app = makeApp();
  const res = await app.fetch(new Request('http://localhost/v1/rfc9421/demo'));
  const body = await res.json() as Record<string, unknown>;
  const ex = body.example as Record<string, unknown>;
  const signed = ex.signed as Record<string, Record<string, string>>;
  const sigInput = signed.headers['signature-input'];

  const pattern = /^agent=\("@method" "@authority" "@path" "content-type"\);created=\d+;expires=\d+;keyid="did:key:z6Mk[A-Za-z0-9]+";alg="ed25519";nonce="[0-9a-f-]{36}";tag="agentlair-demo"$/;
  expect(sigInput).toMatch(pattern);
});

// ─── Test 4: signature-envelope-format ────────────────────────────────────────

test('4: signature-envelope-format — signature matches agent=:base64: format', async () => {
  const app = makeApp();
  const res = await app.fetch(new Request('http://localhost/v1/rfc9421/demo'));
  const body = await res.json() as Record<string, unknown>;
  const ex = body.example as Record<string, unknown>;
  const signed = ex.signed as Record<string, Record<string, string>>;
  const sig = signed.headers['signature'];

  expect(sig).toMatch(/^agent=:[A-Za-z0-9+/=]+:$/);
});

// ─── Test 5: round-trip-via-lib ───────────────────────────────────────────────

test('5: round-trip-via-lib — verifyHttpSignature returns true for the demo signature', async () => {
  const app = makeApp();
  const res = await app.fetch(new Request('http://localhost/v1/rfc9421/demo'));
  const body = await res.json() as Record<string, unknown>;
  const ex = body.example as Record<string, unknown>;
  const keyId = ex.keyId as string;
  const signed = ex.signed as Record<string, unknown>;
  const headers = signed.headers as Record<string, string>;

  // Decode did:key → 32-byte Ed25519 pubkey
  // did:key format: 'did:key:z' + base58btc(multicodec prefix [0xed, 0x01] + pubkey bytes)
  const nid = keyId.slice('did:key:z'.length);
  const decoded = base58btcDecode(nid);
  expect(decoded).not.toBeNull();
  // First 2 bytes are multicodec prefix [0xed, 0x01], rest is pubkey
  expect(decoded![0]).toBe(0xed);
  expect(decoded![1]).toBe(0x01);
  const pubkeyBytes = decoded!.slice(2);

  const message: HttpMessage = {
    method: signed.method as string,
    url: signed.target_uri as string,
    headers: {
      'content-type': headers['content-type'],
      'signature-input': headers['signature-input'],
      'signature': headers['signature'],
    },
  };

  const valid = verifyHttpSignature(
    message,
    headers['signature-input'],
    headers['signature'],
    pubkeyBytes,
  );

  expect(valid).toBe(true);
});

// ─── Test 6: content-digest-not-required ──────────────────────────────────────

test('6: content-digest-not-required — covered_components does NOT include content-digest', async () => {
  const app = makeApp();
  const res = await app.fetch(new Request('http://localhost/v1/rfc9421/demo'));
  const body = await res.json() as Record<string, unknown>;
  const ex = body.example as Record<string, unknown>;
  const signed = ex.signed as Record<string, unknown>;
  const components = signed.covered_components as string[];

  expect(components).not.toContain('content-digest');
  expect(components).toContain('@method');
  expect(components).toContain('@authority');
  expect(components).toContain('@path');
  expect(components).toContain('content-type');
});

// ─── Test 7: curl-shape ───────────────────────────────────────────────────────

test('7: curl-shape — example.curl is correct and contains required values', async () => {
  const app = makeApp();
  const res = await app.fetch(new Request('http://localhost/v1/rfc9421/demo'));
  const body = await res.json() as Record<string, unknown>;
  const ex = body.example as Record<string, unknown>;
  const signed = ex.signed as Record<string, Record<string, string>>;
  const curl = ex.curl as string;

  expect(typeof curl).toBe('string');
  expect(curl.length).toBeGreaterThan(0);
  expect(curl.startsWith('curl -sS -X POST')).toBe(true);
  expect(curl).toContain('https://api.agentlair.dev/v1/rfc9421/verify');
  expect(curl).toContain('https://merchant.example.com/agent/checkout');

  // The curl string JSON-encodes the signed payload, so signature-input and signature
  // are embedded as JSON-escaped strings. Check the JSON-escaped forms instead.
  const sigInputEscaped = JSON.stringify(signed.headers['signature-input']).slice(1, -1);
  const sigEscaped = JSON.stringify(signed.headers['signature']).slice(1, -1);
  expect(curl).toContain(sigInputEscaped);
  expect(curl).toContain(sigEscaped);
});

// ─── Test 8: freshness-monotonic ──────────────────────────────────────────────

test('8: freshness-monotonic — expires - created === 480 in both calls', async () => {
  const app = makeApp();
  const res1 = await app.fetch(new Request('http://localhost/v1/rfc9421/demo'));
  const res2 = await app.fetch(new Request('http://localhost/v1/rfc9421/demo'));

  const body1 = await res1.json() as Record<string, unknown>;
  const body2 = await res2.json() as Record<string, unknown>;

  const ex1 = (body1.example as Record<string, unknown>).signed as Record<string, number>;
  const ex2 = (body2.example as Record<string, unknown>).signed as Record<string, number>;

  expect(ex1.expires - ex1.created).toBe(480);
  expect(ex2.expires - ex2.created).toBe(480);

  // Monotonic: second call's created is >= first call's created
  expect(ex2.created).toBeGreaterThanOrEqual(ex1.created);
});

// ─── Test 9: no-auth-required ─────────────────────────────────────────────────

test('9: no-auth-required — garbage Authorization header returns 200, not 401', async () => {
  const app = makeApp();
  const res = await app.fetch(
    new Request('http://localhost/v1/rfc9421/demo', {
      headers: { Authorization: 'garbage-not-a-jwt' },
    }),
  );
  expect(res.status).toBe(200);
});

// ─── Test 10: documentation-content ──────────────────────────────────────────

test('10: documentation-content — verifier_url, summary contains Visa + RFC 9421, production_note contains demo-only', async () => {
  const app = makeApp();
  const res = await app.fetch(new Request('http://localhost/v1/rfc9421/demo'));
  const body = await res.json() as Record<string, unknown>;
  const docs = body.documentation as Record<string, string>;

  expect(docs.verifier_url).toBe('https://api.agentlair.dev/v1/rfc9421/verify');
  expect(docs.summary).toContain('Visa');
  expect(docs.summary).toContain('RFC 9421');
  expect(docs.production_note).toContain('do not use');
});

// ─── Test 11: rate-limit-stub ─────────────────────────────────────────────────

test('11: rate-limit-stub — when rate limit exceeded, returns 429 with rate_limited error', async () => {
  const app = makeApp();
  // Pass a fake env with a KV stub that returns the limit value (100 ≥ 60 → not allowed)
  // and a cf-connecting-ip so the ip check passes
  const fakeEnv = { KEYS: AT_LIMIT_KV };
  const res = await app.fetch(
    new Request('http://localhost/v1/rfc9421/demo', {
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    }),
    fakeEnv,
  );
  expect(res.status).toBe(429);
  const body = await res.json() as Record<string, unknown>;
  expect(body.error).toBe('rate_limited');
  expect(typeof body.retry_after).toBe('string');
});
