/**
 * AgentLair Identity Provider — Token Revocation
 *
 * RFC-001: Section 3.3 (Token Revocation)
 *
 * Provides token revocation for AATs. Revoked tokens return active:false
 * on introspection. JWKS-only verification cannot detect revocation —
 * relying parties requiring revocation awareness must use introspection.
 *
 * Storage: KV with TTL aligned to token's original expiration.
 * This ensures revocation entries are automatically cleaned up when the
 * token would have expired anyway.
 *
 * Revocation reasons:
 * - agent_compromised: API key or signing key may be compromised
 * - scope_change: agent's authorized scopes have changed
 * - operator_request: human operator requested revocation
 * - trust_violation: trust score dropped below minimum threshold
 * - decommissioned: agent has been permanently deactivated
 */

import { Hono } from 'hono';
import { json, err } from '../utils.js';
import type { HonoEnv, Env } from '../types.js';
import { getPublicKey, verifyJWT } from '../jwt.js';

export const revokeRoutes = new Hono<HonoEnv>();

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_REVOCATION_REASONS = [
  'agent_compromised',
  'scope_change',
  'operator_request',
  'trust_violation',
  'decommissioned',
] as const;

type RevocationReason = (typeof VALID_REVOCATION_REASONS)[number];

/** KV key prefix for revocation entries */
const REVOCATION_PREFIX = 'revoked:';

// ─── Revocation Record ──────────────────────────────────────────────────────────

interface RevocationRecord {
  jti: string;
  account_id: string;
  reason: RevocationReason;
  revoked_at: string;
  original_exp: number;
}

// ─── POST /v1/tokens/revoke ────────────────────────────────────────────────────
//
// Revoke an active AAT by its JTI (JWT ID). The token must have been issued
// to the authenticated account. Once revoked, introspection returns active:false.
//
// Request body:
// {
//   "jti": "aat_xyz789",              // required: token ID to revoke
//   "reason": "agent_compromised"     // required: revocation reason
// }
//
// Response (200):
// {
//   "revoked": true,
//   "jti": "aat_xyz789",
//   "reason": "agent_compromised",
//   "expires_cleanup": "2026-04-19T22:00:00Z"
// }

revokeRoutes.post('/revoke', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required', 401, 'unauthorized');

  const signingKey = c.env.AUDIT_SIGNING_KEY;
  if (!signingKey) {
    return err('Token service not configured', 503, 'signing_unavailable');
  }

  // Parse request body
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return err('Invalid JSON body', 400, 'invalid_body');
  }

  // Validate JTI
  const jti = body.jti;
  if (!jti || typeof jti !== 'string') {
    return err('jti is required (the token ID to revoke)', 400, 'missing_jti');
  }
  if (!jti.startsWith('aat_')) {
    return err('jti must be an AgentLair token ID (starts with aat_)', 400, 'invalid_jti');
  }

  // Validate reason
  const reason = body.reason;
  if (!reason || typeof reason !== 'string') {
    return err('reason is required', 400, 'missing_reason');
  }
  if (!VALID_REVOCATION_REASONS.includes(reason as RevocationReason)) {
    return err(
      `Invalid reason. Must be one of: ${VALID_REVOCATION_REASONS.join(', ')}`,
      400,
      'invalid_reason',
    );
  }

  // Optionally verify the token to extract exp and confirm ownership
  // If a token string is provided, verify it belongs to this account
  let originalExp: number | null = null;

  if (typeof body.token === 'string') {
    const publicKeyBytes = getPublicKey(signingKey);
    const claims = verifyJWT(body.token, publicKeyBytes);
    if (claims) {
      // Verify ownership: token must be issued to the same account
      if (claims.sub !== account.id) {
        return err('Token does not belong to this account', 403, 'token_ownership_mismatch');
      }
      originalExp = claims.exp;
    }
    // If verification fails, still allow revocation by JTI — the token may already be expired
  }

  // Check if already revoked
  const existingRevocation = await c.env.KEYS.get(`${REVOCATION_PREFIX}${jti}`);
  if (existingRevocation) {
    const existing = JSON.parse(existingRevocation) as RevocationRecord;
    return json({
      revoked: true,
      jti,
      reason: existing.reason,
      already_revoked: true,
      revoked_at: existing.revoked_at,
    });
  }

  // Compute KV TTL: align with token's original expiration
  // If we don't know the original exp, use 24h (max AAT TTL)
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = originalExp
    ? Math.max(originalExp - now, 60) // At least 60s TTL
    : 86400; // Default 24h if exp unknown

  const record: RevocationRecord = {
    jti,
    account_id: account.id,
    reason: reason as RevocationReason,
    revoked_at: new Date().toISOString(),
    original_exp: originalExp ?? now + ttlSeconds,
  };

  // Store revocation in KV with TTL
  await c.env.KEYS.put(`${REVOCATION_PREFIX}${jti}`, JSON.stringify(record), {
    expirationTtl: ttlSeconds,
  });

  const expiresCleanup = new Date((originalExp ?? now + ttlSeconds) * 1000).toISOString();

  return json({
    revoked: true,
    jti,
    reason,
    revoked_at: record.revoked_at,
    expires_cleanup: expiresCleanup,
  });
});

// ─── Revocation Check (for introspection integration) ──────────────────────────
//
// Used by the introspection endpoint to check if a token has been revoked.
// Returns true if the token is revoked, false otherwise.

export async function isTokenRevoked(env: Env, jti: string): Promise<boolean> {
  const record = await env.KEYS.get(`${REVOCATION_PREFIX}${jti}`);
  return record !== null;
}

// ─── Bulk Revocation (for account-level operations) ────────────────────────────
//
// Revoke all tokens for an account. Used when:
// - Account is suspended
// - API key is rotated
// - Account is decommissioned
//
// Since we don't track all issued JTIs per account (AATs are stateless),
// this works by recording the account-level revocation timestamp.
// Introspection checks: if token.iat < account_revocation_time, active:false.

const ACCOUNT_REVOCATION_PREFIX = 'account-revoked:';

export async function revokeAllAccountTokens(
  env: Env,
  accountId: string,
  reason: RevocationReason,
): Promise<void> {
  const record = {
    account_id: accountId,
    reason,
    revoked_at: new Date().toISOString(),
    revoked_since: Math.floor(Date.now() / 1000),
  };

  // Store with 24h TTL (max token lifetime)
  // After 24h, all tokens issued before the revocation will have expired naturally
  await env.KEYS.put(
    `${ACCOUNT_REVOCATION_PREFIX}${accountId}`,
    JSON.stringify(record),
    { expirationTtl: 86400 },
  );
}

/**
 * Check if an account has a blanket revocation active.
 * Returns the revocation timestamp (Unix seconds) or null if no blanket revocation.
 */
export async function getAccountRevocationTime(
  env: Env,
  accountId: string,
): Promise<number | null> {
  const raw = await env.KEYS.get(`${ACCOUNT_REVOCATION_PREFIX}${accountId}`);
  if (!raw) return null;

  try {
    const record = JSON.parse(raw) as { revoked_since: number };
    return record.revoked_since;
  } catch {
    return null;
  }
}
