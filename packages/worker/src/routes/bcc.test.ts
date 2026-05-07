/**
 * BCC Route Tests — Bonded Credibility Certificate issuance and retrieval.
 *
 * Covers:
 *   POST /issue    — happy path + all validation failure cases
 *   GET  /:id      — found, not found, revoked
 *   GET  /:id/verify — structured verification response (valid, invalid, revoked, 404)
 *
 * Uses a lightweight in-memory D1 mock backed by a Map<string, object>.
 * Signing uses a fixed all-zero Ed25519 private key (valid but not trusted).
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { bccRoutes, bccPublicRoutes } from './bcc.js';
import type { HonoEnv } from '../types.js';
import type { Account } from '../types.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalJSON } from '../lib/popa-cose.js';

// ─── Mock D1 ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal D1Database mock backed by a Map.
 *
 * Supports:
 *   INSERT INTO bcc_credentials  → stores the row
 *   SELECT credential_json, revoked_at FROM bcc_credentials WHERE id = ?
 */
interface MockD1 extends D1Database {
  store: Map<string, Record<string, unknown>>;
}

function makeMockD1(rows?: Map<string, Record<string, unknown>>): MockD1 {
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

        // SELECT ... FROM bcc_credentials WHERE id = ?
        if (q.includes('from bcc_credentials') && q.includes('where id')) {
          const id = bindings[0] as string;
          const row = store.get(id);
          return (row ?? null) as T | null;
        }

        return null as T | null;
      },
      async all<T>(): Promise<D1Result<T>> {
        const q = sql.trim().toLowerCase();

        // LIST query: SELECT rowid, id, subject_did, stake_medium, issued_at FROM bcc_credentials
        if (q.includes('select rowid') && q.includes('from bcc_credentials')) {
          // Filter revoked rows
          let rows = Array.from(store.values()).filter(r => !r['revoked_at']);

          // Sort by rowid desc (insertion order)
          rows.sort((a, b) => (b['rowid'] as number) - (a['rowid'] as number));

          let limit: number;
          if (q.includes('rowid < ?1')) {
            // Cursor query: bindings = [cursorRowid, limit]
            const cursorRowid = bindings[0] as number;
            limit = bindings[1] as number;
            rows = rows.filter(r => (r['rowid'] as number) < cursorRowid);
          } else {
            // No cursor: bindings = [limit]
            limit = bindings[0] as number;
          }

          rows = rows.slice(0, limit);

          const results = rows.map(r => ({
            rowid: r['rowid'],
            id: r['id'],
            subject_did: r['subject_did'],
            stake_medium: r['stake_medium'],
            issued_at: r['issued_at'],
          })) as unknown as T[];

          return { results, success: true, meta: {} as D1ResultInfo };
        }

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
          const newRowid = store.size + 1;
          store.set(id!, {
            rowid: newRowid,
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
    store,
  } as unknown as MockD1;
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
  db: MockD1 | null,
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

// ─── GET /:id/verify tests ────────────────────────────────────────────────────

describe('GET /:id/verify — verification endpoint', () => {
  test('verify: not found returns 404', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/bcc_doesnotexist/verify'),
      env as never,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('not_found');
  });

  test('verify: invalid id returns 400', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/vc_notabcc/verify'),
      env as never,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_id');
  });

  test('verify: revoked credential returns 410 with valid:false', async () => {
    const store = new Map<string, Record<string, unknown>>();
    const sampleCredential = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://agentlair.dev/contexts/bcc/v1.jsonld'],
      type: ['VerifiableCredential', 'BondedCredibilityCredential'],
      id: 'https://agentlair.dev/v1/bcc/bcc_revoked99',
      issuer: { id: 'did:web:agentlair.dev:agents:acc_test' },
      validFrom: '2026-05-05T00:00:00.000Z',
      validUntil: null,
      credentialSubject: {
        id: 'did:web:example.com',
        bcc_profile: 'BCC-Existence',
        stake_medium: 'existence',
        stake_amount: null,
        stake_unit: null,
        commitment_window_start: '2026-05-05T00:00:00.000Z',
        commitment_window_end: null,
        slashing_oracle_uri: null,
        evidence_anchor: 'self:bcc_revoked99',
        claim: {},
        confidence: 0.8,
      },
      proof: {
        type: 'DataIntegrityProof',
        cryptosuite: 'eddsa-jcs-2022',
        verificationMethod: 'did:web:agentlair.dev:agents:acc_test#key-1',
        proofPurpose: 'assertionMethod',
        created: '2026-05-05T00:00:00.000Z',
        proofValue: 'zFAKESIGNATURE',
      },
    };

    store.set('bcc_revoked99', {
      credential_json: JSON.stringify(sampleCredential),
      revoked_at: '2026-05-05T12:00:00.000Z',
    });

    const db = makeMockD1(store);
    const { app, env } = makeTestApp(null, db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/bcc_revoked99/verify'),
      env as never,
    );

    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.credential_id).toBe('bcc_revoked99');
  });
});

