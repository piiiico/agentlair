/**
 * AgentLair Token Routes — AAT (AgentLair Agent Token) issuance
 *
 * POST /v1/tokens/issue — Issue a signed JWT for agent-to-service authentication
 *
 * Design:
 * - Authenticated: requires valid API key (al_live_* or al_pod_*)
 * - Short-lived: default 1 hour TTL, max 24 hours
 * - Signed with Ed25519 (same key as audit log — AUDIT_SIGNING_KEY)
 * - Includes AgentLair-specific claims for agent identity
 * - Every issuance logged to audit trail
 */

import { Hono } from 'hono';
import { json, err, nanoid } from '../utils.js';
import type { HonoEnv } from '../types.js';
import { createJWT, getPublicKey, computeKeyId, verifyJWT } from '../jwt.js';
import type { AATClaims } from '../jwt.js';
import { trackTokenIssuance, checkAndIncrementTokenVerify, TOKEN_VERIFY_LIMITS } from '../middleware/ratelimit.js';
import { SERVICE_PRICES, make402Response } from '../x402.js';
import { getTrustAttestationForEmbed } from '../idp/trust-embed.js';
import { isTokenRevoked, getAccountRevocationTime } from '../idp/revoke.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ISSUER = 'https://agentlair.dev';
const DEFAULT_TTL = 3600; // 1 hour
const MAX_TTL = 86400; // 24 hours
const MIN_TTL = 60; // 1 minute

// Valid scope patterns (Phase 1: permissive, tighten in Phase 2)
const SCOPE_PATTERN = /^[a-z][a-z0-9._:-]*$/;
const MAX_SCOPES = 20;

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

/**
 * Validate scope ceiling: return disallowed scopes or null if ceiling is not enforced.
 * - null means check skipped (allowedScopes empty/undefined — backward compat)
 * - non-empty array means the request must be rejected (scope_ceiling_exceeded)
 */
export function validateScopeCeiling(requestedScopes: string[], allowedScopes: unknown): string[] | null {
  if (!Array.isArray(allowedScopes) || allowedScopes.length === 0) return null;
  const disallowed = requestedScopes.filter((s) => !(allowedScopes as string[]).includes(s));
  return disallowed.length > 0 ? disallowed : null;
}

// ─── Token Routes ─────────────────────────────────────────────────────────────

export const tokenRoutes = new Hono<HonoEnv>();

/**
 * POST /v1/tokens/issue
 *
 * Request body:
 * {
 *   "audience": "https://mcp.example.com",  // required
 *   "scopes": ["mcp:tools:read"],            // required, non-empty
 *   "ttl": 3600,                             // optional, default 1h, max 24h
 *   "agent_name": "my-agent",                // optional, override account name
 *   "agent_email": "my-agent@agentlair.dev"  // optional
 * }
 *
 * Response (201):
 * {
 *   "token": "eyJ...",
 *   "expires_at": "2026-03-24T02:00:00Z",
 *   "jti": "aat_xyz789",
 *   "audit_url": "https://agentlair.dev/v1/audit/log"
 * }
 */
