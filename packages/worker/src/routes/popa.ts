/**
 * PoPA Routes — public read API for Proof-of-Presence metrics.
 *
 *   GET /v1/popa/:did   → 200 PoPAMetrics, or 404 no_attestations_found
 *
 * Public endpoint: mounted BEFORE the global /v1/* auth middleware in
 * index.ts (see comment near publicAuditRoutes for the same pattern).
 *
 * Caching: KV (KEYS namespace) with 24h TTL. The emitter invalidates this
 * key on every successful write (`popa:<did>`).
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { json, err } from '../utils.js';
import { computeMetrics, type AttestationRow } from '../lib/popa-aggregator.js';

export const popaRoutes = new Hono<HonoEnv>();

popaRoutes.get('/:did', async (c) => {
  if (!c.env.AUDIT) return err('PoPA not configured.', 503, 'audit_unavailable');

  const did = c.req.param('did');
  if (!did) return err('did is required.', 400, 'missing_did');

  // Cache hit
  try {
    const cached = await c.env.KEYS.get('popa:' + did);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Powered-By': 'AgentLair',
          'X-Cache': 'HIT',
        },
      });
    }
  } catch {
    // KV read failure is non-fatal — fall through to D1
  }

  const result = await c.env.AUDIT
    .prepare(
      `SELECT sequence, gap_detected, gap_hours, window_start, window_end, entry_id, created_at
       FROM popa_attestations WHERE agent_did = ? ORDER BY sequence DESC LIMIT 1000`,
    )
    .bind(did)
    .all<AttestationRow>();

  const rows = result.results ?? [];
  if (rows.length === 0) {
    return err('no_attestations_found', 404, 'no_attestations_found');
  }

  const metrics = computeMetrics(did, rows);
  const body = JSON.stringify(metrics);

  // Cache write is fire-and-forget — don't fail the response on KV errors
  try {
    await c.env.KEYS.put('popa:' + did, body, { expirationTtl: 86400 });
  } catch {
    /* non-fatal */
  }

  return json(metrics);
});
