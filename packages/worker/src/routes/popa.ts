/**
 * PoPA Routes — Proof-of-Presence metrics API.
 *
 * Two routers exported:
 *
 *   popaRoutes (public)
 *     GET /v1/popa/:did   → 200 PoPAMetrics, or 404 no_attestations_found
 *     Mounted BEFORE the global /v1/* auth middleware in index.ts.
 *
 *   popaEnrollRoutes (auth-gated)
 *     POST /v1/popa/enroll → 200 SubscriberRow, idempotent UPSERT
 *     Mounted AFTER the global /v1/* auth middleware in index.ts.
 *
 * Splitting the routers lets a public GET coexist with an auth-gated POST
 * on the same /v1/popa prefix: Hono falls through public popaRoutes when
 * no method matches, allowing the auth middleware (and then popaEnrollRoutes)
 * to run.
 *
 * Caching: KV (KEYS namespace) with 24h TTL. The emitter invalidates this
 * key on every successful write (`popa:<did>`).
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { json, err } from '../utils.js';
import { computeMetrics, type AttestationRow } from '../lib/popa-aggregator.js';

export const popaRoutes = new Hono<HonoEnv>();

/**
 * Validate an agent DID for enrollment.
 *
 * Accepts:
 *   - did:web:<host>[:path-segments]   (RFC: did-method-web)
 *   - did:key:<multibase>               (RFC: did-method-key)
 *
 * Rejects empty DIDs, other DID methods, and DIDs longer than 512 chars
 * (defensive cap — D1 TEXT has no enforced length but we don't want to
 * accept arbitrary blobs as primary keys).
 */
export function isValidEnrollableDid(did: unknown): did is string {
  if (typeof did !== 'string') return false;
  if (did.length === 0 || did.length > 512) return false;
  if (did.startsWith('did:web:') && did.length > 'did:web:'.length) return true;
  if (did.startsWith('did:key:') && did.length > 'did:key:'.length) return true;
  return false;
}

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

/**
 * Auth-gated enrollment router. Mounted AFTER the /v1/* auth middleware in
 * index.ts so that c.get('account') is populated. The public popaRoutes
 * mount has no POST handler, so POST requests fall through the public
 * mount, get authenticated, and then land here.
 */
export const popaEnrollRoutes = new Hono<HonoEnv>();

popaEnrollRoutes.post('/enroll', async (c) => {
  if (!c.env.AUDIT) return err('PoPA not configured.', 503, 'audit_unavailable');

  const account = c.get('account');
  if (!account) {
    // Defensive — auth middleware should have rejected unauthenticated calls.
    return err('Authentication required.', 401, 'unauthorized');
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return err('Request body must be valid JSON.', 400, 'invalid_json');
  }

  if (!body || typeof body !== 'object') {
    return err('Request body must be a JSON object.', 400, 'invalid_body');
  }

  const { agent_did, enabled } = body as { agent_did?: unknown; enabled?: unknown };

  if (!isValidEnrollableDid(agent_did)) {
    return err(
      'agent_did must be a non-empty string starting with "did:web:" or "did:key:" (max 512 chars).',
      400,
      'invalid_did',
    );
  }

  // `enabled` is optional, defaults to true. Coerce booleans / numbers / undefined.
  let enabledFlag: 0 | 1 = 1;
  if (typeof enabled === 'boolean') {
    enabledFlag = enabled ? 1 : 0;
  } else if (typeof enabled === 'number') {
    enabledFlag = enabled === 0 ? 0 : 1;
  } else if (enabled !== undefined) {
    return err('enabled must be a boolean if provided.', 400, 'invalid_enabled');
  }

  // Idempotent UPSERT. RETURNING lets us read back the canonical row in one
  // round-trip, including the created_at value SQLite computed if it was a
  // fresh insert.
  try {
    const result = await c.env.AUDIT
      .prepare(
        `INSERT INTO popa_subscribers (agent_did, account_id, enabled)
         VALUES (?, ?, ?)
         ON CONFLICT(agent_did) DO UPDATE SET enabled = excluded.enabled
         RETURNING agent_did, account_id, enabled, created_at`,
      )
      .bind(agent_did, account.id ?? null, enabledFlag)
      .first<{
        agent_did: string;
        account_id: string | null;
        enabled: number;
        created_at: string;
      }>();

    if (!result) {
      return err('Failed to enroll subscriber.', 500, 'enroll_failed');
    }

    return json({
      agent_did: result.agent_did,
      account_id: result.account_id,
      enabled: result.enabled === 1,
      enrolled_at: result.created_at,
    });
  } catch (e) {
    return err(
      'Failed to enroll subscriber: ' + (e instanceof Error ? e.message : 'unknown error'),
      500,
      'enroll_failed',
    );
  }
});