tokenRoutes.post('/issue', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required', 401, 'unauthorized');

  // Signing key must be configured
  const signingKey = c.env.AUDIT_SIGNING_KEY;
  if (!signingKey) {
    return err('Token signing not configured', 503, 'signing_unavailable');
  }

  // Parse request body
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return err('Invalid JSON body', 400, 'invalid_body');
  }

  // ── Validate audience ───────────────────────────────────────────────────
  const audience = body.audience;
  if (!audience || typeof audience !== 'string') {
    return err('audience is required (URL of the target service)', 400, 'missing_audience');
  }
  // Basic URL validation — must be a plausible URL
  if (!audience.startsWith('https://') && !audience.startsWith('http://')) {
    return err('audience must be a valid URL (https://...)', 400, 'invalid_audience');
  }

  // ── Validate scopes ────────────────────────────────────────────────────
  const scopes = body.scopes;
  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return err('scopes is required (non-empty array of scope strings)', 400, 'missing_scopes');
  }
  if (scopes.length > MAX_SCOPES) {
    return err(`Maximum ${MAX_SCOPES} scopes allowed`, 400, 'too_many_scopes');
  }
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !SCOPE_PATTERN.test(scope)) {
      return err(
        `Invalid scope: "${scope}". Scopes must match pattern: lowercase letters, digits, dots, colons, hyphens, underscores.`,
        400,
        'invalid_scope',
      );
    }
  }

  // ── Scope ceiling check ────────────────────────────────────────────────
  // If the account has allowed_scopes set, requested scopes must be a subset.
  // This enforces per-account scope ceilings (e.g., tier-based restrictions).
  // Fail-closed: any scope not in the ceiling is rejected.
  const disallowedScopes = validateScopeCeiling(scopes as string[], account.allowed_scopes);
  if (disallowedScopes !== null) {
    return err(
      `Requested scopes exceed account ceiling: ${disallowedScopes.join(', ')}`,
      403,
      'scope_ceiling_exceeded',
    );
  }

  // ── Validate TTL ──────────────────────────────────────────────────────
  let ttl = DEFAULT_TTL;
  if (body.ttl !== undefined) {
    if (typeof body.ttl !== 'number' || !Number.isInteger(body.ttl)) {
      return err('ttl must be an integer (seconds)', 400, 'invalid_ttl');
    }
    ttl = body.ttl;
    if (ttl < MIN_TTL || ttl > MAX_TTL) {
      return err(`ttl must be between ${MIN_TTL} and ${MAX_TTL} seconds`, 400, 'invalid_ttl');
    }
  }

  // ── Optional fields ────────────────────────────────────────────────────
  const agentName =
    typeof body.agent_name === 'string'
      ? body.agent_name.trim().slice(0, 64)
      : typeof (account as Record<string, unknown>).name === 'string'
        ? ((account as Record<string, unknown>).name as string)
        : undefined;

  const agentEmail =
    typeof body.agent_email === 'string' ? body.agent_email.trim().toLowerCase() : undefined;

  // Validate agent_email if provided — must be @agentlair.dev
  if (agentEmail && !agentEmail.endsWith('@agentlair.dev')) {
    return err('agent_email must be an @agentlair.dev address', 400, 'invalid_agent_email');
  }

  // ── Build JWT claims ───────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const jti = 'aat_' + nanoid(16);

  // Compute did:web claim for MCP-I Level 2 interop.
  // Format: did:web:agentlair.dev:agents:<account_id>
  // Resolves to https://agentlair.dev/agents/<account_id>/did.json
  // The did:web method uses ':' as path separator (RFC did-web spec).
  // JWKS at .well-known/jwks.json already acts as the key material backing this DID.
  const did = `did:web:agentlair.dev:agents:${account.id}`;

  const claims: AATClaims = {
    iss: ISSUER,
    sub: account.id,
    aud: audience,
    exp: now + ttl,
    iat: now,
    jti,
    did,
    al_scopes: scopes as string[],
    al_audit_url: `${ISSUER}/v1/audit/${jti}`,
  };

  if (agentName) claims.al_name = agentName;
  if (agentEmail) claims.al_email = agentEmail;

  // ── Trust attestation embedding (RFC-001 Phase 1) ─────────────────────
  // Embed a trust snapshot (al_trust) in the AAT claims if sufficient
  // behavioral observations exist (>= 10). Fail-open: if trust service
  // is unavailable or insufficient data, token is issued without al_trust.
  try {
    const trustAttestation = await getTrustAttestationForEmbed(c.env, account.id);
    if (trustAttestation) {
      claims.al_trust = trustAttestation;
    }
  } catch { /* fail-open — trust embedding is best-effort */ }

  // ── Sign JWT ───────────────────────────────────────────────────────────
  const publicKeyBytes = getPublicKey(signingKey);
  const kid = await computeKeyId(publicKeyBytes);
  const token = createJWT(claims, signingKey, kid);

  const expiresAt = new Date((now + ttl) * 1000).toISOString();

  // Store per-token metadata in KV for the public audit endpoint (non-blocking, fail-open)
  // TTL: token TTL + 300s (5 min buffer) so KV entry expires naturally after the token itself
  if (c.env.KEYS) {
    const meta = {
      jti,
      issued_at: new Date(now * 1000).toISOString(),
      audience,
      scopes: scopes as string[],
      account_id: account.id,
      expires_at: expiresAt,
    };
    c.executionCtx.waitUntil(
      c.env.KEYS.put(`aat-meta:${jti}`, JSON.stringify(meta), { expirationTtl: ttl + 300 }),
    );
  }

  // Track issuance count for usage dashboard (non-blocking, fail-open)
  c.executionCtx.waitUntil(trackTokenIssuance(c.env, account.id));

  return json(
    {
      token,
      token_type: 'Bearer',
      expires_at: expiresAt,
      expires_in: ttl,
      jti,
      audit_url: `${ISSUER}/v1/audit/${jti}`,
    },
    201,
  );
});

