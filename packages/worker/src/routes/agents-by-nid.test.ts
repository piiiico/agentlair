/**
 * Tests for GET /v1/agents/by-nid/:al_nid — Inverse AAT-NID bridge
 *
 * Test NIDs are derived at runtime from freshly-generated Ed25519 keypairs.
 * No hardcoded production NIDs (did:key:z6MkidGJ...) in this file.
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import { b64urlEncode } from '../jwt.js';
import { pubkeyToRadicleNid } from '../jwt.js';
import { agentsByNidRoutes } from './agents-by-nid.js';
import { signingKeyRoutes } from './signing-keys.js';
import type { Env, HonoEnv } from '../types.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeRandomKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array; publicKeyB64: string; nid: string } {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = ed25519.getPublicKey(privateKey);
  const publicKeyB64 = b64urlEncode(publicKey);
  const nid = pubkeyToRadicleNid(publicKey);
  return { privateKey, publicKey, publicKeyB64, nid };
}

/** Build an in-memory KV + app for integration tests. */
function makeTestApp(account: { id: string; name?: string }) {
  const kvStore = new Map<string, string>();
  const kvMock = {
    get: async (key: string) => kvStore.get(key) ?? null,
    put: async (key: string, value: string) => { kvStore.set(key, value); },
    delete: async (key: string) => { kvStore.delete(key); },
  };

  // Seed account record for account_name resolution
  if (account.name) {
    kvStore.set('account:' + account.id, JSON.stringify({ name: account.name }));
  }

  const env = { KEYS: kvMock } as unknown as Env;

  const app = new Hono<HonoEnv>();

  // Mount signing-keys (authenticated, for setup)
  app.use('/v1/agents/signing-keys', async (c, next) => {
    c.set('account', account as never);
    return next();
  });
  app.route('/v1/agents', signingKeyRoutes);

  // Mount by-nid (public, no auth needed)
  app.route('/v1/agents', agentsByNidRoutes);

  return { app, env, kvStore };
}

/** POST a signing key and return the response body. */
async function registerKey(app: Hono<HonoEnv>, env: Env, publicKeyB64: string) {
  const res = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_key: publicKeyB64 }),
  }), env);
  return res;
}

/** GET /v1/agents/by-nid/:nid */
async function lookupNid(app: Hono<HonoEnv>, env: Env, nid: string) {
  const res = await app.fetch(
    new Request(`http://localhost/v1/agents/by-nid/${encodeURIComponent(nid)}`),
    env,
  );
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /v1/agents/by-nid/:al_nid — happy path', () => {
  test('registered NID returns 200 with required fields', async () => {
    const { app, env } = makeTestApp({ id: 'acc_happy1', name: 'testaccount' });
    const { publicKeyB64, nid } = makeRandomKeypair();
    await registerKey(app, env, publicKeyB64);

    const res = await lookupNid(app, env, nid);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.account_id).toBe('acc_happy1');
    expect(body.al_nid).toBe(nid);
    expect(body.did_web).toBe('did:web:agentlair.dev:agents:acc_happy1');
    expect(typeof body.latest_signing_key_registered_at).toBe('string');
  });

  test('account_name omitted when account has no name', async () => {
    const { app, env } = makeTestApp({ id: 'acc_noname' }); // no name
    const { publicKeyB64, nid } = makeRandomKeypair();
    await registerKey(app, env, publicKeyB64);

    const res = await lookupNid(app, env, nid);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect('account_name' in body).toBe(false);
  });

  test('account_name present when account has a name', async () => {
    const { app, env } = makeTestApp({ id: 'acc_withname', name: 'myagent' });
    const { publicKeyB64, nid } = makeRandomKeypair();
    await registerKey(app, env, publicKeyB64);

    const res = await lookupNid(app, env, nid);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.account_name).toBe('myagent');
  });

  test('fingerprint shape: colon-separated lowercase hex, 95 chars', async () => {
    const { app, env } = makeTestApp({ id: 'acc_fp1' });
    const { publicKeyB64, nid } = makeRandomKeypair();
    await registerKey(app, env, publicKeyB64);

    const res = await lookupNid(app, env, nid);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.fingerprint).toBe('string');
    // 32 bytes × 2 hex chars + 31 colons = 64 + 31 = 95 chars
    expect((body.fingerprint as string).length).toBe(95);
    expect(/^([0-9a-f]{2}:){31}[0-9a-f]{2}$/.test(body.fingerprint as string)).toBe(true);
  });

  test('trust_score omitted when observations < 10 (fresh account)', async () => {
    const { app, env } = makeTestApp({ id: 'acc_trustlow' });
    const { publicKeyB64, nid } = makeRandomKeypair();
    await registerKey(app, env, publicKeyB64);

    const res = await lookupNid(app, env, nid);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // Fresh account has no AUDIT binding — trust_score should be omitted
    expect('trust_score' in body).toBe(false);
  });
});

describe('GET /v1/agents/by-nid/:al_nid — 404 cases', () => {
  test('syntactically valid but unregistered NID → 404 nid_not_registered', async () => {
    const { app, env } = makeTestApp({ id: 'acc_miss' });
    const { nid } = makeRandomKeypair(); // not registered
    const res = await lookupNid(app, env, nid);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('nid_not_registered');
  });
});

