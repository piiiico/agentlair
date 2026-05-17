/**
 * Tests for POST /v1/rfc9421/verify — RFC 9421 HTTP Message Signature verifier
 *
 * All 11 hermetic test cases per spec.md "Test plan".
 * No live network — globalThis.fetch is mocked in beforeEach/afterEach.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import { rfc9421VerifyRoutes } from './rfc9421-verify.js';
import {
  signHttpMessage,
  signForVisaTAP,
  type HttpMessage,
  type SignatureParams,
} from '../lib/rfc9421.js';
import { base58btcEncode } from '../lib/base58btc.js';

// ─── Test keypair (deterministic) ─────────────────────────────────────────────

const TEST_SEED = new Uint8Array(32);
TEST_SEED[0] = 0x42;
TEST_SEED[31] = 0x01;
const TEST_PRIVATE_KEY_B64 = btoa(String.fromCharCode(...TEST_SEED));
const TEST_PUBLIC_KEY = ed25519.getPublicKey(TEST_SEED);

// Second keypair for "wrong key" test case
const WRONG_SEED = new Uint8Array(32);
WRONG_SEED[0] = 0x99;
WRONG_SEED[31] = 0x99;
const WRONG_PUBLIC_KEY = ed25519.getPublicKey(WRONG_SEED);

/** Build a did:key from an Ed25519 public key. */
function pubkeyToDidKey(pubkey: Uint8Array): string {
  // Prepend multicodec prefix: 0xed 0x01 (Ed25519 public key)
  const encoded = new Uint8Array(2 + pubkey.length);
  encoded[0] = 0xed;
  encoded[1] = 0x01;
  encoded.set(pubkey, 2);
  // Multibase base58btc: 'z' prefix + base58btc
  return `did:key:z${base58btcEncode(encoded)}`;
}

const TEST_DID_KEY = pubkeyToDidKey(TEST_PUBLIC_KEY);
const WRONG_DID_KEY = pubkeyToDidKey(WRONG_PUBLIC_KEY);

// ─── Test Hono app ────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono();
  app.route('/v1/rfc9421/verify', rfc9421VerifyRoutes);
  return app;
}

// ─── Fetch mock ───────────────────────────────────────────────────────────────