/**
 * GET /v1/tokens/info
 *
 * Returns information about the token service capabilities.
 */
tokenRoutes.get('/info', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required', 401, 'unauthorized');

  return json({
    issuer: ISSUER,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    signing_algorithm: 'EdDSA',
    supported_scopes: 'any (agent-declared, validated by target service)',
    default_ttl: DEFAULT_TTL,
    max_ttl: MAX_TTL,
    min_ttl: MIN_TTL,
  });
});

// ─── Public Token Routes (no auth required) ───────────────────────────────────
// These must be mounted BEFORE the /v1/* auth middleware in index.ts.

export const publicTokenRoutes = new Hono<HonoEnv>();

/**
 * POST /v1/tokens/introspect (RFC 7662 compatible)
 *
 * Public endpoint — no AgentLair API key required.
 * Any MCP server can call this to validate an AAT token.
 *
 * Request body:
 * {
 *   "token": "eyJ..."   // required
 * }
 *
 * Response (valid + active):
 * {
 *   "active": true,
 *   "sub": "acct_abc123",
 *   "iss": "https://agentlair.dev",
 *   "aud": "https://mcp.example.com",
 *   "exp": 1742776800,
 *   "iat": 1742773200,
 *   "jti": "aat_xyz789",
 *   "scope": "mcp:tools:read mcp:tools:execute",  // space-separated (RFC 7662)
 *   "al_scopes": ["mcp:tools:read", "mcp:tools:execute"],
 *   "al_audit_url": "https://agentlair.dev/v1/audit/log",
 *   "al_name": "research-agent-7",    // optional
 *   "al_email": "research-agent-7@agentlair.dev"  // optional
 * }
 *
 * Response (invalid / expired / tampered):
 * { "active": false }
 */
