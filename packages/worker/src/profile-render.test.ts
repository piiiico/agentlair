/**
 * Unit tests for profile-render.ts
 *
 * Tests fetchProfileExtras (D1+KV data fetching) and renderAgentProfileHTML (HTML generation).
 * Uses in-memory mocks — no network or CF runtime required.
 */

import { describe, test, expect } from 'bun:test';
import { renderAgentProfileHTML, fetchProfileExtras } from './profile-render.js';
import type { ProfileExtras } from './profile-render.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_AGENT = {
  id: 'acc_test123',
  did: 'did:web:agentlair.dev:agents:acc_test123',
  name: 'Test Agent',
  email: 'testagent@agentlair.dev',
  verified: true,
};

const NULL_EXTRAS: ProfileExtras = {
  bccCount: null,
  popaStreakDays: null,
  popaLastAttestedAt: null,
  auditCount30d: null,
  signingKeyThumbprint: null,
};

// ─── D1 mock factory ──────────────────────────────────────────────────────────

interface MockD1Options {
  bccCnt?: number;
  popaRows?: { window_date: string; attested_at: string }[];
  auditCnt?: number;
  throwOnAll?: boolean;
  capturedBindings?: string[][];
}

function makeMockD1(opts: MockD1Options = {}): D1Database {
  return {
    prepare(sql: string) {
      const q = sql.trim().toLowerCase();
      const capturedArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          capturedArgs.push(...args);
          if (opts.capturedBindings) {
            opts.capturedBindings.push(args.map(a => String(a)));
          }
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (opts.throwOnAll) throw new Error('D1 unavailable');
          if (q.includes('count(*) as cnt from bcc_credentials')) {
            return (opts.bccCnt !== undefined ? { cnt: opts.bccCnt } : null) as T | null;
          }
          if (q.includes('count(*) as cnt from audit_log')) {
            return (opts.auditCnt !== undefined ? { cnt: opts.auditCnt } : null) as T | null;
          }
          return null as T | null;
        },
        async all<T>(): Promise<D1Result<T>> {
          if (opts.throwOnAll) throw new Error('D1 unavailable');
          if (q.includes('from popa_self_attestations')) {
            return {
              results: (opts.popaRows ?? []) as unknown as T[],
              success: true,
              meta: {} as D1ResultInfo,
            };
          }
          return { results: [] as T[], success: true, meta: {} as D1ResultInfo };
        },
        async run(): Promise<D1Result<Record<string, unknown>>> {
          return { results: [], success: true, meta: {} as D1ResultInfo };
        },
      };
      return stmt;
    },
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

// ─── KV mock factory ──────────────────────────────────────────────────────────

function makeMockKV(data: Map<string, string>): KVNamespace {
  return {
    get: async (key: string) => data.get(key) ?? null,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, caret: undefined }),
    getWithMetadata: async <T>() => ({ value: null as T | null, metadata: null }),
  } as unknown as KVNamespace;
}

// Known Ed25519 public key (all-zero private key → fixed public key in base64url)
// Used to test signing key thumbprint computation.
const TEST_PUBLIC_KEY_B64URL = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo';

function makeKVWithSigningKey(accountId: string, keyid: string): KVNamespace {
  const data = new Map<string, string>();
  data.set('signing-key-by-account:' + accountId, JSON.stringify({ keyid }));
  data.set('signing-key:' + keyid, JSON.stringify({
    keyid,
    algorithm: 'ed25519',
    public_key: TEST_PUBLIC_KEY_B64URL,
    agent_id: accountId,
    status: 'active',
    registered_at: '2026-05-01T00:00:00Z',
  }));
  return makeMockKV(data);
}

// ─── fetchProfileExtras tests ─────────────────────────────────────────────────

describe('fetchProfileExtras', () => {
  test('1: returns all-null when AUDIT throws — function never propagates', async () => {
    const brokenDb = makeMockD1({ throwOnAll: true });
    const emptyKV = makeMockKV(new Map());

    const extras = await fetchProfileExtras(
      { AUDIT: brokenDb, KEYS: emptyKV },
      { id: TEST_AGENT.id, did: TEST_AGENT.did },
    );

    expect(extras.bccCount).toBeNull();
    expect(extras.popaStreakDays).toBeNull();
    expect(extras.popaLastAttestedAt).toBeNull();
    expect(extras.auditCount30d).toBeNull();
    expect(extras.signingKeyThumbprint).toBeNull();
  });

  test('2: populates all fields correctly with full data', async () => {
    const popaRows = [
      { window_date: '2026-05-08', attested_at: '2026-05-08T10:00:00Z' },
      { window_date: '2026-05-07', attested_at: '2026-05-07T10:00:00Z' },
      { window_date: '2026-05-06', attested_at: '2026-05-06T10:00:00Z' },
      { window_date: '2026-05-05', attested_at: '2026-05-05T10:00:00Z' },
      { window_date: '2026-05-04', attested_at: '2026-05-04T10:00:00Z' },
    ];

    const db = makeMockD1({ bccCnt: 3, popaRows, auditCnt: 12 });
    const kv = makeKVWithSigningKey(TEST_AGENT.id, 'key_abc123');

    const extras = await fetchProfileExtras(
      { AUDIT: db, KEYS: kv },
      { id: TEST_AGENT.id, did: TEST_AGENT.did },
    );

    expect(extras.bccCount).toBe(3);
    expect(extras.popaStreakDays).toBe(5);
    expect(extras.popaLastAttestedAt).toBe('2026-05-08');
    expect(extras.auditCount30d).toBe(12);
    expect(extras.signingKeyThumbprint).not.toBeNull();
    expect(typeof extras.signingKeyThumbprint).toBe('string');
    expect(extras.signingKeyThumbprint!.length).toBe(43);
  });

  test('3: handles missing PoPA gracefully — no rows returns 0 streak, null last_attested', async () => {
    const db = makeMockD1({ popaRows: [] });
    const kv = makeMockKV(new Map());

    const extras = await fetchProfileExtras(
      { AUDIT: db, KEYS: kv },
      { id: TEST_AGENT.id, did: TEST_AGENT.did },
    );

    expect(extras.popaStreakDays).toBe(0);
    expect(extras.popaLastAttestedAt).toBeNull();
  });

  test('4: handles missing signing key gracefully — KV miss returns null thumbprint', async () => {
    const db = makeMockD1({ bccCnt: 1 });
    const emptyKV = makeMockKV(new Map());

    const extras = await fetchProfileExtras(
      { AUDIT: db, KEYS: emptyKV },
      { id: TEST_AGENT.id, did: TEST_AGENT.did },
    );

    expect(extras.signingKeyThumbprint).toBeNull();
  });
});

