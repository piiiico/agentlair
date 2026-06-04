/**
 * Tests for POST /v1/tokens/issue-l3
 *
 * Covers:
 * - Missing required fields (transaction_id, checkout_hash, l2_mandate)
 * - Invalid transaction_id format
 * - TTL enforcement: above MAX (300) rejected; default applied when omitted
 * - Valid issuance: token parses, all L3 claims present and correct
 * - al_mandate_hash is SHA-256 of l2_mandate (not the raw mandate)
 * - No auth → 401
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { verifyJWT } from '../jwt';

import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { tokenRoutes } from './tokens';
import { publicAuditRoutes } from './audit';

function generateTestKey(): { privateKeyB64: string; publicKeyBytes: Uint8Array } {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));
  return { privateKeyB64, publicKeyBytes };
}

const { privateKeyB64, publicKeyBytes } = generateTestKey();

// Minimal test app: mounts tokenRoutes under /v1/tokens with optional auth
function makeApp(authenticated = true) {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    if (authenticated) {
      c.set('account', { id: 'acc_test123', tier: 'free', allowed_scopes: undefined } as any);
    }
    await next();
  });
  app.route('/v1/tokens', tokenRoutes);
  return app;
}

function makeEnv() {
  return {
    AUDIT_SIGNING_KEY: privateKeyB64,
    KEYS: null,
  };
}

/** KV mock that actually stores values for inspection in tests */
function makeKVMock() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      put: (key: string, value: string, _opts?: any) => {
        store.set(key, value);
        return Promise.resolve();
      },
    },
  };
}

