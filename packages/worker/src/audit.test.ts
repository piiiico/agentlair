/**
 * AgentLair Audit Trail — Tests
 *
 * Tests for:
 * - Ed25519 signing and verification roundtrip
 * - Event categorization (path → category)
 * - Action derivation (method + path → action)
 * - Result mapping (status code → result)
 * - Hash chain (prev_hash logic)
 * - POST /v1/audit/log — explicit L3 self-attestation endpoint
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getCategory, getAction, getResult, signEntry, writeExplicitAuditEvent, ACTION_STREAM_UNIT_TYPES } from './middleware/audit';
import type { AuditEntry } from './middleware/audit';
import { auditRoutes } from './routes/audit';
import type { HonoEnv } from './types';

// ─── Helper: generate a test Ed25519 keypair ─────────────────────────────────

function generateTestKeypair(): { privateKeyB64: string; publicKeyBytes: Uint8Array } {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));
  return { privateKeyB64, publicKeyBytes };
}

// ─── Helper: make a minimal entry for signing ─────────────────────────────────

function makeEntry(overrides: Partial<Omit<AuditEntry, 'signature'>> = {}): Omit<AuditEntry, 'signature'> {
  return {
    id: 'test123',
    timestamp: '2026-03-23T10:00:00.000Z',
    account_id: 'acc_test',
    actor_type: 'account',
    actor_id: 'acc_test',
    actor_ip_hash: 'abc123',
    category: 'auth',
    action: 'auth.login',
    method: 'POST',
    path: '/v1/auth/login',
    resource_type: null,
    resource_id: null,
    status: 200,
    result: 'success',
    error_code: null,
    details: null,
    prev_hash: '0'.repeat(64),
    ...overrides,
  };
}

// ─── Ed25519 signing ──────────────────────────────────────────────────────────

describe('Ed25519 signing', () => {
  test('sign + verify roundtrip produces valid signature', async () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const entry = makeEntry();

    const signature = await signEntry(entry, privateKeyB64);
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);

    // Verify signature
    const privateKeyBytes = Uint8Array.from(atob(privateKeyB64), c => c.charCodeAt(0));
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    const contentToSign = JSON.stringify(entry);
    const messageBytes = new TextEncoder().encode(contentToSign);

    const valid = ed25519.verify(signatureBytes, messageBytes, publicKeyBytes);
    expect(valid).toBe(true);
  });

  test('different entries produce different signatures', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry1 = makeEntry({ id: 'entry1' });
    const entry2 = makeEntry({ id: 'entry2' });

    const sig1 = await signEntry(entry1, privateKeyB64);
    const sig2 = await signEntry(entry2, privateKeyB64);

    expect(sig1).not.toBe(sig2);
  });

  test('same entry + same key produces same signature (deterministic)', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeEntry();

    const sig1 = await signEntry(entry, privateKeyB64);
    const sig2 = await signEntry(entry, privateKeyB64);

    // Ed25519 is deterministic (no randomness in signing)
    expect(sig1).toBe(sig2);
  });

  test('signature is 64 bytes (128 base64 chars)', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeEntry();
    const signature = await signEntry(entry, privateKeyB64);

    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    expect(signatureBytes.length).toBe(64);
  });

  test('wrong public key fails verification', async () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();
    const entry = makeEntry();

    const signature = await signEntry(entry, kp1.privateKeyB64);
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    const contentToSign = JSON.stringify(entry);
    const messageBytes = new TextEncoder().encode(contentToSign);

    // Verify with wrong public key — should return false
    const valid = ed25519.verify(signatureBytes, messageBytes, kp2.publicKeyBytes);
    expect(valid).toBe(false);
  });
});

// ─── Event categorization ─────────────────────────────────────────────────────

describe('getCategory', () => {
  test('auth paths → auth category', () => {
    expect(getCategory('/v1/auth/login', 200)).toBe('auth');
    expect(getCategory('/v1/auth/keys', 200)).toBe('auth');
    expect(getCategory('/v1/auth/agent-register', 200)).toBe('auth');
  });

  test('email paths → email category', () => {
    expect(getCategory('/v1/email/send', 200)).toBe('email');
    expect(getCategory('/v1/email/inbox', 200)).toBe('email');
    expect(getCategory('/v1/inbox/abc123', 200)).toBe('email');
  });

  test('vault paths → vault category', () => {
    expect(getCategory('/v1/vault/store', 200)).toBe('vault');
    expect(getCategory('/v1/vault/recover', 200)).toBe('vault');
    expect(getCategory('/v1/vault/mykey', 200)).toBe('vault');
  });

  test('pod paths → pod category', () => {
    expect(getCategory('/v1/pods', 200)).toBe('pod');
    expect(getCategory('/v1/pods/pod_abc123', 200)).toBe('pod');
  });

  test('calendar paths → calendar category', () => {
    expect(getCategory('/v1/calendar/events', 200)).toBe('calendar');
    expect(getCategory('/v1/calendar/feed.ics', 200)).toBe('calendar');
  });

  test('webhook paths → webhook category', () => {
    expect(getCategory('/v1/email/webhooks', 200)).toBe('webhook');
    expect(getCategory('/v1/email/webhooks/abc123', 200)).toBe('webhook');
  });

  test('401 status → system category (auth failure)', () => {
    expect(getCategory('/v1/email/send', 401)).toBe('system');
  });

  test('429 status → system category (rate limit)', () => {
    expect(getCategory('/v1/email/send', 429)).toBe('system');
  });

  test('unknown paths → system category', () => {
    expect(getCategory('/v1/unknown/path', 200)).toBe('system');
    expect(getCategory('/v1/dns/something', 200)).toBe('system');
  });
});

// ─── Action derivation ────────────────────────────────────────────────────────

describe('getAction', () => {
  test('POST /v1/auth/login → auth.login', () => {
    expect(getAction('auth', 'POST', '/v1/auth/login')).toBe('auth.login');
  });

  test('POST /v1/auth/keys → auth.create_key', () => {
    expect(getAction('auth', 'POST', '/v1/auth/keys')).toBe('auth.create_key');
  });

  test('POST /v1/auth/agent-register → auth.agent_register', () => {
    expect(getAction('auth', 'POST', '/v1/auth/agent-register')).toBe('auth.agent_register');
  });

  test('POST /v1/email/send → email.send', () => {
    expect(getAction('email', 'POST', '/v1/email/send')).toBe('email.send');
  });

  test('GET /v1/email/inbox → email.list', () => {
    expect(getAction('email', 'GET', '/v1/email/inbox')).toBe('email.list');
  });

  test('POST /v1/vault/store → vault.store', () => {
    expect(getAction('vault', 'POST', '/v1/vault/store')).toBe('vault.store');
  });

  test('GET /v1/vault/mykey → vault.retrieve', () => {
    expect(getAction('vault', 'GET', '/v1/vault/mykey')).toBe('vault.retrieve');
  });

  test('POST /v1/pods → pod.create', () => {
    expect(getAction('pod', 'POST', '/v1/pods')).toBe('pod.create');
  });

  test('DELETE /v1/pods/pod_abc → pod.delete', () => {
    expect(getAction('pod', 'DELETE', '/v1/pods/pod_abc')).toBe('pod.delete');
  });

  test('POST /v1/pods/pod_abc/keys → pod.create_key', () => {
    expect(getAction('pod', 'POST', '/v1/pods/pod_abc/keys')).toBe('pod.create_key');
  });

  test('POST /v1/calendar/events → calendar.create', () => {
    expect(getAction('calendar', 'POST', '/v1/calendar/events')).toBe('calendar.create');
  });

  test('POST /v1/email/webhooks → webhook.create', () => {
    expect(getAction('webhook', 'POST', '/v1/email/webhooks')).toBe('webhook.create');
  });

  test('DELETE /v1/email/webhooks/abc → webhook.delete', () => {
    expect(getAction('webhook', 'DELETE', '/v1/email/webhooks/abc')).toBe('webhook.delete');
  });

  test('fallback: GET system path → system.read', () => {
    expect(getAction('system', 'GET', '/v1/unknown')).toBe('system.read');
  });

  test('fallback: POST system path → system.create', () => {
    expect(getAction('system', 'POST', '/v1/unknown')).toBe('system.create');
  });

  test('fallback: DELETE system path → system.delete', () => {
    expect(getAction('system', 'DELETE', '/v1/unknown')).toBe('system.delete');
  });
});

// ─── Result mapping ───────────────────────────────────────────────────────────

describe('getResult', () => {
  test('2xx → success', () => {
    expect(getResult(200)).toBe('success');
    expect(getResult(201)).toBe('success');
    expect(getResult(204)).toBe('success');
  });

  test('401 → denied', () => {
    expect(getResult(401)).toBe('denied');
  });

  test('403 → denied', () => {
    expect(getResult(403)).toBe('denied');
  });

  test('429 → rate_limited', () => {
    expect(getResult(429)).toBe('rate_limited');
  });

  test('400 → failure', () => {
    expect(getResult(400)).toBe('failure');
  });

  test('404 → failure', () => {
    expect(getResult(404)).toBe('failure');
  });

  test('500 → failure', () => {
    expect(getResult(500)).toBe('failure');
  });

  test('503 → failure', () => {
    expect(getResult(503)).toBe('failure');
  });
});

// ─── Hash chain ───────────────────────────────────────────────────────────────

describe('hash chain', () => {
  test('prev_hash of first entry is genesis (64 zeros)', () => {
    const entry = makeEntry();
    expect(entry.prev_hash).toBe('0'.repeat(64));
  });

  test('prev_hash length is 64 chars (SHA-256 hex)', () => {
    const entry = makeEntry({ prev_hash: 'a'.repeat(64) });
    expect(entry.prev_hash.length).toBe(64);
  });

  test('two entries have different prev_hashes when second references first', async () => {
    const entry1 = makeEntry({ id: 'entry1', prev_hash: '0'.repeat(64) });
    const entry2 = makeEntry({ id: 'entry2', prev_hash: 'a'.repeat(64) });

    expect(entry1.prev_hash).not.toBe(entry2.prev_hash);
  });

  test('SHA-256 of an entry produces a 64-char hex string', async () => {
    const entry = makeEntry();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entry)));
    const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(hashHex.length).toBe(64);
  });
});

// ─── POST /v1/audit/log — explicit L3 self-attestation ────────────────────────

// ── Mock helpers ───────────────────────────────────────────────────────────────

/** Build a test Ed25519 key as base64. Returns {privateKeyB64, publicKeyBytes}. */
function makeTestSigningKey() {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));
  return { privateKeyB64, publicKeyBytes };
}

