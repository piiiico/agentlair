/**
 * RFC 9421 Signing Keys — Unit Tests
 *
 * Tests for:
 * - computeSigningKeyId: key ID computation (base64url SHA-256 prefix)
 * - Key ID format: exactly 22 chars, base64url chars only
 * - Key ID determinism: same input → same keyid
 * - Key ID uniqueness: different inputs → different keyids
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import { b64urlEncode, b64urlDecode } from './jwt';
import { computeSigningKeyId, computeJwkThumbprint, getSigningKeyByThumbprint, signingKeyRoutes, type SigningKeyRecord } from './routes/signing-keys';
import type { Env } from './types.js';
import type { HonoEnv } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a deterministic Ed25519 keypair for testing. */
function makeTestPublicKey(seed?: Uint8Array): Uint8Array {
  const privateKey = seed ?? crypto.getRandomValues(new Uint8Array(32));
  return ed25519.getPublicKey(privateKey);
}

// ─── computeSigningKeyId ──────────────────────────────────────────────────────

describe('computeSigningKeyId', () => {
  test('returns a string of exactly 22 characters', async () => {
    const pubKey = makeTestPublicKey();
    const keyid = await computeSigningKeyId(pubKey);
    expect(typeof keyid).toBe('string');
    expect(keyid.length).toBe(22);
  });

  test('contains only base64url-safe characters', async () => {
    // Run multiple times to catch edge cases
    for (let i = 0; i < 10; i++) {
      const pubKey = makeTestPublicKey();
      const keyid = await computeSigningKeyId(pubKey);
      expect(/^[A-Za-z0-9_-]+$/.test(keyid)).toBe(true);
    }
  });

  test('is deterministic — same input produces same keyid', async () => {
    const seed = new Uint8Array(32).fill(42); // deterministic seed
    const pubKey = makeTestPublicKey(seed);
    const keyid1 = await computeSigningKeyId(pubKey);
    const keyid2 = await computeSigningKeyId(pubKey);
    expect(keyid1).toBe(keyid2);
  });

  test('different public keys produce different keyids', async () => {
    const pubKey1 = makeTestPublicKey(new Uint8Array(32).fill(1));
    const pubKey2 = makeTestPublicKey(new Uint8Array(32).fill(2));
    const keyid1 = await computeSigningKeyId(pubKey1);
    const keyid2 = await computeSigningKeyId(pubKey2);
    expect(keyid1).not.toBe(keyid2);
  });

  test('is a prefix of base64url(SHA-256(pubkey))', async () => {
    const seed = new Uint8Array(32).fill(7);
    const pubKey = makeTestPublicKey(seed);

    // Compute expected value manually
    const buf = pubKey.buffer.slice(pubKey.byteOffset, pubKey.byteOffset + pubKey.byteLength);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    const hashBytes = new Uint8Array(hash);
    const expectedFull = b64urlEncode(hashBytes);
    const expected22 = expectedFull.slice(0, 22);

    const keyid = await computeSigningKeyId(pubKey);
    expect(keyid).toBe(expected22);
  });
});

// ─── computeJwkThumbprint ─────────────────────────────────────────────────────

describe('computeJwkThumbprint', () => {
  test('returns a string of exactly 43 characters (base64url SHA-256)', async () => {
    const pubKey = makeTestPublicKey();
    const thumbprint = await computeJwkThumbprint(pubKey);
    expect(typeof thumbprint).toBe('string');
    expect(thumbprint.length).toBe(43);
  });

  test('contains only base64url-safe characters', async () => {
    for (let i = 0; i < 10; i++) {
      const pubKey = makeTestPublicKey();
      const thumbprint = await computeJwkThumbprint(pubKey);
      expect(/^[A-Za-z0-9_-]+$/.test(thumbprint)).toBe(true);
    }
  });

  test('is deterministic — same input produces same thumbprint', async () => {
    const seed = new Uint8Array(32).fill(42);
    const pubKey = makeTestPublicKey(seed);
    const t1 = await computeJwkThumbprint(pubKey);
    const t2 = await computeJwkThumbprint(pubKey);
    expect(t1).toBe(t2);
  });

  test('different public keys produce different thumbprints', async () => {
    const pubKey1 = makeTestPublicKey(new Uint8Array(32).fill(3));
    const pubKey2 = makeTestPublicKey(new Uint8Array(32).fill(4));
    const t1 = await computeJwkThumbprint(pubKey1);
    const t2 = await computeJwkThumbprint(pubKey2);
    expect(t1).not.toBe(t2);
  });

  test('uses RFC 7638 canonical JSON — lexicographic member order', async () => {
    const seed = new Uint8Array(32).fill(5);
    const pubKey = makeTestPublicKey(seed);
    const x = b64urlEncode(pubKey);
    // Canonical form per RFC 7638 §3.2: {"crv":"Ed25519","kty":"OKP","x":"<b64url>"}
    const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${x}"}`;
    const buf = new TextEncoder().encode(canonical).buffer as ArrayBuffer;
    const hash = await crypto.subtle.digest('SHA-256', buf);
    const expected = b64urlEncode(new Uint8Array(hash));
    const actual = await computeJwkThumbprint(pubKey);
    expect(actual).toBe(expected);
  });
});