// ─── Round-trip: issue then verify ───────────────────────────────────────────

describe('round-trip: issue then verify', () => {
  test('issued credential verifies as valid:true', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_verify'), db, TEST_SIGNING_KEY);

    // Issue
    const issueRes = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:web:verify.example.com',
          claim: { note: 'verify round-trip' },
          stake_medium: 'existence',
          confidence: 0.9,
        }),
      }),
      env as never,
    );

    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as Record<string, unknown>;
    const bccId = (issued.id as string).split('/').at(-1)!;
    expect(bccId.startsWith('bcc_')).toBe(true);

    // Verify
    const verifyRes = await app.fetch(
      new Request(`http://x/${bccId}/verify`),
      env as never,
    );

    expect(verifyRes.status).toBe(200);
    const body = (await verifyRes.json()) as Record<string, unknown>;

    // Structural checks
    expect(body.credential_id).toBe(bccId);
    expect(body.valid).toBe(true);
    expect(body.profile).toBe('BCC-Existence');

    // Stake
    const stake = body.stake as Record<string, unknown>;
    expect(stake.medium).toBe('existence');
    expect(stake.amount).toBeNull();
    expect(stake.unit).toBeNull();

    // Oracle state for existence profile
    expect(body.oracle_state).toBe('self_revealing');

    // Evidence chain
    const chain = body.evidence_chain as Array<Record<string, unknown>>;
    expect(chain.length).toBe(1);
    expect(chain[0]!.type).toBe('self_anchor');
    expect((chain[0]!.ref as string).startsWith('self:bcc_')).toBe(true);

    // Issuer and subject
    expect(body.issuer).toBe('did:web:agentlair.dev:agents:acc_verify');
    expect(body.subject).toBe('did:web:verify.example.com');

    // Window
    const window = body.window as Record<string, unknown>;
    expect(typeof window.start).toBe('string');
    expect(window.end).toBeNull();
  });

  test('credential with tampered proofValue verifies as valid:false', async () => {

    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_tamper'), db, TEST_SIGNING_KEY);

    // Issue
    const issueRes = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:web:tamper.example.com',
          claim: { note: 'tamper test' },
          stake_medium: 'capital',
          confidence: 1.0,
        }),
      }),
      env as never,
    );

    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as Record<string, unknown>;
    const bccId = (issued.id as string).split('/').at(-1)!;

    // Tamper: overwrite the stored credential_json with a modified proofValue
    const store = db.store;
    const row = store.get(bccId)!;
    const cred = JSON.parse(row.credential_json as string) as Record<string, unknown>;
    (cred.proof as Record<string, unknown>).proofValue = 'zTAMPEREDSIGNATUREXXXXXXXX';
    store.set(bccId, { ...row, credential_json: JSON.stringify(cred) });

    // Verify — should fail
    const verifyRes = await app.fetch(
      new Request(`http://x/${bccId}/verify`),
      env as never,
    );

    expect(verifyRes.status).toBe(200);
    const body = (await verifyRes.json()) as Record<string, unknown>;
    expect(body.valid).toBe(false);
  });
});

