/**
 * GET /v1/agents/:agentId/track_record — agent reputation snapshot (public, no auth).
 *
 * Hermetic Hono tests with in-memory KV + D1 mocks.
 *
 * Run: bun test src/routes/agent-track-record.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { agentTrackRecordRoutes } from './agent-track-record.js';
import type { HonoEnv } from '../types.js';
import type { D1Database } from '@cloudflare/workers-types';

// ─── KV mock ─────────────────────────────────────────────────────────────────

function makeKv(initial: Record<string, string> = {}): { get(k: string): Promise<string | null> } {
  const store = new Map<string, string>(Object.entries(initial));
  return { get: async (k: string) => store.get(k) ?? null };
}

// ─── D1 mock ─────────────────────────────────────────────────────────────────

interface MockD1Tables {
  findings_track_record: Record<string, unknown>[];
  findings: Record<string, unknown>[];
  finding_outcomes: Record<string, unknown>[];
}

function makeMockD1(initial?: Partial<MockD1Tables>): D1Database & { tables: MockD1Tables } {
  const tables: MockD1Tables = {
    findings_track_record: initial?.findings_track_record ?? [],
    findings: initial?.findings ?? [],
    finding_outcomes: initial?.finding_outcomes ?? [],
  };

  const prepare = (sql: string) => {
    let bindings: unknown[] = [];
    const lower = sql.trim().toLowerCase();

    const stmt = {
      bind(...params: unknown[]) {
        bindings = params;
        return stmt;
      },

      async first<T>(): Promise<T | null> {
        // SELECT * FROM findings_track_record WHERE agent_id = ?
        if (lower.includes('from findings_track_record')) {
          const agentId = bindings[0];
          const row = tables.findings_track_record.find((r) => r['agent_id'] === agentId);
          return (row ?? null) as T | null;
        }
        return null;
      },

      async all<T>(): Promise<{ results: T[]; success: boolean; meta: unknown }> {
        // SELECT DISTINCT ... FROM finding_outcomes o JOIN findings f ...
        if (lower.includes('from finding_outcomes') && lower.includes('join findings')) {
          const agentId = bindings[0];
          // Gather all (audience, max_ts) pairs for this agent
          const audMap = new Map<string, number>();
          for (const o of tables.finding_outcomes) {
            const f = tables.findings.find((fn) => fn['jti'] === o['jti']);
            if (!f || f['agent_id'] !== agentId) continue;
            const aud = f['audience'] as string;
            const ts = o['ts'] as number;
            const existing = audMap.get(aud);
            if (existing === undefined || ts > existing) {
              audMap.set(aud, ts);
            }
          }
          // Sort by last_ts DESC, cap at 5
          const sorted = [...audMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([audience, last_ts]) => ({ audience, last_ts }));
          return { results: sorted as unknown as T[], success: true, meta: {} };
        }
        return { results: [], success: true, meta: {} };
      },

      async run(): Promise<{ success: boolean; meta: unknown }> {
        return { success: true, meta: {} };
      },
    };
    return stmt;
  };

  return {
    prepare,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    tables,
  } as unknown as D1Database & { tables: MockD1Tables };
}

// ─── App builder ──────────────────────────────────────────────────────────────

function makeApp(opts: {
  kvEntries?: Record<string, string>;
  d1?: D1Database;
}): { app: Hono<HonoEnv>; env: Record<string, unknown> } {
  const app = new Hono<HonoEnv>();
  app.route('/v1', agentTrackRecordRoutes);

  const kv = makeKv(opts.kvEntries ?? {});
  const env: Record<string, unknown> = {
    KEYS: kv,
    AUDIT: opts.d1 ?? null,
  };

  return { app, env };
}

// Helper: run a fetch with env injected as second arg (Cloudflare Workers pattern)
function fetch$(
  app: Hono<HonoEnv>,
  env: Record<string, unknown>,
  req: Request,
): Promise<Response> {
  return app.fetch(req, env as unknown as Record<string, string>);
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const DEMO_AGENT_ID = 'acc_demoreadoutfixture';
const DEMO_NID = 'did:key:z6MkTestNidForTrackRecordABC12345';

function makeTrackRecord(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    agent_id: DEMO_AGENT_ID,
    findings_submitted: 5,
    findings_accepted: 3,
    findings_rejected: 1,
    valid_rate: 0.75,
    false_positive_rate: 0.25,
    avg_severity: 6.8,
    updated_ts: 1747500000,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /v1/agents/:agentId/track_record — happy path (acc_ form)', () => {
  test('1. 200 with correct aggregates and Cache-Control', async () => {
    const d1 = makeMockD1({ findings_track_record: [makeTrackRecord()] });
    const { app, env } = makeApp({ d1 });

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${DEMO_AGENT_ID}/track_record`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');

    const body = await res.json() as Record<string, unknown>;
    expect(body.agent_id).toBe(DEMO_AGENT_ID);
    expect(body.valid_rate).toBe(0.75);
    expect(body.false_positive_rate).toBe(0.25);
    expect(body.findings_submitted).toBe(5);
    expect(body.findings_accepted).toBe(3);
    expect(body.findings_rejected).toBe(1);
    expect(body.avg_severity).toBe(6.8);
    expect(body.last_updated).toBe(1747500000);
    expect(Array.isArray(body.recent_audiences)).toBe(true);
  });
});

describe('GET /v1/agents/:agentId/track_record — happy path (did:key form)', () => {
  test('2. NID resolves to correct account, al_nid present in response', async () => {
    const kvEntries: Record<string, string> = {
      [`nid:${DEMO_NID}`]: JSON.stringify({ account_id: DEMO_AGENT_ID, keyid: 'key1' }),
    };
    const d1 = makeMockD1({ findings_track_record: [makeTrackRecord()] });
    const { app, env } = makeApp({ kvEntries, d1 });

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${encodeURIComponent(DEMO_NID)}/track_record`));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.agent_id).toBe(DEMO_AGENT_ID);
    expect(body.al_nid).toBe(DEMO_NID);
  });
});

describe('GET /v1/agents/:agentId/track_record — 404 cases', () => {
  test('3. 404 track_record_not_found for unknown acc_ agent', async () => {
    const d1 = makeMockD1(); // no rows
    const { app, env } = makeApp({ d1 });

    const res = await fetch$(app, env, new Request('http://localhost/v1/agents/acc_unknownagent/track_record'));
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('track_record_not_found');
  });

  test('4. 404 nid_not_registered for valid but unregistered NID', async () => {
    const d1 = makeMockD1();
    const { app, env } = makeApp({ kvEntries: {}, d1 }); // no KV entries

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${encodeURIComponent(DEMO_NID)}/track_record`));
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('nid_not_registered');
  });
});

describe('GET /v1/agents/:agentId/track_record — 400 cases', () => {
  test('5. 400 for malformed agentId (special chars)', async () => {
    const d1 = makeMockD1();
    const { app, env } = makeApp({ d1 });

    const res = await fetch$(app, env, new Request('http://localhost/v1/agents/!!bad!!/track_record'));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_agent_id');
  });

  test('6. 400 for did:key with wrong multicodec (not z6Mk)', async () => {
    const d1 = makeMockD1();
    const { app, env } = makeApp({ d1 });

    // z9... is not Ed25519
    const res = await fetch$(app, env, new Request('http://localhost/v1/agents/did:key:z9OtherCurveABC123/track_record'));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_agent_id');
  });
});

describe('GET /v1/agents/:agentId/track_record — auth behavior', () => {
  test('7. No Authorization header → 200 (public endpoint)', async () => {
    const d1 = makeMockD1({ findings_track_record: [makeTrackRecord()] });
    const { app, env } = makeApp({ d1 });

    // No Authorization header
    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${DEMO_AGENT_ID}/track_record`));
    expect(res.status).toBe(200);
  });

  test('8. Wrong bearer token is ignored → 200 (handler ignores auth)', async () => {
    const d1 = makeMockD1({ findings_track_record: [makeTrackRecord()] });
    const { app, env } = makeApp({ d1 });

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${DEMO_AGENT_ID}/track_record`, {
      headers: { Authorization: 'Bearer al_live_wrongtoken' },
    }));
    expect(res.status).toBe(200);
  });
});

describe('GET /v1/agents/:agentId/track_record — Cache-Control', () => {
  test('9. Cache-Control: public, max-age=60 on 200 response', async () => {
    const d1 = makeMockD1({ findings_track_record: [makeTrackRecord()] });
    const { app, env } = makeApp({ d1 });

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${DEMO_AGENT_ID}/track_record`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });
});

describe('GET /v1/agents/:agentId/track_record — recent_audiences', () => {
  test('10. recent_audiences capped at 5 when agent has 7 distinct audiences', async () => {
    const agentId = 'acc_multiaudience';
    const findings = Array.from({ length: 7 }, (_, i) => ({
      jti: `finding_jti${String(i).padStart(21, '0')}`,
      agent_id: agentId,
      audience: `https://program${i}.example.com`,
    }));
    const outcomes = findings.map((f, i) => ({
      jti: f.jti,
      program_id: `prog_${i}`,
      outcome: 'accepted',
      ts: 1747500000 + i,
    }));

    const d1 = makeMockD1({
      findings_track_record: [makeTrackRecord({ agent_id: agentId })],
      findings,
      finding_outcomes: outcomes,
    });
    const { app, env } = makeApp({ d1 });

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${agentId}/track_record`));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.recent_audiences)).toBe(true);
    expect((body.recent_audiences as unknown[]).length).toBe(5);
  });

  test('11. recent_audiences deduplicate — 3 outcomes for same audience counts as 1', async () => {
    const agentId = 'acc_dedupetest';
    const findings = [
      { jti: 'finding_AAAAAAAAAAAAAAAAAAAAAA', agent_id: agentId, audience: 'https://hackerone.com' },
      { jti: 'finding_BBBBBBBBBBBBBBBBBBBBBB', agent_id: agentId, audience: 'https://hackerone.com' },
      { jti: 'finding_CCCCCCCCCCCCCCCCCCCCCC', agent_id: agentId, audience: 'https://hackerone.com' },
      { jti: 'finding_DDDDDDDDDDDDDDDDDDDDDD', agent_id: agentId, audience: 'https://immunefi.com' },
    ];
    const outcomes = findings.map((f, i) => ({
      jti: f.jti,
      program_id: `prog_${i}`,
      outcome: 'accepted',
      ts: 1747500000 + i,
    }));

    const d1 = makeMockD1({
      findings_track_record: [makeTrackRecord({ agent_id: agentId })],
      findings,
      finding_outcomes: outcomes,
    });
    const { app, env } = makeApp({ d1 });

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${agentId}/track_record`));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const audiences = body.recent_audiences as string[];
    expect(audiences.length).toBe(2);
    expect(audiences).toContain('https://hackerone.com');
    expect(audiences).toContain('https://immunefi.com');
  });
});

describe('GET /v1/agents/:agentId/track_record — body shape and zero-state', () => {
  test('12. Body has no PII — exact key set check', async () => {
    const d1 = makeMockD1({ findings_track_record: [makeTrackRecord()] });
    const { app, env } = makeApp({ d1 });

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${DEMO_AGENT_ID}/track_record`));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    const ALLOWED_KEYS = new Set([
      'agent_id', 'al_nid', 'valid_rate', 'false_positive_rate',
      'findings_submitted', 'findings_accepted', 'findings_rejected',
      'avg_severity', 'last_updated', 'recent_audiences',
    ]);
    const FORBIDDEN_KEYS = ['email', 'name', 'program_id', 'api_key_hash', 'keyid'];

    for (const key of Object.keys(body)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
    for (const key of FORBIDDEN_KEYS) {
      expect(key in body).toBe(false);
    }
  });

  test('13. avg_severity: null returned explicitly (not omitted) when no severity data', async () => {
    const d1 = makeMockD1({
      findings_track_record: [makeTrackRecord({
        findings_submitted: 3,
        findings_accepted: 0,
        findings_rejected: 0,
        valid_rate: 0.0,
        false_positive_rate: 0.0,
        avg_severity: null,
      })],
    });
    const { app, env } = makeApp({ d1 });

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${DEMO_AGENT_ID}/track_record`));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect('avg_severity' in body).toBe(true);
    expect(body.avg_severity).toBeNull();
    expect(body.valid_rate).toBe(0.0);
  });

  test('14. 503 audit_unavailable when AUDIT binding missing', async () => {
    // Pass no d1 — AUDIT binding absent
    const { app, env } = makeApp({ d1: undefined as unknown as D1Database });

    const res = await fetch$(app, env, new Request(`http://localhost/v1/agents/${DEMO_AGENT_ID}/track_record`));
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('audit_unavailable');
  });
});
