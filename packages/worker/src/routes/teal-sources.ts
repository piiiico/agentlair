/**
 * TEAL Sources Handler — GET /v1/trust/:agentId/teal-sources
 *
 * Free public read. Lists which operators have submitted TEAL behavioral records
 * about a given subject agent in the past 90 days. No auth, no x402.
 *
 * Spec: agentlair-teal-subject-agent-id-20260515, D4
 */

import type { Context } from 'hono';
import { json, err } from '../utils.js';
import type { HonoEnv } from '../types.js';

// Reuses the same AGENT_ID_RE pattern as routes/trust.ts (acc_ prefix, 1–64 chars)
const AGENT_ID_RE = /^acc_[A-Za-z0-9_-]{1,64}$/;

interface TealSourceRow {
  operator_id: string;
  record_count: number;
  first_seen: string;
  last_seen: string;
  session_count: number;
}

/**
 * GET /v1/trust/:agentId/teal-sources
 *
 * Returns which operators have submitted TEAL records about the given subject agent.
 * Window: 90 days. Sort: record_count DESC, operator_id ASC.
 *
 * Free invariant: MUST NOT call verifyX402Payment / make402Response / authenticateAny.
 * This endpoint is unconditionally public — the convergence blog cross-links to it.
 */
export async function tealSourcesHandler(c: Context<HonoEnv>): Promise<Response> {
  const agentId = c.req.param('agentId');
  if (!agentId || !AGENT_ID_RE.test(agentId)) {
    return err('Invalid agent ID format. Expected: acc_<alphanumeric>.', 400, 'invalid_agent_id');
  }

  // Graceful degradation when AUDIT binding is absent
  if (!c.env.AUDIT) {
    return json({
      agent_id: agentId,
      sources: [] as TealSourceRow[],
      total_records: 0,
      total_operators: 0,
      window_days: 90,
      note: 'audit_unavailable',
    });
  }

  try {
    const rows = await c.env.AUDIT.prepare(`
      SELECT operator_id,
             COUNT(*) AS record_count,
             MIN(received_at) AS first_seen,
             MAX(received_at) AS last_seen,
             COUNT(DISTINCT session_id) AS session_count
      FROM teal_records
      WHERE (subject_agent_id = ?1 OR (subject_agent_id IS NULL AND operator_id = ?1))
        AND received_at >= datetime('now', '-90 days')
      GROUP BY operator_id
      ORDER BY record_count DESC, operator_id ASC
    `).bind(agentId).all<TealSourceRow>();

    const sources = rows.results ?? [];
    const total_records = sources.reduce((sum, r) => sum + r.record_count, 0);

    return json({
      agent_id: agentId,
      sources,
      total_records,
      total_operators: sources.length,
      window_days: 90,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Table or column not yet created (migration pending) — graceful degradation
    if (msg.includes('no such table') || msg.includes('no such column') || msg.includes('SQLITE_ERROR')) {
      return json({
        agent_id: agentId,
        sources: [] as TealSourceRow[],
        total_records: 0,
        total_operators: 0,
        window_days: 90,
        note: 'audit_unavailable',
      });
    }
    return err(`teal-sources query failed: ${msg}`, 500, 'internal_error');
  }
}
