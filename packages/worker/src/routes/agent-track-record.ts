/**
 * GET /v1/agents/:agentId/track_record — Public agent reputation snapshot
 *
 * Returns the aggregate track record for a security-finding agent.
 * Anonymous read — no auth required. Mounted BEFORE the /v1/* auth middleware.
 *
 * :agentId accepts two formats:
 *   - did:key:z6Mk...  — Radicle NID (resolved via nid:<did> KV index)
 *   - acc_<base58>     — internal account id (used directly)
 *
 * Response: JSON aggregate snapshot + Cache-Control: public, max-age=60
 */

import { Hono } from 'hono';
import { err } from '../utils.js';
import type { HonoEnv } from '../types.js';

export const agentTrackRecordRoutes = new Hono<HonoEnv>();

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_NID_LENGTH = 128;
const ACC_ID_PATTERN = /^acc_[A-Za-z0-9_]{1,60}$/;

// ─── NID resolution ───────────────────────────────────────────────────────────

interface ResolveOk {
  account_id: string;
  al_nid?: string;
}

/**
 * Resolve :agentId to an account_id.
 * Returns null when the agentId is syntactically invalid (caller → 400).
 * Returns 'nid_not_registered' when NID is well-formed but unregistered.
 * Returns { account_id, al_nid? } on success.
 */
async function resolveAgentId(
  env: { KEYS: { get(key: string): Promise<string | null> } },
  agentId: string,
): Promise<ResolveOk | 'nid_not_registered' | null> {
  if (agentId.startsWith('did:key:')) {
    // Ed25519 NIDs start with z6Mk (multicodec 0xed01, base58btc-encoded)
    if (!agentId.startsWith('did:key:z6Mk') || agentId.length > MAX_NID_LENGTH) {
      return null; // caller → 400 invalid_agent_id
    }

    // Inverse index: nid:<did> → { account_id, keyid }
    const indexRaw = await env.KEYS.get('nid:' + agentId);
    if (!indexRaw) {
      return 'nid_not_registered';
    }
    const { account_id } = JSON.parse(indexRaw) as { account_id: string };
    return { account_id, al_nid: agentId };
  }

  // acc_ form — validate shape, use directly
  if (!ACC_ID_PATTERN.test(agentId)) {
    return null; // caller → 400 invalid_agent_id
  }

  // No KV scan for al_nid in this branch (O(KV-scan) — omitted at MVP)
  return { account_id: agentId };
}

// ─── DB row types ─────────────────────────────────────────────────────────────

interface TrackRecordRow {
  agent_id: string;
  findings_submitted: number;
  findings_accepted: number;
  findings_rejected: number;
  valid_rate: number;
  false_positive_rate: number;
  avg_severity: number | null;
  updated_ts: number;
}

interface AudienceRow {
  audience: string;
  last_ts: number;
}

// ─── GET /agents/:agentId/track_record ────────────────────────────────────────

agentTrackRecordRoutes.get('/agents/:agentId/track_record', async (c) => {
  // ── Env guard ────────────────────────────────────────────────────────────────
  if (!c.env.AUDIT) {
    return err('Audit store not enabled for this instance.', 503, 'audit_unavailable');
  }

  const agentId = c.req.param('agentId');

  // ── Resolve agentId → account_id ─────────────────────────────────────────────
  const resolved = await resolveAgentId(c.env, agentId);

  if (resolved === null) {
    return err(
      'Invalid agentId. Must be did:key:z6Mk... (Ed25519 NID) or acc_<alphanumeric>.',
      400,
      'invalid_agent_id',
      'Accepted: "did:key:z6Mk..." (max 128 chars) or "acc_[A-Za-z0-9_]{1,60}".',
    );
  }

  if (resolved === 'nid_not_registered') {
    return err(
      'NID is well-formed but not registered to any AgentLair account.',
      404,
      'nid_not_registered',
      'The agent may not have registered this NID, or the key may have been revoked.',
    );
  }

  const { account_id, al_nid } = resolved;

  // ── Fetch track_record row ───────────────────────────────────────────────────
  let row: TrackRecordRow | null;
  try {
    row = await c.env.AUDIT
      .prepare('SELECT * FROM findings_track_record WHERE agent_id = ? LIMIT 1')
      .bind(account_id)
      .first<TrackRecordRow>();
  } catch (e) {
    console.error('Track record lookup failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to look up track record.', 500, 'lookup_error');
  }

  if (!row) {
    return err(
      'No track record found for this agent.',
      404,
      'track_record_not_found',
      'The agent has not yet had any findings attested by a program.',
    );
  }

  // ── Fetch recent audiences (distinct, most-recent first, capped at 5) ────────
  let recentAudiences: string[] = [];
  try {
    const audResult = await c.env.AUDIT
      .prepare(
        `SELECT DISTINCT f.audience AS audience, MAX(o.ts) AS last_ts
           FROM finding_outcomes o
           JOIN findings f ON f.jti = o.jti
          WHERE f.agent_id = ?
          GROUP BY f.audience
          ORDER BY last_ts DESC
          LIMIT 5`,
      )
      .bind(account_id)
      .all<AudienceRow>();
    recentAudiences = (audResult.results ?? []).map((r) => r.audience);
  } catch (e) {
    // Non-fatal — return empty array rather than failing the request
    console.error('Recent audiences query failed:', e instanceof Error ? e.message : String(e));
  }

  // ── Build response ──────────────────────────────────────────────────────────
  const body: Record<string, unknown> = {
    agent_id: account_id,
    ...(al_nid !== undefined && { al_nid }),
    valid_rate: row.valid_rate,
    false_positive_rate: row.false_positive_rate,
    findings_submitted: row.findings_submitted,
    findings_accepted: row.findings_accepted,
    findings_rejected: row.findings_rejected,
    avg_severity: row.avg_severity, // null returned explicitly — lets callers distinguish "no data" from key missing
    last_updated: row.updated_ts,
    recent_audiences: recentAudiences,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
});
