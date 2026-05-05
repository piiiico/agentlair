/**
 * PoPA Routes — Proof-of-Presence metrics API.
 *
 * Three routers exported:
 *
 *   popaRoutes (public)
 *     GET /v1/popa/leaderboard        → 200 leaderboard
 *     GET /v1/popa/agent/:did         → 200 self-attestation history
 *     GET /v1/popa/:did               → 200 PoPAMetrics, or 404 no_attestations_found
 *     Mounted BEFORE the global /v1/* auth middleware in index.ts.
 *
 *   popaEnrollRoutes (account-key auth-gated)
 *     POST   /v1/popa/enroll          → 200 SubscriberRow, idempotent UPSERT
 *     DELETE /v1/popa/enroll/:did     → 200 revoke enrollment
 *     Mounted AFTER the global /v1/* auth middleware in index.ts.
 *
 *   popaAgentRoutes (AAT auth — agent self-service)
 *     POST /v1/popa/self-attest       → 201 self-attestation record
 *     Mounted BEFORE the global /v1/* auth middleware (but after public
 *     popaRoutes) — the router does its own AAT verification inline.
 *
 * Caching: KV (KEYS namespace) with 24h TTL. The emitter invalidates this
 * key on every successful write (`popa:<did>`).
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { json, err, nanoid } from '../utils.js';
import { computeMetrics, type AttestationRow } from '../lib/popa-aggregator.js';
import { checkController } from '../lib/popa-controller.js';
import { getPublicKey, verifyJWT, b64urlEncode } from '../jwt.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalJSON } from '../lib/popa-cose.js';

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

/**
 * GET /v1/popa/agent/:did — agent self-attestation history (public).
 *
 * Returns the list of self-attestation records for a DID, ordered newest first.
 * These are agent-driven liveness proofs (POST /v1/popa/self-attest),
 * distinct from controller-driven attestations (served by GET /v1/popa/:did).
 */