// ─── getSigningKeyByThumbprint ────────────────────────────────────────────────

describe('getSigningKeyByThumbprint', () => {
  function makeKvEnv(store: Record<string, string>) {
    return {
      KEYS: {
        get: async (key: string) => store[key] ?? null,
      },
    } as unknown as import('./types').Env;
  }

  test('returns null when thumbprint is not in KV', async () => {
    const env = makeKvEnv({});
    const result = await getSigningKeyByThumbprint(env, 'nonexistent-thumbprint');
    expect(result).toBeNull();
  });

  test('returns null when thumbprint index points to missing key record', async () => {
    const thumbprint = 'abc123';
    const env = makeKvEnv({
      [`signing-key-thumbprint:${thumbprint}`]: JSON.stringify({ keyid: 'missingkeyid' }),
      // No 'signing-key:missingkeyid' entry
    });
    const result = await getSigningKeyByThumbprint(env, thumbprint);
    expect(result).toBeNull();
  });

  test('returns full SigningKeyRecord when thumbprint index and key record both exist', async () => {
    const seed = new Uint8Array(32).fill(99);
    const pubKey = makeTestPublicKey(seed);
    const thumbprint = await computeJwkThumbprint(pubKey);
    const keyid = 'test-keyid-22chars!!';

    const record: SigningKeyRecord = {
      keyid,
      algorithm: 'ed25519',
      public_key: b64urlEncode(pubKey),
      agent_id: 'acc_test',
      registered_at: '2026-01-01T00:00:00.000Z',
      status: 'active',
    };

    const env = makeKvEnv({
      [`signing-key-thumbprint:${thumbprint}`]: JSON.stringify({ keyid }),
      [`signing-key:${keyid}`]: JSON.stringify(record),
    });

    const result = await getSigningKeyByThumbprint(env, thumbprint);
    expect(result).not.toBeNull();
    expect(result!.keyid).toBe(keyid);
    expect(result!.agent_id).toBe('acc_test');
    expect(result!.status).toBe('active');
  });
});

// ─── b64urlEncode / b64urlDecode round-trip (used in signing key logic) ───────

describe('base64url round-trip (for signing key public keys)', () => {
  test('32-byte Ed25519 public key encodes and decodes correctly', () => {
    const pubKey = makeTestPublicKey();
    const encoded = b64urlEncode(pubKey);
    const decoded = b64urlDecode(encoded);
    expect(decoded.length).toBe(32);
    expect(decoded).toEqual(pubKey);
  });

  test('encoded public key contains no standard base64 padding', () => {
    // base64url should never have = padding
    const pubKey = makeTestPublicKey();
    const encoded = b64urlEncode(pubKey);
    expect(encoded).not.toContain('=');
  });

  test('encoded public key uses - not + and _ not /', () => {
    // Check against standard base64 chars that base64url replaces
    const pubKey = makeTestPublicKey();
    const encoded = b64urlEncode(pubKey);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });
});

// ─── POST /v1/agents/signing-keys — input validation ─────────────────────────

function makeApp(account: { id: string; name?: string; email?: string }) {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('account', account as never);
    return next();
  });
  app.route('/v1/agents', signingKeyRoutes);
  return app;
}

// ─── Radicle NID exposure ─────────────────────────────────────────────────────

describe('Radicle NID exposure', () => {
  /** Build a full app with an in-memory KV store for integration-style tests. */
  function makeKvApp(account: { id: string; name?: string; email?: string }) {
    const kvStore = new Map<string, string>();
    const kvMock = {
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => { kvStore.set(key, value); },
      delete: async (key: string) => { kvStore.delete(key); },
    };
    const env = { KEYS: kvMock } as unknown as Env;
    const app = new Hono<import('./types').HonoEnv>();
    app.use('*', async (c, next) => {
      c.set('account', account as never);
      return next();
    });
    app.route('/v1/agents', signingKeyRoutes);
    // Return app + env so callers can pass env to fetch
    return { app, env };
  }

  const seed = new Uint8Array(32).fill(7);
  const testPubKey = ed25519.getPublicKey(seed);
  const testPubKeyB64 = b64urlEncode(testPubKey);

  test('POST new-registration response includes nid starting with did:key:z6Mk', async () => {
    const { app, env } = makeKvApp({ id: 'acc_nid_test' });
    const res = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: testPubKeyB64 }),
    }), env);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.nid).toBe('string');
    expect(body.nid.startsWith('did:key:z6Mk')).toBe(true);
  });

  test('POST idempotent response includes same nid', async () => {
    const { app, env } = makeKvApp({ id: 'acc_nid_idem' });
    // First registration
    await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: testPubKeyB64 }),
    }), env);
    // Second registration (idempotent)
    const res = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: testPubKeyB64 }),
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.nid).toBe('string');
    expect(body.nid.startsWith('did:key:z6Mk')).toBe(true);
  });

  test('GET signing-key response includes nid matching POST response', async () => {
    const { app, env } = makeKvApp({ id: 'acc_nid_get' });
    // Register key
    const postRes = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: testPubKeyB64 }),
    }), env);
    const postBody = await postRes.json();
    const postNid = postBody.nid;

    // Fetch via GET
    const getRes = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'GET',
    }), env);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(typeof getBody.nid).toBe('string');
    expect(getBody.nid).toBe(postNid);
  });
});

