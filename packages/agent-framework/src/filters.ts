// ---------------------------------------------------------------------------
// @agentlair/agent-framework — Function Invocation Filters
//
// Microsoft Agent Framework 1.0 inherits the filter/pipeline model from
// Semantic Kernel. Filters intercept function (tool) invocations before
// and after execution. This module provides trust-aware filters that:
//
//   1. Gate tool execution based on the calling agent's trust score.
//   2. Log behavioral telemetry for every tool call.
//   3. Escalate high-risk tool calls for low-trust agents.
//
// Usage:
//   import { createTrustFilter } from '@agentlair/agent-framework/filters';
//
//   const kernel = new AgentKernel();
//   kernel.addFilter('functionInvocation', createTrustFilter({
//     apiKey: process.env.AGENTLAIR_API_KEY,
//     minimumScore: 200,
//   }));
// ---------------------------------------------------------------------------

import type {
  FunctionInvocationContext,
  FunctionInvocationFilter,
  AgentLairTrustConfig,
  TrustPolicyMap,
  TrustTier,
  TierPolicy,
} from "./types.js";
import {
  scoreTier,
  DEFAULT_POLICY,
  DEFAULT_HIGH_RISK_TOOLS,
} from "./types.js";
import { fetchTrustScore, emitEvent } from "./trust-client.js";

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

