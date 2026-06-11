/**
 * Findings Provenance — Unit Tests
 *
 * Covers:
 * - POST /v1/agents/:agentId/findings (auth-gated submit, IDOR guard, validation, signing)
 * - GET  /v1/findings/:jti (public lookup, byte-stable re-sign)
 *
 * Hermetic Hono tests with in-memory D1 mock. AUDIT_SIGNING_KEY is a deterministic
 * 32-byte base64 key so signed_jwt bytes are reproducible across submit + lookup.
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import { findingsRoutes, findingsPublicRoutes } from './routes/findings';
import { verifyJWS, b64urlDecode } from './jwt';
import type { HonoEnv } from './types.js';
import type { D1Database } from '@cloudflare/workers-types';

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Deterministic 32-byte Ed25519 private key (base64) for reproducible signatures. */
function makeTestSigningKey(): { privateKeyB64: string; publicKeyBytes: Uint8Array } {
  const privateKeyBytes = new Uint8Array(32).fill(11);
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));
  return { privateKeyB64, publicKeyBytes };
}

/** Mock D1Database backed by an in-memory `findings` table. */
function makeMockD1() {
  const rows: Record<string, unknown>[] = [];
  const COLS = [
    'jti', 'agent_id', 'audience', 'title', 'severity', 'cwe', 'target',
    'evidence_hash', 'evidence_url', 'tools_used', 'time_to_find_ms',
    'behavioral_score', 'trust_level', 'trust_confidence', 'submitted_at',
  ];

  return {
    rows,
    prepare(sql: string) {
      const isInsert = sql.includes('INSERT INTO findings');
      const isSelect = sql.includes('SELECT') && sql.includes('FROM findings');
      const isAuditLogQuery = sql.includes('FROM audit_log');
      const isBehavioralEventsQuery = sql.includes('FROM behavioral_events');
      let boundParams: unknown[] = [];

      const self = {
        bind: (...params: unknown[]) => {
          boundParams = params;
          return self;
        },
        run: async () => {
          if (isInsert) {
            const entry: Record<string, unknown> = {};
            COLS.forEach((col, i) => { entry[col] = boundParams[i]; });
            rows.push(entry);
          }
          return { success: true, meta: {} };
        },
        first: async <T>() => {
          if (isSelect) {
            const jti = boundParams[0];
            const row = rows.find(r => r.jti === jti);
            return (row as T) ?? null;
          }
          if (isAuditLogQuery || isBehavioralEventsQuery) {
            return null as T | null;
          }
          return null;
        },
        all: async <T>() => {
          if (isAuditLogQuery || isBehavioralEventsQuery) {
            // trust-engine cold-start path — no events recorded
            return { results: [] as T[] };
          }
          return { results: rows.slice() as T[] };
        },
      };
      return self;
    },
  } as unknown as D1Database & { rows: Record<string, unknown>[] };
}

/** Build a Hono app that injects account, mounts both finding routers. */
function makeApp(account: { id: string; name?: string } | null) {
  const app = new Hono<HonoEnv>();
  // Mount public route first (so it matches GET /v1/findings/:jti without auth)
  app.route('/v1', findingsPublicRoutes);
  // Then inject account + mount auth-gated route
  app.use('/v1/agents/*', async (c, next) => {
    c.set('account', account as never);
    return next();
  });
  app.route('/v1', findingsRoutes);
  return app;
}

const { privateKeyB64, publicKeyBytes } = makeTestSigningKey();
const baseEnv = {
  AUDIT: makeMockD1(),
  AUDIT_SIGNING_KEY: privateKeyB64,
};

function freshEnv() {
  return { AUDIT: makeMockD1(), AUDIT_SIGNING_KEY: privateKeyB64 };
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Reentrancy in withdraw()',
    severity: 'HIGH',
    cwe: 'CWE-841',
    target: 'github:proto/vault@a3f9c12',
    evidence_hash: 'sha256:' + 'a'.repeat(64),
    evidence_url: 'https://gist.example/poc',
    tools_used: ['slither', 'foundry-fuzz'],
    time_to_find_ms: 12000,
    ...overrides,
  };
}

// ─── POST /v1/agents/:agentId/findings — submission ──────────────────────────