// ─── Inverse NID index writes ─────────────────────────────────────────────────

describe('Inverse NID index writes', () => {
  /** Build a full app with in-memory KV, returning the raw KV store for inspection. */
  function makeKvAppWithStore(account: { id: string }) {
    const kvStore = new Map<string, string>();
    const kvMock = {
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => { kvStore.set(key, value); },
      delete: async (key: string) => { kvStore.delete(key); },
    };
    const env = { KEYS: kvMock } as unknown as Env;
    const app = new Hono<import('./types').HonoEnv>();
    app.use('*', async (c, next) => {
      c.set('account', account as never);
      return next();
    });
    app.route('/v1/agents', signingKeyRoutes);
    return { app, env, kvStore };
  }

  test('POST registration writes nid:<did> inverse index', async () => {
    const { app, env, kvStore } = makeKvAppWithStore({ id: 'acc_nididx1' });
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const pubKey = ed25519.getPublicKey(seed);
    const pubKeyB64 = b64urlEncode(pubKey);

    const res = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: pubKeyB64 }),
    }), env);
    expect(res.status).toBe(201);
    const body = await res.json();
    const nid = body.nid as string;

    // Directly inspect KV for nid:<did>
    const raw = kvStore.get('nid:' + nid);
    expect(raw).toBeDefined();
    const indexed = JSON.parse(raw!) as { account_id: string; keyid: string };
    expect(indexed.account_id).toBe('acc_nididx1');
    expect(typeof indexed.keyid).toBe('string');
    expect(indexed.keyid.length).toBeGreaterThan(0);
  });

  test('POST rotation deletes previous nid:<did> entry', async () => {
    const { app, env, kvStore } = makeKvAppWithStore({ id: 'acc_nidrot1' });
    const seed1 = crypto.getRandomValues(new Uint8Array(32));
    const pubKey1 = ed25519.getPublicKey(seed1);
    const seed2 = crypto.getRandomValues(new Uint8Array(32));
    const pubKey2 = ed25519.getPublicKey(seed2);

    // Register key1
    const res1 = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: b64urlEncode(pubKey1) }),
    }), env);
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    const nid1 = body1.nid as string;
    expect(kvStore.has('nid:' + nid1)).toBe(true);

    // Rotate to key2
    const res2 = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: b64urlEncode(pubKey2) }),
    }), env);
    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    const nid2 = body2.nid as string;

    // Previous NID entry should be gone
    expect(kvStore.has('nid:' + nid1)).toBe(false);
    // New NID entry should exist
    expect(kvStore.has('nid:' + nid2)).toBe(true);
    const indexed2 = JSON.parse(kvStore.get('nid:' + nid2)!) as { account_id: string };
    expect(indexed2.account_id).toBe('acc_nidrot1');
  });

  test('DELETE revocation removes nid:<did> entry', async () => {
    const { app, env, kvStore } = makeKvAppWithStore({ id: 'acc_nidrev1' });
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const pubKey = ed25519.getPublicKey(seed);

    // Register
    const postRes = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: b64urlEncode(pubKey) }),
    }), env);
    expect(postRes.status).toBe(201);
    const postBody = await postRes.json();
    const nid = postBody.nid as string;
    expect(kvStore.has('nid:' + nid)).toBe(true);

    // Revoke
    const delRes = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'DELETE',
    }), env);
    expect(delRes.status).toBe(200);

    // NID entry should be removed
    expect(kvStore.has('nid:' + nid)).toBe(false);
  });
});

describe('POST /v1/agents/signing-keys — input validation', () => {
  test('missing public_key → 400 missing_public_key', async () => {
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_public_key');
  });

  test('public_key as JWK object → 400 wrong_public_key_shape with x-field hint', async () => {
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: { kty: 'OKP', crv: 'Ed25519', x: 'someBase64Url' },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('wrong_public_key_shape');
    expect(body.hint).toContain('x');
    expect(body.hint).toContain('jwk.x');
  });

  test('public_key as number → 400 wrong_public_key_shape', async () => {
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: 42 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('wrong_public_key_shape');
    expect(body.hint).toContain('number');
  });

  test('public_key as null → 400 missing_public_key (preserved)', async () => {
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/signing-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: null }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_public_key');
  });
});
