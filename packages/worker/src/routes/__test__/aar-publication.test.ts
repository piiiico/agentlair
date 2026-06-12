/**
 * Unit tests for AAR v0.7 publication endpoints
 *
 *   GET  /.well-known/aar-profiles/:hash
 *   GET  /.well-known/aar-bindings/:hash
 *   POST /v1/aar/profiles  (admin)
 *   POST /v1/aar/bindings  (admin)
 *
 * Hermetic — uses an in-memory D1 mock and a freshly-generated Ed25519 key.
 *
 * Pipeline: aar-v07-publication-20260612-130000
 * Run: bun test src/routes/__test__/aar-publication.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  aarPublicationReadRoutes,
  aarPublicationWriteRoutes,
  canonicalJson,
} from '../aar-publication.js';
import type { HonoEnv } from '../../types.js';

// ── helpers ────────────────────────────────────────────────────────────────

function makeTestSigningKey(): string {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...privateKeyBytes));
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface ProfileRow {
  profile_hash: string;
  profile_canonical_json: string;
  issuer_signature_jws: string;
  issuer: string;
  issued_at: string;
  expires_at: string | null;
  superseded_at: string | null;
  supersedes: string | null;
}

interface BindingRow {
  binding_hash: string;
  binding_canonical_json: string;
  issuer_signature_jws: string;
  policy_surface_hash: string;
  canonicalizer_profile_hash: string;
  issuer: string;
  issued_at: string;
  expires_at: string | null;
  superseded_at: string | null;
  supersedes: string | null;
  status: 'active' | 'revoked' | 'superseded';
}

/**
 * Minimal D1 mock — supports the two tables and the four query shapes the
 * publication routes use. Stores rows in plain objects.
 */
function makeMockD1() {
  const profiles = new Map<string, ProfileRow>();
  const bindings = new Map<string, BindingRow>();
  return {
    profiles,
    bindings,
    prepare(sql: string) {
      const bind = (...params: unknown[]) => ({
        async run() {
          if (sql.startsWith('INSERT INTO aar_profiles')) {
            // Handler binds 7 params (?1..?7): hash, json, sig, issuer, issuedAt,
            // expiresAt, supersedes. superseded_at is hardcoded NULL in the SQL.
            const [hash, json, sig, issuer, issuedAt, expiresAt, supersedes] = params as [
              string, string, string, string, string, string | null, string | null,
            ];
            if (profiles.has(hash)) {
              throw new Error('UNIQUE constraint failed: aar_profiles.profile_hash');
            }
            profiles.set(hash, {
              profile_hash: hash,
              profile_canonical_json: json,
              issuer_signature_jws: sig,
              issuer,
              issued_at: issuedAt,
              expires_at: expiresAt,
              superseded_at: null,
              supersedes,
            });
          } else if (sql.startsWith('INSERT INTO aar_bindings')) {
            // Handler binds 10 params (?1..?10): hash, json, sig, surfaceHash,
            // profileHash, issuer, issuedAt, expiresAt, supersedes, status.
            const [hash, json, sig, surfaceHash, profileHash, issuer, issuedAt, expiresAt, supersedes, status] = params as [
              string, string, string, string, string, string, string, string | null, string | null,
              'active' | 'revoked' | 'superseded',
            ];
            if (bindings.has(hash)) {
              throw new Error('UNIQUE constraint failed: aar_bindings.binding_hash');
            }
            bindings.set(hash, {
              binding_hash: hash,
              binding_canonical_json: json,
              issuer_signature_jws: sig,
              policy_surface_hash: surfaceHash,
              canonicalizer_profile_hash: profileHash,
              issuer,
              issued_at: issuedAt,
              expires_at: expiresAt,
              superseded_at: null,
              supersedes,
              status,
            });
          } else if (sql.startsWith('UPDATE aar_profiles SET superseded_at')) {
            const [supersededAt, hash] = params as [string, string];
            const row = profiles.get(hash);
            if (row && row.superseded_at === null) row.superseded_at = supersededAt;
          } else if (sql.startsWith('UPDATE aar_bindings SET superseded_at')) {
            const [supersededAt, status, hash] = params as ['string', 'superseded', string];
            const row = bindings.get(hash);
            if (row && row.superseded_at === null) {
              row.superseded_at = supersededAt;
              row.status = status as 'superseded';
            }
          }
          return { success: true };
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith('SELECT profile_canonical_json')) {
            return (profiles.get(params[0] as string) as unknown as T) ?? null;
          }
          if (sql.startsWith('SELECT binding_canonical_json')) {
            return (bindings.get(params[0] as string) as unknown as T) ?? null;
          }
          if (sql.startsWith('SELECT 1 AS ok FROM aar_profiles')) {
            return (profiles.has(params[0] as string) ? ({ ok: 1 } as unknown as T) : null);
          }
          return null;
        },
      });
      return { bind };
    },
  };
}

function makeEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    KEYS: {},
    EMAILS: {},
    VAULT: {},
    AE_ANALYTICS: {},
    INBOX_NOTIFIER: {},
    AUDIT: makeMockD1(),
    AUDIT_SIGNING_KEY: makeTestSigningKey(),
    ADMIN_KEY: 'test-admin-key',
    ...overrides,
  };
}

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/.well-known', aarPublicationReadRoutes);
  app.route('/v1/aar', aarPublicationWriteRoutes);
  return app;
}

function appFetch(app: Hono<HonoEnv>, req: Request, env: Record<string, unknown>): Promise<Response> {
  return app.fetch(req, env as unknown as Record<string, string>);
}

// ── canonicalJson byte-parity ─────────────────────────────────────────────
//
// The worker's canonicalJson MUST produce the same bytes as audit-logger's.
// Asserted here against a few representative shapes — if this regresses,
// every hash check in the verifier will silently fail.

describe('canonicalJson byte-parity with audit-logger', () => {
  test('null/undefined → "null"', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
  });

  test('primitives are JSON.stringify equivalents', () => {
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('abc')).toBe('"abc"');
    expect(canonicalJson(true)).toBe('true');
  });

  test('object keys are sorted alphabetically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test('arrays preserve order, recurse into elements', () => {
    expect(canonicalJson([{ b: 1, a: 2 }, 3])).toBe('[{"a":2,"b":1},3]');
  });

  test('nested objects sort at every level', () => {
    const v = { z: { y: 1, x: 2 }, a: [{ b: 1, a: 2 }] };
    expect(canonicalJson(v)).toBe('{"a":[{"a":2,"b":1}],"z":{"x":2,"y":1}}');
  });
});

// ── GET endpoints — read ──────────────────────────────────────────────────

describe('GET /.well-known/aar-profiles/:hash', () => {
  test('400 on invalid hash format', async () => {
    const app = makeApp();
    const env = makeEnv();
    const res = await appFetch(app, new Request('http://t/.well-known/aar-profiles/not-a-hash'), env);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_profile_hash_format');
  });

  test('404 with profile_unpublished on unknown hash', async () => {
    const app = makeApp();
    const env = makeEnv();
    const hash = 'sha256:' + '0'.repeat(64);
    const res = await appFetch(app, new Request(`http://t/.well-known/aar-profiles/${hash}`), env);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('profile_unpublished');
    expect(body.profile_hash).toBe(hash);
  });
});

describe('GET /.well-known/aar-bindings/:hash', () => {
  test('400 on invalid hash format', async () => {
    const app = makeApp();
    const env = makeEnv();
    const res = await appFetch(app, new Request('http://t/.well-known/aar-bindings/garbage'), env);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_binding_hash_format');
  });

  test('404 with binding_unpublished on unknown hash', async () => {
    const app = makeApp();
    const env = makeEnv();
    const hash = 'sha256:' + '1'.repeat(64);
    const res = await appFetch(app, new Request(`http://t/.well-known/aar-bindings/${hash}`), env);
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('binding_unpublished');
    expect(body.binding_hash).toBe(hash);
  });
});

// ── POST endpoints — admin write + retrieval round-trip ────────────────────

async function buildSelfHashingProfile(): Promise<Record<string, unknown>> {
  // Mirror audit-logger's computeCanonicalizerProfileHash semantics: arrays are
  // sorted before canonicalJson. Skipping the sort here would produce a hash
  // the route handler — which DOES sort — would never accept.
  const profileWithoutHash = {
    profileId: 'http.v1',
    version: '1.0.0',
    toolFamily: 'http',
    includedConsequentialFields: ['method', 'url', 'body'].sort(),
    excludedFields: ['user_agent', 'request_id'].sort(),
    normalizationRules: { url: { caseSensitive: true } },
  };
  const profileHash = 'sha256:' + await sha256Hex(canonicalJson(profileWithoutHash));
  return { ...profileWithoutHash, profileHash };
}

