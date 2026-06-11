/**
 * @agentlair/verify — Security Finding Verification (v0.2.0)
 *
 * Verifies a signed security-finding JWT issued by `POST /v1/agents/:agentId/findings`
 * (or re-signed by `GET /v1/findings/:jti`) and classifies the submitting agent's
 * behavioral trust tier.
 *
 * Architecture notes:
 *  - Reuses the JWKS cache from `./jwks.ts` (same fetcher as `verifyAAT`).
 *  - Calls `jose.jwtVerify` directly (NOT `verifyAAT`) because finding JWTs lack
 *    the AAT-specific claims (`al_scopes`, `al_audit_url`) that `verifyAAT` enforces.
 *  - The error mapper here returns the discriminated `VerifyFindingErrorReason`
 *    enum so triagers can branch on machine-readable reasons.
 *  - `evidence_hash` is NOT verified against any external content — the SDK has
 *    no PoC fetcher. Programs that want to verify evidence MUST do it themselves.
 */

import { jwtVerify, errors as joseErrors } from 'jose';
import { getKeyResolver, DEFAULT_JWKS_URL, DEFAULT_CACHE_TTL } from './jwks.js';
import type {
  FindingClaims,
  FindingSeverity,
  TrackRecord,
  TrustTier,
  VerifyFindingErrorReason,
  VerifyFindingOptions,
  VerifyFindingResult,
} from './types.js';

const EXPECTED_ISSUER = 'https://agentlair.dev';
const VALID_SEVERITIES: readonly FindingSeverity[] = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
];

// Permalink URL: https://<host>/v1/findings/finding_<21 chars from nanoid alphabet>
const PERMALINK_URL_PATTERN =
  /^https:\/\/[^/]+\/v1\/findings\/(finding_[A-Za-z0-9_-]{21})$/;

// ─── Public surface ─────────────────────────────────────────────────────────

/**
 * Verify a signed security-finding JWT.
 *
 * Returns a discriminated union: `{ valid: true, ... }` or
 * `{ valid: false, error, reason }`.
 *
 * @example
 * ```typescript
 * import { verifyFinding } from '@agentlair/verify';
 *
 * const result = await verifyFinding(jwt, { audience: 'https://hackerone.com' });
 * if (result.valid) {
 *   console.log(result.agent.id, result.finding.severity, result.trustTier);
 * } else if (result.reason === 'audience_mismatch') {
 *   // re-prompt the operator…
 * }
 * ```
 */
export async function verifyFinding(
  tokenOrUrl: string,
  options: VerifyFindingOptions = {},
): Promise<VerifyFindingResult> {
  const {
    jwksUrl = DEFAULT_JWKS_URL,
    cacheTtl = DEFAULT_CACHE_TTL,
    audience,
    maxAge,
    requireFindingType = true,
    fetchPermalink = false,
  } = options;

  // Allow callers to pass a permalink URL when fetchPermalink=true.
  if (fetchPermalink && typeof tokenOrUrl === 'string' && /^https?:\/\//.test(tokenOrUrl)) {
    return verifyFindingPermalink(tokenOrUrl, options);
  }

  // Basic shape check before hitting the network.
  if (!tokenOrUrl || typeof tokenOrUrl !== 'string') {
    return mkErr('malformed', 'Token must be a non-empty string');
  }
  const parts = tokenOrUrl.split('.');
  if (parts.length !== 3) {
    return mkErr(
      'malformed',
      'Malformed token: expected 3-part JWT (header.payload.signature)',
    );
  }

  try {
    const getKey = getKeyResolver(jwksUrl, cacheTtl);

    const jwtOptions: Parameters<typeof jwtVerify>[2] = {
      algorithms: ['EdDSA'],
      issuer: EXPECTED_ISSUER,
    };
    if (audience !== undefined) {
      jwtOptions.audience = audience;
    }
    if (maxAge) {
      jwtOptions.maxTokenAge = maxAge;
    }

    const { payload } = await jwtVerify(tokenOrUrl, getKey, jwtOptions);
    const claims = payload as unknown as FindingClaims;

    return assembleResult(claims, { requireFindingType });
  } catch (err) {
    return mapJoseError(err);
  }
}

