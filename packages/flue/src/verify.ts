/**
 * @agentlair/flue — Incoming AAT Verification
 *
 * Verifies Agent Authentication Tokens (AATs) sent BY other agents
 * TO your Flue webhook endpoint.
 *
 * Uses jose for Ed25519 verification against AgentLair's public JWKS.
 * JWKS keys are cached for 5 minutes to avoid repeated network calls.
 */

import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import type { VerifiedAgent, VerifyAATOptions, AATClaims } from './types.js';

// ─── JWKS cache ───────────────────────────────────────────────────────────────

type JWKSFetcher = ReturnType<typeof createRemoteJWKSet>;

interface CacheEntry {
  fetcher: JWKSFetcher;
  createdAt: number;
}

const jwksCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getJWKSFetcher(jwksUrl: string): JWKSFetcher {
  const cached = jwksCache.get(jwksUrl);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.fetcher;
  }
  const fetcher = createRemoteJWKSet(new URL(jwksUrl));
  jwksCache.set(jwksUrl, { fetcher, createdAt: Date.now() });
  return fetcher;
}

/** Clear the JWKS cache — useful after key rotation. */
export function clearJWKSCache(): void {
  jwksCache.clear();
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify an incoming AAT from another agent.
 *
 * Use this in Flue webhook handlers to authenticate callers before
 * executing sensitive operations.
 *
 * @example
 * ```typescript
 * // .flue/agents/my-service.ts
 * export const triggers = { webhook: true };
 *
 * export default async function ({ init, payload, env }: FlueContext) {
 *   // Verify the calling agent's identity
 *   const caller = await verifyIncomingAAT(
 *     payload.headers?.authorization as string,
 *     {
 *       audience: 'https://my-service.com',
 *       requiredScopes: ['mcp:tools:execute'],
 *     }
 *   );
 *
 *   console.log(`Request from agent: ${caller.name} (${caller.accountId})`);
 *
 *   const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });
 *   const session = await agent.session();
 *   return await session.prompt(payload.message as string);
 * }
 * ```
 *
 * @throws If token is missing, malformed, expired, or fails scope check.
 */
export async function verifyIncomingAAT(
  authHeaderOrToken: string | undefined | null,
  options: VerifyAATOptions,
): Promise<VerifiedAgent> {
  if (!authHeaderOrToken) {
    throw new Error('No Authorization header present');
  }

  // Strip "Bearer " prefix if present
  const token = authHeaderOrToken.startsWith('Bearer ')
    ? authHeaderOrToken.slice(7)
    : authHeaderOrToken;

  const jwksUrl =
    options.jwksUrl ?? 'https://agentlair.dev/.well-known/jwks.json';
  const issuer = options.issuer ?? 'https://agentlair.dev';
  const clockSkewSeconds = options.clockSkewSeconds ?? 60;

  const JWKS = getJWKSFetcher(jwksUrl);

  let payload: AATClaims;
  try {
    const result = await jwtVerify(token, JWKS, {
      issuer,
      audience: options.audience,
      clockTolerance: clockSkewSeconds,
      algorithms: ['EdDSA'],
    });
    payload = result.payload as unknown as AATClaims;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new Error('AAT has expired');
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      throw new Error(`AAT claim validation failed: ${err.message}`);
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new Error('AAT signature verification failed');
    }
    throw new Error(`AAT verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Scope check — at least one required scope must be present
  if (options.requiredScopes && options.requiredScopes.length > 0) {
    const agentScopes = payload.al_scopes ?? [];
    const hasScope =
      agentScopes.includes('*') ||
      options.requiredScopes.some((s) => agentScopes.includes(s));
    if (!hasScope) {
      throw new Error(
        `Agent missing required scopes. Has: [${agentScopes.join(', ')}]. Needs one of: [${options.requiredScopes.join(', ')}]`,
      );
    }
  }

  return {
    accountId: payload.sub,
    name: payload.al_name,
    email: payload.al_email,
    scopes: payload.al_scopes ?? [],
    tokenRef: payload.jti,
    auditUrl: payload.al_audit_url,
    claims: payload,
  };
}