describe('POST /v1/agents/:agentId/findings — happy path', () => {
  test('returns 201 with jti, signed_jwt, permalink', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/acc_test/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    }, env as never);
    expect(res.status).toBe(201);
    const body = await res.json() as { jti: string; signed_jwt: string; permalink: string };
    expect(body.jti).toMatch(/^finding_[A-Za-z0-9_-]{21}$/);
    expect(typeof body.signed_jwt).toBe('string');
    expect(body.signed_jwt.split('.').length).toBe(3);
    expect(body.permalink).toBe(`https://agentlair.dev/v1/findings/${body.jti}`);
  });

  test('signed_jwt header alg=EdDSA and kid is present', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/acc_test/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    }, env as never);
    expect(res.status).toBe(201);
    const body = await res.json() as { signed_jwt: string };
    const [headerB64] = body.signed_jwt.split('.');
    const headerJson = new TextDecoder().decode(b64urlDecode(headerB64));
    const header = JSON.parse(headerJson) as { alg: string; kid: string };
    expect(header.alg).toBe('EdDSA');
    expect(typeof header.kid).toBe('string');
    expect(header.kid.length).toBeGreaterThan(0);
  });

  test('signed_jwt verifies against AUDIT_SIGNING_KEY public key', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/acc_test/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    }, env as never);
    const body = await res.json() as { signed_jwt: string; jti: string };
    const payload = verifyJWS(body.signed_jwt, publicKeyBytes);
    expect(payload).not.toBeNull();
    expect(payload!.iss).toBe('https://agentlair.dev');
    expect(payload!.sub).toBe('acc_test');
    expect(payload!.jti).toBe(body.jti);
    expect(payload!.type).toBe('security_finding');
  });

  test('inserts a row into findings with the correct columns', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_inserted' });
    const res = await app.request('/v1/agents/acc_inserted/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody({ title: 'D1 round-trip', severity: 'LOW' })),
    }, env as never);
    expect(res.status).toBe(201);
    const stored = (env.AUDIT as unknown as { rows: Record<string, unknown>[] }).rows;
    expect(stored.length).toBe(1);
    const row = stored[0];
    expect(row.agent_id).toBe('acc_inserted');
    expect(row.title).toBe('D1 round-trip');
    expect(row.severity).toBe('LOW');
    expect(row.audience).toBe('https://agentlair.dev');
    expect(row.evidence_hash).toBe('sha256:' + 'a'.repeat(64));
    expect(row.tools_used).toBe(JSON.stringify(['slither', 'foundry-fuzz']));
    expect(typeof row.submitted_at).toBe('string');
  });
});

// ─── POST /v1/agents/:agentId/findings — auth + IDOR ─────────────────────────

describe('POST /v1/agents/:agentId/findings — auth + IDOR', () => {
  test('no account (anonymous) → 401 unauthorized', async () => {
    const env = freshEnv();
    const app = makeApp(null);
    const res = await app.request('/v1/agents/acc_test/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    }, env as never);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  test('agentId != account.id → 403 forbidden (IDOR guard)', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_alice' });
    const res = await app.request('/v1/agents/acc_bob/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    }, env as never);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('forbidden');
  });
});

// ─── POST /v1/agents/:agentId/findings — validation ──────────────────────────

describe('POST /v1/agents/:agentId/findings — validation', () => {
  test('invalid severity → 400 invalid_severity', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/acc_test/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody({ severity: 'PANIC' })),
    }, env as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_severity');
  });

  test('invalid evidence_hash → 400 invalid_evidence_hash', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/acc_test/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody({ evidence_hash: 'md5:deadbeef' })),
    }, env as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_evidence_hash');
  });

  test('invalid cwe → 400 invalid_cwe', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/acc_test/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody({ cwe: 'CVE-2024-1234' })),
    }, env as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_cwe');
  });

  test('oversized title → 400 title_too_long', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/acc_test/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody({ title: 'A'.repeat(201) })),
    }, env as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('title_too_long');
  });

  test('missing AUDIT env → 503 audit_unavailable', async () => {
    const env = { AUDIT_SIGNING_KEY: privateKeyB64 };  // no AUDIT binding
    const app = makeApp({ id: 'acc_test' });
    const res = await app.request('/v1/agents/acc_test/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    }, env as never);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('audit_unavailable');
  });
});

// ─── GET /v1/findings/:jti — public lookup ───────────────────────────────────

describe('GET /v1/findings/:jti — public lookup', () => {
  test('happy path: round-trip returns the same signed_jwt as submit', async () => {
    const env = freshEnv();
    const app = makeApp({ id: 'acc_roundtrip' });
    const submitRes = await app.request('/v1/agents/acc_roundtrip/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    }, env as never);
    expect(submitRes.status).toBe(201);
    const submitBody = await submitRes.json() as { jti: string; signed_jwt: string };

    const lookupRes = await app.request(`/v1/findings/${submitBody.jti}`, {}, env as never);
    expect(lookupRes.status).toBe(200);
    const lookupBody = await lookupRes.json() as { jti: string; signed_jwt: string; claims: Record<string, unknown> };
    expect(lookupBody.jti).toBe(submitBody.jti);
    expect(lookupBody.signed_jwt).toBe(submitBody.signed_jwt);
    expect(lookupBody.claims.iss).toBe('https://agentlair.dev');
    expect(lookupBody.claims.sub).toBe('acc_roundtrip');
    expect(lookupBody.claims.type).toBe('security_finding');
  });

  test('invalid jti format → 400 invalid_jti', async () => {
    const env = freshEnv();
    const app = makeApp(null);
    const res = await app.request('/v1/findings/garbage', {}, env as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_jti');
  });

  test('unknown jti (well-formed but absent) → 404 finding_not_found', async () => {
    const env = freshEnv();
    const app = makeApp(null);
    const res = await app.request('/v1/findings/finding_aaaaaaaaaaaaaaaaaaaaa', {}, env as never);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('finding_not_found');
  });

  test('lookup is reachable without an Authorization header (public)', async () => {
    // makeApp with account=null does NOT set c.var.account — but the public
    // router is mounted before the auth-injecting middleware, so the lookup
    // handler runs without account in scope. Verifies the route is public.
    const env = freshEnv();
    // Seed a row via the submit path (so we have something to fetch)
    const submitApp = makeApp({ id: 'acc_pub' });
    const submitRes = await submitApp.request('/v1/agents/acc_pub/findings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    }, env as never);
    const { jti } = await submitRes.json() as { jti: string };

    // Fresh app with no account injected — pure anonymous fetch.
    const anonApp = makeApp(null);
    const res = await anonApp.request(`/v1/findings/${jti}`, {}, env as never);
    expect(res.status).toBe(200);
  });
});
