// ─── Trust Routes ─────────────────────────────────────────────────────────────
//
// Phase 1 implementation of the behavioral trust scoring algorithm.
// Full spec: memory/knowledge/agentlair-trust-scoring-algorithm.md
//
// Endpoints:
//   GET /v1/trust/:agentId          — Full trust profile (score, dimensions, ATF level, CI)
//   GET /v1/trust/:agentId/check    — Fast-path gate (atfLevel + meetsMinimum bool)
//
// Data source: audit_log D1 table (AUDIT binding). Gracefully degrades when
// the AUDIT binding or trust_profiles table is not available.
//
// Auth: API key required (same as other /v1/* endpoints).
// Mounted in index.ts as: app.route('/v1/trust', trustRoutes)

import { Hono } from 'hono';
import type { Context } from 'hono';
import { json, err } from '../utils.js';
import type { HonoEnv } from '../types.js';
import { resolveAccountTier } from '../types.js';
import type { ATFLevel } from '../trust-engine.js';
import { computeTrustScore, checkTrustGate } from '../trust-engine.js';
import { authenticateAny } from '../middleware/auth.js';
import { verifyX402Payment, settleX402Payment, trackX402Spend, make402Response, SERVICE_PRICES } from '../x402.js';

export const trustRoutes = new Hono<HonoEnv>();

// ─── Validation ─────────────────────────────────────────────────────────────────

const AGENT_ID_RE = /^acc_[A-Za-z0-9_-]{1,64}$/;

function validateAgentId(agentId: string | undefined): string | null {
  if (!agentId || !AGENT_ID_RE.test(agentId)) return null;
  return agentId;
}

const VALID_ATF_LEVELS: ATFLevel[] = ['intern', 'junior', 'senior', 'principal'];

function parseMinLevel(raw: string | null): ATFLevel {
  if (raw && (VALID_ATF_LEVELS as string[]).includes(raw)) return raw as ATFLevel;
  return 'intern';
}

// ─── GET /v1/trust/:agentId ────────────────────────────────────────────────────
//
// Returns the full behavioral trust profile for an agent:
//   - Overall score [0, 100]
//   - Confidence interval
//   - ATF maturity level (intern → junior → senior → principal)
//   - Per-dimension breakdown (consistency, restraint, transparency)
//   - Signal contributions within each dimension
//   - Trend (improving / stable / declining)
//
// Visibility:
//   Self: computed from all events (actor_id = own account ID)
//   Other: same computation — audit trail is the data source, not Turso observations
//
// Requires AUDIT D1 binding. Returns 503 if not configured.

trustRoutes.get('/:agentId', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const agentId = validateAgentId(c.req.param('agentId'));
  if (!agentId) return err('Invalid agent ID format. Expected: acc_<alphanumeric>.', 400, 'invalid_agent_id');

  const db = c.env.AUDIT;
  if (!db) {
    return err(
      'Trust scoring requires the audit trail database (AUDIT D1 binding). Not configured.',
      503,
      'audit_unavailable',
    );
  }

  try {
    const tier = resolveAccountTier(account);
    const profile = await computeTrustScore(db, agentId, tier);
    return json(profile);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Common case: trust_profiles table not yet created (migration pending)
    if (msg.includes('no such table') || msg.includes('SQLITE_ERROR')) {
      return err(
        'Trust scoring tables not yet initialized. Run D1 migration 0004_create_trust_profiles.sql.',
        503,
        'trust_tables_missing',
      );
    }
    return err(`Trust score computation failed: ${msg}`, 500, 'trust_computation_error');
  }
});

// ─── GET /v1/trust/:agentId/check ─────────────────────────────────────────────
//
// Fast-path enforcement gate. Returns a lightweight trust check result:
//   { agentId, score, atfLevel, meetsMinimum, requiredLevel, confidence, cached }
//
// Query parameters:
//   min_level — ATF level threshold: intern | junior | senior | principal (default: intern)
//
// Uses cached trust_profiles when available (avoids full audit trail scan).
// Falls back to full computation if no cached score exists.
//
// Designed for integration into enforcement layers that need low-latency
// trust decisions before allowing an action.

trustRoutes.get('/:agentId/check', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const agentId = validateAgentId(c.req.param('agentId'));
  if (!agentId) return err('Invalid agent ID format. Expected: acc_<alphanumeric>.', 400, 'invalid_agent_id');

  const minLevel = parseMinLevel(c.req.query('min_level') ?? null);

  const db = c.env.AUDIT;
  if (!db) {
    return err(
      'Trust scoring requires the audit trail database (AUDIT D1 binding). Not configured.',
      503,
      'audit_unavailable',
    );
  }

  try {
    const tier = resolveAccountTier(account);
    const result = await checkTrustGate(db, agentId, minLevel, tier);
    return json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table') || msg.includes('SQLITE_ERROR')) {
      return err(
        'Trust scoring tables not yet initialized. Run D1 migration 0004_create_trust_profiles.sql.',
        503,
        'trust_tables_missing',
      );
    }
    return err(`Trust check failed: ${msg}`, 500, 'trust_check_error');
  }
});

// ─── Public Trust Routes (optional auth + x402 for anonymous) ────────────────────
//
// Mounted BEFORE the /v1/* auth middleware in index.ts so anonymous agents can access.
// If a valid API key is present, it is used and no payment is required.
// Without an API key, callers must pay 0.01 USDC via x402.
//
// Handles both:
//   GET /v1/trust/:agentId         — full trust profile
//   GET /v1/trust/:agentId/check   — fast-path gate

