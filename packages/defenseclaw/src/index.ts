/**
 * @agentlair/defenseclaw
 *
 * AgentLair behavioral trust verification for DefenseClaw.
 *
 * DefenseClaw excels at governing agent ACTIONS — scanning skills, enforcing
 * policies, blocking malicious tools. But it has no concept of WHO is
 * performing the action or whether that agent has earned trust over time.
 *
 * This plugin closes that gap: before DefenseClaw approves a tool call, it
 * checks the calling agent's behavioral trust score from AgentLair's trust
 * engine. An agent with no history gets extra scrutiny. An established agent
 * with a strong score gets through without friction.
 *
 * Trust tiers:
 *   TRUSTED    (score ≥ 70): allow
 *   CAUTIOUS   (score 31–69): allow with audit log
 *   COLD_START (score ≤ 30): block by default (configurable)
 *
 * @example Minimal setup (zero config — uses AGENTLAIR_API_KEY env var)
 * ```ts
 * import agentlairDefenseClaw from '@agentlair/defenseclaw';
 * export default agentlairDefenseClaw;
 * ```
 *
 * @example With custom policy
 * ```ts
 * import { createPlugin } from '@agentlair/defenseclaw';
 * export default createPlugin({
 *   policy: { COLD_START: 'audit' },       // warn instead of block
 *   highRiskTools: ['bash', 'write_file'],
 * });
 * ```
 *
 * @see https://agentlair.dev/docs/trust
 * @see https://github.com/cisco-ai-defense/defenseclaw
 */

import { checkTrust } from "./trust-client.js";
import {
  scoreTier,
  type BeforeToolCallEvent,
  type BeforeToolCallResult,
  type DefenseClawPluginConfig,
  type HighRiskTools,
  type TierPolicy,
  type ToolContext,
  type TrustPolicyMap,
  type TrustTier,
} from "./types.js";

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_POLICY: TrustPolicyMap = {
  TRUSTED: "allow",
  CAUTIOUS: "audit",
  COLD_START: "block",
};

/**
 * Tools that are considered high-risk.
 * A CAUTIOUS agent calling any of these is treated as COLD_START.
 */
const DEFAULT_HIGH_RISK_TOOLS: HighRiskTools = [
  "bash",
  "execute",
  "shell",
  "run_command",
  "write_file",
  "delete_file",
  "http_request",
  "fetch",
  "send_email",
  "exfiltrate",
];

// ─── Plugin factory ───────────────────────────────────────────────────────────

/**
 * Create a DefenseClaw OpenClaw plugin that gates tool calls on AgentLair
 * behavioral trust scores.
 */
export function createPlugin(config: DefenseClawPluginConfig = {}) {
  const policy: TrustPolicyMap = {
    ...DEFAULT_POLICY,
    ...config.policy,
  };

  const highRiskTools = new Set<string>(
    config.highRiskTools ?? DEFAULT_HIGH_RISK_TOOLS
  );

  const blockOnFailure = config.blockOnFailure ?? false;

  // ─── OpenClaw plugin entry ──────────────────────────────────────────────
  return function (api: { on: (event: string, handler: (...args: unknown[]) => unknown) => void }) {
    api.on(
      "before_tool_call",
      async (...args: unknown[]): Promise<BeforeToolCallResult | void> => {
        const event = args[0] as BeforeToolCallEvent;
        const ctx = args[1] as ToolContext;
        const agentId = ctx.agentId ?? ctx.sessionKey;

        if (!agentId) {
          // No agent identity — cannot check trust. Fail open or closed.
          if (blockOnFailure) {
            return {
              block: true,
              blockReason:
                "AgentLair trust check: agent identity not present in ToolContext. " +
                "Configure agentId in your OpenClaw session.",
            };
          }
          return; // allow
        }

        let tier: TrustTier;

        try {
          const result = await checkTrust(agentId, config.trust);
          tier = scoreTier(result.score);

          // High-risk tool escalation: CAUTIOUS agents face COLD_START rules
          if (tier === "CAUTIOUS" && highRiskTools.has(event.toolName)) {
            tier = "COLD_START";
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);

          // Trust API unreachable or errored
          if (blockOnFailure) {
            return {
              block: true,
              blockReason: `AgentLair trust check failed: ${message}`,
            };
          }

          console.warn(
            `[agentlair/defenseclaw] Trust check failed for agent ${agentId}, failing open: ${message}`
          );
          return; // fail open
        }

        return enforcePolicy(policy[tier], tier, agentId, event.toolName);
      }
    );
  };
}

// ─── Policy enforcement ───────────────────────────────────────────────────────

function enforcePolicy(
  action: TierPolicy,
  tier: TrustTier,
  agentId: string,
  toolName: string
): BeforeToolCallResult | void {
  switch (action) {
    case "allow":
      return; // no-op, permit

    case "audit":
      console.warn(
        `[agentlair/defenseclaw] AUDIT — agent ${agentId} (tier: ${tier}) called ${toolName}. ` +
          `Trust is building — monitor this agent's behavior.`
      );
      return; // permit, but logged

    case "block":
      return {
        block: true,
        blockReason:
          `AgentLair trust check: agent ${agentId} has trust tier ${tier}. ` +
          tierBlockReason(tier),
      };
  }
}

function tierBlockReason(tier: TrustTier): string {
  switch (tier) {
    case "COLD_START":
      return (
        "This agent has no established behavioral history (score ≤ 30). " +
        "Allow it to build a trust record before permitting tool access, " +
        "or configure policy.COLD_START = 'audit' to allow with monitoring."
      );
    case "CAUTIOUS":
      return (
        "Agent trust score is in the cautious range (31–69) and attempted a high-risk tool. " +
        "Configure highRiskTools or policy to adjust this threshold."
      );
    case "TRUSTED":
      return ""; // never blocked
  }
}

// ─── Default export ───────────────────────────────────────────────────────────

/** Pre-built plugin with default settings. Import and export as your OpenClaw plugin. */
const agentlairDefenseClaw = createPlugin();
export default agentlairDefenseClaw;

// Re-export types
export type {
  DefenseClawPluginConfig,
  TrustCheckOptions,
  TrustCheckResponse,
  TrustPolicyMap,
  TrustTier,
  TierPolicy,
} from "./types.js";
export { scoreTier } from "./types.js";
export { checkTrust } from "./trust-client.js";
