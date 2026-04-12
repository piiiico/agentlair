/**
 * @agentlair/mastra — Type definitions
 *
 * Types for AgentLair agent identity, trust scoring, and trust-gated execution.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

export interface AgentLairConfig {
  /**
   * AgentLair API base URL.
   * @default "https://agentlair.dev"
   */
  baseUrl?: string;

  /**
   * AgentLair API key for authenticated requests (al_live_...).
   * Required for trust scoring and observation APIs.
   */
  apiKey?: string;

  /**
   * JWKS endpoint URL for fetching AgentLair signing public keys.
   * @default "{baseUrl}/.well-known/jwks.json"
   */
  jwksUrl?: string;

  /**
   * Maximum age (in seconds) for cached JWKS keys.
   * @default 3600
   */
  jwksCacheTtl?: number;
}

// ─── Agent Identity (AAT Claims) ─────────────────────────────────────────────

/**
 * AgentLair Agent Token (AAT) claims — decoded from an EdDSA-signed JWT.
 *
 * Verifiable at runtime via the JWKS endpoint at agentlair.dev/.well-known/jwks.json.
 */
export interface AATClaims {
  /** Issuer — always "https://agentlair.dev" */
  iss: string;
  /** Subject — AgentLair account ID */
  sub: string;
  /** Audience — target service URL */
  aud: string;
  /** Expiration time (Unix seconds) */
  exp: number;
  /** Issued at (Unix seconds) */
  iat: number;
  /** Unique token ID */
  jti: string;

  /** Agent's registered display name */
  al_name?: string;
  /** Agent's @agentlair.dev email address */
  al_email?: string;
  /** Granted scopes */
  al_scopes: string[];
  /** URL to the agent's audit trail */
  al_audit_url: string;
}

// ─── Trust Scoring ───────────────────────────────────────────────────────────

/**
 * Trust score for an agent, computed from behavioral telemetry.
 *
 * Score range: 0–1000. Breakdown by category provides transparency
 * into which behavioral signals drive the score.
 */
export interface TrustScore {
  /** Agent account ID */
  agentId: string;
  /** Overall trust score (0–1000) */
  score: number;
  /** Trust tier derived from score */
  tier: 'untrusted' | 'provisional' | 'trusted' | 'verified';
  /** Category breakdown */
  breakdown: TrustBreakdown;
  /** ISO timestamp of last score computation */
  computedAt: string;
  /** Number of observations used in scoring */
  observationCount: number;
}

export interface TrustBreakdown {
  /** Adherence to declared behavior patterns (0–250) */
  behavioral: number;
  /** Consistency of actions over time (0–250) */
  consistency: number;
  /** Quality of interactions with other agents (0–250) */
  reputation: number;
  /** Audit trail completeness and transparency (0–250) */
  transparency: number;
}

/**
 * Result of a trust gate check.
 */
export interface TrustGateResult {
  /** Whether the agent passed the trust gate */
  allowed: boolean;
  /** Current trust score (if available) */
  score?: number;
  /** Current trust tier */
  tier?: TrustScore['tier'];
  /** Reason for denial (when allowed=false) */
  reason?: string;
  /** Minimum score required by this gate */
  requiredScore: number;
}

// ─── Verified Agent Context ──────────────────────────────────────────────────

/**
 * Verified agent identity — available in Mastra's request context
 * after AgentLairAuth middleware runs.
 */
export interface VerifiedAgent {
  /** AgentLair account ID (from JWT sub claim) */
  accountId: string;
  /** Agent display name */
  name?: string;
  /** Agent email address */
  email?: string;
  /** Granted scopes */
  scopes: string[];
  /** Audit trail URL */
  auditUrl: string;
  /** Trust score (populated if trust lookup succeeded) */
  trustScore?: TrustScore;
  /** Raw JWT token */
  token: string;
  /** Decoded JWT claims */
  claims: AATClaims;
}

// ─── JWK types ───────────────────────────────────────────────────────────────

export interface JWK {
  kty: string;
  crv?: string;
  x?: string;
  kid: string;
  use?: string;
  alg?: string;
}

export interface JWKS {
  keys: JWK[];
}
