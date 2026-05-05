/**
 * BCC Route Tests — Bonded Credibility Certificate issuance and retrieval.
 *
 * Covers:
 *   POST /issue — happy path + all validation failure cases
 *   GET  /:id   — found, not found, revoked
 *
 * Uses a lightweight in-memory D1 mock backed by a Map<string, object>.
 * Signing uses a fixed all-zero Ed25519 private key (valid but not trusted).
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { bccRoutes, bccPublicRoutes } from './bcc.js';
import type { HonoEnv } from '../types.js';
import type { Account } from '../types.js';

// ─── Mock D1 ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal D1Database mock backed by a Map.
 *
 * Supports:
 *   INSERT INTO bcc_credentials  → stores the row
 *   SELECT credential_json, revoked_at FROM bcc_credentials WHERE id = ?
 */
function makeMockD1(rows?: Map<string, Record<string, unknown>>): D1Database {
  const store: Map<string, Record<string, unknown>> = rows ?? new Map();

  const makeStmt = (sql: string) => {
    let bindings: unknown[] = [];

    const stmt = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        const q = sql.trim().toLowerCase();

        // SELECT credential_json, revoked_at FROM bcc_credentials WHERE id = ?
        if (q.includes('from bcc_credentials') && q.includes('where id')) {
          const id = bindings[0] as string;
          const row = store.get(id);
          return (row ?? null) as T | null;
        }

        return null as T | null;
      },
      async all<T>(): Promise<D1Result<T>> {
        return { results: [] as T[], success: true, meta: {} as D1ResultInfo };
      },
      async run(): Promise<D1Result<Record<string, unknown>>> {
        const q = sql.trim().toLowerCase();

        // INSERT INTO bcc_credentials (id, issuer_account_id, ...)
        if (q.includes('insert into bcc_credentials')) {
          // Positional: id, issuer_account_id, subject_did, bcc_profile, stake_medium,
          //             confidence, claim_json, credential_json
          const [id, issuer_account_id, subject_did, bcc_profile, stake_medium,
                 confidence, claim_json, credential_json] = bindings as string[];
          store.set(id!, {
            id,
            issuer_account_id,
            subject_did,
            bcc_profile,
            stake_medium,
            confidence,
            claim_json,
            credential_json,
            issued_at: new Date().toISOString(),
            revoked_at: null,
          });
        }

        return { results: [], success: true, meta: {} as D1ResultInfo };
      },
    };

    return stmt;
  };

  return {
    prepare: makeStmt,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

// ─── Test app builder ─────────────────────────────────────────────────────────

/** A valid Ed25519 private key seed (32 zero bytes, base64) — valid but not trusted. */
const TEST_SIGNING_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeAccount(id: string): Account {
  return { id, plan: 'free' };
}

/**
 * Build a Hono test app with both issue and public retrieval routes.
 *
 * Account is injected via middleware (simulates the auth middleware in the real app).
 * D1 and signing key are passed via env.
 */
function makeTestApp(
  account: Account | null,
  db: D1Database | null,
  signingKey: string | null,
): { app: Hono<HonoEnv>; env: Record<string, unknown> } {
  const app = new Hono<HonoEnv>();

  app.use('*', async (c, next) => {
    c.set('account', account);
    await next();
  });

  // Mount public retrieval on /:id
  app.route('/', bccPublicRoutes);

  // Mount auth-gated issuance on /issue
  app.route('/', bccRoutes);

  const env: Record<string, unknown> = {};
  if (db) env['AUDIT'] = db;
  if (signingKey) env['AUDIT_SIGNING_KEY'] = signingKey;

  return { app, env };
}

// ─── POST /issue tests ────────────────────────────────────────────────────────

describe('POST /issue — happy path', () => {
  test('returns 201 with a valid BCC structure', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:web:example.com:agents:agent1',
          claim: { statement: 'This agent is trustworthy.' },
          stake_medium: 'existence',
          confidence: 0.85,
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;

    // W3C VC 2.0 context
    expect(body['@context']).toEqual([
      'https://www.w3.org/ns/credentials/v2',
      'https://agentlair.dev/contexts/bcc/v1.jsonld',
    ]);
    expect(body.type).toEqual(['VerifiableCredential', 'BondedCredibilityCredential']);
    expect(typeof body.id).toBe('string');
    expect((body.id as string).startsWith('https://agentlair.dev/v1/bcc/bcc_')).toBe(true);

    // Issuer
    const issuer = body.issuer as Record<string, unknown>;
    expect(issuer.id).toBe('did:web:agentlair.dev:agents:acc_test');

    // Credential subject
    const cs = body.credentialSubject as Record<string, unknown>;
    expect(cs.id).toBe('did:web:example.com:agents:agent1');
    expect(cs.bcc_profile).toBe('BCC-Existence');
    expect(cs.stake_medium).toBe('existence');
    expect(cs.confidence).toBe(0.85);
    expect(cs.claim).toEqual({ statement: 'This agent is trustworthy.' });
    expect(typeof cs.evidence_anchor).toBe('string');
    expect((cs.evidence_anchor as string).startsWith('self:bcc_')).toBe(true);

    // Proof
    const proof = body.proof as Record<string, unknown>;
    expect(proof.type).toBe('DataIntegrityProof');
    expect(proof.cryptosuite).toBe('eddsa-jcs-2022');
    expect(proof.proofPurpose).toBe('assertionMethod');
    expect(typeof proof.proofValue).toBe('string');
    expect((proof.proofValue as string).startsWith('z')).toBe(true);
    expect((proof.verificationMethod as string).startsWith('did:web:agentlair.dev:agents:acc_test')).toBe(true);
  });

  test('capital profile maps correctly', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:key:z6Mktest',
          claim: { bond_contract: '0xabc123' },
          stake_medium: 'capital',
          confidence: 1.0,
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const cs = body.credentialSubject as Record<string, unknown>;
    expect(cs.bcc_profile).toBe('BCC-Capital');
  });

  test('claims profile maps correctly', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:key:z6Mktest',
          claim: { brier_score: 0.12 },
          stake_medium: 'claims',
          confidence: 0.7,
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const cs = body.credentialSubject as Record<string, unknown>;
    expect(cs.bcc_profile).toBe('BCC-Claims');
  });
});