export interface TrustFilterOptions extends AgentLairTrustConfig {
  /** Per-tier policy overrides. */
  policy?: Partial<TrustPolicyMap>;
  /** Session ID for grouping telemetry events. */
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Trust filter factory
// ---------------------------------------------------------------------------

/**
 * Create a function invocation filter that gates tool execution based on
 * the calling agent's AgentLair trust score.
 *
 * The filter runs BEFORE execution (pre-invocation). If the agent's trust
 * score is below the threshold, the invocation is cancelled. After
 * execution (post-invocation), a behavioral event is emitted to AgentLair.
 *
 * Agent identity is extracted from `context.metadata.agentId` or via the
 * custom `extractAgentId` function.
 */
export function createTrustFilter(
  options: TrustFilterOptions = {},
): FunctionInvocationFilter {
  const {
    apiKey,
    baseUrl,
    minimumScore = 0,
    requiredTier,
    blockOnFailure = false,
    emitTelemetry = true,
    extractAgentId,
    timeout,
    policy: policyOverrides,
    sessionId,
  } = options;

  const policy: TrustPolicyMap = { ...DEFAULT_POLICY, ...policyOverrides };
  const highRiskTools = new Set(options.highRiskTools ?? DEFAULT_HIGH_RISK_TOOLS);

  // Cache trust scores for the lifetime of the filter instance
  const scoreCache = new Map<string, { score: number; tier: TrustTier; ts: number }>();
  const CACHE_TTL = 60_000; // 1 minute

  return async function trustFilter(
    context: FunctionInvocationContext,
    next: () => Promise<void>,
  ): Promise<void> {
    const startTime = Date.now();

    // -----------------------------------------------------------------------
    // 1. Extract agent identity
    // -----------------------------------------------------------------------
    const agentId = extractAgentId
      ? extractAgentId(context.metadata)
      : (context.metadata.agentId as string | undefined);

    if (!agentId) {
      // No agent identity — fail open or closed based on config
      if (blockOnFailure) {
        context.cancelled = true;
        context.cancelReason =
          "AgentLair trust check: no agent identity found in context.";
        return;
      }
      await next();
      return;
    }

    // -----------------------------------------------------------------------
    // 2. Fetch trust score (cached)
    // -----------------------------------------------------------------------
    let score = 0;
    let tier: TrustTier = "untrusted";

    const cached = scoreCache.get(agentId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      score = cached.score;
      tier = cached.tier;
    } else {
      try {
        const trustResult = await fetchTrustScore(agentId, {
          apiKey,
          baseUrl,
          timeout,
        });
        score = trustResult.score;
        tier = trustResult.tier;
        scoreCache.set(agentId, { score, tier, ts: Date.now() });
      } catch {
        if (blockOnFailure) {
          context.cancelled = true;
          context.cancelReason =
            "AgentLair trust check: unable to verify trust score.";
          return;
        }
        // Fail open — proceed with untrusted
      }
    }

    // -----------------------------------------------------------------------
    // 3. High-risk tool escalation
    // -----------------------------------------------------------------------
    let effectiveTier = tier;
    const toolName = context.functionName;
    if (effectiveTier === "provisional" && highRiskTools.has(toolName)) {
      effectiveTier = "untrusted";
    }

    // -----------------------------------------------------------------------
    // 4. Enforce policy
    // -----------------------------------------------------------------------
    const action = policy[effectiveTier];

    if (action === "block") {
      context.cancelled = true;
      context.cancelReason = `AgentLair trust gate: agent ${agentId} (score: ${score}, tier: ${effectiveTier}) blocked from calling ${toolName}. Required: ${requiredTier ?? `score >= ${minimumScore}`}.`;

      // Emit denial event
      if (emitTelemetry) {
        emitEvent(
          {
            category: "tool",
            action: toolName,
            result: "denied",
            resource_type: context.pluginName ?? "function",
            duration_ms: Date.now() - startTime,
            metadata: {
              agent_id: agentId,
              trust_score: score,
              trust_tier: effectiveTier,
              policy_action: "block",
            },
            session_id: sessionId,
          },
          { apiKey, baseUrl, timeout },
        );
      }
      return;
    }

    if (action === "audit") {
      console.warn(
        `[agentlair/agent-framework] AUDIT — agent ${agentId} (score: ${score}, tier: ${effectiveTier}) calling ${toolName}`,
      );
    }

    // -----------------------------------------------------------------------
    // 5. Additional score/tier checks
    // -----------------------------------------------------------------------
    if (requiredTier) {
      const tierOrder: TrustTier[] = ["untrusted", "provisional", "trusted", "verified"];
      const requiredIdx = tierOrder.indexOf(requiredTier);
      const actualIdx = tierOrder.indexOf(tier);
      if (actualIdx < requiredIdx) {
        context.cancelled = true;
        context.cancelReason = `AgentLair trust gate: agent ${agentId} tier ${tier} below required ${requiredTier}.`;
        return;
      }
    }

    if (score < minimumScore) {
      context.cancelled = true;
      context.cancelReason = `AgentLair trust gate: agent ${agentId} score ${score} below minimum ${minimumScore}.`;
      return;
    }

    // -----------------------------------------------------------------------
    // 6. Execute the function
    // -----------------------------------------------------------------------
    await next();

    // -----------------------------------------------------------------------
    // 7. Post-execution telemetry
    // -----------------------------------------------------------------------
    if (emitTelemetry) {
      const duration = Date.now() - startTime;
      emitEvent(
        {
          category: "tool",
          action: toolName,
          result: context.result !== undefined ? "success" : "failure",
          resource_type: context.pluginName ?? "function",
          duration_ms: duration,
          metadata: {
            agent_id: agentId,
            trust_score: score,
            trust_tier: tier,
            policy_action: action,
          },
          session_id: sessionId,
        },
        { apiKey, baseUrl, timeout },
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Convenience: create a filter that only logs (no gating)
// ---------------------------------------------------------------------------

/**
 * Create a telemetry-only filter that logs all tool calls as behavioral
 * events without gating execution. Useful for observation periods before
 * enforcing trust policies.
 */
export function createTelemetryFilter(
  options: Pick<TrustFilterOptions, "apiKey" | "baseUrl" | "timeout" | "extractAgentId" | "sessionId"> = {},
): FunctionInvocationFilter {
  return createTrustFilter({
    ...options,
    minimumScore: 0,
    blockOnFailure: false,
    emitTelemetry: true,
    policy: {
      verified: "allow",
      trusted: "allow",
      provisional: "allow",
      untrusted: "allow",
    },
  });
}