/** Mock D1Database that stores INSERT rows in-memory. */
function makeMockD1() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    prepare(sql: string) {
      const COLS = ['id', 'timestamp', 'account_id', 'actor_type', 'actor_id', 'actor_ip_hash',
        'category', 'action', 'method', 'path', 'resource_type', 'resource_id',
        'status', 'result', 'error_code', 'details', 'prev_hash', 'signature'];
      // Chain: prepare → bind → run / prepare → first / prepare → all
      const self = {
        bind: (...params: unknown[]) => ({
          run: async () => {
            if (sql.includes('INSERT INTO audit_log')) {
              const entry: Record<string, unknown> = {};
              COLS.forEach((col, i) => { entry[col] = params[i]; });
              rows.push(entry);
            }
          },
          first: async <T>() => null as T | null,
          all: async <T>() => ({ results: rows.slice() as T[] }),
        }),
        // Called by getPrevHash: prepare(sql).first<AuditEntry>()
        first: async <T>() => (rows.length > 0 ? rows[rows.length - 1] as T : null as T | null),
        all: async <T>() => ({ results: rows.slice() as T[] }),
      };
      return self;
    },
  } as unknown as D1Database;
}

/** Build a minimal Hono test app — injects account and mounts auditRoutes. */
function makeAuditApp(account: { id: string } | null) {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('account', account as never);
    return next();
  });
  app.route('/', auditRoutes);
  return app;
}

