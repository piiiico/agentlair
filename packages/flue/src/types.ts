/**
 * @agentlair/flue — Types
 *
 * Shared types for the AgentLair × Flue integration.
 */

// ─── AAT Context ──────────────────────────────────────────────────────────────

/**
 * A live AAT — token string plus decoded claims.
 * Issued per Flue agent session via AgentLair's /v1/tokens/issue endpoint.
 */
export interface AATContext {
  /** Raw JWT string — use as `Authorization: Bearer ${aal.token}` */
  token: string;
  /** Decoded JWT payload */
  claims: AATClaims;
  /** Convenience: bearer string ready to use as Authorization header value */
  bearer: string;
  /** Convenience: agent display name from `al_name` claim */
  name: string;
  /** Convenience: stable account ID from `sub` claim */
  accountId: string;
  /** Convenience: granted scopes from `al_scopes` claim */
  scopes: string[];
  /** Expiry time as Date */
  expiresAt: Date;
  /** Link to AgentLair audit trail for this token */
  auditUrl?: string;
}

/**
 * Decoded AAT JWT payload — all standard + AgentLair-specific claims.
 */
export interface AATClaims {
  /** Standard: issuer (`https://agentlair.dev`) */
  iss: string;
  /** Standard: subject = AgentLair account ID */
  sub: string;
  /** Standard: audience = target service URL */
  aud: string | string[];
  /** Standard: expiry (Unix timestamp) */
  exp: number;
  /** Standard: issued-at (Unix timestamp) */
  iat: number;
  /** Standard: JWT ID (unique token identifier, `aat_xxx`) */
  jti: string;
  /** AgentLair: agent display name */
  al_name: string;
  /** AgentLair: agent email (`<name>@agentlair.dev`) */
  al_email?: string;
  /** AgentLair: granted scopes */
  al_scopes?: string[];
  /** AgentLair: link to audit trail for this token */
  al_audit_url?: string;
}

// ─── Issue Options ────────────────────────────────────────────────────────────

/**
 * Options for issuing an AAT at session start.
 */
export interface IssueAATOptions {
  /**
   * AgentLair API key.
   * Recommended: pass via `env.AGENTLAIR_API_KEY` from Flue's env system.
   */
  apiKey: string;
  /**
   * Target audience for the token — typically your service URL.
   * Services verifying incoming AATs check this matches their own URL.
   */
  audience: string;
  /**
   * Scopes to request. Any `[a-z][a-z0-9._:-]*` pattern is accepted.
   * Common: 'mcp:tools:execute', 'email:send', 'vault:read', 'memory:write'
   * @default []
   */
  scopes?: string[];
  /**
   * TTL in seconds.
   * @default 3600 (1 hour)
   * @min 60
   * @max 86400
   */
  ttl?: number;
  /**
   * AgentLair API base URL.
   * @default "https://agentlair.dev"
   */
  baseUrl?: string;
}

// ─── Verify Options ───────────────────────────────────────────────────────────

/**
 * Options for verifying an incoming AAT from another agent.
 */
export interface VerifyAATOptions {
  /**
   * Expected audience. Tokens with a different `aud` claim are rejected.
   * Set to your service URL.
   */
  audience: string;
  /**
   * Expected issuer.
   * @default "https://agentlair.dev"
   */
  issuer?: string;
  /**
   * JWKS endpoint URL.
   * @default "https://agentlair.dev/.well-known/jwks.json"
   */
  jwksUrl?: string;
  /**
   * Required scopes — at least one must be present.
   * If empty, no scope check is performed.
   */
  requiredScopes?: string[];
  /**
   * Clock skew tolerance in seconds.
   * @default 60
   */
  clockSkewSeconds?: number;
}

/**
 * Result of a successful AAT verification.
 */
export interface VerifiedAgent {
  /** Stable account ID (`sub` claim) */
  accountId: string;
  /** Agent display name (`al_name` claim) */
  name: string;
  /** Agent email (`al_email` claim) */
  email?: string;
  /** Granted scopes */
  scopes: string[];
  /** Unique token ID — safe to log, never log the raw token */
  tokenRef: string;
  /** Link to audit trail */
  auditUrl?: string;
  /** Full decoded claims */
  claims: AATClaims;
}

// ─── Flue types (duck-typed, no hard dep on @flue/sdk) ────────────────────────

/**
 * Minimal FlueContext type — duck-typed so @agentlair/flue has no hard
 * dependency on @flue/sdk. The actual context passed at runtime will
 * extend this with additional Flue-internal properties.
 */
export interface FlueContext {
  /** Initialize the agent runtime */
  init: (options: FlueInitOptions) => Promise<FlueAgent>;
  /** Request payload */
  payload: Record<string, unknown>;
  /** Environment variables (secrets, API keys) */
  env: Record<string, string | undefined>;
}

export interface FlueInitOptions {
  model: string;
  id?: string;
  role?: string;
  tools?: unknown[];
  cwd?: string;
  sandbox?: unknown;
  [key: string]: unknown;
}

export interface FlueAgent {
  session: (threadId?: string) => Promise<FlueSession>;
}

export interface FlueSession {
  prompt: (message: string, options?: unknown) => Promise<unknown>;
  skill: (name: string, options?: unknown) => Promise<unknown>;
  task: (prompt: string, options?: unknown) => Promise<unknown>;
  shell: (command: string, options?: unknown) => Promise<unknown>;
}

// ─── withAgentLair options ────────────────────────────────────────────────────

/**
 * Options for the `withAgentLair` agent wrapper.
 */
export interface WithAgentLairOptions extends Omit<IssueAATOptions, 'apiKey'> {
  /**
   * How to find the API key. Options:
   * - string: explicit API key (not recommended in production)
   * - undefined: read from `env.AGENTLAIR_API_KEY` (recommended)
   */
  apiKey?: string;
}

/**
 * Extended FlueContext with AgentLair AAT context injected.
 */
export type FlueContextWithAAL<Env extends Record<string, string | undefined> = Record<string, string | undefined>> =
  Omit<FlueContext, 'env'> & {
    env: Env;
    /** AgentLair AAT context — token, claims, convenience helpers */
    aal: AATContext;
  };