describe('POST /v1/aar/profiles (admin write)', () => {
  test('403 on missing ADMIN_KEY', async () => {
    const app = makeApp();
    const env = makeEnv();
    const profile = await buildSelfHashingProfile();
    const res = await appFetch(app, new Request('http://t/v1/aar/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, issuer: 'agentlair.dev' }),
    }), env);
    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('admin_unauthorized');
  });

  test('422 profile_hash_mismatch when submitted hash != recomputed', async () => {
    const app = makeApp();
    const env = makeEnv();
    const profile = await buildSelfHashingProfile();
    // Tamper with the hash.
    (profile as Record<string, unknown>).profileHash = 'sha256:' + 'f'.repeat(64);
    const res = await appFetch(app, new Request('http://t/v1/aar/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
      body: JSON.stringify({ profile, issuer: 'agentlair.dev' }),
    }), env);
    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('profile_hash_mismatch');
  });

  test('201 published on self-consistent profile, retrievable via GET, signature present', async () => {
    const app = makeApp();
    const env = makeEnv();
    const profile = await buildSelfHashingProfile();
    const postRes = await appFetch(app, new Request('http://t/v1/aar/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
      body: JSON.stringify({ profile, issuer: 'agentlair.dev', issued_at: '2026-06-12T13:00:00Z' }),
    }), env);
    expect(postRes.status).toBe(201);
    const postBody = await postRes.json() as Record<string, unknown>;
    expect(postBody.status).toBe('published');
    expect(postBody.profile_hash).toBe(profile.profileHash);

    const getRes = await appFetch(app, new Request(`http://t/.well-known/aar-profiles/${profile.profileHash}`), env);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as Record<string, unknown>;
    expect(getBody.profile_hash).toBe(profile.profileHash);
    expect(typeof getBody.issuer_signature).toBe('string');
    expect((getBody.issuer_signature as string).split('.').length).toBe(3);  // JWS compact form
    expect(getBody.issued_at).toBe('2026-06-12T13:00:00Z');
  });

  test('200 already_published on duplicate POST (idempotent on content-addressed hash)', async () => {
    const app = makeApp();
    const env = makeEnv();
    const profile = await buildSelfHashingProfile();
    const req = () => new Request('http://t/v1/aar/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
      body: JSON.stringify({ profile, issuer: 'agentlair.dev' }),
    });
    const first = await appFetch(app, req(), env);
    expect(first.status).toBe(201);
    const second = await appFetch(app, req(), env);
    expect(second.status).toBe(200);
    const body = await second.json() as Record<string, unknown>;
    expect(body.status).toBe('already_published');
  });
});

describe('POST /v1/aar/bindings (admin write)', () => {
  const POLICY_SURFACE_HASH = 'sha256:' + 'a'.repeat(64);

  test('403 on missing ADMIN_KEY', async () => {
    const app = makeApp();
    const env = makeEnv();
    const profile = await buildSelfHashingProfile();
    const res = await appFetch(app, new Request('http://t/v1/aar/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        policy_surface_hash: POLICY_SURFACE_HASH,
        canonicalizer_profile_hash: profile.profileHash,
        issuer: 'agentlair.dev',
      }),
    }), env);
    expect(res.status).toBe(403);
  });

  test('422 canonicalizer_profile_not_published when binding references unpublished profile', async () => {
    const app = makeApp();
    const env = makeEnv();
    const profile = await buildSelfHashingProfile();
    // Skip publishing the profile.
    const res = await appFetch(app, new Request('http://t/v1/aar/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
      body: JSON.stringify({
        policy_surface_hash: POLICY_SURFACE_HASH,
        canonicalizer_profile_hash: profile.profileHash,
        issuer: 'agentlair.dev',
      }),
    }), env);
    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('canonicalizer_profile_not_published');
  });

  test('201 published on binding after profile published; retrievable; binding_hash matches audit-logger formula', async () => {
    const app = makeApp();
    const env = makeEnv();
    const profile = await buildSelfHashingProfile();
    // Publish profile first.
    await appFetch(app, new Request('http://t/v1/aar/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
      body: JSON.stringify({ profile, issuer: 'agentlair.dev' }),
    }), env);
    // Then publish binding.
    const postRes = await appFetch(app, new Request('http://t/v1/aar/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
      body: JSON.stringify({
        policy_surface_hash: POLICY_SURFACE_HASH,
        canonicalizer_profile_hash: profile.profileHash,
        issuer: 'agentlair.dev',
        issued_at: '2026-06-12T13:00:00Z',
      }),
    }), env);
    expect(postRes.status).toBe(201);
    const postBody = await postRes.json() as Record<string, unknown>;

    // The binding_hash must be sha256(canonicalJson({policySurfaceHash, canonicalizerProfileHash})).
    const expectedBindingHash = 'sha256:' + await sha256Hex(
      canonicalJson({ policySurfaceHash: POLICY_SURFACE_HASH, canonicalizerProfileHash: profile.profileHash })
    );
    expect(postBody.binding_hash).toBe(expectedBindingHash);

    const getRes = await appFetch(app, new Request(`http://t/.well-known/aar-bindings/${expectedBindingHash}`), env);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as Record<string, unknown>;
    expect(getBody.binding_hash).toBe(expectedBindingHash);
    expect(getBody.policy_surface_hash).toBe(POLICY_SURFACE_HASH);
    expect(getBody.canonicalizer_profile_hash).toBe(profile.profileHash);
    expect(getBody.status).toBe('active');
    expect(typeof getBody.issuer_signature).toBe('string');
  });

  test('400 on invalid policy_surface_hash format', async () => {
    const app = makeApp();
    const env = makeEnv();
    const res = await appFetch(app, new Request('http://t/v1/aar/bindings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
      body: JSON.stringify({
        policy_surface_hash: 'not-a-hash',
        canonicalizer_profile_hash: 'sha256:' + 'a'.repeat(64),
        issuer: 'agentlair.dev',
      }),
    }), env);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('policy_surface_hash_invalid');
  });
});

// Keep import live to avoid TS unused warning if test framework strips it.
void ed25519;