// ─── GET /list tests ──────────────────────────────────────────────────────────

/** Build a pre-populated store with N rows (rowid 1..N). */
function makeListStore(n: number): Map<string, Record<string, unknown>> {
  const store = new Map<string, Record<string, unknown>>();
  for (let i = 1; i <= n; i++) {
    store.set(`bcc_row${i}`, {
      rowid: i,
      id: `bcc_row${i}`,
      subject_did: `did:web:example.com:agents:agent${i}`,
      stake_medium: 'existence',
      issued_at: `2026-05-05T${String(i).padStart(2, '0')}:00:00.000Z`,
      revoked_at: null,
      credential_json: JSON.stringify({}),
    });
  }
  return store;
}

describe('GET /list — list endpoint', () => {
  test('1: empty DB returns items=[], count=0, next_cursor=null', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, null);

    const res = await app.fetch(new Request('http://x/list'), env as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.items).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.next_cursor).toBeNull();
  });

  test('2: populated DB returns all rows in desc order', async () => {
    const db = makeMockD1(makeListStore(3));
    const { app, env } = makeTestApp(null, db, null);

    const res = await app.fetch(new Request('http://x/list'), env as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[]; count: number; next_cursor: string | null };
    expect(body.count).toBe(3);
    expect(body.next_cursor).toBeNull(); // count(3) < default limit(20)
    // Verify desc order: row3, row2, row1
    expect(body.items[0]!['id']).toBe('bcc_row3');
    expect(body.items[1]!['id']).toBe('bcc_row2');
    expect(body.items[2]!['id']).toBe('bcc_row1');
    // evidence_type maps from stake_medium
    expect(body.items[0]!['evidence_type']).toBe('existence');
    expect(typeof body.items[0]!['issued_at']).toBe('string');
  });

  test('3: limit=200 clamped to 100, returns HTTP 200', async () => {
    const db = makeMockD1(makeListStore(3));
    const { app, env } = makeTestApp(null, db, null);

    const res = await app.fetch(new Request('http://x/list?limit=200'), env as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; count: number };
    // Should not return 400, and count ≤ 100
    expect(body.count).toBeLessThanOrEqual(100);
  });

  test('4: since cursor paginates correctly', async () => {
    const db = makeMockD1(makeListStore(5));
    const { app, env } = makeTestApp(null, db, null);

    // since=bcc_row3 (rowid=3) → returns rows with rowid < 3 → bcc_row2, bcc_row1
    const res = await app.fetch(new Request('http://x/list?since=bcc_row3'), env as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[]; count: number; next_cursor: string | null };
    expect(body.count).toBe(2);
    expect(body.items[0]!['id']).toBe('bcc_row2');
    expect(body.items[1]!['id']).toBe('bcc_row1');
    expect(body.next_cursor).toBeNull(); // count(2) < default limit(20)
  });

  test('5: limit=abc returns 400 invalid_limit', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, null);

    const res = await app.fetch(new Request('http://x/list?limit=abc'), env as never);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_limit');
  });

  test('6: since=notabcc returns 400 invalid_cursor', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, null);

    const res = await app.fetch(new Request('http://x/list?since=notabcc'), env as never);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_cursor');
  });
});

// ─── Inline helpers for expired-credential test ───────────────────────────────
// Mirrors the signing logic in bcc.ts — used only to build pre-signed test fixtures.

const BASE58_ALPHABET_T = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncodeT(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j]!) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map(d => BASE58_ALPHABET_T[d]!).join('');
}

async function buildHashDataT(
  credentialWithoutProof: Record<string, unknown>,
  proofOptions: Record<string, unknown>,
): Promise<Uint8Array> {
  const sha256 = async (text: string): Promise<Uint8Array> => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return new Uint8Array(buf);
  };
  const proofHash = await sha256(canonicalJSON(proofOptions));
  const docHash = await sha256(canonicalJSON(credentialWithoutProof));
  const hashData = new Uint8Array(64);
  hashData.set(proofHash, 0);
  hashData.set(docHash, 32);
  return hashData;
}

