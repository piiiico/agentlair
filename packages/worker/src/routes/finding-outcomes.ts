// ─── Finding Outcomes Routes ─────────────────────────────────────────────────
// Program-attested outcome on a security finding.
// Endpoint: POST /v1/findings/:jti/outcome (program API key — NOT agent AAT)
//
// Auth model:
//   - Bearer token MUST start with `prog_`. AAT (`al_`) bearers are explicitly
//     rejected — programs and agents are different identity classes.
//   - The program key resolves to a row in `program_api_keys` (sha256 hash).
//   - `disabled_at` non-null → 401 (key revoked).
//
// IDOR guard:
//   - The program's bound `audience` (e.g. https://hackerone.com) MUST equal
//     the finding's `audience` column. A HackerOne program cannot attest on
//     an Immunefi-targeted finding. Mismatch → 403.
//
// Idempotency:
//   - PRIMARY KEY (jti, program_id) in `finding_outcomes` enforces one outcome
//     per (finding × program). SQLITE_CONSTRAINT on duplicate → 409.
//
// Aggregate recompute:
//   - On every successful write, recompute the agent's `findings_track_record`
//     row from finding_outcomes ⨝ findings. Single-statement SQL avoids
//     multi-statement transactions for D1 portability.
//
// JWT staleness note:
//   - A finding's signed envelope is a SNAPSHOT at submission time. The
//     track_record block embedded in the JWT does NOT update retroactively
//     when new outcomes arrive. Agents who want a fresh snapshot must submit
//     a new finding. The live aggregate is queryable via this endpoint's
//     200 response and (future) GET /v1/agents/:agentId/track_record.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoEnv, Env } from '../types.js';
import { json, err, sha256hex } from '../utils.js';

export const findingOutcomesRoutes = new Hono<HonoEnv>();

const JTI_PATTERN = /^finding_[A-Za-z0-9_-]{21}$/;
const VALID_OUTCOMES = ['accepted', 'rejected'] as const;
const VALID_REASONS = ['duplicate', 'invalid', 'out_of_scope', 'informative', 'other'] as const;

type Outcome = (typeof VALID_OUTCOMES)[number];
type Reason = (typeof VALID_REASONS)[number];

interface OutcomeSubmission {
  outcome: Outcome;
  reason?: Reason;
  severity_confirmed?: number;
  payout_usd?: number;
}

interface ProgramRow {
  program_id: string;
  audience: string;
  disabled_at: string | null;
}

interface FindingRow {
  jti: string;
  agent_id: string;
  audience: string;
}

interface AggregateRow {
  submitted: number;
  accepted: number;
  rejected: number;
  avg_sev: number | null;
}