popaRoutes.get('/agent/:did', async (c) => {
  if (!c.env.AUDIT) return err('PoPA not configured.', 503, 'audit_unavailable');

  const agentDid = c.req.param('did');
  if (!agentDid) return err('did path parameter is required.', 400, 'missing_did');

  const result = await c.env.AUDIT
    .prepare(
      `SELECT id, agent_did, account_id, aat_jti, sequence, window_date, attested_at
       FROM popa_self_attestations
       WHERE agent_did = ?
       ORDER BY sequence DESC
       LIMIT 365`,
    )
    .bind(agentDid)
    .all<{
      id: string;
      agent_did: string;
      account_id: string;
      aat_jti: string;
      sequence: number;
      window_date: string;
      attested_at: string;
    }>();

  const rows = result.results ?? [];

  // Compute simple streak (consecutive days, descending)
  let streak = 0;
  let totalAttestations = rows.length;
  let longestStreak = 0;
  let currentRun = 0;
  let prevDate: string | null = null;

  for (const row of rows) {
    if (prevDate === null) {
      currentRun = 1;
    } else {
      const prev = new Date(prevDate + 'T00:00:00Z');
      const curr = new Date(row.window_date + 'T00:00:00Z');
      const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86_400_000);
      if (diffDays === 1) {
        currentRun++;
      } else {
        longestStreak = Math.max(longestStreak, currentRun);
        currentRun = 1;
      }
    }
    prevDate = row.window_date;
    if (streak === 0) streak = currentRun; // current streak = run from most recent
  }
  longestStreak = Math.max(longestStreak, currentRun);
  // After the loop, streak is the current streak (running from the most recent entry).
  // Re-compute: walk from the top and count consecutive days.
  streak = 0;
  prevDate = null;
  for (const row of rows) {
    if (prevDate === null) {
      streak = 1;
    } else {
      const prev = new Date(prevDate + 'T00:00:00Z');
      const curr = new Date(row.window_date + 'T00:00:00Z');
      const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86_400_000);
      if (diffDays === 1) {
        streak++;
      } else {
        break; // gap — current streak ends
      }
    }
    prevDate = row.window_date;
  }

  return json({
    agent_did: agentDid,
    total_attestations: totalAttestations,
    streak_days: streak,
    longest_streak: longestStreak,
    last_attested_at: rows[0]?.attested_at ?? null,
    genesis_at: rows.length > 0 ? rows[rows.length - 1]!.attested_at : null,
    attestations: rows,
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

// ─── Agent self-service router (AAT-gated) ────────────────────────────────────
//
// Mounted BEFORE the global /v1/* account-key auth middleware so that it
// handles its own JWT verification inline. The global middleware only handles
// `al_*` API keys, not AAT JWTs.

/**
 * POST /v1/popa/self-attest — agent-driven liveness proof.
 *
 * Authentication: Bearer <AAT>  (EdDSA JWT issued by POST /v1/tokens/issue)
 *
 * The agent presents its non-expired AAT. The server:
 *   1. Verifies the AAT signature against AUDIT_SIGNING_KEY
 *   2. Extracts the agent DID (from `did` claim, or derived from `sub`)
 *   3. Signs a liveness claim JSON using the same Ed25519 key
 *      (the same key backs the agent's DID — conceptually the agent's key)
 *   4. Inserts a row into popa_self_attestations (idempotent per UTC day)
 *   5. Returns the attestation record
 *
 * Rate: one attestation per DID per UTC day. Re-attesting the same day
 * returns 200 with the existing record (idempotent, not an error).
 */
export const popaAgentRoutes = new Hono<HonoEnv>();

popaAgentRoutes.post('/self-attest', async (c) => {
  if (!c.env.AUDIT || !c.env.AUDIT_SIGNING_KEY) {
    return err('PoPA not configured.', 503, 'audit_unavailable');
  }

  // ── 1. Extract and verify the AAT ─────────────────────────────────────────
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return err('Authorization header with Bearer AAT required.', 401, 'unauthorized');
  }
  const token = authHeader.slice(7).trim();

  // AATs start with "eyJ" (base64url-encoded JSON); reject obvious API keys early
  if (token.startsWith('al_') || !token.includes('.')) {
    return err('Bearer token must be a JWT (AAT), not an API key.', 401, 'invalid_token_type');
  }

  const publicKeyBytes = getPublicKey(c.env.AUDIT_SIGNING_KEY);
  const claims = verifyJWT(token, publicKeyBytes);
  if (!claims) {
    return err('AAT signature verification failed.', 401, 'invalid_aat');
  }

  // Expiry check (verifyJWT doesn't check exp)
  const nowSecs = Math.floor(Date.now() / 1000);
  if (claims.exp && nowSecs > claims.exp) {
    return err('AAT has expired. Issue a new token via POST /v1/tokens/issue.', 401, 'aat_expired');
  }

  // ── 2. Resolve agent DID ───────────────────────────────────────────────────
  const agentDid = claims.did ?? `did:web:agentlair.dev:agents:${claims.sub}`;
  const accountId = claims.sub;

  // ── 3. Current UTC date (window_date) ─────────────────────────────────────
  const now = new Date();
  const windowDateIso = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

  // ── 4. Idempotency: check if already attested today ───────────────────────
  const existing = await c.env.AUDIT
    .prepare('SELECT id, sequence, attested_at FROM popa_self_attestations WHERE agent_did = ? AND window_date = ?')
    .bind(agentDid, windowDateIso)
    .first<{ id: string; sequence: number; attested_at: string }>();

  if (existing) {
    // Already attested today — idempotent success
    return json(
      {
        id: existing.id,
        agent_did: agentDid,
        account_id: accountId,
        sequence: existing.sequence,
        window_date: windowDateIso,
        attested_at: existing.attested_at,
        already_attested_today: true,
      },
      200,
    );
  }

  // ── 5. Build and sign the liveness claim ──────────────────────────────────
  //
  // The agent's DID is anchored to AgentLair's JWKS — the AUDIT_SIGNING_KEY IS
  // the agent's key. Signing with it is conceptually "the agent signing with its
  // own key."
  const attestedAt = now.toISOString();
  const prevRow = await c.env.AUDIT
    .prepare('SELECT sequence FROM popa_self_attestations WHERE agent_did = ? ORDER BY sequence DESC LIMIT 1')
    .bind(agentDid)
    .first<{ sequence: number }>();
  const sequence = (prevRow?.sequence ?? 0) + 1;

  const id = 'psa_' + nanoid(16);

  const livenessPayload = canonicalJSON({
    '@context': ['https://agentlair.dev/popa/v1'],
    type: 'AgentLivenessAttestation',
    id,
    agent_did: agentDid,
    account_id: accountId,
    aat_jti: claims.jti,
    sequence,
    window_date: windowDateIso,
    attested_at: attestedAt,
    issuer: 'https://agentlair.dev',
  });

  const privBytes = Uint8Array.from(atob(c.env.AUDIT_SIGNING_KEY), (ch) => ch.charCodeAt(0));
  const payloadBytes = new TextEncoder().encode(livenessPayload);
  const sigBytes = ed25519.sign(payloadBytes, privBytes);
  const sigB64 = b64urlEncode(sigBytes);

  const signedClaim = JSON.stringify({
    payload: livenessPayload,
    signature: sigB64,
    algorithm: 'EdDSA',
    key_id: 'agentlair.dev/audit',
  });

  // ── 6. Persist ────────────────────────────────────────────────────────────
  try {
    await c.env.AUDIT
      .prepare(
        `INSERT INTO popa_self_attestations (id, agent_did, account_id, aat_jti, sequence, window_date, attested_at, signed_claim)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, agentDid, accountId, claims.jti, sequence, windowDateIso, attestedAt, signedClaim)
      .run();
  } catch (e) {
    // UNIQUE constraint on aat_jti — replay attempt
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return err('This AAT has already been used for a self-attestation.', 409, 'jti_conflict');
    }
    return err(
      'Failed to store self-attestation: ' + (e instanceof Error ? e.message : 'unknown error'),
      500,
      'store_failed',
    );
  }

  // ── 7. Invalidate KV cache for this DID ──────────────────────────────────
  try {
    await c.env.KEYS.delete('popa:' + agentDid);
  } catch {
    /* non-fatal */
  }

  return json(
    {
      id,
      agent_did: agentDid,
      account_id: accountId,
      sequence,
      window_date: windowDateIso,
      attested_at: attestedAt,
      already_attested_today: false,
    },
    201,
  );
});