/** sha256hex helper for test assertions. */
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /v1/audit/log — input validation (HTTP)', () => {
  const { privateKeyB64 } = makeTestSigningKey();
  const mockEnv = { AUDIT: makeMockD1(), AUDIT_SIGNING_KEY: privateKeyB64 };
  const app = makeAuditApp({ id: 'acc_test' });

  test('missing auth → 401 unauthorized', async () => {
    const noAuthApp = makeAuditApp(null);
    const res = await noAuthApp.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'task', action: 'task.complete' }),
    }, mockEnv as never);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  test('bad category → 400 invalid_category', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'invalid_xyz', action: 'task.complete' }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; hint?: string };
    expect(body.error).toBe('invalid_category');
    expect(body.hint).toBeDefined();
  });

  test('missing action → 400 missing_action', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'task' }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('missing_action');
  });

  test('action with invalid format (uppercase) → 400 invalid_action', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'task', action: 'Task.Complete' }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_action');
  });

  test('oversize details (>4KB) → 413 details_too_large', async () => {
    const bigDetails = { data: 'x'.repeat(4097) };
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'task', action: 'task.complete', details: bigDetails }),
    }, mockEnv as never);
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('details_too_large');
  });

  test('happy path — 201 with id, timestamp, signature, prev_hash', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'task', action: 'task.complete', details: { src: 'test' } }),
    }, mockEnv as never);
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; timestamp: string; signature: string; prev_hash: string };
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.signature).toBe('string');
    expect(typeof body.prev_hash).toBe('string');
    expect(body.prev_hash.length).toBe(64);
  });
});

