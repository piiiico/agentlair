/**
 * POST /v1/auth/verify — Unit Tests
 *
 * Tests the x402-gated AAT token verification endpoint.
 * Payment IS authentication — no AgentLair API key required.
 *
 * Run: bun test src/routes/auth.verify.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { handleAuthRoutes } from './auth.js';
import { createJWT, getPublicKey } from '../jwt.js';
import type { AATClaims } from '../jwt.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { Env, RouteContext } from '../types.js';

// ─── MockKV ───────────────────────────────────────────────────────────────────

class MockKV {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && Date.now() / 1000 > entry.expiration) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiration = options?.expirationTtl
      ? Math.floor(Date.now() / 1000) + options.expirationTtl
      : undefined;
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<{ keys: { name: string }[] }> {
    return { keys: [...this.store.keys()].map((name) => ({ name })) };
  }

  _set(key: string, value: string): void {
    this.store.set(key, { value });
  }
}

// ─── Test keypair helpers ─────────────────────────────────────────────────────

function generateTestKeypair(): { privateKeyB64: string; publicKeyBytes: Uint8Array } {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));
  return { privateKeyB64, publicKeyBytes };
}

function makeClaims(overrides: Partial<AATClaims> = {}): AATClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://agentlair.dev',
    sub: 'acc_test123',
    aud: 'https://mcp.example.com',
    exp: now + 3600,
    iat: now,
    jti: 'aat_testtoken123',
    al_scopes: ['mcp:tools:read'],
    al_audit_url: 'https://agentlair.dev/v1/audit/aat_testtoken123',
    ...overrides,
  };
}

function makeToken(claims: AATClaims, privateKeyB64: string): string {
  return createJWT(claims, privateKeyB64, 'test-kid');
}

// ─── Request + Env builders ───────────────────────────────────────────────────

function makeVerifyRequest(opts: {
  paymentHeader?: string;
  body?: unknown;
  noBody?: boolean;
} = {}): Request {
  const headers: Record<string, string> = {};
  if (!opts.noBody) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.paymentHeader !== undefined) {
    headers['X-PAYMENT'] = opts.paymentHeader;
  }
  return new Request('https://agentlair.dev/v1/auth/verify', {
    method: 'POST',
    headers,
    body: opts.noBody ? undefined : JSON.stringify(opts.body ?? {}),
  });
}

function makeEnv(opts: { signingKey?: string } = {}): Env {
  return {
    KEYS: new MockKV() as unknown as KVNamespace,
    EMAILS: new MockKV() as unknown as KVNamespace,
    VAULT: new MockKV() as unknown as KVNamespace,
    AE_ANALYTICS: undefined as unknown as AnalyticsEngineDataset,
    INBOX_NOTIFIER: undefined as unknown as DurableObjectNamespace,
    AUDIT_SIGNING_KEY: opts.signingKey,
  };
}

const ROUTE_CONTEXT: RouteContext = {
  url: new URL('https://agentlair.dev/v1/auth/verify'),
  path: '/v1/auth/verify',
  method: 'POST',
  account: null,
};

const EXEC_CTX = {
  waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

// ─── Payment header helpers ───────────────────────────────────────────────────

// Valid base64 JSON that looks like a payment payload (will be verified by facilitator mock)
const VALID_PAYMENT_HEADER = btoa(JSON.stringify({
  payload: { signature: '0xabcdef', authorization: { from: '0xtest', value: '1000' } },
}));

// Valid base64 JSON but facilitator will reject it
const INVALID_PAYMENT_HEADER = btoa(JSON.stringify({
  payload: { signature: '0xbad', authorization: {} },
}));

// Not valid base64 at all
const BAD_BASE64_PAYMENT = 'not!!!valid!!!base64';

// ─── Facilitator fetch mock ───────────────────────────────────────────────────

let facilitatorShouldSucceed = true;
const originalFetch = globalThis.fetch;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /v1/auth/verify', () => {
  beforeEach(() => {
    facilitatorShouldSucceed = true;
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const urlStr = url instanceof Request ? url.url : String(url);
      if (urlStr.includes('facilitator')) {
        if (urlStr.endsWith('/verify')) {
          return new Response(
            JSON.stringify(
              facilitatorShouldSucceed
                ? { isValid: true, payer: '0xtest_payer' }
                : { isValid: false, invalidReason: 'test_payment_rejection' },
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // /settle and other facilitator calls
        return new Response(
          JSON.stringify({ settled: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // Resend or other calls — gate on RESEND_API_KEY presence, which we don't set
      throw new Error(`Unexpected network call in test: ${urlStr}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── 402: Missing payment ───────────────────────────────────────────────────

  test('missing X-PAYMENT header → 402 with payment requirements', async () => {
    const req = makeVerifyRequest();
    const env = makeEnv();
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.x402Version).toBeDefined();
    expect(Array.isArray(body.accepts)).toBe(true);
  });

  // ── 402: Invalid payment ───────────────────────────────────────────────────

  test('bad base64 X-PAYMENT header → 402 with payment_invalid', async () => {
    const req = makeVerifyRequest({ paymentHeader: BAD_BASE64_PAYMENT });
    const env = makeEnv();
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.active).toBe(false);
    expect(body.error).toBe('payment_invalid');
  });

  test('facilitator-rejected payment → 402 with payment_invalid', async () => {
    facilitatorShouldSucceed = false;
    const req = makeVerifyRequest({ paymentHeader: INVALID_PAYMENT_HEADER });
    const env = makeEnv();
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.active).toBe(false);
    expect(body.error).toBe('payment_invalid');
  });

  // ── 400: Missing token ─────────────────────────────────────────────────────

  test('valid payment but missing token in body → 400 with missing_token', async () => {
    const req = makeVerifyRequest({ paymentHeader: VALID_PAYMENT_HEADER, body: {} });
    const { privateKeyB64 } = generateTestKeypair();
    const env = makeEnv({ signingKey: privateKeyB64 });
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.error).toBe('missing_token');
  });

  test('valid payment, body with non-string token → 400 with missing_token', async () => {
    const req = makeVerifyRequest({ paymentHeader: VALID_PAYMENT_HEADER, body: { token: 42 } });
    const { privateKeyB64 } = generateTestKeypair();
    const env = makeEnv({ signingKey: privateKeyB64 });
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.error).toBe('missing_token');
  });

  // ── 503: Missing signing key ───────────────────────────────────────────────

  test('valid payment, valid token, missing AUDIT_SIGNING_KEY → 503 with validation_unavailable', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const claims = makeClaims();
    const token = makeToken(claims, privateKeyB64);
    const req = makeVerifyRequest({ paymentHeader: VALID_PAYMENT_HEADER, body: { token } });
    const env = makeEnv(); // no signingKey
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.error).toBe('validation_unavailable');
  });

  // ── 200: Valid token ──────────────────────────────────────────────────────

  test('valid payment, valid AAT token → {active: true, ...claims}', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const claims = makeClaims();
    const token = makeToken(claims, privateKeyB64);
    const req = makeVerifyRequest({ paymentHeader: VALID_PAYMENT_HEADER, body: { token } });
    const env = makeEnv({ signingKey: privateKeyB64 });
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.active).toBe(true);
    expect(body.sub).toBe(claims.sub);
    expect(body.iss).toBe(claims.iss);
    expect(body.aud).toBe(claims.aud);
    expect(body.exp).toBe(claims.exp);
    expect(body.iat).toBe(claims.iat);
    expect(body.jti).toBe(claims.jti);
    expect(body.al_scopes).toEqual(claims.al_scopes);
    expect(body.al_audit_url).toBe(claims.al_audit_url);
    expect(typeof body.scope).toBe('string');
  });

  // ── 200: Expired token ────────────────────────────────────────────────────

  test('valid payment, expired token → {active: false, reason: expired}', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const now = Math.floor(Date.now() / 1000);
    const claims = makeClaims({ exp: now - 3600 }); // expired 1h ago
    const token = makeToken(claims, privateKeyB64);
    const req = makeVerifyRequest({ paymentHeader: VALID_PAYMENT_HEADER, body: { token } });
    const env = makeEnv({ signingKey: privateKeyB64 });
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.active).toBe(false);
    expect(body.reason).toBe('expired');
  });

  // ── 200: Invalid/tampered token ───────────────────────────────────────────

  test('valid payment, tampered token (signed with different key) → {active: false}', async () => {
    const keypairA = generateTestKeypair();
    const keypairB = generateTestKeypair();
    const claims = makeClaims();
    const token = makeToken(claims, keypairA.privateKeyB64); // signed with A
    const req = makeVerifyRequest({ paymentHeader: VALID_PAYMENT_HEADER, body: { token } });
    // verify with B → signature mismatch → {active: false}
    const env = makeEnv({ signingKey: keypairB.privateKeyB64 });
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.active).toBe(false);
    expect(body.reason).toBeUndefined(); // no reason for invalid sig
  });

  test('valid payment, malformed JWT string → {active: false}', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const req = makeVerifyRequest({
      paymentHeader: VALID_PAYMENT_HEADER,
      body: { token: 'not.a.valid.jwt.at.all' },
    });
    const env = makeEnv({ signingKey: privateKeyB64 });
    const res = await handleAuthRoutes(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.active).toBe(false);
  });
});
