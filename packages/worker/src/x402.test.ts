/**
 * x402 facilitator envelope — Unit tests
 *
 * Verifies that verifyX402Payment and settleX402Payment POST the correct
 * resource/description/mimeType fields in the facilitator envelope body,
 * reading them from the service config (not from requirements).
 *
 * Regression test for pipeline x402-spec-v2-fix-followup-20260605-060620:
 * commit 3abbf0a left both callers reading requirements.{resource,description,
 * mimeType} which resolved to undefined after those fields were moved to
 * the service config. This hermetic test would have caught that at CI time.
 *
 * Run: bun test src/x402.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { verifyX402Payment, settleX402Payment, SERVICE_PRICES, X402_CONFIG, generateCdpBearerToken } from './x402.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal payment header that passes base64/JSON parsing. */
const MOCK_PAYMENT_HEADER = btoa(JSON.stringify({
  payload: {
    signature: '0xmocksig',
    authorization: { amount: '1000', network: 'eip155:8453' },
  },
}));

const originalFetch = globalThis.fetch;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('x402 facilitator envelope fields', () => {
  let capturedVerifyBody: Record<string, unknown> | null = null;
  let capturedSettleBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    capturedVerifyBody = null;
    capturedSettleBody = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

      if (url.includes('/verify')) {
        capturedVerifyBody = JSON.parse(init?.body as string ?? '{}');
        return new Response(JSON.stringify({ isValid: true, payer: '0xtest' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/settle')) {
        capturedSettleBody = JSON.parse(init?.body as string ?? '{}');
        return new Response(JSON.stringify({ success: true, txHash: '0xabc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected network call in test: ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('verifyX402Payment sends resource fields from service config', async () => {
    const service = SERVICE_PRICES.email_send;
    await verifyX402Payment(MOCK_PAYMENT_HEADER, service);

    expect(capturedVerifyBody).not.toBeNull();
    const body = capturedVerifyBody as Record<string, unknown>;
    const resource = body.resource as Record<string, string>;

    expect(resource).toBeDefined();
    expect(resource.url).toBe(service.resource);
    expect(resource.description).toBe(service.description);
    expect(resource.mimeType).toBe(service.mimeType);

    // Explicit string checks — undefined would fail at least the first two
    expect(typeof resource.url).toBe('string');
    expect(typeof resource.description).toBe('string');
    expect(typeof resource.mimeType).toBe('string');
  });

  test('settleX402Payment sends resource fields from service config', async () => {
    const service = SERVICE_PRICES.email_send;
    await settleX402Payment(MOCK_PAYMENT_HEADER, service, X402_CONFIG.facilitator);

    expect(capturedSettleBody).not.toBeNull();
    const body = capturedSettleBody as Record<string, unknown>;
    const resource = body.resource as Record<string, string>;

    expect(resource).toBeDefined();
    expect(resource.url).toBe(service.resource);
    expect(resource.description).toBe(service.description);
    expect(resource.mimeType).toBe(service.mimeType);

    // Explicit string checks — undefined would fail at least the first two
    expect(typeof resource.url).toBe('string');
    expect(typeof resource.description).toBe('string');
    expect(typeof resource.mimeType).toBe('string');
  });
});

describe('generateCdpBearerToken', () => {
  // Generate a real Ed25519 key for testing
  async function makeTestKey(): Promise<{ keyId: string; keySecret: string }> {
    // WebCrypto Ed25519 raw private key is 32 bytes (seed only)
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

    // d = base64url seed (32 bytes), x = base64url pubkey (32 bytes)
    const seed = Uint8Array.from(atob(privJwk.d!.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const pubkey = Uint8Array.from(atob(pubJwk.x!.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

    // 64-byte base64: seed + pubkey
    const combined = new Uint8Array(64);
    combined.set(seed, 0);
    combined.set(pubkey, 32);
    const keySecret = btoa(String.fromCharCode(...combined));

    return { keyId: 'test-key-id-12345678', keySecret };
  }

  function decodeJwtPart(part: string): Record<string, unknown> {
    // Add base64 padding back
    const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - part.length % 4) % 4);
    return JSON.parse(atob(padded));
  }

  test('produces a valid 3-part JWT from Ed25519 key', async () => {
    const { keyId, keySecret } = await makeTestKey();
    const token = await generateCdpBearerToken(keyId, keySecret, 'POST', '/platform/v2/x402/verify');

    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const header = decodeJwtPart(parts[0]);
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(keyId);
    expect(header.typ).toBe('JWT');
    expect(typeof header.nonce).toBe('string');
    expect((header.nonce as string).length).toBe(32); // 16 bytes hex

    const payload = decodeJwtPart(parts[1]);
    expect(payload.sub).toBe(keyId);
    expect(payload.iss).toBe('cdp');
    expect(Array.isArray(payload.uris)).toBe(true);
    expect((payload.uris as string[])[0]).toBe('POST api.cdp.coinbase.com/platform/v2/x402/verify');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect((payload.exp as number) - (payload.iat as number)).toBe(120);
  });

  test('uris claim reflects method and path', async () => {
    const { keyId, keySecret } = await makeTestKey();
    const token = await generateCdpBearerToken(keyId, keySecret, 'POST', '/platform/v2/x402/settle');
    const parts = token.split('.');
    const payload = decodeJwtPart(parts[1]);
    expect((payload.uris as string[])[0]).toBe('POST api.cdp.coinbase.com/platform/v2/x402/settle');
  });

  test('throws on invalid key length', async () => {
    await expect(
      generateCdpBearerToken('kid', btoa('short'), 'POST', '/verify')
    ).rejects.toThrow('CDP Ed25519 key must be 64 bytes');
  });

  test('throws on non-base64 key', async () => {
    await expect(
      generateCdpBearerToken('kid', '!!!not-base64!!!', 'POST', '/verify')
    ).rejects.toThrow();
  });

  test('throws on PEM key format', async () => {
    await expect(
      generateCdpBearerToken('kid', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', 'POST', '/verify')
    ).rejects.toThrow('not yet supported');
  });
});