describe('POST /v1/audit/log — verification category', () => {
  const { privateKeyB64 } = makeTestSigningKey();
  const mockD1 = makeMockD1();
  const storedRows = (mockD1 as unknown as { rows: Record<string, unknown>[] }).rows;
  const mockEnv = { AUDIT: mockD1, AUDIT_SIGNING_KEY: privateKeyB64 };
  const app = makeAuditApp({ id: 'acc_test' });

  const OUTPUT_HASH = '0000000000000000000000000000000000000000000000000000000000000001';

  test('happy path — 201 with all four fields stored in details', async () => {
    storedRows.length = 0;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'verification',
        action: 'verification.run',
        tool: 'cargo-test',
        tier: 'automated_tooling',
        exit_code: 0,
        output_hash: OUTPUT_HASH,
      }),
    }, mockEnv as never);
    expect(res.status).toBe(201);
    expect(storedRows.length).toBe(1);
    const storedDetails = JSON.parse(storedRows[0].details as string);
    expect(storedDetails.tool).toBe('cargo-test');
    expect(storedDetails.tier).toBe('automated_tooling');
    expect(storedDetails.exit_code).toBe(0);
    expect(storedDetails.output_hash).toBe(OUTPUT_HASH);
  });

  test('happy path, no output_hash — 201, details has no output_hash key', async () => {
    storedRows.length = 0;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'verification',
        action: 'verification.run',
        tool: 'cargo-test',
        tier: 'automated_tooling',
        exit_code: 0,
      }),
    }, mockEnv as never);
    expect(res.status).toBe(201);
    expect(storedRows.length).toBe(1);
    const storedDetails = JSON.parse(storedRows[0].details as string);
    expect(storedDetails.tool).toBe('cargo-test');
    expect(storedDetails.tier).toBe('automated_tooling');
    expect(storedDetails.exit_code).toBe(0);
    expect('output_hash' in storedDetails).toBe(false);
  });

  test('invalid tier → 400 invalid_tier with hint including agent_self_annotation', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'verification',
        action: 'verification.run',
        tool: 'cargo-test',
        tier: 'manual_glance',
        exit_code: 0,
      }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; hint?: string };
    expect(body.error).toBe('invalid_tier');
    expect(body.hint).toContain('agent_self_annotation');
  });

  test('missing tool → 400 missing_tool', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'verification',
        action: 'verification.run',
        tier: 'automated_tooling',
        exit_code: 0,
      }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('missing_tool');
  });

  test('non-integer exit_code → 400 invalid_exit_code', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'verification',
        action: 'verification.run',
        tool: 'cargo-test',
        tier: 'automated_tooling',
        exit_code: 1.5,
      }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_exit_code');
  });

  test('non-verification category unaffected — task.complete → 201 without tool/tier', async () => {
    storedRows.length = 0;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'task', action: 'task.complete' }),
    }, mockEnv as never);
    expect(res.status).toBe(201);
  });
});

