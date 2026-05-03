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
import { checkController } from '../lib/popa-controller.js';

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

popaRoutes.get('/leaderboard', async (c) => {
  if (!c.env.AUDIT) return err('PoPA not configured.', 503, 'audit_unavailable');

  // Parse + clamp query
  const sortRaw = c.req.query('sort');
  const sort: 'attestations' | 'age' = sortRaw === 'age' ? 'age' : 'attestations';
  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

  const cacheKey = `popa:leaderboard:${sort}:${limit}`;

  // KV cache hit
  try {
    const cached = await c.env.KEYS.get(cacheKey);
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
    /* KV failure is non-fatal — fall through to D1 */
  }

  const orderBy =
    sort === 'attestations'
      ? 'attestation_count DESC, s.created_at ASC'
      : 's.created_at ASC, attestation_count DESC';

  const sql = `
    SELECT
      s.agent_did               AS did,
      s.account_id              AS controller,
      s.created_at              AS enrolled_at,
      s.last_attested_at        AS last_attested_at,
      s.revoked_at              AS revoked_at,
      COALESCE(a.cnt, 0)        AS attestation_count
    FROM popa_subscribers s
    LEFT JOIN (
      SELECT agent_did, COUNT(*) AS cnt
      FROM popa_attestations
      GROUP BY agent_did
    ) a ON a.agent_did = s.agent_did
    WHERE s.revoked_at IS NULL
    ORDER BY ${orderBy}
    LIMIT ?
  `;

  const result = await c.env.AUDIT.prepare(sql).bind(limit).all<{
    did: string;
    controller: string | null;
    enrolled_at: string;
    last_attested_at: string | null;
    revoked_at: string | null;
    attestation_count: number;
  }>();

  const body = JSON.stringify({
    sort,
    limit,
    rows: result.results ?? [],
    generated_at: new Date().toISOString(),
  });

  // Fire-and-forget cache write — 60s TTL, keeps the leaderboard cheap under
  // load while staying recent enough that newly-enrolled DIDs surface within
  // a minute. Cron-driven attestation counts only change once per UTC day.
  try {
    await c.env.KEYS.put(cacheKey, body, { expirationTtl: 60 });
  } catch {
    /* non-fatal */
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Powered-By': 'AgentLair',
      'X-Cache': 'MISS',
    },
  });
});

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
  if (!account || !account.id) {
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

  // PoPA v2 controller check — caller MUST control the DID. Self-issued
  // AgentLair DIDs short-circuit (no network round-trip); other did:web DIDs
  // are resolved and their controller fields verified against the caller.
  const ctrl = await checkController(agent_did, account.id);
  if (!ctrl.ok) {
    if (ctrl.reason === 'not_controller') {
      return err(
        'You do not control this DID. Add did:web:agentlair.dev:agents:' + account.id +
        ' to the verificationMethod[].controller of your DID document, then retry.',
        403,
        'not_controller',
      );
    }
    if (ctrl.reason === 'unresolvable') {
      return err(
        'Could not resolve this DID. ' + (ctrl.detail ?? '') + ' Verify the did.json is reachable and self-identifies with this DID.',
        400,
        'unresolvable_did',
      );
    }
    if (ctrl.reason === 'unsupported_did') {
      return err(ctrl.detail ?? 'This DID method is not supported for enrollment.', 400, 'unsupported_did');
    }
    return err('Invalid DID.', 400, 'invalid_did');
  }

  // Idempotent UPSERT. Re-enrolling a previously revoked DID clears
  // revoked_at — the controller has changed their mind, and the cron picks
  // it back up at the next UTC midnight.
  try {
    const result = await c.env.AUDIT
      .prepare(
        `INSERT INTO popa_subscribers (agent_did, account_id, enabled, revoked_at)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(agent_did) DO UPDATE SET
           enabled = excluded.enabled,
           account_id = excluded.account_id,
           revoked_at = NULL
         RETURNING agent_did, account_id, enabled, created_at, last_attested_at, revoked_at`,
      )
      .bind(agent_did, account.id, enabledFlag)
      .first<{
        agent_did: string;
        account_id: string | null;
        enabled: number;
        created_at: string;
        last_attested_at: string | null;
        revoked_at: string | null;
      }>();

    if (!result) {
      return err('Failed to enroll subscriber.', 500, 'enroll_failed');
    }

    return json({
      agent_did: result.agent_did,
      account_id: result.account_id,
      enabled: result.enabled === 1,
      enrolled_at: result.created_at,
      last_attested_at: result.last_attested_at,
      revoked_at: result.revoked_at,
      status: result.revoked_at ? 'revoked' : result.enabled === 1 ? 'active' : 'paused',
    });
  } catch (e) {
    return err(
      'Failed to enroll subscriber: ' + (e instanceof Error ? e.message : 'unknown error'),
      500,
      'enroll_failed',
    );
  }
});

/**
 * DELETE /v1/popa/enroll/:did — revoke an enrollment.
 *
 * Tombstones rather than deletes: the row stays so the controller history is
 * auditable and so re-enrolling the same DID does not silently re-use a
 * previous account_id binding by accident. The cron skips revoked rows
 * because revoked_at IS NOT NULL flips the predicate to false.
 *
 * Same controller check as POST. A revoked row can be re-activated by the
 * controller via POST /v1/popa/enroll (which sets revoked_at = NULL).
 */
popaEnrollRoutes.delete('/enroll/:did', async (c) => {
  if (!c.env.AUDIT) return err('PoPA not configured.', 503, 'audit_unavailable');

  const account = c.get('account');
  if (!account || !account.id) {
    return err('Authentication required.', 401, 'unauthorized');
  }

  const agentDid = c.req.param('did');
  if (!isValidEnrollableDid(agentDid)) {
    return err(
      'did path parameter must be a valid did:web:* or did:key:* identifier.',
      400,
      'invalid_did',
    );
  }

  const ctrl = await checkController(agentDid, account.id);
  if (!ctrl.ok) {
    if (ctrl.reason === 'not_controller') {
      return err('You do not control this DID.', 403, 'not_controller');
    }
    if (ctrl.reason === 'unresolvable') {
      return err('Could not resolve this DID. ' + (ctrl.detail ?? ''), 400, 'unresolvable_did');
    }
    if (ctrl.reason === 'unsupported_did') {
      return err(ctrl.detail ?? 'This DID method is not supported.', 400, 'unsupported_did');
    }
    return err('Invalid DID.', 400, 'invalid_did');
  }

  try {
    const result = await c.env.AUDIT
      .prepare(
        `UPDATE popa_subscribers
         SET enabled = 0, revoked_at = ?
         WHERE agent_did = ?
         RETURNING agent_did, account_id, enabled, created_at, last_attested_at, revoked_at`,
      )
      .bind(new Date().toISOString(), agentDid)
      .first<{
        agent_did: string;
        account_id: string | null;
        enabled: number;
        created_at: string;
        last_attested_at: string | null;
        revoked_at: string | null;
      }>();

    if (!result) {
      return err('Enrollment not found.', 404, 'not_enrolled');
    }

    return json({
      agent_did: result.agent_did,
      account_id: result.account_id,
      enabled: result.enabled === 1,
      enrolled_at: result.created_at,
      last_attested_at: result.last_attested_at,
      revoked_at: result.revoked_at,
      status: 'revoked',
    });
  } catch (e) {
    return err(
      'Failed to revoke enrollment: ' + (e instanceof Error ? e.message : 'unknown error'),
      500,
      'revoke_failed',
    );
  }
});