export const publicTrustRoutes = new Hono<HonoEnv>();

async function handleX402TrustPayment(c: Context<HonoEnv>) {
  const xPayment = c.req.header('X-PAYMENT');
  if (!xPayment) {
    return make402Response(SERVICE_PRICES.trust_query);
  }
  const verification = await verifyX402Payment(xPayment, SERVICE_PRICES.trust_query);
  if (!verification.valid) {
    return make402Response(SERVICE_PRICES.trust_query, {
      payment_error: verification.error,
    });
  }
  const settlement = await settleX402Payment(xPayment, SERVICE_PRICES.trust_query);
  if (!settlement.settled) {
    return make402Response(SERVICE_PRICES.trust_query, {
      payment_error: settlement.error,
    });
  }
  if (settlement.receipt) {
    c.header('X-Payment-Response', settlement.receipt);
  }
  c.executionCtx.waitUntil(
    trackX402Spend(c.env, 'anonymous', SERVICE_PRICES.trust_query.amount, {
      payer: verification.payer,
      service: 'trust_query',
    }).catch(() => {}),
  );
  return null; // null = payment OK, proceed
}

// ─── GET /v1/trust/score ──────────────────────────────────────────────────────
//
// Query-param style alias for GET /v1/trust/:agentId. Accepts agent_id as a
// query parameter instead of a path parameter. Registered BEFORE /:agentId to
// prevent "/score" being captured as an agentId.
//
// Example: GET /v1/trust/score?agent_id=acc_abc123

publicTrustRoutes.get('/score', async (c) => {
  const account = await authenticateAny(c.req.raw, c.env);

  const rawAgentId = c.req.query('agent_id');
  const agentId = validateAgentId(rawAgentId);
  if (!agentId) return err('Invalid agent ID format. Expected: acc_<alphanumeric>.', 400, 'invalid_agent_id');

  const db = c.env.AUDIT;
  if (!db) {
    return err(
      'Trust scoring requires the audit trail database (AUDIT D1 binding). Not configured.',
      503,
      'audit_unavailable',
    );
  }

  if (!account) {
    const paymentErr = await handleX402TrustPayment(c);
    if (paymentErr) return paymentErr;
  }

  try {
    const tier = account ? resolveAccountTier(account) : 'free';
    const profile = await computeTrustScore(db, agentId, tier);
    return json(profile);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table') || msg.includes('SQLITE_ERROR')) {
      return err(
        'Trust scoring tables not yet initialized. Run D1 migration 0004_create_trust_profiles.sql.',
        503,
        'trust_tables_missing',
      );
    }
    return err(`Trust score computation failed: ${msg}`, 500, 'trust_computation_error');
  }
});

publicTrustRoutes.get('/:agentId', async (c) => {
  // Try optional authentication — if API key present, use it (no payment required)
  const account = await authenticateAny(c.req.raw, c.env);

  const agentId = validateAgentId(c.req.param('agentId'));
  if (!agentId) return err('Invalid agent ID format. Expected: acc_<alphanumeric>.', 400, 'invalid_agent_id');

  const db = c.env.AUDIT;
  if (!db) {
    return err(
      'Trust scoring requires the audit trail database (AUDIT D1 binding). Not configured.',
      503,
      'audit_unavailable',
    );
  }

  if (!account) {
    // Anonymous: require x402 payment
    const paymentErr = await handleX402TrustPayment(c);
    if (paymentErr) return paymentErr;
  }

  try {
    const tier = account ? resolveAccountTier(account) : 'free';
    const profile = await computeTrustScore(db, agentId, tier);
    return json(profile);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table') || msg.includes('SQLITE_ERROR')) {
      return err(
        'Trust scoring tables not yet initialized. Run D1 migration 0004_create_trust_profiles.sql.',
        503,
        'trust_tables_missing',
      );
    }
    return err(`Trust score computation failed: ${msg}`, 500, 'trust_computation_error');
  }
});

publicTrustRoutes.get('/:agentId/check', async (c) => {
  // Try optional authentication — if API key present, use it (no payment required)
  const account = await authenticateAny(c.req.raw, c.env);

  const agentId = validateAgentId(c.req.param('agentId'));
  if (!agentId) return err('Invalid agent ID format. Expected: acc_<alphanumeric>.', 400, 'invalid_agent_id');

  const minLevel = parseMinLevel(c.req.query('min_level') ?? null);

  const db = c.env.AUDIT;
  if (!db) {
    return err(
      'Trust scoring requires the audit trail database (AUDIT D1 binding). Not configured.',
      503,
      'audit_unavailable',
    );
  }

  if (!account) {
    // Anonymous: require x402 payment
    const paymentErr = await handleX402TrustPayment(c);
    if (paymentErr) return paymentErr;
  }

  try {
    const tier = account ? resolveAccountTier(account) : 'free';
    const result = await checkTrustGate(db, agentId, minLevel, tier);
    return json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('no such table') || msg.includes('SQLITE_ERROR')) {
      return err(
        'Trust scoring tables not yet initialized. Run D1 migration 0004_create_trust_profiles.sql.',
        503,
        'trust_tables_missing',
      );
    }
    return err(`Trust check failed: ${msg}`, 500, 'trust_check_error');
  }
});
