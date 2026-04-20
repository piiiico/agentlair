/**
 * @agentlair/verify — Type Definitions
 */

// ─── AAT Claims ───────────────────────────────────────────────────────────────

/**
 * Claims embedded in an AgentLair Agent Authentication Token (AAT).
 * These are decoded from the JWT payload after successful verification.
 */
export interface AATClaims {
  // Standard JWT claims (RFC 7519)
  iss: string;   // "https://agentlair.dev"
  sub: string;   // AgentLair account ID (e.g. "acc_abc123")
  aud: string;   // Target audience URL
  exp: number;   // Expiration (Unix seconds)
  iat: number;   // Issued at (Unix seconds)
  jti: string;   // Unique token ID (e.g. "aat_xyz789")

  // MCP-I Level 2 interop
  did?: string;  // e.g. "did:web:agentlair.dev:agents:acc_xxx"

  // AgentLair-specific claims
  al_name?: string;      // Agent's registered name
  al_email?: string;     // Agent's email (always @agentlair.dev)
  al_scopes: string[];   // Granted scopes
  al_audit_url: string;  // Audit trail link

  // Trust attestation (RFC-001 Phase 1)
  // Present when agent has >= 10 behavioral observations
  al_trust?: {
    score: number;       // [0, 100]
    level: 'intern' | 'junior' | 'senior' | 'principal';
    confidence: number;  // [0.0, 1.0]
    computed_at: string; // ISO 8601
    trend: 'improving' | 'stable' | 'declining';
  };
}

// ─── Verify Options ───────────────────────────────────────────────────────────

/**
 * Options for `verifyAAT`.
 */
export interface VerifyOptions {
  /**
   * JWKS endpoint URL.
   * @default "https://agentlair.dev/.well-known/jwks.json"
   */
  jwksUrl?: string;

  /**
   * Reject tokens older than this duration string (e.g. "1h", "30m").
   * If unset, only `exp` is checked (default JWT behavior).
   */
  maxAge?: string;

  /**
   * JWKS key cache TTL in milliseconds.
   * @default 300_000 (5 minutes)
   */
  cacheTtl?: number;

  /**
   * Additional claims that must be present and match exactly.
   * @example { iss: 'https://agentlair.dev' }
   */
  requiredClaims?: Partial<AATClaims>;

  /**
   * Expected `aud` (audience) claim value.
   * If set, tokens without a matching audience are rejected.
   */
  audience?: string;
}

// ─── Verify Result ────────────────────────────────────────────────────────────

/**
 * Result returned by `verifyAAT`.
 *
 * When `valid` is true, all other fields are populated.
 * When `valid` is false, only `error` is set.
 */
export type VerifyResult =
  | {
      valid: true;
      /** AgentLair account ID (`sub` claim, e.g. "acc_abc123") */
      agentId: string;
      /** Agent email address (`al_email` claim, e.g. "my-agent@agentlair.dev") */
      operatorEmail: string | undefined;
      /** Token issue time */
      issuedAt: Date;
      /** Token expiry time */
      expiresAt: Date;
      /** Granted scopes */
      scopes: string[];
      /** Full decoded claims for advanced use */
      claims: AATClaims;
    }
  | {
      valid: false;
      error: string;
    };

// ─── Middleware Options ───────────────────────────────────────────────────────

/**
 * Options for Express/Hono/Fastify middleware factories.
 */
export interface MiddlewareOptions extends VerifyOptions {
  /**
   * Where to find the token.
   * @default "header" (Authorization: Bearer <token>)
   */
  tokenFrom?: 'header' | 'query';

  /**
   * Query parameter name when tokenFrom is "query".
   * @default "token"
   */
  queryParam?: string;

  /**
   * Custom error handler. Return true to suppress default 401 response.
   */
  onError?: (error: string, context: unknown) => boolean | void;
}

// ─── Behavioral Event Types ───────────────────────────────────────────────────

export type EventCategory =
  | "tool"
  | "resource"
  | "auth"
  | "session"
  | "escalation"
  | "delegation"
  | "error";

export type EventResult = "success" | "failure" | "denied" | "timeout";

export interface BehavioralEvent {
  event_id: string;
  timestamp: string;
  category: EventCategory;
  action: string;
  result: EventResult;
  resource_type?: string;
  duration_ms?: number;
  error_code?: string;
  scope_used?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface EventSubmission {
  events: BehavioralEvent[];
  session_id?: string;
  sdk_version?: string;
}

export interface EventError {
  event_id: string;
  reason: "invalid_schema" | "duplicate" | "too_old" | "future_timestamp" | "rate_limited";
}

export interface EventSubmissionResponse {
  accepted: number;
  rejected: number;
  errors?: EventError[];
  rate_limit: {
    remaining: number;
    reset_at: string;
  };
}

export interface ReportOptions {
  /** AAT (Agent Authentication Token) for authentication */
  aat: string;
  /** AgentLair API base URL. @default "https://agentlair.dev" */
  baseUrl?: string;
  /** Optional session ID to group events */
  sessionId?: string;
  /** Max retries on 429 rate limiting. @default 2 */
  maxRetries?: number;
}

export interface BufferOptions extends ReportOptions {
  /** Flush when this many events accumulate. @default 50 */
  flushAt?: number;
  /** Flush every N milliseconds. @default 10_000 */
  flushInterval?: number;
  /** Called on flush errors (default: console.error) */
  onFlushError?: (error: Error) => void;
}

export interface EventBuffer {
  /** Add an event to the buffer. Auto-flushes when flushAt is reached. */
  add(event: BehavioralEvent): Promise<void>;
  /** Manually flush all buffered events now. Returns null if buffer is empty. */
  flush(): Promise<EventSubmissionResponse | null>;
  /** Destroy the buffer: flush remaining events and clear the interval timer. */
  destroy(): Promise<void>;
}
