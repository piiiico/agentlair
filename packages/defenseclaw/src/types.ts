/**
 * @agentlair/defenseclaw — Types
 *
 * Type definitions for the AgentLair trust API and DefenseClaw integration.
 */

// ─── AgentLair Trust API ──────────────────────────────────────────────────────

/** Response from AgentLair /v1/trust/{id}/check */
export interface TrustCheckResponse {
  /** Whether the agent meets the trust threshold */
  trusted: boolean;
  /** Behavioral trust score: 0–100. New agents start at 30. */
  score: number;
}

/** Options for configuring the trust check */
export interface TrustCheckOptions {
  /** AgentLair API key (or set AGENTLAIR_API_KEY env var) */
  apiKey?: string;
  /** AgentLair base URL (default: https://agentlair.dev) */
  baseUrl?: string;
  /** Timeout in ms for trust API calls (default: 2000) */
  timeoutMs?: number;
}

// ─── Trust Tiers ──────────────────────────────────────────────────────────────

/**
 * Trust tier mapped from score:
 * - TRUSTED:    score ≥ 70   — established behavioral history
 * - CAUTIOUS:   score 31–69  — building history, allow with audit
 * - COLD_START: score ≤ 30   — new agent, no behavioral record
 */
export type TrustTier = "TRUSTED" | "CAUTIOUS" | "COLD_START";

export function scoreTier(score: number): TrustTier {
  if (score >= 70) return "TRUSTED";
  if (score > 30) return "CAUTIOUS";
  return "COLD_START";
}

// ─── Plugin Config ────────────────────────────────────────────────────────────

/**
 * Per-tier enforcement policy.
 * - `allow`: permit the action
 * - `audit`: permit but log warning
 * - `block`: deny the action
 */
export type TierPolicy = "allow" | "audit" | "block";

export interface TrustPolicyMap {
  TRUSTED: TierPolicy;
  CAUTIOUS: TierPolicy;
  COLD_START: TierPolicy;
}

/** High-risk tool names that trigger stricter enforcement for COLD_START agents */
export type HighRiskTools = readonly string[];

export interface DefenseClawPluginConfig {
  /**
   * AgentLair trust options.
   * apiKey defaults to AGENTLAIR_API_KEY env var.
   */
  trust?: TrustCheckOptions;

  /**
   * Enforcement policy per trust tier.
   * Default: TRUSTED=allow, CAUTIOUS=audit, COLD_START=block
   */
  policy?: Partial<TrustPolicyMap>;

  /**
   * Tool names considered high-risk.
   * CAUTIOUS agents calling these tools get COLD_START enforcement.
   * Default: common destructive/exfiltration tools.
   */
  highRiskTools?: HighRiskTools;

  /**
   * If true, trust check failures (API unreachable) default to blocking.
   * If false, fail open (allow). Default: false (fail open).
   */
  blockOnFailure?: boolean;
}

// ─── OpenClaw Plugin SDK shim types ──────────────────────────────────────────
// Duplicated here so the package compiles without requiring @openclaw/plugin-sdk
// at build time. The real SDK types are used at runtime via peerDependency.

export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
}

export interface BeforeToolCallResult {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
}

export interface ToolContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  toolCallId?: string;
}