describe('POST /v1/audit/log — action_stream category', () => {
  const { privateKeyB64 } = makeTestSigningKey();
  const mockD1 = makeMockD1();
  const storedRows = (mockD1 as unknown as { rows: Record<string, unknown>[] }).rows;
  const mockEnv = { AUDIT: mockD1, AUDIT_SIGNING_KEY: privateKeyB64 };
  const app = makeAuditApp({ id: 'acc_test' });

  const HAPPY_BODY = {
    category: 'action_stream',
    action: 'action_stream.output',
    subcategory: 'output_volume',
    output_volume: 250,
    unit_type: 'lines',
    session_id: 'sess-abc12345',
  };

  // Test 1: happy path, with session_id
  test('happy path, with session_id — 201, details has all four fields', async () => {
    storedRows.length = 0;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(HAPPY_BODY),
    }, mockEnv as never);
    expect(res.status).toBe(201);
    expect(storedRows.length).toBe(1);
    const storedDetails = JSON.parse(storedRows[0].details as string);
    expect(storedDetails.subcategory).toBe('output_volume');
    expect(storedDetails.output_volume).toBe(250);
    expect(storedDetails.unit_type).toBe('lines');
    expect(storedDetails.session_id).toBe('sess-abc12345');
  });

  // Test 2: happy path, no session_id
  test('happy path, no session_id — 201, details has no session_id key', async () => {
    storedRows.length = 0;
    const { session_id: _omit, ...bodyWithoutSession } = HAPPY_BODY;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyWithoutSession),
    }, mockEnv as never);
    expect(res.status).toBe(201);
    expect(storedRows.length).toBe(1);
    const storedDetails = JSON.parse(storedRows[0].details as string);
    expect(storedDetails.subcategory).toBe('output_volume');
    expect(storedDetails.output_volume).toBe(250);
    expect(storedDetails.unit_type).toBe('lines');
    expect('session_id' in storedDetails).toBe(false);
  });

  // Test 3: happy path, output_volume = 0 boundary
  test('happy path, output_volume = 0 boundary — 201, stored details.output_volume === 0', async () => {
    storedRows.length = 0;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...HAPPY_BODY, output_volume: 0 }),
    }, mockEnv as never);
    expect(res.status).toBe(201);
    expect(storedRows.length).toBe(1);
    const storedDetails = JSON.parse(storedRows[0].details as string);
    expect(storedDetails.output_volume).toBe(0);
  });

  // Test 4: missing subcategory
  test('missing subcategory — 400 missing_subcategory', async () => {
    const { subcategory: _omit, ...bodyWithout } = HAPPY_BODY;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyWithout),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('missing_subcategory');
  });

  // Test 5: invalid subcategory
  test('invalid subcategory — 400 invalid_subcategory, hint includes output_volume', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...HAPPY_BODY, subcategory: 'something_else' }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; hint?: string };
    expect(body.error).toBe('invalid_subcategory');
    expect(body.hint).toContain('output_volume');
  });

  // Test 6: missing output_volume
  test('missing output_volume — 400 missing_output_volume', async () => {
    const { output_volume: _omit, ...bodyWithout } = HAPPY_BODY;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyWithout),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('missing_output_volume');
  });

  // Test 7: non-integer output_volume
  test('non-integer output_volume — 400 invalid_output_volume', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...HAPPY_BODY, output_volume: 1.5 }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_output_volume');
  });

  // Test 8: negative output_volume
  test('negative output_volume — 400 invalid_output_volume', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...HAPPY_BODY, output_volume: -1 }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_output_volume');
  });

  // Test 9: missing unit_type
  test('missing unit_type — 400 missing_unit_type', async () => {
    const { unit_type: _omit, ...bodyWithout } = HAPPY_BODY;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyWithout),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('missing_unit_type');
  });

  // Test 10: invalid unit_type
  test('invalid unit_type — 400 invalid_unit_type, hint includes lines', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...HAPPY_BODY, unit_type: 'foobar' }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; hint?: string };
    expect(body.error).toBe('invalid_unit_type');
    expect(body.hint).toContain('lines');
  });

  // Test 11: invalid session_id (too short)
  test('invalid session_id (5 chars, below 8-char minimum) — 400 invalid_session_id', async () => {
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...HAPPY_BODY, session_id: 'short' }),
    }, mockEnv as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_session_id');
  });

  // Test 12: non-action_stream category unaffected (regression guard)
  test('non-action_stream category unaffected — task.complete → 201 without subcategory/output_volume/unit_type', async () => {
    storedRows.length = 0;
    const res = await app.request('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'task', action: 'task.complete' }),
    }, mockEnv as never);
    expect(res.status).toBe(201);
  });

  // Test 13: ACTION_STREAM_UNIT_TYPES ↔ REVIEW_UNIT_TYPES drift guard
  describe('action_stream unit-type drift guard', () => {
    test('ACTION_STREAM_UNIT_TYPES deep-equals REVIEW_UNIT_TYPES (order-significant)', async () => {
      const { REVIEW_UNIT_TYPES } = await import('./lib/operator-profile.js');
      expect([...ACTION_STREAM_UNIT_TYPES]).toEqual([...REVIEW_UNIT_TYPES]);
    });
  });
});