/**
 * Fetch an AgentLair finding permalink, extract the embedded `signed_jwt`,
 * and run it through `verifyFinding`. One call for callers (HackerOne forms,
 * etc.) that have only the public URL.
 *
 * Additionally double-checks that the JWT's `jti` matches the URL segment —
 * catches a class of bug where a triager pastes a JSON-body `jti` alongside
 * a swapped JWT.
 *
 * @example
 * ```typescript
 * import { verifyFindingPermalink } from '@agentlair/verify';
 *
 * const result = await verifyFindingPermalink(
 *   'https://agentlair.dev/v1/findings/finding_abc...',
 *   { audience: 'https://hackerone.com' },
 * );
 * ```
 */
export async function verifyFindingPermalink(
  url: string,
  options: VerifyFindingOptions = {},
): Promise<VerifyFindingResult> {
  if (!url || typeof url !== 'string') {
    return mkErr('invalid_url', 'Permalink URL must be a non-empty string');
  }
  const urlMatch = PERMALINK_URL_PATTERN.exec(url);
  if (!urlMatch) {
    return mkErr(
      'invalid_url',
      `URL does not match expected pattern https://<host>/v1/findings/finding_<21 chars>: ${url}`,
    );
  }
  const expectedJti = urlMatch[1]!;

  // Fetch the permalink response. Non-200, network errors, and non-JSON all
  // map to `fetch_failed` (the resource was unreachable / unusable).
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    return mkErr(
      'fetch_failed',
      `Failed to fetch finding permalink: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    return mkErr(
      'fetch_failed',
      `Finding permalink returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  let body: { jti?: unknown; signed_jwt?: unknown };
  try {
    body = (await response.json()) as { jti?: unknown; signed_jwt?: unknown };
  } catch (err) {
    return mkErr(
      'fetch_failed',
      `Finding permalink body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const signedJwt = typeof body.signed_jwt === 'string' ? body.signed_jwt : '';
  if (!signedJwt) {
    return mkErr(
      'fetch_failed',
      'Finding permalink response missing string field "signed_jwt"',
    );
  }

  // Body-level jti vs URL — quick smoke check before signature verification.
  if (typeof body.jti === 'string' && body.jti !== expectedJti) {
    return mkErr(
      'malformed',
      `jti mismatch between URL ("${expectedJti}") and response body ("${body.jti}")`,
    );
  }

  // Verify the JWT itself. Force fetchPermalink off so we don't recurse if the
  // signed_jwt is itself a URL-shaped string (it won't be, but be defensive).
  const innerOptions: VerifyFindingOptions = { ...options, fetchPermalink: false };
  const result = await verifyFinding(signedJwt, innerOptions);
  if (!result.valid) return result;

  // Final assertion: signed JWT's `jti` matches the URL.
  if (result.jti !== expectedJti) {
    return mkErr(
      'malformed',
      `jti mismatch between URL ("${expectedJti}") and signed JWT ("${result.jti}")`,
    );
  }
  return result;
}

/**
 * Map a (possibly partial) `TrackRecord` to a behavioral trust tier.
 *
 * Defaults pinned in the spec:
 *
 * | Tier     | findings_submitted | valid_rate | false_positive_rate | avg_severity |
 * |----------|-------------------:|-----------:|--------------------:|-------------:|
 * | unranked | < 10               | —          | —                   | —            |
 * | junior   | 10–49              | ≥ 0.5      | —                   | —            |
 * | senior   | ≥ 50               | ≥ 0.7      | < 0.15              | —            |
 * | elite    | ≥ 200              | ≥ 0.85     | —                   | ≥ 7.0        |
 *
 * Order of evaluation: elite → senior → junior → unranked. Missing
 * `track_record` → `unranked`. Programs that want a different policy should
 * ignore `result.trustTier` and read `result.agent.track_record` directly.
 */
export function classifyTrustTier(track_record?: TrackRecord): TrustTier {
  if (!track_record || typeof track_record !== 'object') {
    return 'unranked';
  }
  const {
    findings_submitted,
    valid_rate,
    false_positive_rate,
    avg_severity,
  } = track_record;

  if (typeof findings_submitted !== 'number' || !Number.isFinite(findings_submitted)) {
    return 'unranked';
  }

  // elite
  if (
    findings_submitted >= 200 &&
    typeof valid_rate === 'number' && valid_rate >= 0.85 &&
    typeof avg_severity === 'number' && avg_severity >= 7.0
  ) {
    return 'elite';
  }
  // senior
  if (
    findings_submitted >= 50 &&
    typeof valid_rate === 'number' && valid_rate >= 0.7 &&
    typeof false_positive_rate === 'number' && false_positive_rate < 0.15
  ) {
    return 'senior';
  }
  // junior
  if (
    findings_submitted >= 10 && findings_submitted < 50 &&
    typeof valid_rate === 'number' && valid_rate >= 0.5
  ) {
    return 'junior';
  }
  return 'unranked';
}

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * Validate post-signature claims and assemble the success result.
 *
 * At entry the JWT signature, `iss`, `aud` (if set), and `maxAge` (if set)
 * are already validated by `jwtVerify`.
 */
function assembleResult(
  claims: FindingClaims,
  opts: { requireFindingType: boolean },
): VerifyFindingResult {
  if (opts.requireFindingType) {
    if (claims.type !== 'security_finding') {
      return mkErr(
        'wrong_type',
        `Expected claims.type === "security_finding", got ${JSON.stringify(claims.type)}`,
      );
    }
  }

  // Required AgentLair claims on a finding JWT.
  if (typeof claims.sub !== 'string' || !claims.sub) {
    return mkErr('missing_required_fields', 'Token missing required claim: sub');
  }
  if (typeof claims.iss !== 'string' || !claims.iss) {
    return mkErr('missing_required_fields', 'Token missing required claim: iss');
  }
  if (typeof claims.jti !== 'string' || !claims.jti) {
    return mkErr('missing_required_fields', 'Token missing required claim: jti');
  }
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) {
    return mkErr('missing_required_fields', 'Token missing required claim: iat');
  }

  // Finding body — only present when type === 'security_finding'.
  // When requireFindingType=false the caller has opted into AAT-style tokens
  // and we still enforce the body, since `verifyFinding` is finding-specific.
  const finding = claims.finding;
  if (!finding || typeof finding !== 'object') {
    return mkErr('missing_required_fields', 'Token missing required claim: finding');
  }
  if (typeof finding.title !== 'string' || !finding.title) {
    return mkErr('missing_required_fields', 'Token missing required field: finding.title');
  }
  if (
    typeof finding.severity !== 'string' ||
    !(VALID_SEVERITIES as readonly string[]).includes(finding.severity)
  ) {
    return mkErr(
      'missing_required_fields',
      `Token has invalid finding.severity: ${JSON.stringify(finding.severity)}`,
    );
  }
  if (typeof finding.target !== 'string' || !finding.target) {
    return mkErr('missing_required_fields', 'Token missing required field: finding.target');
  }
  if (typeof finding.evidence_hash !== 'string' || !finding.evidence_hash) {
    return mkErr(
      'missing_required_fields',
      'Token missing required field: finding.evidence_hash',
    );
  }

  const trackRecord = isTrackRecord(claims.track_record) ? claims.track_record : undefined;

  return {
    valid: true,
    agent: {
      id: claims.sub,
      ...(typeof claims.agent_name === 'string' ? { name: claims.agent_name } : {}),
      ...(typeof claims.behavioral_score === 'number'
        ? { behavioral_score: claims.behavioral_score }
        : {}),
      ...(trackRecord ? { track_record: trackRecord } : {}),
    },
    finding: {
      title: finding.title,
      severity: finding.severity as FindingSeverity,
      ...(typeof finding.cwe === 'string' ? { cwe: finding.cwe } : {}),
      target: finding.target,
      evidence_hash: finding.evidence_hash,
      ...(typeof finding.evidence_url === 'string'
        ? { evidence_url: finding.evidence_url }
        : {}),
      ...(Array.isArray(finding.tools_used) ? { tools_used: finding.tools_used } : {}),
      ...(typeof finding.time_to_find_ms === 'number'
        ? { time_to_find_ms: finding.time_to_find_ms }
        : {}),
    },
    trustTier: classifyTrustTier(trackRecord),
    jti: claims.jti,
    issuedAt: new Date(claims.iat * 1000),
    claims,
  };
}

function isTrackRecord(value: unknown): value is TrackRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.findings_submitted === 'number';
}

function mkErr(
  reason: VerifyFindingErrorReason,
  error: string,
): VerifyFindingResult {
  return { valid: false, reason, error };
}

/**
 * Finding-specific mapping of jose errors → `VerifyFindingErrorReason`.
 * Distinct from `verify.ts::formatError` because:
 *   (a) we return a discriminated reason field, not just an error string;
 *   (b) audience mismatch on a finding is more common (programs run their own
 *       audiences) and deserves a dedicated reason.
 */
function mapJoseError(err: unknown): VerifyFindingResult {
  if (err instanceof joseErrors.JWTExpired) {
    return mkErr(
      'expired',
      `Token expired at ${
        err.payload?.exp
          ? new Date((err.payload.exp as number) * 1000).toISOString()
          : 'unknown time'
      }`,
    );
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    if (err.claim === 'aud') {
      return mkErr('audience_mismatch', `Audience claim mismatch: ${err.reason}`);
    }
    if (err.claim === 'iat') {
      // jose throws JWTClaimValidationFailed for maxTokenAge breaches.
      return mkErr('expired', `Token age exceeded: ${err.reason}`);
    }
    return mkErr(
      'missing_required_fields',
      `Invalid claim "${err.claim}": ${err.reason}`,
    );
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return mkErr(
      'signature_invalid',
      'Signature verification failed: token may be tampered or signed with wrong key',
    );
  }
  if (err instanceof joseErrors.JWKSNoMatchingKey) {
    return mkErr(
      'signature_invalid',
      'No matching key in JWKS: key ID not found or key has been rotated',
    );
  }
  if (err instanceof joseErrors.JWKSMultipleMatchingKeys) {
    return mkErr(
      'signature_invalid',
      'Multiple matching keys found in JWKS — key ID ambiguity',
    );
  }
  if (err instanceof joseErrors.JWTInvalid) {
    return mkErr('malformed', `Invalid JWT: ${err.message}`);
  }
  // JWSInvalid covers shape problems (non-base64 header/payload, missing alg).
  // joseErrors.JWSInvalid exists in jose v5+ — guard with optional access for
  // forward-compat with bundlers that tree-shake unused error classes.
  const JWSInvalidCtor = (joseErrors as unknown as { JWSInvalid?: typeof Error })
    .JWSInvalid;
  if (JWSInvalidCtor && err instanceof JWSInvalidCtor) {
    return mkErr('malformed', `Invalid JWS: ${(err as Error).message}`);
  }
  if (err instanceof joseErrors.JOSEError) {
    return mkErr('signature_invalid', err.message);
  }
  if (err instanceof Error) {
    if (
      err.message.includes('fetch') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('ECONNREFUSED')
    ) {
      return mkErr('signature_invalid', `Failed to fetch JWKS: ${err.message}`);
    }
    return mkErr('signature_invalid', err.message);
  }
  return mkErr('signature_invalid', 'Unknown verification error');
}
