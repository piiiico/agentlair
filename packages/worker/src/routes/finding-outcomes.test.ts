/**
 * POST /v1/findings/:jti/outcome — program-attested outcome on a finding.
 *
 * Hermetic Hono tests with an in-memory D1 mock that backs:
 *   - program_api_keys (auth lookup)
 *   - findings        (IDOR audience check)
 *   - finding_outcomes (idempotency: PRIMARY KEY (jti, program_id))
 *   - findings_track_record (UPSERT target — assert via the response body)
 *
 * Run: bun test src/routes/finding-outcomes.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { findingOutcomesRoutes } from './finding-outcomes.js';
import { sha256hex } from '../utils.js';
import type { HonoEnv } from '../types.js';
import type { D1Database } from '@cloudflare/workers-types';

// ─── In-memory D1 mock ───────────────────────────────────────────────────────

interface MockTables {
  program_api_keys: Record<string, unknown>[];
  findings: Record<string, unknown>[];
  finding_outcomes: Record<string, unknown>[];
  findings_track_record: Record<string, unknown>[];
}

function makeMockD1(): D1Database & { tables: MockTables } {
  const tables: MockTables = {
    program_api_keys: [],
    findings: [],
    finding_outcomes: [],
    findings_track_record: [],
  };

  const prepare = (sql: string) => {
    let bindings: unknown[] = [];
    const q = sql.trim();
    const lower = q.toLowerCase();

    const stmt = {
      bind(...params: unknown[]) {
        bindings = params;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        // SELECT program_id, audience, disabled_at FROM program_api_keys WHERE api_key_hash = ?
        if (lower.includes('from program_api_keys')) {
          const hash = bindings[0];
          const row = tables.program_api_keys.find(r => r['api_key_hash'] === hash);
          return (row ?? null) as T | null;
        }

        // SELECT jti, agent_id, audience FROM findings WHERE jti = ?
        if (lower.includes('from findings where jti')) {
          const jti = bindings[0];
          const row = tables.findings.find(r => r['jti'] === jti);
          return (row ?? null) as T | null;
        }

        // Aggregate recompute — multi-subquery using ?1 (single binding reused).
        if (lower.includes('count(*) from findings where agent_id')) {
          const agentId = bindings[0];
          const submitted = tables.findings.filter(r => r['agent_id'] === agentId).length;
          const acceptedOutcomes = tables.finding_outcomes.filter(o => {
            const f = tables.findings.find(f2 => f2['jti'] === o['jti']);
            return f && f['agent_id'] === agentId && o['outcome'] === 'accepted';
          });
          const accepted = acceptedOutcomes.length;
          const rejected = tables.finding_outcomes.filter(o => {
            const f = tables.findings.find(f2 => f2['jti'] === o['jti']);
            return f && f['agent_id'] === agentId && o['outcome'] === 'rejected';
          }).length;
          const sevs = acceptedOutcomes
            .map(o => o['severity_confirmed'])
            .filter((v): v is number => typeof v === 'number');
          const avg_sev = sevs.length === 0 ? null : sevs.reduce((a, b) => a + b, 0) / sevs.length;
          return { submitted, accepted, rejected, avg_sev } as unknown as T;
        }

        return null;
      },
      async run(): Promise<D1Result<Record<string, unknown>>> {
        // INSERT INTO finding_outcomes (jti, program_id, outcome, reason, severity_confirmed, payout_usd, ts)
        if (lower.startsWith('insert into finding_outcomes')) {
          const [jti, program_id, outcome, reason, severity_confirmed, payout_usd, ts] = bindings;
          // Idempotency: PRIMARY KEY (jti, program_id)
          const dup = tables.finding_outcomes.find(
            r => r['jti'] === jti && r['program_id'] === program_id,
          );
          if (dup) {
            throw new Error('UNIQUE constraint failed: finding_outcomes.jti, finding_outcomes.program_id');
          }
          tables.finding_outcomes.push({
            jti, program_id, outcome,
            reason: reason ?? null,
            severity_confirmed: severity_confirmed ?? null,
            payout_usd: payout_usd ?? null,
            ts,
          });
          return { success: true, meta: {} } as unknown as D1Result<Record<string, unknown>>;
        }

        // INSERT INTO findings_track_record (...) VALUES (...) ON CONFLICT(agent_id) DO UPDATE ...
        if (lower.startsWith('insert into findings_track_record')) {
          const [
            agent_id, submitted, accepted, rejected,
            valid_rate, false_positive_rate, avg_severity, updated_ts,
          ] = bindings;
          const existing = tables.findings_track_record.find(r => r['agent_id'] === agent_id);
          if (existing) {
            existing['findings_submitted'] = submitted;
            existing['findings_accepted'] = accepted;
            existing['findings_rejected'] = rejected;
            existing['valid_rate'] = valid_rate;
            existing['false_positive_rate'] = false_positive_rate;
            existing['avg_severity'] = avg_severity;
            existing['updated_ts'] = updated_ts;
          } else {
            tables.findings_track_record.push({
              agent_id,
              findings_submitted: submitted,
              findings_accepted: accepted,
              findings_rejected: rejected,
              valid_rate,
              false_positive_rate,
              avg_severity,
              updated_ts,
            });
          }
          return { success: true, meta: {} } as unknown as D1Result<Record<string, unknown>>;
        }

        return { success: true, meta: {} } as unknown as D1Result<Record<string, unknown>>;
      },
      async all<T>(): Promise<D1Result<T>> {
        return { results: [] as T[], success: true, meta: {} } as unknown as D1Result<T>;
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
  } as unknown as D1Database & { tables: MockTables };
}

// ─── Test app builder ────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/v1', findingOutcomesRoutes);
  return app;
}

// Seed helpers — populate the mock tables directly.
async function seedProgram(
  db: D1Database & { tables: MockTables },
  opts: { program_id: string; key: string; audience: string; disabled?: boolean },
): Promise<void> {
  db.tables.program_api_keys.push({
    program_id: opts.program_id,
    api_key_hash: await sha256hex(opts.key),
    audience: opts.audience,
    display_name: opts.program_id,
    created_at: new Date().toISOString(),
    disabled_at: opts.disabled ? new Date().toISOString() : null,
  });
}

function seedFinding(
  db: D1Database & { tables: MockTables },
  opts: { jti: string; agent_id: string; audience: string },
): void {
  db.tables.findings.push({
    jti: opts.jti,
    agent_id: opts.agent_id,
    audience: opts.audience,
  });
}

const VALID_JTI = 'finding_AAAAAAAAAAAAAAAAAAAAA';
const VALID_JTI_2 = 'finding_BBBBBBBBBBBBBBBBBBBBB';
const VALID_JTI_3 = 'finding_CCCCCCCCCCCCCCCCCCCCC';

const PROG_KEY_H1 = 'prog_hackerone_testkey_aaa';
const PROG_KEY_IM = 'prog_immunefi_testkey_bbb';
const PROG_KEY_DISABLED = 'prog_disabled_testkey_ccc';

const AUDIENCE_H1 = 'https://hackerone.com';
const AUDIENCE_IM = 'https://immunefi.com';

// ─── 1. Happy path: outcome=accepted ─────────────────────────────────────────

describe('POST /v1/findings/:jti/outcome — happy path', () => {
  test('1: 200 with track_record { accepted: 1 } on first accepted outcome', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_alice', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);

    expect(res.status).toBe(200);
    const body = await res.json() as {
      jti: string; outcome: string; agent_id: string;
      track_record: {
        findings_submitted: number; findings_accepted: number; findings_rejected: number;
        valid_rate: number; false_positive_rate: number; avg_severity: number | null;
      };
    };
    expect(body.jti).toBe(VALID_JTI);
    expect(body.outcome).toBe('accepted');
    expect(body.agent_id).toBe('acc_alice');
    expect(body.track_record.findings_submitted).toBe(1);
    expect(body.track_record.findings_accepted).toBe(1);
    expect(body.track_record.findings_rejected).toBe(0);
    expect(body.track_record.valid_rate).toBe(1.0);
    expect(body.track_record.false_positive_rate).toBe(0.0);
    expect(body.track_record.avg_severity).toBeNull();
  });

  test('2: 200 with outcome=rejected + reason=duplicate → false_positive_rate 1.0', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_bob', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'rejected', reason: 'duplicate' }),
    }, env as never);

    expect(res.status).toBe(200);
    const body = await res.json() as {
      track_record: { findings_rejected: number; false_positive_rate: number; valid_rate: number };
    };
    expect(body.track_record.findings_rejected).toBe(1);
    expect(body.track_record.false_positive_rate).toBe(1.0);
    expect(body.track_record.valid_rate).toBe(0.0);
  });

  test('3: 200 with severity_confirmed=8.5 → avg_severity=8.5', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_carol', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted', severity_confirmed: 8.5, payout_usd: 1500 }),
    }, env as never);

    expect(res.status).toBe(200);
    const body = await res.json() as { track_record: { avg_severity: number | null } };
    expect(body.track_record.avg_severity).toBe(8.5);
  });
});

// ─── 2. Auth (401 / 403) ─────────────────────────────────────────────────────

describe('POST /v1/findings/:jti/outcome — auth', () => {
  test('4: 401 when Authorization header is missing', async () => {
    const db = makeMockD1();
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  test('5: 401 when bearer is an al_ AAT key (not prog_)', async () => {
    const db = makeMockD1();
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer al_live_abcdef1234567890' },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);

    expect(res.status).toBe(401);
  });

  test('6: 401 when program key hash is not in program_api_keys', async () => {
    const db = makeMockD1();
    // Note: no seedProgram — the key hash is unknown.
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);

    expect(res.status).toBe(401);
  });

  test('7: 401 when program key row has disabled_at set', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_dead', key: PROG_KEY_DISABLED, audience: AUDIENCE_H1, disabled: true });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_DISABLED}` },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);

    expect(res.status).toBe(401);
  });

  test('8: 403 when program audience does not match finding audience (IDOR)', async () => {
    const db = makeMockD1();
    // Immunefi program key, HackerOne-targeted finding.
    await seedProgram(db, { program_id: 'prog_im', key: PROG_KEY_IM, audience: AUDIENCE_IM });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_IM}` },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('audience_mismatch');
  });
});

// ─── 3. Not found / invalid body ─────────────────────────────────────────────

describe('POST /v1/findings/:jti/outcome — not found + validation', () => {
  test('9: 404 when jti is valid format but the finding row does not exist', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    // No findings seeded.
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('finding_not_found');
  });

  test('10: 400 when outcome value is "maybe" (not accepted/rejected)', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'maybe' }),
    }, env as never);

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_outcome');
  });

  test('11: 400 when severity_confirmed is 11.0 (out of CVSS range)', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted', severity_confirmed: 11.0 }),
    }, env as never);

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_severity_confirmed');
  });

  test('12: 409 when (jti, program_id) outcome already exists — idempotency boundary', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const first = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);
    expect(first.status).toBe(200);

    const retry = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);
    expect(retry.status).toBe(409);
    const body = await retry.json() as { error: string };
    expect(body.error).toBe('outcome_already_submitted');
  });
});

// ─── 4. Extra coverage: aggregates + invalid jti ─────────────────────────────

describe('POST /v1/findings/:jti/outcome — aggregates + edges', () => {
  test('13: invalid jti format → 400 invalid_jti (even with valid auth)', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request('/v1/findings/notavalidjti/outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted' }),
    }, env as never);

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_jti');
  });

  test('14: aggregate correctness — 3 findings, 2 accepted + 1 rejected → valid_rate 0.6667, fp_rate 0.3333', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    // Three findings for the same agent — same audience so the H1 program can attest on all.
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_agg', audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI_2, agent_id: 'acc_agg', audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI_3, agent_id: 'acc_agg', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    // Two accepts (with severity), one reject.
    const r1 = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted', severity_confirmed: 6.0 }),
    }, env as never);
    expect(r1.status).toBe(200);

    const r2 = await app.request(`/v1/findings/${VALID_JTI_2}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted', severity_confirmed: 8.0 }),
    }, env as never);
    expect(r2.status).toBe(200);

    const r3 = await app.request(`/v1/findings/${VALID_JTI_3}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'rejected', reason: 'invalid' }),
    }, env as never);
    expect(r3.status).toBe(200);
    const body = await r3.json() as {
      track_record: {
        findings_submitted: number; findings_accepted: number; findings_rejected: number;
        valid_rate: number; false_positive_rate: number; avg_severity: number | null;
      };
    };
    expect(body.track_record.findings_submitted).toBe(3);
    expect(body.track_record.findings_accepted).toBe(2);
    expect(body.track_record.findings_rejected).toBe(1);
    expect(body.track_record.valid_rate).toBe(0.6667);
    expect(body.track_record.false_positive_rate).toBe(0.3333);
    expect(body.track_record.avg_severity).toBe(7.0);
  });

  test('15: 400 when body is not JSON', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: 'not-json',
    }, env as never);

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  test('16: 400 when payout_usd is negative', async () => {
    const db = makeMockD1();
    await seedProgram(db, { program_id: 'prog_h1', key: PROG_KEY_H1, audience: AUDIENCE_H1 });
    seedFinding(db, { jti: VALID_JTI, agent_id: 'acc_x', audience: AUDIENCE_H1 });
    const app = makeApp();
    const env = { AUDIT: db };

    const res = await app.request(`/v1/findings/${VALID_JTI}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROG_KEY_H1}` },
      body: JSON.stringify({ outcome: 'accepted', payout_usd: -100 }),
    }, env as never);

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_payout');
  });
});