// ─── renderAgentProfileHTML tests ─────────────────────────────────────────────

describe('renderAgentProfileHTML', () => {
  test('5: all-null extras renders em-dash placeholders for all 4 new fields', () => {
    const html = renderAgentProfileHTML(TEST_AGENT, NULL_EXTRAS);

    // All 4 labels must appear
    expect(html).toContain('BCCs Declared');
    expect(html).toContain('PoPA Streak');
    expect(html).toContain('Audit Attestations');
    expect(html).toContain('Web Bot Auth Signing Key');

    // Em-dashes for null fields
    const emDashCount = (html.match(/—/g) ?? []).length;
    expect(emDashCount).toBeGreaterThanOrEqual(3); // BCC null, PoPA null, Audit null

    // Not registered for signing key
    expect(html).toContain('Not registered');

    // No BCC link (count is null)
    expect(html).not.toContain('/v1/bcc/list');

    // Valid HTML structure
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  test('6: populated extras renders field labels and values', () => {
    const extras: ProfileExtras = {
      bccCount: 7,
      popaStreakDays: 14,
      popaLastAttestedAt: '2026-05-08',
      auditCount30d: 42,
      signingKeyThumbprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };

    const html = renderAgentProfileHTML(TEST_AGENT, extras);

    // All 4 labels present
    expect(html).toContain('BCCs Declared');
    expect(html).toContain('PoPA Streak');
    expect(html).toContain('Audit Attestations (30d)');
    expect(html).toContain('Web Bot Auth Signing Key');

    // Correct values
    expect(html).toContain('>7<');
    expect(html).toContain('14 days (last 2026-05-08)');
    expect(html).toContain('>42<');
    expect(html).toContain('Registered (AAAAAAAA…)');

    // Links present
    expect(html).toContain('/v1/bcc/list?subject_did=');
    expect(html).toContain('/v1/popa/agent/');
    expect(html).toContain('/api');
    expect(html).toContain('/agents/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });

  test('7: snapshot — existing markers still present alongside new fields', () => {
    const extras: ProfileExtras = {
      bccCount: 2,
      popaStreakDays: 3,
      popaLastAttestedAt: '2026-05-06',
      auditCount30d: 5,
      signingKeyThumbprint: null,
    };

    const html = renderAgentProfileHTML(
      { ...TEST_AGENT, trustScore: 80, trustLevel: 'High' },
      extras,
    );

    // Existing structure markers
    expect(html).toContain('profile-name');
    expect(html).toContain('Behavioral Trust Score');
    expect(html).toContain(TEST_AGENT.name);
    expect(html).toContain(TEST_AGENT.did);
    expect(html).toContain('agentlair.dev');

    // New markers
    expect(html).toContain('BCCs Declared');
    expect(html).toContain('PoPA Streak');
    expect(html).toContain('Audit Attestations');
    expect(html).toContain('Web Bot Auth Signing Key');

    // Trust score rendered
    expect(html).toContain('High (80/100)');
  });

  test('8: audit-count query uses 30-day cutoff — bound parameter is within 5s of now-30d', async () => {
    const capturedBindings: string[][] = [];
    const db = makeMockD1({ bccCnt: 0, auditCnt: 0, popaRows: [], capturedBindings });
    const kv = makeMockKV(new Map());

    const before = Date.now();
    await fetchProfileExtras(
      { AUDIT: db, KEYS: kv },
      { id: TEST_AGENT.id, did: TEST_AGENT.did },
    );
    const after = Date.now();

    // Find the audit query binding: it's the second argument of the audit COUNT query
    // capturedBindings contains all bind calls; the audit query binds [agent.id, cutoff]
    const auditCall = capturedBindings.find(args =>
      args.length === 2 && args[0] === TEST_AGENT.id && args[1]?.includes('T'),
    );
    expect(auditCall).toBeDefined();

    const cutoffMs = new Date(auditCall![1]!).getTime();
    const expectedLow = before - 30 * 86_400_000;
    const expectedHigh = after - 30 * 86_400_000;

    // Cutoff should be within the 30d window ± 5s
    expect(cutoffMs).toBeGreaterThanOrEqual(expectedLow - 5000);
    expect(cutoffMs).toBeLessThanOrEqual(expectedHigh + 5000);
  });
});
