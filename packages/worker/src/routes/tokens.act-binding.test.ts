/**
 * Tests for Phase 2c act-binding mint-time boundary (issue ucsandman/DashClaw#121).
 *
 * Covers:
 * - parseActBindingRequest pure validation
 * - POST /v1/tokens/issue with act_binding: claim emitted, hash correct
 * - POST /v1/tokens/issue WITHOUT act_binding: no claim (backward compat)
 * - POST /v1/tokens/issue-l3 with act_binding: same shape, stacks with L3 claims
 * - Validation rejections: missing field, wrong type, empty string
 * - POST /v1/tokens/introspect: claim surfaces verbatim
 * - GET /v1/tokens/info: act_binding capability advertised
 *
 * The frozen-vector cross-check (issuer must produce DashClaw-identical hashes)
 * is in ../lib/act-binding.test.ts. This file only checks the boundary plumbing.
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { verifyJWT } from '../jwt';
import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import {
  tokenRoutes,
  publicTokenRoutes,
  parseActBindingRequest,
} from './tokens';

function generateTestKey(): { privateKeyB64: string; publicKeyBytes: Uint8Array } {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));
  return { privateKeyB64, publicKeyBytes };
}

const { privateKeyB64, publicKeyBytes } = generateTestKey();

function makeApp(authenticated = true) {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    if (authenticated) {
      c.set('account', { id: 'acc_test_actbind', tier: 'free', allowed_scopes: undefined } as any);
    }
    await next();
  });
  app.route('/v1/tokens', tokenRoutes);
  app.route('/v1/tokens', publicTokenRoutes);
  return app;
}

function makeEnv() {
  return {
    AUDIT_SIGNING_KEY: privateKeyB64,
    KEYS: null,
  };
}

async function post(path: string, body: Record<string, unknown>) {
  const app = makeApp();
  const req = new Request('http://localhost' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return app.fetch(req, makeEnv(), { waitUntil: () => {} } as any);
}

async function get(path: string) {
  const app = makeApp();
  const req = new Request('http://localhost' + path);
  return app.fetch(req, makeEnv(), { waitUntil: () => {} } as any);
}

const READ_CUSTOMER_TUPLE = {
  action: 'http.GET',
  target: 'https://api.example/customers/42',
  goal: 'read the customer record to summarize recent orders',
};
// Frozen hash from DashClaw's vec.ascii.read-customer (PR #138, vector 1/9).
// If this breaks, either the vendored canonicalizer drifted or the wire format
// bumped to action-binding/v2 without re-vendoring vectors.
const READ_CUSTOMER_HASH = 'sha256:XfBUzVuMEr-BUnGQtAT06R_Hzlt8pocE2aEywEL2s9k';

// ─── parseActBindingRequest (pure validation) ────────────────────────────────

describe('parseActBindingRequest', () => {
  test('absent → ok with tuple: null', () => {
    expect(parseActBindingRequest(undefined)).toEqual({ ok: true, tuple: null });
    expect(parseActBindingRequest(null)).toEqual({ ok: true, tuple: null });
  });

  test('valid tuple → ok with tuple', () => {
    const result = parseActBindingRequest(READ_CUSTOMER_TUPLE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tuple).toEqual(READ_CUSTOMER_TUPLE);
  });

  test('non-object → 400-shape error', () => {
    const r = parseActBindingRequest('a string');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('act_binding');
  });

  test('array → 400 (object check rejects arrays)', () => {
    const r = parseActBindingRequest(['action', 'target', 'goal']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('act_binding');
  });

  test('missing action → 400 on act_binding.action', () => {
    const r = parseActBindingRequest({ target: 't', goal: 'g' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('act_binding.action');
  });

  test('empty target → 400 on act_binding.target', () => {
    const r = parseActBindingRequest({ action: 'a', target: '', goal: 'g' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('act_binding.target');
  });

  test('non-string goal → 400 on act_binding.goal', () => {
    const r = parseActBindingRequest({ action: 'a', target: 't', goal: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('act_binding.goal');
  });
});

// ─── /v1/tokens/issue with act_binding ───────────────────────────────────────

describe('POST /v1/tokens/issue with act_binding', () => {
  test('emits urn:dashclaw:act-binding claim with frozen hash', async () => {
    const res = await post('/v1/tokens/issue', {
      audience: 'https://example.test',
      scopes: ['mcp:tools:read'],
      act_binding: READ_CUSTOMER_TUPLE,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string };
    const claims = verifyJWT(body.token, publicKeyBytes);
    expect(claims).not.toBeNull();
    const binding = (claims as any)['urn:dashclaw:act-binding'];
    expect(binding).toBeDefined();
    expect(binding.typ).toBe('action-binding/v1');
    expect(binding.hash).toBe(READ_CUSTOMER_HASH);
  });

  test('omitting act_binding produces a token WITHOUT the claim (backward compat)', async () => {
    const res = await post('/v1/tokens/issue', {
      audience: 'https://example.test',
      scopes: ['mcp:tools:read'],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string };
    const claims = verifyJWT(body.token, publicKeyBytes);
    expect(claims).not.toBeNull();
    expect((claims as any)['urn:dashclaw:act-binding']).toBeUndefined();
  });

  test('act_binding with empty string field → 400 invalid_act_binding', async () => {
    const res = await post('/v1/tokens/issue', {
      audience: 'https://example.test',
      scopes: ['mcp:tools:read'],
      act_binding: { action: 'http.GET', target: '', goal: 'g' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_act_binding');
  });

  test('act_binding with non-string field → 400 invalid_act_binding', async () => {
    const res = await post('/v1/tokens/issue', {
      audience: 'https://example.test',
      scopes: ['mcp:tools:read'],
      act_binding: { action: 42, target: 't', goal: 'g' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_act_binding');
  });

  test('act_binding as a string (not an object) → 400', async () => {
    const res = await post('/v1/tokens/issue', {
      audience: 'https://example.test',
      scopes: ['mcp:tools:read'],
      act_binding: 'http.GET https://api.example/customers/42 read',
    });
    expect(res.status).toBe(400);
  });

  test('two different bindings produce two different hashes (sanity)', async () => {
    const r1 = await post('/v1/tokens/issue', {
      audience: 'https://example.test',
      scopes: ['mcp:tools:read'],
      act_binding: READ_CUSTOMER_TUPLE,
    });
    const r2 = await post('/v1/tokens/issue', {
      audience: 'https://example.test',
      scopes: ['mcp:tools:read'],
      act_binding: {
        action: 'http.DELETE',
        target: 'https://api.example/orders/9001',
        goal: 'delete the cancelled order at the user request',
      },
    });
    const c1 = verifyJWT(((await r1.json()) as { token: string }).token, publicKeyBytes);
    const c2 = verifyJWT(((await r2.json()) as { token: string }).token, publicKeyBytes);
    const h1 = (c1 as any)['urn:dashclaw:act-binding'].hash;
    const h2 = (c2 as any)['urn:dashclaw:act-binding'].hash;
    expect(h1).not.toBe(h2);
    // h1 is the frozen value; h2 is vec.ascii.delete-order's frozen value.
    expect(h2).toBe('sha256:8m9D2_tkCCf5Q67SNFMs4VjwtwnP376pqefXI46baao');
  });
});

// ─── /v1/tokens/issue-l3 with act_binding ────────────────────────────────────

describe('POST /v1/tokens/issue-l3 with act_binding', () => {
  test('L3 token can carry act_binding alongside transaction-scoped claims', async () => {
    const res = await post('/v1/tokens/issue-l3', {
      transaction_id: 'tx_abc123',
      checkout_hash: 'sha256:checkout',
      l2_mandate: 'mandate.opaque.payload',
      act_binding: READ_CUSTOMER_TUPLE,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string };
    const claims = verifyJWT(body.token, publicKeyBytes);
    expect(claims).not.toBeNull();
    const c = claims as any;
    // L3 marker survives
    expect(c.al_l3).toBe(true);
    expect(c.al_transaction_id).toBe('tx_abc123');
    // Act-binding stacks on top
    expect(c['urn:dashclaw:act-binding']).toBeDefined();
    expect(c['urn:dashclaw:act-binding'].typ).toBe('action-binding/v1');
    expect(c['urn:dashclaw:act-binding'].hash).toBe(READ_CUSTOMER_HASH);
  });

  test('L3 without act_binding produces a token WITHOUT the claim', async () => {
    const res = await post('/v1/tokens/issue-l3', {
      transaction_id: 'tx_abc123',
      checkout_hash: 'sha256:checkout',
      l2_mandate: 'mandate.opaque.payload',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string };
    const claims = verifyJWT(body.token, publicKeyBytes);
    expect((claims as any)['urn:dashclaw:act-binding']).toBeUndefined();
    // L3 claims still there
    expect((claims as any).al_l3).toBe(true);
  });

  test('L3 with malformed act_binding → 400 invalid_act_binding (other L3 fields unaffected)', async () => {
    const res = await post('/v1/tokens/issue-l3', {
      transaction_id: 'tx_abc123',
      checkout_hash: 'sha256:checkout',
      l2_mandate: 'mandate.opaque.payload',
      act_binding: { action: 'http.GET' }, // missing target+goal
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_act_binding');
  });
});

// ─── /v1/tokens/introspect surfacing ─────────────────────────────────────────

describe('POST /v1/tokens/introspect surfaces act_binding', () => {
  test('introspect response carries the claim verbatim when token is bound', async () => {
    const mintRes = await post('/v1/tokens/issue', {
      audience: 'https://example.test',
      scopes: ['mcp:tools:read'],
      act_binding: READ_CUSTOMER_TUPLE,
    });
    const { token } = (await mintRes.json()) as { token: string };

    const introspectRes = await post('/v1/tokens/introspect', { token });
    expect(introspectRes.status).toBe(200);
    const body = (await introspectRes.json()) as Record<string, unknown>;
    expect(body.active).toBe(true);
    const surfaced = body['urn:dashclaw:act-binding'] as { typ: string; hash: string } | undefined;
    expect(surfaced).toBeDefined();
    expect(surfaced!.typ).toBe('action-binding/v1');
    expect(surfaced!.hash).toBe(READ_CUSTOMER_HASH);
  });

  test('introspect of an unbound token does NOT include the claim', async () => {
    const mintRes = await post('/v1/tokens/issue', {
      audience: 'https://example.test',
      scopes: ['mcp:tools:read'],
    });
    const { token } = (await mintRes.json()) as { token: string };

    const introspectRes = await post('/v1/tokens/introspect', { token });
    const body = (await introspectRes.json()) as Record<string, unknown>;
    expect(body.active).toBe(true);
    expect(body['urn:dashclaw:act-binding']).toBeUndefined();
  });
});

// ─── /v1/tokens/info advertises capability ───────────────────────────────────

describe('GET /v1/tokens/info advertises act_binding capability', () => {
  test('info endpoint exposes act_binding metadata', async () => {
    const res = await get('/v1/tokens/info');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { act_binding?: Record<string, unknown> };
    expect(body.act_binding).toBeDefined();
    expect(body.act_binding!.supported).toBe(true);
    expect(body.act_binding!.claim).toBe('urn:dashclaw:act-binding');
    expect(body.act_binding!.typ).toBe('action-binding/v1');
    expect(body.act_binding!.request_field).toBe('act_binding');
  });
});
