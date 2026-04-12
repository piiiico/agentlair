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
 *   "audit_url": "https://agentlair.dev/v1/audit/aat_xyz789"
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

  const claims: AATClaims = {
    iss: ISSUER,
    sub: account.id,
    aud: audience,
    exp: now + ttl,
    iat: now,
    jti,
    al_scopes: scopes as string[],
    al_audit_url: `${ISSUER}/v1/audit/${jti}`,
  };

  if (agentName) claims.al_name = agentName;
  if (agentEmail) claims.al_email = agentEmail;

  // ── Sign JWT ───────────────────────────────────────────────────────────
  const publicKeyBytes = getPublicKey(signingKey);
  const kid = await computeKeyId(publicKeyBytes);
  const token = createJWT(claims, signingKey, kid);

  const expiresAt = new Date((now + ttl) * 1000).toISOString();

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
 *   "al_audit_url": "https://agentlair.dev/v1/audit/aat_xyz789",
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

  if (claims.al_name) response.al_name = claims.al_name;
  if (claims.al_email) response.al_email = claims.al_email;

  return json(response);
});