describe('GET /v1/agents/by-nid/:al_nid — 400 cases', () => {
  test('non-did:key prefix → 400 invalid_nid', async () => {
    const { app, env } = makeTestApp({ id: 'acc_bad1' });
    const res = await lookupNid(app, env, 'not-a-did');
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_nid');
  });

  test('wrong multicodec prefix (X25519, z6LS...) → 400 invalid_nid', async () => {
    const { app, env } = makeTestApp({ id: 'acc_bad2' });
    // z6LS prefix is X25519, not Ed25519 (z6Mk)
    const res = await lookupNid(app, env, 'did:key:z6LSc...invalidpadding');
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_nid');
  });

  test('invalid base58btc characters → 400 invalid_nid', async () => {
    const { app, env } = makeTestApp({ id: 'acc_bad3' });
    const res = await lookupNid(app, env, 'did:key:z6Mk!!!invalid!!!');
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_nid');
  });

  test('length > 128 chars → 400 invalid_nid', async () => {
    const { app, env } = makeTestApp({ id: 'acc_bad4' });
    const longNid = 'did:key:z6Mk' + 'a'.repeat(120); // > 128 chars
    const res = await lookupNid(app, env, longNid);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_nid');
  });
});

describe('GET /v1/agents/by-nid/:al_nid — case sensitivity', () => {
  test('base58btc is case-sensitive: lowercased NID does not match', async () => {
    const { app, env } = makeTestApp({ id: 'acc_case1' });
    const { publicKeyB64, nid } = makeRandomKeypair();
    await registerKey(app, env, publicKeyB64);

    // Lowercase the NID — base58btc is case-sensitive, so this produces a different identifier
    const lowercasedNid = nid.toLowerCase();
    if (lowercasedNid === nid) {
      // NID was already lowercase — skip (edge case with all-lowercase chars)
      return;
    }
    const res = await lookupNid(app, env, lowercasedNid);
    // Should be 400 (different prefix) or 404 (different NID) — NEVER 200
    expect(res.status === 400 || res.status === 404).toBe(true);
    expect(res.status).not.toBe(200);
  });
});

describe('GET /v1/agents/by-nid/:al_nid — free public read', () => {
  test('no Authorization header required — never returns 401', async () => {
    const { app, env } = makeTestApp({ id: 'acc_public' });
    const { publicKeyB64, nid } = makeRandomKeypair();
    await registerKey(app, env, publicKeyB64);

    // No auth header
    const res = await app.fetch(
      new Request(`http://localhost/v1/agents/by-nid/${encodeURIComponent(nid)}`),
      env,
    );
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  test('no Authorization header for unregistered NID → 404, not 401', async () => {
    const { app, env } = makeTestApp({ id: 'acc_public2' });
    const { nid } = makeRandomKeypair(); // not registered
    const res = await app.fetch(
      new Request(`http://localhost/v1/agents/by-nid/${encodeURIComponent(nid)}`),
      env,
    );
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(404);
  });
});

describe('GET /v1/agents/by-nid/:al_nid — rotation cleanup', () => {
  test('rotation: old NID → 404, new NID → 200', async () => {
    const { app, env } = makeTestApp({ id: 'acc_rot1' });
    const key1 = makeRandomKeypair();
    const key2 = makeRandomKeypair();

    // Register key1
    await registerKey(app, env, key1.publicKeyB64);
    const res1 = await lookupNid(app, env, key1.nid);
    expect(res1.status).toBe(200);

    // Rotate to key2
    await registerKey(app, env, key2.publicKeyB64);

    // key1 NID should now 404
    const res1after = await lookupNid(app, env, key1.nid);
    expect(res1after.status).toBe(404);

    // key2 NID should 200
    const res2 = await lookupNid(app, env, key2.nid);
    expect(res2.status).toBe(200);
    const body = await res2.json() as Record<string, unknown>;
    expect(body.account_id).toBe('acc_rot1');
  });

  test('rotation: new NID response includes key2 registered_at', async () => {
    const { app, env } = makeTestApp({ id: 'acc_rot2' });
    const key1 = makeRandomKeypair();
    const key2 = makeRandomKeypair();

    await registerKey(app, env, key1.publicKeyB64);
    const rotationRes = await registerKey(app, env, key2.publicKeyB64);
    const rotBody = await rotationRes.json() as Record<string, unknown>;
    const key2RegisteredAt = rotBody.registered_at as string;

    const res = await lookupNid(app, env, key2.nid);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.latest_signing_key_registered_at).toBe(key2RegisteredAt);
  });
});

describe('GET /v1/agents/by-nid/:al_nid — revocation cleanup', () => {
  test('after DELETE /v1/agents/signing-keys, NID → 404', async () => {
    const { app, env } = makeTestApp({ id: 'acc_rev1' });
    const { publicKeyB64, nid } = makeRandomKeypair();

    // Register
    await registerKey(app, env, publicKeyB64);
    const beforeRes = await lookupNid(app, env, nid);
    expect(beforeRes.status).toBe(200);

    // Revoke
    const delRes = await app.fetch(new Request('http://localhost/v1/agents/signing-keys', {
      method: 'DELETE',
    }), env);
    expect(delRes.status).toBe(200);

    // NID should now 404
    const afterRes = await lookupNid(app, env, nid);
    expect(afterRes.status).toBe(404);
    const body = await afterRes.json() as Record<string, unknown>;
    expect(body.error).toBe('nid_not_registered');
  });
});
