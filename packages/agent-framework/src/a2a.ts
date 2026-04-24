// ---------------------------------------------------------------------------
// @agentlair/agent-framework — A2A Trust Verification
//
// Microsoft Agent Framework 1.0 uses A2A (Agent-to-Agent) protocol for
// inter-agent communication. This module provides trust verification
// for incoming A2A task requests:
//
//   1. Verify the requesting agent's identity (AgentLair AAT or A2A auth).
//   2. Check the agent's behavioral trust score before accepting work.
//   3. Enrich Agent Cards with AgentLair trust metadata.
//   4. Log inter-agent interactions as behavioral events.
//
// Usage:
//   import { createA2ATrustHandler, enrichAgentCard }
//     from '@agentlair/agent-framework/a2a';
//
//   const trustHandler = createA2ATrustHandler({
//     apiKey: process.env.AGENTLAIR_API_KEY,
//     minimumScore: 200,
//   });
//
//   // In your A2A server's task handler:
//   const decision = await trustHandler.verifyIncoming(request);
//   if (!decision.allowed) {
//     return { error: decision.reason };
//   }
// ---------------------------------------------------------------------------

import type {
  A2AAgentCard,
  AgentLairTrustConfig,
  TrustScore,
  TrustTier,
  TrustPolicyMap,
  TierPolicy,
  VerifiedAgent,
} from "./types.js";
import { scoreTier, DEFAULT_POLICY } from "./types.js";
import { fetchTrustScore, emitEvent } from "./trust-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the A2A trust handler. */
export interface A2ATrustHandlerOptions extends AgentLairTrustConfig {
  /** Per-tier policy overrides. */
  policy?: Partial<TrustPolicyMap>;
  /** Session ID for telemetry grouping. */
  sessionId?: string;
}

/** An incoming A2A request with agent identity metadata. */
export interface IncomingA2ARequest {
  /** The requesting agent's ID (from A2A auth or AgentLair AAT). */
  agentId: string;
  /** The A2A task ID. */
  taskId?: string;
  /** The task description or first message. */
  description?: string;
  /** Additional metadata from the A2A request. */
  metadata?: Record<string, unknown>;
}

/** Result of a trust verification for an incoming A2A request. */
export interface A2ATrustDecision {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** The requesting agent's trust score, if retrieved. */
  score?: number;
  /** The requesting agent's trust tier. */
  tier?: TrustTier;
  /** Reason for denial, if not allowed. */
  reason?: string;
  /** The policy action that was applied. */
  action: TierPolicy;
}

// ---------------------------------------------------------------------------
// A2A Trust Handler
// ---------------------------------------------------------------------------

/**
 * Create an A2A trust handler that verifies incoming agent-to-agent
 * requests against AgentLair behavioral trust scores.
 */