// Resolve a program API key into { program_id, audience }, or null if the
// bearer is missing, wrong prefix, unknown hash, or revoked.
async function resolveProgram(
  c: Context<HonoEnv>,
): Promise<{ program_id: string; audience: string } | null> {
  const auth = c.req.header('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const key = auth.slice(7).trim();
  if (!key.startsWith('prog_')) return null;
  if (!c.env.AUDIT) return null;

  const hash = await sha256hex(key);
  const row = await c.env.AUDIT
    .prepare('SELECT program_id, audience, disabled_at FROM program_api_keys WHERE api_key_hash = ? LIMIT 1')
    .bind(hash)
    .first<ProgramRow>();

  if (!row) return null;
  if (row.disabled_at) return null;
  return { program_id: row.program_id, audience: row.audience };
}

// Round to 4 decimal places.
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ─── POST /findings/:jti/outcome ─────────────────────────────────────────────
findingOutcomesRoutes.post('/findings/:jti/outcome', async (c) => {
  // TODO[scale]: switch to materialized counters when an agent reaches ~50k outcomes
  // (sum of finding_outcomes across all of agent's findings). Until then, recompute
  // keeps the model simple and avoids counter-skew bugs.

  // ── Env guards ────────────────────────────────────────────────────────────
  if (!c.env.AUDIT) {
    return err('Findings store not enabled for this instance.', 503, 'audit_unavailable');
  }

  // ── jti format ────────────────────────────────────────────────────────────
  const jti = c.req.param('jti');
  if (!JTI_PATTERN.test(jti)) {
    return err('Finding id must match format finding_[A-Za-z0-9_-]{21}', 400, 'invalid_jti');
  }

  // ── Program auth ──────────────────────────────────────────────────────────
  const program = await resolveProgram(c);
  if (!program) {
    return err('Program API key required. Pass Bearer prog_...', 401, 'unauthorized');
  }

  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: OutcomeSubmission;
  try {
    body = (await c.req.json()) as OutcomeSubmission;
  } catch {
    return err('Invalid JSON body.', 400, 'invalid_body');
  }
  if (!body || typeof body !== 'object') {
    return err('Body must be a JSON object.', 400, 'invalid_body');
  }

  const { outcome, reason, severity_confirmed, payout_usd } = body;

  // outcome — required, must be 'accepted' | 'rejected'
  if (!outcome) {
    return err('Missing required field: outcome.', 400, 'missing_required_field');
  }
  if (typeof outcome !== 'string' || !(VALID_OUTCOMES as readonly string[]).includes(outcome)) {
    return err(
      'Invalid outcome.',
      400,
      'invalid_outcome',
      `Allowed values: ${VALID_OUTCOMES.join(', ')}`,
    );
  }

  // reason — optional, must be one of VALID_REASONS
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== 'string' || !(VALID_REASONS as readonly string[]).includes(reason)) {
      return err(
        'Invalid reason.',
        400,
        'invalid_reason',
        `Allowed values: ${VALID_REASONS.join(', ')}`,
      );
    }
  }

  // severity_confirmed — optional, finite number in [0, 10]
  if (severity_confirmed !== undefined && severity_confirmed !== null) {
    if (
      typeof severity_confirmed !== 'number' ||
      !Number.isFinite(severity_confirmed) ||
      severity_confirmed < 0 ||
      severity_confirmed > 10
    ) {
      return err('severity_confirmed must be a number in 0..10.', 400, 'invalid_severity_confirmed');
    }
  }

  // payout_usd — optional, finite non-negative number
  if (payout_usd !== undefined && payout_usd !== null) {
    if (typeof payout_usd !== 'number' || !Number.isFinite(payout_usd) || payout_usd < 0) {
      return err('payout_usd must be a non-negative number.', 400, 'invalid_payout');
    }
  }

  // ── Resolve finding (404 + IDOR check) ────────────────────────────────────
  let finding: FindingRow | null;
  try {
    finding = await c.env.AUDIT
      .prepare('SELECT jti, agent_id, audience FROM findings WHERE jti = ? LIMIT 1')
      .bind(jti)
      .first<FindingRow>();
  } catch (e) {
    console.error('Finding lookup failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to look up finding.', 500, 'finding_lookup_error');
  }
  if (!finding) {
    return err('Finding not found.', 404, 'finding_not_found');
  }

  // IDOR guard — program audience must match finding audience.
  if (program.audience !== finding.audience) {
    return err('Program audience does not match finding audience.', 403, 'audience_mismatch');
  }

  // ── INSERT outcome (409 on duplicate via PRIMARY KEY) ─────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    await c.env.AUDIT.prepare(
      `INSERT INTO finding_outcomes (jti, program_id, outcome, reason, severity_confirmed, payout_usd, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      jti,
      program.program_id,
      outcome,
      reason ?? null,
      severity_confirmed ?? null,
      payout_usd ?? null,
      nowSec,
    ).run();
  } catch (e) {
    // D1/SQLITE_CONSTRAINT on duplicate (jti, program_id).
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes('UNIQUE') ||
      msg.includes('constraint') ||
      msg.includes('CONSTRAINT') ||
      msg.includes('PRIMARY KEY')
    ) {
      return err('Outcome already submitted for this (finding, program).', 409, 'outcome_already_submitted');
    }
    console.error('Outcome insert failed:', msg);
    return err('Failed to persist outcome.', 500, 'outcome_insert_error');
  }

  // ── Recompute aggregates (single SQL — D1 portable) ───────────────────────
  let agg: AggregateRow | null;
  try {
    agg = await c.env.AUDIT.prepare(
      `SELECT
        (SELECT COUNT(*) FROM findings WHERE agent_id = ?1) AS submitted,
        (SELECT COUNT(*) FROM finding_outcomes o JOIN findings f ON f.jti = o.jti
           WHERE f.agent_id = ?1 AND o.outcome = 'accepted') AS accepted,
        (SELECT COUNT(*) FROM finding_outcomes o JOIN findings f ON f.jti = o.jti
           WHERE f.agent_id = ?1 AND o.outcome = 'rejected') AS rejected,
        (SELECT AVG(o.severity_confirmed) FROM finding_outcomes o JOIN findings f ON f.jti = o.jti
           WHERE f.agent_id = ?1 AND o.outcome = 'accepted' AND o.severity_confirmed IS NOT NULL) AS avg_sev`,
    ).bind(finding.agent_id).first<AggregateRow>();
  } catch (e) {
    console.error('Aggregate recompute failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to recompute track record.', 500, 'aggregate_error');
  }

  const submitted = agg?.submitted ?? 0;
  const accepted = agg?.accepted ?? 0;
  const rejected = agg?.rejected ?? 0;
  const avgSev: number | null =
    agg?.avg_sev !== undefined && agg?.avg_sev !== null ? round4(agg.avg_sev) : null;
  const decided = accepted + rejected;
  const validRate = round4(accepted / Math.max(decided, 1));
  const fpRate = round4(rejected / Math.max(decided, 1));

  // ── UPSERT track_record (one row per agent_id) ────────────────────────────
  try {
    await c.env.AUDIT.prepare(
      `INSERT INTO findings_track_record (
         agent_id, findings_submitted, findings_accepted, findings_rejected,
         valid_rate, false_positive_rate, avg_severity, updated_ts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         findings_submitted = excluded.findings_submitted,
         findings_accepted = excluded.findings_accepted,
         findings_rejected = excluded.findings_rejected,
         valid_rate = excluded.valid_rate,
         false_positive_rate = excluded.false_positive_rate,
         avg_severity = excluded.avg_severity,
         updated_ts = excluded.updated_ts`,
    ).bind(
      finding.agent_id,
      submitted,
      accepted,
      rejected,
      validRate,
      fpRate,
      avgSev,
      nowSec,
    ).run();
  } catch (e) {
    console.error('Track-record upsert failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to persist track record.', 500, 'track_record_upsert_error');
  }

  // ── Response (track_record snapshot only — no PII, no program_id leak) ───
  return json({
    jti,
    outcome,
    agent_id: finding.agent_id,
    track_record: {
      findings_submitted: submitted,
      findings_accepted: accepted,
      findings_rejected: rejected,
      valid_rate: validRate,
      false_positive_rate: fpRate,
      avg_severity: avgSev,
      updated_ts: nowSec,
    },
  });
});

// Re-export the type for convenience (the D1Database type isn't needed at the
// route boundary — env.AUDIT is typed via HonoEnv → Env).
export type { Env };