describe('POST /issue — auth guard', () => {
  test('missing auth returns 401', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:key:z6Mktest',
          claim: {},
          stake_medium: 'existence',
          confidence: 0.5,
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
  });
});

describe('POST /issue — validation errors', () => {
  test('invalid stake_medium returns 400', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:key:z6Mktest',
          claim: {},
          stake_medium: 'reputation',  // not a valid medium
          confidence: 0.5,
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_stake_medium');
  });

  test('confidence above 1 returns 400', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:key:z6Mktest',
          claim: {},
          stake_medium: 'existence',
          confidence: 1.5,
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_confidence');
  });

  test('confidence below 0 returns 400', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:key:z6Mktest',
          claim: {},
          stake_medium: 'existence',
          confidence: -0.1,
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_confidence');
  });

  test('missing claim returns 400', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:key:z6Mktest',
          stake_medium: 'existence',
          confidence: 0.5,
          // claim omitted
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('missing_claim');
  });

  test('missing subject_did returns 400', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // subject_did omitted
          claim: {},
          stake_medium: 'existence',
          confidence: 0.5,
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_subject_did');
  });

  test('subject_did not starting with did: returns 400', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_test'), db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'not-a-did',
          claim: {},
          stake_medium: 'existence',
          confidence: 0.5,
        }),
      }),
      env as never,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_subject_did');
  });
});

// ─── GET /:id tests ───────────────────────────────────────────────────────────

describe('GET /:id — retrieval', () => {
  test('found credential returns 200 with credential JSON', async () => {
    const sampleCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'BondedCredibilityCredential'],
      id: 'https://agentlair.dev/v1/bcc/bcc_test123',
    };

    const store = new Map<string, Record<string, unknown>>();
    store.set('bcc_test123', {
      credential_json: JSON.stringify(sampleCredential),
      revoked_at: null,
    });

    const db = makeMockD1(store);
    const { app, env } = makeTestApp(null, db, null);

    const res = await app.fetch(
      new Request('http://x/bcc_test123'),
      env as never,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['@context']).toEqual(['https://www.w3.org/ns/credentials/v2']);
  });

  test('not found returns 404', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, null);

    const res = await app.fetch(
      new Request('http://x/bcc_doesnotexist'),
      env as never,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('not_found');
  });

  test('revoked credential returns 410', async () => {
    const store = new Map<string, Record<string, unknown>>();
    store.set('bcc_revoked1', {
      credential_json: JSON.stringify({ type: 'test' }),
      revoked_at: '2026-05-01T00:00:00.000Z',
    });

    const db = makeMockD1(store);
    const { app, env } = makeTestApp(null, db, null);

    const res = await app.fetch(
      new Request('http://x/bcc_revoked1'),
      env as never,
    );

    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('revoked');
  });

  test('id not starting with bcc_ returns 400', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, null);

    const res = await app.fetch(
      new Request('http://x/vc_somethingelse'),
      env as never,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_id');
  });
});

// ─── Round-trip: issue then retrieve ─────────────────────────────────────────

describe('round-trip: issue then retrieve', () => {
  test('issued credential is retrievable via GET', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_roundtrip'), db, TEST_SIGNING_KEY);

    // Issue
    const issueRes = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:web:example.com',
          claim: { note: 'round-trip test' },
          stake_medium: 'claims',
          confidence: 0.6,
        }),
      }),
      env as never,
    );

    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as Record<string, unknown>;
    const credUrl = issued.id as string;

    // Extract the bcc_ id from the URL
    const bccId = credUrl.split('/').at(-1)!;
    expect(bccId.startsWith('bcc_')).toBe(true);

    // Retrieve
    const getRes = await app.fetch(
      new Request(`http://x/${bccId}`),
      env as never,
    );

    expect(getRes.status).toBe(200);
    const retrieved = (await getRes.json()) as Record<string, unknown>;
    expect(retrieved.id).toBe(credUrl);
  });
});
