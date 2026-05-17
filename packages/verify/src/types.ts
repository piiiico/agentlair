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

// ─── Finding Types (v0.2.0) ──────────────────────────────────────────────────

/**
 * Severity of a security finding (matches the worker's persisted set).
 */
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/**
 * Behavioral trust tier derived from a `TrackRecord`.
 *
 * Defaults (per `classifyTrustTier`):
 *  - `unranked` — fewer than 10 findings submitted, or no track record
 *  - `junior`   — 10–49 findings, valid_rate ≥ 0.5
 *  - `senior`   — ≥ 50 findings, valid_rate ≥ 0.7, false_positive_rate < 0.15
 *  - `elite`    — ≥ 200 findings, valid_rate ≥ 0.85, avg_severity ≥ 7.0
 *
 * Evaluation order: elite → senior → junior → unranked.
 */
export type TrustTier = 'unranked' | 'junior' | 'senior' | 'elite';

/**
 * A behavioral track record carried inside a finding JWT's `agent.track_record`.
 *
 * `valid_rate` and `false_positive_rate` are expressed in [0, 1].
 * `avg_severity` is a numeric severity score (e.g. CRITICAL=10, HIGH=8…).
 */
export interface TrackRecord {
  /** Total findings the agent has ever submitted. */
  findings_submitted: number;
  /** Fraction of submitted findings the receiving program marked as valid. [0,1] */
  valid_rate?: number;
  /** Fraction of submitted findings flagged as false-positives by the program. [0,1] */
  false_positive_rate?: number;
  /** Mean severity (numeric) across the agent's confirmed findings. */
  avg_severity?: number;
}

/**
 * Decoded claims of a security-finding JWT (post-signature-verification).
 *
 * Matches the worker's `buildFindingClaims` shape (packages/worker/src/routes/findings.ts).
 */
export interface FindingClaims {
  // Standard JWT
  iss: string;          // "https://agentlair.dev"
  sub: string;          // AgentLair account ID — the agent that filed the finding
  aud: string | string[]; // Target audience (program URI). Default 'https://agentlair.dev'.
  iat: number;          // Issued-at (Unix seconds)
  jti: string;          // "finding_<21-char-nanoid>"
  type: 'security_finding';

  // Optional agent name (display)
  agent_name?: string;

  // Finding body
  finding: {
    title: string;
    severity: FindingSeverity;
    cwe?: string;
    target: string;
    evidence_hash: string;
    evidence_url?: string;
    tools_used?: string[];
    time_to_find_ms?: number;
  };

  // Optional trust attestation snapshot (cold-start agents omit it)
  behavioral_score?: number;
  trust?: {
    level: string;
    confidence: number | null;
  };

  // Optional track record — feeds classifyTrustTier()
  track_record?: TrackRecord;

  // Forward-compatible passthrough
  [key: string]: unknown;
}

/**
 * Discriminated machine-readable error reasons for `verifyFinding`/`verifyFindingPermalink`.
 *
 * Triagers should switch on `result.reason` (not `result.error`) for recovery paths.
 */
export type VerifyFindingErrorReason =
  | 'malformed'              // Not a valid JWT shape, or jti/URL mismatch on permalink path
  | 'signature_invalid'      // JWKS or signature check failed
  | 'wrong_type'             // Verified, but `type !== 'security_finding'` and requireFindingType=true
  | 'missing_required_fields'// type ok, but required fields missing (sub/iss/jti/finding.*)
  | 'expired'                // `maxAge` set and exceeded
  | 'audience_mismatch'      // `audience` set and `aud` doesn't match
  | 'fetch_failed'           // verifyFindingPermalink network/non-200
  | 'invalid_url';           // fetchPermalink=true and URL didn't match the expected pattern

/**
 * Options for `verifyFinding` and `verifyFindingPermalink`.
 *
 * Inherits JWKS plumbing (`jwksUrl`, `cacheTtl`) and `maxAge` from `VerifyOptions`.
 * The `audience` field is widened to also accept a string array.
 */
export interface VerifyFindingOptions
  extends Omit<VerifyOptions, 'audience' | 'requiredClaims'> {
  /**
   * Expected `aud` claim. Pass an array to allow several caller identities
   * (e.g. `['https://hackerone.com', 'https://agentlair.dev']`).
   * If unset, no audience check is performed.
   */
  audience?: string | string[];

  /**
   * Reject finding JWTs whose claims don't include `type: 'security_finding'`.
   * @default true
   */
  requireFindingType?: boolean;

  /**
   * Only meaningful on `verifyFinding`: if the input value isn't a JWT (3 dots)
   * and looks like a `https://.../v1/findings/finding_...` URL, fetch the
   * permalink first and verify the embedded `signed_jwt`.
   *
   * Always-on inside `verifyFindingPermalink`.
   * @default false
   */
  fetchPermalink?: boolean;
}

/**
 * Result of `verifyFinding` / `verifyFindingPermalink`.
 *
 * Discriminated union on `valid: true | false`. On failure, only `error`
 * (human-readable) and `reason` (machine-readable enum) are populated.
 */
export type VerifyFindingResult =
  | {
      valid: true;
      /** Agent identity + optional trust signals. */
      agent: {
        /** AgentLair account ID (`sub` claim). */
        id: string;
        /** Agent's display name, if the finding carries one. */
        name?: string;
        /** Behavioral score [0,100] at the time the finding was signed. */
        behavioral_score?: number;
        /** Raw track-record passthrough — programs can apply their own classifier. */
        track_record?: TrackRecord;
      };
      /** Finding body (all required-by-spec fields are non-optional here). */
      finding: {
        title: string;
        severity: FindingSeverity;
        cwe?: string;
        target: string;
        evidence_hash: string;
        evidence_url?: string;
        tools_used?: string[];
        time_to_find_ms?: number;
      };
      /** Behavioral trust tier (per `classifyTrustTier`). */
      trustTier: TrustTier;
      /** Finding ID — `finding_<21-char-nanoid>`. */
      jti: string;
      /** Issue time. */
      issuedAt: Date;
      /** Full decoded claims for advanced use. */
      claims: FindingClaims;
    }
  | {
      valid: false;
      /** Human-readable explanation. */
      error: string;
      /** Machine-readable failure class — switch on this in triager UIs. */
      reason: VerifyFindingErrorReason;
    };
