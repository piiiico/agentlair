// ---------------------------------------------------------------------------
// @agentlair/agent-framework — Type Definitions
// ---------------------------------------------------------------------------

/** Trust tier derived from behavioral score (0–1000). */
export type TrustTier = "untrusted" | "provisional" | "trusted" | "verified";

/** Map a numeric score (0–1000) to a tier. */
export function scoreTier(score: number): TrustTier {
  if (score >= 800) return "verified";
  if (score >= 500) return "trusted";
  if (score >= 200) return "provisional";
  return "untrusted";
}

/** Breakdown of a trust score into behavioral dimensions. */
export interface TrustBreakdown {
  behavioral: number;   // 0–250: declared behavior adherence
  consistency: number;  // 0–250: action stability over time
  reputation: number;   // 0–250: quality of agent interactions
  transparency: number; // 0–250: audit trail completeness
}

/** Full trust score as returned by AgentLair. */
export interface TrustScore {
  agentId: string;
  score: number;
  tier: TrustTier;
  breakdown: TrustBreakdown;
  computedAt: string;
  observationCount: number;
}

/** Agent Authentication Token (AAT) JWT claims. */
export interface AATClaims {
  iss: string;         // "https://agentlair.dev"
  sub: string;         // Agent account ID
  aud: string;         // Target service URL
  exp: number;         // Expiration (Unix seconds)
  iat: number;         // Issued at (Unix seconds)
  jti: string;         // Unique token ID
  al_name?: string;    // Agent display name
  al_email?: string;   // @agentlair.dev email
  al_scopes: string[]; // Granted scopes
  al_audit_url: string; // Audit trail URL
}

/** Verified agent identity after AAT validation. */
export interface VerifiedAgent {
  accountId: string;
  name?: string;
  email?: string;
  scopes: string[];
  auditUrl: string;
  trustScore?: TrustScore;
  token: string;
  claims: AATClaims;
}

// ---------------------------------------------------------------------------
// Microsoft Agent Framework types (duck-typed, no hard dependency)
// ---------------------------------------------------------------------------

/** Minimal interface for a function invocation context (Semantic Kernel heritage). */
export interface FunctionInvocationContext {
  /** The function/tool being invoked. */
  functionName: string;
  /** The plugin or namespace the function belongs to. */
  pluginName?: string;
  /** Input arguments to the function. */
  arguments: Record<string, unknown>;
  /** Result of the function (populated after execution). */
  result?: unknown;
  /** Whether the invocation was cancelled by a filter. */
  cancelled?: boolean;
  /** Reason for cancellation. */
  cancelReason?: string;
  /** Metadata bag for passing data between filters. */
  metadata: Record<string, unknown>;
}

/** A filter function that runs before/after function invocation. */
export type FunctionInvocationFilter = (
  context: FunctionInvocationContext,
  next: () => Promise<void>,
) => Promise<void>;

/** A2A Task object (simplified from A2A v1.0 spec). */
export interface A2ATask {
  id: string;
  sessionId?: string;
  status: {
    state: "submitted" | "working" | "input-required" | "completed" | "canceled" | "failed";
    message?: A2AMessage;
  };
  artifacts?: A2AArtifact[];
  metadata?: Record<string, unknown>;
}

/** A2A Message within a task. */
export interface A2AMessage {
  role: "user" | "agent";
  parts: Array<{
    type: "text" | "data" | "file";
    text?: string;
    data?: Record<string, unknown>;
    mimeType?: string;
  }>;
  metadata?: Record<string, unknown>;
}

/** A2A Artifact produced by a task. */
export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: Array<{
    type: "text" | "data" | "file";
    text?: string;
    data?: Record<string, unknown>;
    mimeType?: string;
  }>;
  index: number;
  append?: boolean;
  lastChunk?: boolean;
}

/** A2A Agent Card (public metadata about an agent's capabilities). */
export interface A2AAgentCard {
  name: string;
  description?: string;
  url: string;
  version?: string;
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
  skills?: Array<{
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    examples?: string[];
  }>;
  /** AgentLair extension: trust metadata. */
  agentlair?: {
    agentId: string;
    auditUrl: string;
    trustBadgeUrl?: string;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for AgentLair trust middleware. */
export interface AgentLairTrustConfig {
  /** AgentLair API key for trust score lookups. */
  apiKey?: string;
  /** AgentLair base URL. @default "https://agentlair.dev" */
  baseUrl?: string;
  /** Minimum trust score (0–1000) required for tool execution. @default 0 */
  minimumScore?: number;
  /** Required trust tier. If set, overrides minimumScore. */
  requiredTier?: TrustTier;
  /** Tools that require elevated trust (CAUTIOUS → UNTRUSTED escalation). */
  highRiskTools?: string[];
  /** Whether to block execution when trust check fails (API error). @default false */
  blockOnFailure?: boolean;
  /** Whether to emit behavioral events to AgentLair. @default true */
  emitTelemetry?: boolean;
  /** Custom function to extract agent identity from context metadata. */
  extractAgentId?: (metadata: Record<string, unknown>) => string | undefined;
  /** Timeout for trust API calls in ms. @default 2000 */
  timeout?: number;
}

/** Tier-specific policy actions. */
export type TierPolicy = "allow" | "audit" | "block";

/** Policy map for each trust tier. */
export interface TrustPolicyMap {
  verified: TierPolicy;
  trusted: TierPolicy;
  provisional: TierPolicy;
  untrusted: TierPolicy;
}

/** Default policy: verified/trusted allow, provisional audit, untrusted block. */
export const DEFAULT_POLICY: TrustPolicyMap = {
  verified: "allow",
  trusted: "allow",
  provisional: "audit",
  untrusted: "block",
};

/** Default high-risk tools that escalate PROVISIONAL agents to UNTRUSTED enforcement. */
export const DEFAULT_HIGH_RISK_TOOLS = [
  "bash",
  "execute",
  "shell",
  "run_command",
  "write_file",
  "delete_file",
  "http_request",
  "fetch",
  "send_email",
  "deploy",
  "database_query",
  "code_execution",
];

// ---------------------------------------------------------------------------
// Behavioral event types (RFC-003)
// ---------------------------------------------------------------------------

/** Behavioral event categories matching AgentLair's event taxonomy. */
export type EventCategory =
  | "tool"
  | "resource"
  | "auth"
  | "session"
  | "escalation"
  | "delegation"
  | "error";

/** Result classification for behavioral events. */
export type EventResult = "success" | "failure" | "denied" | "timeout";

/** A behavioral event to emit to AgentLair. */
export interface BehavioralEvent {
  category: EventCategory;
  action: string;
  result: EventResult;
  resource_type?: string;
  duration_ms?: number;
  error_code?: string;
  scope_used?: string;
  metadata?: Record<string, string | number | boolean>;
  session_id?: string;
}