describe('POST /v1/audit/log — signature + hash chain (function-level)', () => {
  test('signature is verifiable with derived public key', async () => {
    const { privateKeyB64, publicKeyBytes } = makeTestSigningKey();
    const mockD1 = makeMockD1();
    const mockEnv = { AUDIT: mockD1, AUDIT_SIGNING_KEY: privateKeyB64 } as never;

    const result = await writeExplicitAuditEvent(mockEnv, {
      accountId: 'acc_sig_test',
      actorId: 'acc_sig_test',
      category: 'task',
      action: 'task.complete',
      status: 200,
      result: 'success',
      details: { note: 'sig-verify-test' },
    });

    expect(result).not.toBeNull();
    if (!result) return;

    // The signature covers JSON.stringify(entryWithoutSignature).
    // To verify: reconstruct entry without signature from stored D1 row.
    const storedRows = (mockD1 as unknown as { rows: Record<string, unknown>[] }).rows;
    expect(storedRows.length).toBe(1);
    const stored = storedRows[0];

    // Rebuild the entry-without-signature (details is stored as JSON string; parse back)
    const entryWithoutSig = {
      id: stored.id,
      timestamp: stored.timestamp,
      account_id: stored.account_id,
      actor_type: stored.actor_type,
      actor_id: stored.actor_id,
      actor_ip_hash: stored.actor_ip_hash,
      category: stored.category,
      action: stored.action,
      method: stored.method,
      path: stored.path,
      resource_type: stored.resource_type,
      resource_id: stored.resource_id,
      status: stored.status,
      result: stored.result,
      error_code: stored.error_code,
      details: stored.details ? JSON.parse(stored.details as string) : null,
      prev_hash: stored.prev_hash,
    };

    const messageBytes = new TextEncoder().encode(JSON.stringify(entryWithoutSig));
    const sigBytes = Uint8Array.from(atob(result.signature), ch => ch.charCodeAt(0));
    const valid = ed25519.verify(sigBytes, messageBytes, publicKeyBytes);
    expect(valid).toBe(true);
  });

  test('hash-chain integrity across 3 sequential attestations', async () => {
    const { privateKeyB64 } = makeTestSigningKey();
    // Fresh D1 for this test to ensure clean row ordering
    const mockD1 = makeMockD1();
    const storedRows = (mockD1 as unknown as { rows: Record<string, unknown>[] }).rows;
    const mockEnv = { AUDIT: mockD1, AUDIT_SIGNING_KEY: privateKeyB64 } as never;

    for (let i = 0; i < 3; i++) {
      await writeExplicitAuditEvent(mockEnv, {
        accountId: 'acc_chain_test',
        actorId: 'acc_chain_test',
        category: 'observation',
        action: `observation.step`,
        status: 200,
        result: 'success',
        details: { step: i },
      });
    }

    expect(storedRows.length).toBe(3);

    // For rows 1 and 2, verify prev_hash = sha256(JSON.stringify(full_entry[i-1]))
    for (let i = 1; i < 3; i++) {
      const prev = storedRows[i - 1];
      // Reconstruct the entry as it was hashed (details as parsed object, not string)
      const prevEntry = {
        ...prev,
        details: prev.details ? JSON.parse(prev.details as string) : null,
      };
      const expectedPrevHash = await sha256hex(JSON.stringify(prevEntry));
      expect(storedRows[i].prev_hash).toBe(expectedPrevHash);
    }
  });
});