async function issueL3(
  body: Record<string, unknown>,
  opts: { authenticated?: boolean } = {},
) {
  const app = makeApp(opts.authenticated !== false);
  const req = new Request('http://localhost/v1/tokens/issue-l3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return app.fetch(req, makeEnv(), { waitUntil: () => {} } as any);
}

/** Issue L3 with a real KV mock; awaits all waitUntil promises before returning */
async function issueL3WithKV(
  body: Record<string, unknown>,
  kvMock: ReturnType<typeof makeKVMock>,
) {
  const app = makeApp(true);
  const pendingWaitUntil: Promise<any>[] = [];
  const req = new Request('http://localhost/v1/tokens/issue-l3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await app.fetch(
    req,
    { AUDIT_SIGNING_KEY: privateKeyB64, KEYS: kvMock.kv },
    { waitUntil: (p: Promise<any>) => pendingWaitUntil.push(p) } as any,
  );
  // Flush all background work so KV writes are visible before assertions
  await Promise.all(pendingWaitUntil);
  return res;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('POST /v1/tokens/issue-l3', () => {
  // ── Auth ──────────────────────────────────────────────────────────────
  test('returns 401 when unauthenticated', async () => {
    const res = await issueL3(
      { transaction_id: 'tx_abc123', checkout_hash: 'sha256:abc', l2_mandate: 'mandate' },
      { authenticated: false },
    );
    expect(res.status).toBe(401);
  });

  // ── Missing fields ────────────────────────────────────────────────────
  test('returns 400 when transaction_id missing', async () => {
    const res = await issueL3({ checkout_hash: 'sha256:abc', l2_mandate: 'mandate' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('missing_transaction_id');
  });

  test('returns 400 when checkout_hash missing', async () => {
    const res = await issueL3({ transaction_id: 'tx_abc', l2_mandate: 'mandate' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('missing_checkout_hash');
  });

  test('returns 400 when l2_mandate missing', async () => {
    const res = await issueL3({ transaction_id: 'tx_abc', checkout_hash: 'sha256:abc' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('missing_l2_mandate');
  });

  test('returns 400 when l2_mandate is empty string', async () => {
    const res = await issueL3({ transaction_id: 'tx_abc', checkout_hash: 'sha256:abc', l2_mandate: '' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('missing_l2_mandate');
  });

  // ── transaction_id validation ──────────────────────────────────────────
  test('returns 400 for transaction_id with invalid characters', async () => {
    const res = await issueL3({
      transaction_id: 'tx abc!@#',
      checkout_hash: 'sha256:abc',
      l2_mandate: 'mandate',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('invalid_transaction_id');
  });

  test('returns 400 for transaction_id > 128 chars', async () => {
    const res = await issueL3({
      transaction_id: 'a'.repeat(129),
      checkout_hash: 'sha256:abc',
      l2_mandate: 'mandate',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('invalid_transaction_id');
  });

  // ── TTL enforcement ────────────────────────────────────────────────────
  test('returns 400 when ttl > 300', async () => {
    const res = await issueL3({
      transaction_id: 'tx_abc',
      checkout_hash: 'sha256:abc',
      l2_mandate: 'mandate',
      ttl: 301,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('invalid_ttl');
  });

  test('returns 400 when ttl < 1', async () => {
    const res = await issueL3({
      transaction_id: 'tx_abc',
      checkout_hash: 'sha256:abc',
      l2_mandate: 'mandate',
      ttl: 0,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('invalid_ttl');
  });

  test('returns 400 when ttl is non-integer', async () => {
    const res = await issueL3({
      transaction_id: 'tx_abc',
      checkout_hash: 'sha256:abc',
      l2_mandate: 'mandate',
      ttl: 60.5,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('invalid_ttl');
  });

  // ── Valid issuance ─────────────────────────────────────────────────────
  test('returns 201 with valid payload and default ttl', async () => {
    const res = await issueL3({
      transaction_id: 'tx_valid123',
      checkout_hash: 'sha256:deadbeef',
      l2_mandate: 'eyJ.mandate.token',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.').length).toBe(3);
    expect(body.jti).toMatch(/^aal3_/);
    expect(body.transaction_id).toBe('tx_valid123');
    expect(typeof body.expires_at).toBe('string');
  });

  test('token parses and contains correct L3 claims', async () => {
    const l2Mandate = 'eyJ.mandate.token';
    const checkoutHash = 'sha256:deadbeef';
    const transactionId = 'tx_valid123';

    const res = await issueL3({ transaction_id: transactionId, checkout_hash: checkoutHash, l2_mandate: l2Mandate });
    expect(res.status).toBe(201);
    const body = await res.json() as any;

    // Verify signature
    const claims = verifyJWT(body.token, publicKeyBytes);
    expect(claims).not.toBeNull();

    // Standard claims
    expect(claims!.iss).toBe('https://agentlair.dev');
    expect(claims!.sub).toBe('acc_test123');
    expect(claims!.aud).toBe(transactionId); // aud = transaction_id per VI spec
    expect(claims!.jti).toMatch(/^aal3_/);

    // L3-specific claims
    expect(claims!.al_l3).toBe(true);
    expect(claims!.al_transaction_id).toBe(transactionId);
    expect(claims!.al_checkout_hash).toBe(checkoutHash);
    expect(typeof claims!.al_mandate_hash).toBe('string');
    expect(claims!.al_mandate_hash!.length).toBeGreaterThan(0);

    // al_scopes is empty for L3 (transaction-bound, no permission scopes)
    expect(claims!.al_scopes).toEqual([]);
  });

  test('al_mandate_hash is SHA-256 of l2_mandate, base64url-encoded', async () => {
    const l2Mandate = 'test-mandate-value';
    const res = await issueL3({
      transaction_id: 'tx_hashtest',
      checkout_hash: 'sha256:abc',
      l2_mandate: l2Mandate,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    const claims = verifyJWT(body.token, publicKeyBytes);
    expect(claims).not.toBeNull();

    // Recompute SHA-256 and base64url-encode
    const mandateBytes = new TextEncoder().encode(l2Mandate);
    const hashBuf = await crypto.subtle.digest('SHA-256', mandateBytes);
    const hashBytes = new Uint8Array(hashBuf);
    const expected = btoa(String.fromCharCode(...hashBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    expect(claims!.al_mandate_hash).toBe(expected);
  });

  test('l2_mandate itself is NOT present in the issued token', async () => {
    const l2Mandate = 'super-secret-mandate';
    const res = await issueL3({
      transaction_id: 'tx_privacy',
      checkout_hash: 'sha256:abc',
      l2_mandate: l2Mandate,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;

    // Raw mandate must not appear in the compact token string
    expect(body.token).not.toContain(l2Mandate);

    // Decode payload and confirm mandate absent
    const payloadB64 = body.token.split('.')[1];
    const pad = (4 - (payloadB64.length % 4)) % 4;
    const b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
    const payloadJson = atob(b64);
    expect(payloadJson).not.toContain(l2Mandate);
  });

  test('TTL of 60 produces correct exp - iat = 60', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await issueL3({
      transaction_id: 'tx_ttltest',
      checkout_hash: 'sha256:abc',
      l2_mandate: 'mandate',
      ttl: 60,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    const claims = verifyJWT(body.token, publicKeyBytes);
    expect(claims).not.toBeNull();
    expect(claims!.exp - claims!.iat).toBe(60);
    expect(claims!.exp).toBeGreaterThanOrEqual(before + 60);
  });

  test('ttl=300 (max) is accepted', async () => {
    const res = await issueL3({
      transaction_id: 'tx_maxttl',
      checkout_hash: 'sha256:abc',
      l2_mandate: 'mandate',
      ttl: 300,
    });
    expect(res.status).toBe(201);
  });

  test('transaction_id with hyphens and underscores is accepted', async () => {
    const res = await issueL3({
      transaction_id: 'tx-abc_123-XYZ',
      checkout_hash: 'sha256:abc',
      l2_mandate: 'mandate',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.transaction_id).toBe('tx-abc_123-XYZ');
  });

  // ── KV / tracking (touch points 3 & 4) ───────────────────────────────
  test('aat-meta KV written on L3 issuance', async () => {
    const kv = makeKVMock();
    const res = await issueL3WithKV(
      { transaction_id: 'tx_kvtest', checkout_hash: 'sha256:abc', l2_mandate: 'mandate' },
      kv,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    const jti: string = body.jti;
    expect(jti).toMatch(/^aal3_/);

    const raw = kv.store.get(`aat-meta:${jti}`);
    expect(raw).not.toBeNull();
    const meta = JSON.parse(raw!);
    expect(meta.accountId).toBe('acc_test123');
    expect(typeof meta.issuedAt).toBe('number');
    expect(typeof meta.expiresAt).toBe('number');
    expect(Array.isArray(meta.scopes)).toBe(true);
  });

  test('trackTokenIssuance called on L3 path (KV counter incremented)', async () => {
    const kv = makeKVMock();
    const res = await issueL3WithKV(
      { transaction_id: 'tx_tracktest', checkout_hash: 'sha256:abc', l2_mandate: 'mandate' },
      kv,
    );
    expect(res.status).toBe(201);
    // trackTokenIssuance writes to token-issue-monthly:<accountId>:<month>
    const month = new Date().toISOString().slice(0, 7);
    const counterKey = `token-issue-monthly:acc_test123:${month}`;
    const value = kv.store.get(counterKey);
    expect(value).toBe('1');
  });
});

// ── Audit endpoint regex (touch points 1 & 2) ──────────────────────────────
describe('audit endpoint — aal3_ JTI format acceptance', () => {
  function makeAuditApp() {
    const app = new Hono<HonoEnv>();
    app.route('/v1/audit', publicAuditRoutes);
    return app;
  }

  test('aal3_ JTI passes format check (returns 402, not 400)', async () => {
    const app = makeAuditApp();
    const req = new Request('http://localhost/v1/audit/aal3_ABCDabcd12345678');
    const res = await app.fetch(req, { KEYS: null } as any, { waitUntil: () => {} } as any);
    // 402 means the JTI passed format validation and hit the payment gate
    // 400 would mean invalid_jti (regression)
    expect(res.status).not.toBe(400);
    expect(res.status).toBe(402);
  });

  test('aat_ JTI still accepted (no regression)', async () => {
    const app = makeAuditApp();
    const req = new Request('http://localhost/v1/audit/aat_ABCDabcd12345678');
    const res = await app.fetch(req, { KEYS: null } as any, { waitUntil: () => {} } as any);
    expect(res.status).not.toBe(400);
    expect(res.status).toBe(402);
  });

  test('invalid prefix still rejected with 400', async () => {
    const app = makeAuditApp();
    const req = new Request('http://localhost/v1/audit/bad_ABCDabcd12345678');
    const res = await app.fetch(req, { KEYS: null } as any, { waitUntil: () => {} } as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('invalid_jti');
  });
});