publicTokenRoutes.post('/introspect', async (c) => {
  const signingKey = c.env.AUDIT_SIGNING_KEY;
  if (!signingKey) {
    return err('Token validation not configured', 503, 'validation_unavailable');
  }

  // Parse request body
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return err('Invalid JSON body', 400, 'invalid_body');
  }

  const tokenStr = body.token;
  if (!tokenStr || typeof tokenStr !== 'string') {
    return err('token is required', 400, 'missing_token');
  }

  // Derive public key and verify signature
  const publicKeyBytes = getPublicKey(signingKey);
  const claims = verifyJWT(tokenStr, publicKeyBytes);

  if (!claims) {
    // Invalid signature or malformed token
    return json({ active: false });
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    return json({ active: false });
  }

  // ── Revocation check (RFC-001 Phase 1) ───────────────────────────────
  // Check JTI-level revocation and account-level blanket revocation.
  // Fail-open: if KV is unavailable, proceed (prefer availability over security).
  try {
    if (await isTokenRevoked(c.env, claims.jti)) {
      return json({ active: false });
    }
    const accountRevokedSince = await getAccountRevocationTime(c.env, claims.sub);
    if (accountRevokedSince !== null && accountRevokedSince > claims.iat) {
      return json({ active: false });
    }
  } catch { /* fail-open — revocation check is best-effort */ }

  // ── Per-account verification rate limiting ────────────────────────────
  // Look up the issuing account's tier to determine the limit.
  // We do this before returning active:true so overlimit accounts can't bypass.
  const accountId = claims.sub;
  let accountTier = 'free';
  try {
    const keyHash = await c.env.KEYS.get('account:' + accountId);
    if (keyHash) {
      const accountRaw = await c.env.KEYS.get('key:' + keyHash);
      if (accountRaw) {
        const acct = JSON.parse(accountRaw) as { tier?: string };
        accountTier = acct.tier || 'free';
        // Lazy tier expiry check
        if (accountTier === 'paid') {
          const acctFull = acct as { tier_expires_at?: string };
          if (acctFull.tier_expires_at && new Date(acctFull.tier_expires_at) < new Date()) {
            accountTier = 'free';
          }
        }
      }
    }
  } catch {
    // Fail open: if we can't check the tier, default to free limits
  }

  const verifyCheck = await checkAndIncrementTokenVerify(c.env, accountId, accountTier);
  if (!verifyCheck.allowed) {
    // Return 402 with x402 payment requirements so agents can pay to continue
    const paymentHeader = c.req.raw.headers.get('X-PAYMENT');
    if (!paymentHeader) {
      return make402Response(SERVICE_PRICES.token_verify, {
        active: false,
        error: 'verification_limit_exceeded',
        message: `Monthly token verification limit reached (${verifyCheck.limit.toLocaleString()}/month on free tier). Upgrade at https://agentlair.dev/pricing or pay ${SERVICE_PRICES.token_verify.amount} atomic USDC via x402.`,
        used: verifyCheck.used,
        limit: verifyCheck.limit,
        upgrade_url: 'https://agentlair.dev/pricing',
        tier_limits: TOKEN_VERIFY_LIMITS,
      });
    }
    // x402 payment provided — verify and settle
    const { verifyX402Payment, settleX402Payment, trackX402Spend, autoUpgradeIfThreshold } = await import('../x402.js');
    const payment = await verifyX402Payment(paymentHeader, SERVICE_PRICES.token_verify);
    if (!payment.valid) {
      return new Response(JSON.stringify({
        active: false,
        error: 'payment_invalid',
        message: payment.error,
      }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Payment valid — settle and allow this verification (counter already incremented by checkAndIncrement if allowed)
    // Actually we need to allow it — re-check with the paid-bypass flag not possible, so just proceed
    // Note: counter was NOT incremented (allowed:false path). Increment now as one-off bypass.
    try {
      await settleX402Payment(paymentHeader, SERVICE_PRICES.token_verify);
      const spend = await trackX402Spend(c.env, accountId, SERVICE_PRICES.token_verify.amount, {
        payer: payment.payer,
        service: 'token_verify',
      });
      // Attempt auto-upgrade if cumulative spend threshold met
      try {
        const keyHash = await c.env.KEYS.get('account:' + accountId);
        if (keyHash) {
          const accountRaw = await c.env.KEYS.get('key:' + keyHash);
          if (accountRaw) {
            const acctObj = JSON.parse(accountRaw);
            await autoUpgradeIfThreshold(c.env, acctObj, spend);
          }
        }
      } catch { /* non-critical */ }
    } catch { /* non-critical — proceed with response */ }
    // Fall through to return active:true response with payment acknowledged
  }

  // Build RFC 7662 introspection response
  const response: Record<string, unknown> = {
    active: true,
    sub: claims.sub,
    iss: claims.iss,
    aud: claims.aud,
    exp: claims.exp,
    iat: claims.iat,
    jti: claims.jti,
    scope: claims.al_scopes.join(' '), // RFC 7662: space-separated string
    al_scopes: claims.al_scopes, // Convenience: array form
    al_audit_url: claims.al_audit_url,
  };

  if (claims.did) response.did = claims.did;
  if (claims.al_name) response.al_name = claims.al_name;
  if (claims.al_email) response.al_email = claims.al_email;

  return json(response);
});