export function createA2ATrustHandler(options: A2ATrustHandlerOptions = {}) {
  const {
    apiKey,
    baseUrl,
    minimumScore = 0,
    requiredTier,
    blockOnFailure = false,
    emitTelemetry = true,
    timeout,
    sessionId,
  } = options;

  const policy: TrustPolicyMap = { ...DEFAULT_POLICY, ...options.policy };

  return {
    /**
     * Verify an incoming A2A request against the agent's trust score.
     * Call this before accepting any delegated task.
     */
    async verifyIncoming(request: IncomingA2ARequest): Promise<A2ATrustDecision> {
      const { agentId, taskId, description } = request;

      // Fetch trust score
      let score = 0;
      let tier: TrustTier = "untrusted";

      try {
        const trustResult = await fetchTrustScore(agentId, {
          apiKey,
          baseUrl,
          timeout,
        });
        score = trustResult.score;
        tier = trustResult.tier;
      } catch {
        if (blockOnFailure) {
          return {
            allowed: false,
            action: "block",
            reason: `Trust check failed for agent ${agentId}. Blocking due to blockOnFailure policy.`,
          };
        }
        // Fail open — treat as untrusted but allow policy to decide
      }

      // Apply policy
      const action = policy[tier];

      if (action === "block") {
        const reason = `A2A trust gate: agent ${agentId} (score: ${score}, tier: ${tier}) blocked. Required: ${requiredTier ?? `score >= ${minimumScore}`}.`;

        if (emitTelemetry) {
          emitEvent(
            {
              category: "delegation",
              action: "a2a_incoming_blocked",
              result: "denied",
              resource_type: "a2a_task",
              metadata: {
                from_agent: agentId,
                task_id: taskId ?? "",
                trust_score: score,
                trust_tier: tier,
              },
              session_id: sessionId,
            },
            { apiKey, baseUrl, timeout },
          );
        }

        return { allowed: false, score, tier, reason, action };
      }

      if (action === "audit") {
        console.warn(
          `[agentlair/agent-framework] A2A AUDIT — agent ${agentId} (score: ${score}, tier: ${tier}) requesting task${taskId ? ` ${taskId}` : ""}`,
        );
      }

      // Additional score/tier checks
      if (requiredTier) {
        const tierOrder: TrustTier[] = ["untrusted", "provisional", "trusted", "verified"];
        if (tierOrder.indexOf(tier) < tierOrder.indexOf(requiredTier)) {
          return {
            allowed: false,
            score,
            tier,
            action: "block",
            reason: `A2A trust gate: agent ${agentId} tier ${tier} below required ${requiredTier}.`,
          };
        }
      }

      if (score < minimumScore) {
        return {
          allowed: false,
          score,
          tier,
          action: "block",
          reason: `A2A trust gate: agent ${agentId} score ${score} below minimum ${minimumScore}.`,
        };
      }

      // Record accepted delegation
      if (emitTelemetry) {
        emitEvent(
          {
            category: "delegation",
            action: "a2a_incoming_accepted",
            result: "success",
            resource_type: "a2a_task",
            metadata: {
              from_agent: agentId,
              task_id: taskId ?? "",
              trust_score: score,
              trust_tier: tier,
              task_desc: description?.slice(0, 256) ?? "",
            },
            session_id: sessionId,
          },
          { apiKey, baseUrl, timeout },
        );
      }

      return { allowed: true, score, tier, action };
    },

    /**
     * Verify an outgoing A2A delegation target. Use this before sending
     * tasks to another agent to ensure they meet your trust requirements.
     */
    async verifyOutgoing(targetAgentId: string): Promise<A2ATrustDecision> {
      let score = 0;
      let tier: TrustTier = "untrusted";

      try {
        const trustResult = await fetchTrustScore(targetAgentId, {
          apiKey,
          baseUrl,
          timeout,
        });
        score = trustResult.score;
        tier = trustResult.tier;
      } catch {
        if (blockOnFailure) {
          return {
            allowed: false,
            action: "block",
            reason: `Cannot verify trust for delegation target ${targetAgentId}.`,
          };
        }
      }

      const action = policy[tier];
      if (action === "block") {
        return {
          allowed: false,
          score,
          tier,
          action,
          reason: `Delegation target ${targetAgentId} (score: ${score}, tier: ${tier}) does not meet trust requirements.`,
        };
      }

      return { allowed: true, score, tier, action };
    },
  };
}

// ---------------------------------------------------------------------------
// Agent Card enrichment
// ---------------------------------------------------------------------------

/**
 * Enrich an A2A Agent Card with AgentLair trust metadata.
 *
 * This adds the `agentlair` extension field to your Agent Card, enabling
 * other agents to discover your trust score and audit trail before
 * initiating communication.
 *
 * @example
 *   const card = enrichAgentCard(baseCard, {
 *     agentId: 'agent_abc123',
 *     auditUrl: 'https://agentlair.dev/audit/agent_abc123',
 *   });
 */
export function enrichAgentCard(
  card: Omit<A2AAgentCard, "agentlair">,
  agentlair: NonNullable<A2AAgentCard["agentlair"]>,
): A2AAgentCard {
  return {
    ...card,
    agentlair: {
      ...agentlair,
      trustBadgeUrl:
        agentlair.trustBadgeUrl ??
        `https://agentlair.dev/badge/${encodeURIComponent(agentlair.agentId)}/score.svg`,
    },
  };
}

/**
 * Fetch an agent's trust score and include it inline in the Agent Card
 * response. Useful for dynamic Agent Card serving.
 */
export async function enrichAgentCardWithScore(
  card: Omit<A2AAgentCard, "agentlair">,
  agentId: string,
  config: Pick<AgentLairTrustConfig, "apiKey" | "baseUrl" | "timeout"> = {},
): Promise<A2AAgentCard & { trustScore?: TrustScore }> {
  const enriched = enrichAgentCard(card, {
    agentId,
    auditUrl: `${config.baseUrl ?? "https://agentlair.dev"}/audit/${encodeURIComponent(agentId)}`,
  });

  try {
    const trustScore = await fetchTrustScore(agentId, config);
    return { ...enriched, trustScore };
  } catch {
    return enriched;
  }
}
