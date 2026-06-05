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
import { verifyX402Payment, settleX402Payment, SERVICE_PRICES, X402_CONFIG } from './x402.js';

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
