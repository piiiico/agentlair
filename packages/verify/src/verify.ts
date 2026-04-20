/**
 * @agentlair/verify — Core verification logic
 */

import { jwtVerify, errors as joseErrors } from 'jose';
import { getKeyResolver, DEFAULT_JWKS_URL, DEFAULT_CACHE_TTL } from './jwks.js';
import type { AATClaims, VerifyOptions, VerifyResult } from './types.js';

// Expected issuer — all AgentLair tokens use this
const EXPECTED_ISSUER = 'https://agentlair.dev';

/**
 * Verify an AgentLair Agent Authentication Token (AAT).
 *
 * Fetches the JWKS from agentlair.dev (cached), verifies the EdDSA
 * signature, and validates standard JWT claims (exp, iss, aud, iat).
 *
 * Zero-config — all options have sensible defaults.
 *
 * @example Basic usage
 * ```typescript
 * import { verifyAAT } from '@agentlair/verify';
 *
 * const result = await verifyAAT(token);
 * if (result.valid) {
 *   console.log('Agent:', result.agentId);
 *   console.log('Scopes:', result.scopes);
 * } else {
 *   console.error('Rejected:', result.error);
 * }
 * ```
 *
 * @example With audience check
 * ```typescript
 * const result = await verifyAAT(token, {
 *   audience: 'https://my-service.example.com',
 * });
 * ```
 */
export async function verifyAAT(
  token: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const {
    jwksUrl = DEFAULT_JWKS_URL,
    cacheTtl = DEFAULT_CACHE_TTL,
    audience,
    maxAge,
    requiredClaims,
  } = options;

  // Basic structure check before hitting the network
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token must be a non-empty string' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token: expected 3-part JWT (header.payload.signature)' };
  }

  try {
    const getKey = getKeyResolver(jwksUrl, cacheTtl);

    const jwtOptions: Parameters<typeof jwtVerify>[2] = {
      algorithms: ['EdDSA'],
      issuer: EXPECTED_ISSUER,
    };

    if (audience) {
      jwtOptions.audience = audience;
    }

    if (maxAge) {
      jwtOptions.maxTokenAge = maxAge;
    }

    const { payload } = await jwtVerify(token, getKey, jwtOptions);
    const claims = payload as unknown as AATClaims;

    // Validate required AgentLair-specific claims
    if (!claims.sub) {
      return { valid: false, error: 'Token missing required claim: sub' };
    }
    if (!claims.al_scopes || !Array.isArray(claims.al_scopes)) {
      return { valid: false, error: 'Token missing required claim: al_scopes' };
    }
    if (!claims.al_audit_url) {
      return { valid: false, error: 'Token missing required claim: al_audit_url' };
    }

    // Check any extra required claims
    if (requiredClaims) {
      for (const [key, expected] of Object.entries(requiredClaims)) {
        const actual = (claims as unknown as Record<string, unknown>)[key];
        if (actual !== expected) {
          return {
            valid: false,
            error: `Required claim mismatch: "${key}" expected "${String(expected)}", got "${String(actual)}"`,
          };
        }
      }
    }

    return {
      valid: true,
      agentId: claims.sub,
      operatorEmail: claims.al_email,
      issuedAt: new Date(claims.iat * 1000),
      expiresAt: new Date(claims.exp * 1000),
      scopes: claims.al_scopes,
      claims,
    };
  } catch (err) {
    return { valid: false, error: formatError(err) };
  }
}

/**
 * Turn jose errors into clear human-readable messages.
 */
function formatError(err: unknown): string {
  if (err instanceof joseErrors.JWTExpired) {
    return `Token expired at ${err.payload?.exp ? new Date((err.payload.exp as number) * 1000).toISOString() : 'unknown time'}`;
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    return `Invalid claim "${err.claim}": ${err.reason}`;
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return 'Signature verification failed: token may be tampered or signed with wrong key';
  }
  if (err instanceof joseErrors.JWKSNoMatchingKey) {
    return 'No matching key in JWKS: key ID not found or key has been rotated';
  }
  if (err instanceof joseErrors.JWKSMultipleMatchingKeys) {
    return 'Multiple matching keys found in JWKS — key ID ambiguity';
  }
  if (err instanceof joseErrors.JWTInvalid) {
    return `Invalid JWT: ${err.message}`;
  }
  if (err instanceof Error) {
    // Check for network errors (JWKS fetch failure)
    if (err.message.includes('fetch') || err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
      return `Failed to fetch JWKS: ${err.message}`;
    }
    return err.message;
  }
  return 'Unknown verification error';
}