// ─── GET /:id/badge — BCC badge endpoint ─────────────────────────────────────

describe('GET /:id/badge — BCC badge endpoint', () => {
  test('1: verified credential → green badge (fill=#4caf50, text verified)', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_badge'), db, TEST_SIGNING_KEY);

    // Issue a BCC
    const issueRes = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:web:badge.example.com',
          claim: { note: 'badge test' },
          stake_medium: 'existence',
          confidence: 0.9,
        }),
      }),
      env as never,
    );
    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as Record<string, unknown>;
    const bccId = (issued.id as string).split('/').at(-1)!;

    // Fetch badge.svg
    const res = await app.fetch(
      new Request(`http://x/${bccId}/badge.svg`),
      env as never,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    const svg = await res.text();
    expect(svg.includes('fill="#4caf50"')).toBe(true);
    expect(svg.includes('verified')).toBe(true);

    // Cache-Control assertion (satisfies test 9 requirement)
    expect(res.headers.get('Cache-Control')).toMatch(/^public, max-age=300/);
  });

  test('2: revoked credential → red badge (fill=#f44336, text revoked)', async () => {
    const store = new Map<string, Record<string, unknown>>();
    store.set('bcc_revoked_badge1', {
      credential_json: JSON.stringify({
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'BondedCredibilityCredential'],
        id: 'https://agentlair.dev/v1/bcc/bcc_revoked_badge1',
        credentialSubject: { id: 'did:web:example.com' },
        proof: { type: 'DataIntegrityProof', proofValue: 'zFAKE' },
      }),
      revoked_at: '2026-05-01T00:00:00.000Z',
    });

    const db = makeMockD1(store);
    const { app, env } = makeTestApp(null, db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/bcc_revoked_badge1/badge.svg'),
      env as never,
    );

    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg.includes('fill="#f44336"')).toBe(true);
    expect(svg.includes('revoked')).toBe(true);
  });

  test('3: tampered proofValue → red badge (fill=#f44336, text revoked)', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_tamper2'), db, TEST_SIGNING_KEY);

    // Issue
    const issueRes = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:web:tamper2.example.com',
          claim: { note: 'tamper badge test' },
          stake_medium: 'capital',
          confidence: 1.0,
        }),
      }),
      env as never,
    );
    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as Record<string, unknown>;
    const bccId = (issued.id as string).split('/').at(-1)!;

    // Tamper the stored credential
    const row = db.store.get(bccId)!;
    const cred = JSON.parse(row.credential_json as string) as Record<string, unknown>;
    (cred.proof as Record<string, unknown>).proofValue = 'zTAMPEREDBADGETEST';
    db.store.set(bccId, { ...row, credential_json: JSON.stringify(cred) });

    const res = await app.fetch(
      new Request(`http://x/${bccId}/badge.svg`),
      env as never,
    );

    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg.includes('fill="#f44336"')).toBe(true);
    expect(svg.includes('revoked')).toBe(true);
  });

  test('4: expired window → amber badge (fill=#ff9800, text expired)', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_expired'), db, TEST_SIGNING_KEY);

    const credentialId = 'bcc_expiredtest1234';
    const now = new Date().toISOString();
    // 1 hour in the past
    const pastTime = new Date(Date.now() - 3_600_000).toISOString();
    const issuerDid = 'did:web:agentlair.dev:agents:acc_expired';

    const credentialWithoutProof = {
      '@context': [
        'https://www.w3.org/ns/credentials/v2',
        'https://agentlair.dev/contexts/bcc/v1.jsonld',
      ],
      type: ['VerifiableCredential', 'BondedCredibilityCredential'],
      id: `https://agentlair.dev/v1/bcc/${credentialId}`,
      issuer: { id: issuerDid },
      validFrom: now,
      validUntil: null,
      credentialSubject: {
        id: 'did:web:expired.example.com',
        bcc_profile: 'BCC-Capital',
        stake_medium: 'capital',
        stake_amount: null,
        stake_unit: null,
        commitment_window_start: now,
        commitment_window_end: pastTime,
        slashing_oracle_uri: null,
        evidence_anchor: `self:${credentialId}`,
        claim: { note: 'expired badge test' },
        confidence: 0.9,
      },
    };

    const proofOptions = {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      verificationMethod: `${issuerDid}#key-1`,
      proofPurpose: 'assertionMethod',
      created: now,
    };

    const privKeyBytes = Uint8Array.from(atob(TEST_SIGNING_KEY), ch => ch.charCodeAt(0));
    const hashData = await buildHashDataT(
      credentialWithoutProof as Record<string, unknown>,
      proofOptions as Record<string, unknown>,
    );
    const signature = ed25519.sign(hashData, privKeyBytes);
    const proofValue = 'z' + base58btcEncodeT(signature);

    const credential = { ...credentialWithoutProof, proof: { ...proofOptions, proofValue } };

    db.store.set(credentialId, {
      rowid: 99,
      id: credentialId,
      credential_json: JSON.stringify(credential),
      revoked_at: null,
      issued_at: now,
    });

    const res = await app.fetch(
      new Request(`http://x/${credentialId}/badge.svg`),
      env as never,
    );

    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg.includes('fill="#ff9800"')).toBe(true);
    expect(svg.includes('expired')).toBe(true);
  });

  test('5: id not found → gray badge (fill=#9e9e9e, text unknown)', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/bcc_doesnotexistbadge/badge.svg'),
      env as never,
    );

    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg.includes('fill="#9e9e9e"')).toBe(true);
    expect(svg.includes('unknown')).toBe(true);
  });

  test('6: invalid id format → gray badge with "invalid id" (HTTP 200, SVG)', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(null, db, TEST_SIGNING_KEY);

    const res = await app.fetch(
      new Request('http://x/notabcc/badge.svg'),
      env as never,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    const svg = await res.text();
    expect(svg.includes('fill="#9e9e9e"')).toBe(true);
    expect(svg.includes('invalid id')).toBe(true);
  });

  test('7: style=flat-square → rx="0"; style=flat → rx="3"', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_style'), db, TEST_SIGNING_KEY);

    // Issue
    const issueRes = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:web:style.example.com',
          claim: { note: 'style test' },
          stake_medium: 'existence',
          confidence: 0.8,
        }),
      }),
      env as never,
    );
    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as Record<string, unknown>;
    const bccId = (issued.id as string).split('/').at(-1)!;

    // flat-square → rx="0"
    const squareRes = await app.fetch(
      new Request(`http://x/${bccId}/badge.svg?style=flat-square`),
      env as never,
    );
    const squareSvg = await squareRes.text();
    expect(squareSvg.includes('rx="0"')).toBe(true);

    // flat (default) → rx="3"
    const flatRes = await app.fetch(
      new Request(`http://x/${bccId}/badge.svg?style=flat`),
      env as never,
    );
    const flatSvg = await flatRes.text();
    expect(flatSvg.includes('rx="3"')).toBe(true);
  });

  test('8: compact=true → label "AL-BCC" appears in SVG', async () => {
    const db = makeMockD1();
    const { app, env } = makeTestApp(makeAccount('acc_compact'), db, TEST_SIGNING_KEY);

    // Issue
    const issueRes = await app.fetch(
      new Request('http://x/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_did: 'did:web:compact.example.com',
          claim: { note: 'compact test' },
          stake_medium: 'existence',
          confidence: 0.7,
        }),
      }),
      env as never,
    );
    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as Record<string, unknown>;
    const bccId = (issued.id as string).split('/').at(-1)!;

    const res = await app.fetch(
      new Request(`http://x/${bccId}/badge.svg?compact=true`),
      env as never,
    );

    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg.includes('>AL-BCC<')).toBe(true);
  });
});