let originalFetch: typeof fetch;
let fetchSpy: { callCount: number; urls: string[] };

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchSpy = { callCount: 0, urls: [] };
  // Default mock: no-op (most tests don't need JWKS fetch)
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    fetchSpy.callCount++;
    fetchSpy.urls.push(url);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSignedRequest(
  opts: {
    components?: string[];
    created?: number;
    expires?: number;
    keyid?: string;
    alg?: string;
    nonce?: string;
    tag?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const method = opts.method ?? 'POST';
  const url = opts.url ?? 'https://example.com/agent/checkout';
  const keyid = opts.keyid ?? TEST_DID_KEY;

  // If alg is non-ed25519, we can't actually sign — just craft the input
  if (opts.alg && opts.alg !== 'ed25519') {
    const components = opts.components ?? ['@method', '@authority', '@path'];
    const paramsStr = [
      `created=${opts.created ?? now}`,
      opts.expires !== undefined ? `expires=${opts.expires}` : null,
      `keyid="${keyid}"`,
      `alg="${opts.alg}"`,
      `nonce="${opts.nonce ?? 'testnonce'}"`,
      `tag="${opts.tag ?? 'test'}"`,
    ].filter(Boolean).join(';');
    const componentList = components.map((c) => `"${c}"`).join(' ');
    return {
      method,
      target_uri: url,
      headers: {
        ...(opts.headers ?? {}),
        'signature-input': `sig1=(${componentList});${paramsStr}`,
        'signature': 'sig1=:AAAA:',
      },
    };
  }

  const params: SignatureParams = {
    keyid,
    alg: 'ed25519',
    created: opts.created ?? now,
    expires: opts.expires,
    nonce: opts.nonce ?? 'testnonce',
    tag: opts.tag ?? 'test',
  };
  const components = opts.components ?? ['@method', '@authority', '@path'];
  const message: HttpMessage = {
    method,
    url,
    headers: opts.headers ?? {},
  };
  const result = signHttpMessage(message, components, params, TEST_PRIVATE_KEY_B64);
  return {
    method,
    target_uri: url,
    headers: {
      ...(opts.headers ?? {}),
      'signature-input': result.signatureInput,
      'signature': result.signature,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /v1/rfc9421/verify', () => {
  test('1. Happy path: valid Ed25519 signature with did:key → 200 { valid: true }', async () => {
    const app = makeApp();
    const body = buildSignedRequest();
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.valid).toBe(true);
    expect(json.key_id).toBe(TEST_DID_KEY);
    expect(json.algorithm).toBe('ed25519');
    expect(json.signature_age_ms).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(json.covered_fields)).toBe(true);
    // Response header present
    expect(res.headers.get('X-AgentLair-Verifier-Scope')).toContain('stateless');
  });

  test('2. Visa TAP fixture: agent-payer-auth tag → 200 { valid: true }', async () => {
    const app = makeApp();
    const message: HttpMessage = {
      method: 'POST',
      url: 'https://merchant.example.com/api/checkout',
      headers: {},
    };
    const tapResult = signForVisaTAP(message, TEST_PRIVATE_KEY_B64, TEST_DID_KEY, 'agent-payer-auth');
    const body = {
      method: 'POST',
      target_uri: 'https://merchant.example.com/api/checkout',
      headers: {
        'signature-input': tapResult['Signature-Input'],
        'signature': tapResult['Signature'],
      },
    };
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.valid).toBe(true);
    expect(json.key_id).toBe(TEST_DID_KEY);
  });

  test('3. Malformed did:key (wrong multicodec prefix) → 422 unsupported did method', async () => {
    const app = makeApp();
    // Construct a did:key with the wrong multicodec (0x12, 0x00 = SHA-256 hash, not Ed25519)
    const fakeKey = new Uint8Array(34);
    fakeKey[0] = 0x12; // wrong multicodec prefix (not 0xed)
    fakeKey[1] = 0x00;
    // Fill with z6Mk-like prefix but different data
    const fakeNid = `did:key:z${base58btcEncode(fakeKey)}`;
    const body = buildSignedRequest({ keyid: fakeNid });
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(422);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('key_resolution_failed');
    expect(json.reason).toBe('unsupported did method');
  });

  test('4. JWKS keyid resolution: mock JWKS returns matching kid → 200 { valid: true }', async () => {
    const app = makeApp();
    // Build a JWKS document with a matching key
    const pubkeyB64url = btoa(String.fromCharCode(...TEST_PUBLIC_KEY))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const kid = 'test-key-1';
    const jwks = { keys: [{ kty: 'OKP', crv: 'Ed25519', kid, x: pubkeyB64url }] };
    const jwksUrl = `https://example.com/.well-known/jwks.json#${kid}`;

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const body = buildSignedRequest({ keyid: jwksUrl });
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.valid).toBe(true);
  });

  test('5. Expired signature: expires = now - 100 → 200 { valid: false, reason: "signature expired" }', async () => {
    const app = makeApp();
    const now = Math.floor(Date.now() / 1000);
    const body = buildSignedRequest({ expires: now - 100, created: now - 200 });
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.valid).toBe(false);
    expect(json.reason).toBe('signature expired');
    expect(typeof json.signature_age_ms).toBe('number');
  });

  test('6. Clock skew: created = now + 7200 → 200 { valid: false, reason: "clock skew too large" }', async () => {
    const app = makeApp();
    const now = Math.floor(Date.now() / 1000);
    const body = buildSignedRequest({ created: now + 7200 });
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.valid).toBe(false);
    expect(json.reason).toBe('clock skew too large');
  });

  test('7. Content-digest mismatch → 200 { valid: false, reason: "content-digest mismatch" }', async () => {
    const app = makeApp();
    const now = Math.floor(Date.now() / 1000);
    const bodyBytes = new TextEncoder().encode('{"amount":42}');
    // Compute correct digest
    const digestBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
    const digestB64 = btoa(String.fromCharCode(...new Uint8Array(digestBuffer)));
    // Use a WRONG content-digest in the header
    const wrongDigest = 'sha-256=:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:';
    const bodyBase64 = btoa(String.fromCharCode(...bodyBytes));

    const params: SignatureParams = {
      keyid: TEST_DID_KEY,
      alg: 'ed25519',
      created: now,
      nonce: 'nonce7',
      tag: 'test',
    };
    const message: HttpMessage = {
      method: 'POST',
      url: 'https://example.com/agent/checkout',
      headers: { 'content-digest': wrongDigest },
    };
    const result = signHttpMessage(message, ['@method', '@authority', 'content-digest'], params, TEST_PRIVATE_KEY_B64);
    const body = {
      method: 'POST',
      target_uri: 'https://example.com/agent/checkout',
      headers: {
        'content-digest': wrongDigest,
        'signature-input': result.signatureInput,
        'signature': result.signature,
      },
      body_base64: bodyBase64,
    };
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.valid).toBe(false);
    expect(json.reason).toBe('content-digest mismatch');
  });

  test('8. SSRF blocked: keyid = http://127.0.0.1/jwks.json#k1 → 422 jwks url blocked (fetch NOT called)', async () => {
    const app = makeApp();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const body = buildSignedRequest({ keyid: 'http://127.0.0.1/jwks.json#k1' });
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(422);
    const json = await res.json() as Record<string, unknown>;
    expect(json.reason).toBe('jwks url blocked');
    expect(fetchCalled).toBe(false); // SSRF guard must block BEFORE fetch
  });

  test('9. Unsupported algorithm: alg="rsa-pss-sha512" → 422 unsupported algorithm', async () => {
    const app = makeApp();
    const body = buildSignedRequest({ alg: 'rsa-pss-sha512' });
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(422);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('key_resolution_failed');
    expect(json.reason).toBe('unsupported algorithm');
  });

  test('10. JWKS too large: mock returns 70000-byte body → 422 jwks too large', async () => {
    const app = makeApp();
    const jwksUrl = `https://example.com/.well-known/jwks.json#k1`;
    // Mock fetch to return a stream of 70000 bytes
    globalThis.fetch = (async () => {
      const bigBody = new Uint8Array(70000).fill(32); // spaces
      return new Response(bigBody, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const body = buildSignedRequest({ keyid: jwksUrl });
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(422);
    const json = await res.json() as Record<string, unknown>;
    expect(json.reason).toBe('jwks too large');
  });

  test('11. JWKS key not found: JWKS has no key with matching kid → 422 jwks key not found', async () => {
    const app = makeApp();
    const jwksUrl = `https://example.com/.well-known/jwks.json#k-missing`;
    // JWKS has a key with a different kid
    const jwks = {
      keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'k-different', x: 'AAAA' }],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const body = buildSignedRequest({ keyid: jwksUrl });
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(422);
    const json = await res.json() as Record<string, unknown>;
    expect(json.reason).toBe('jwks key not found');
  });

  // Additional: verify wrong key returns signature mismatch
  test('bonus: wrong key → 200 { valid: false, reason: "signature mismatch" }', async () => {
    const app = makeApp();
    // Sign with TEST_SEED but claim to use WRONG_PUBLIC_KEY's did:key
    const body = buildSignedRequest({ keyid: WRONG_DID_KEY });
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.valid).toBe(false);
    expect(json.reason).toBe('signature mismatch');
  });

  // Malformed input tests
  test('missing method → 400', async () => {
    const app = makeApp();
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_uri: 'https://x.com', headers: {} }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('malformed_request');
  });

  test('missing signature-input → 400', async () => {
    const app = makeApp();
    const res = await app.request('/v1/rfc9421/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'POST', target_uri: 'https://x.com', headers: { 'signature': 'sig1=:AA==' } }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('malformed_request');
    expect(String(json.reason)).toContain('signature-input');
  });
});
