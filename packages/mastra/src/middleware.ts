/**
 * @agentlair/mastra — Trust-Gated Middleware
 *
 * Higher-order function that wraps Mastra tool execution with trust gates.
 * Before a tool runs, the middleware checks the calling agent's trust score
 * against a configurable threshold.
 *
 * Usage:
 *   import { trustGated } from '@agentlair/mastra/middleware';
 *   import { createTool } from '@mastra/core/tools';
 *
 *   const dangerousTool = createTool({
 *     id: 'delete-everything',
 *     ...
 *   });
 *
 *   // Wrap with trust gate — only agents scoring 700+ can execute
 *   const safeTool = trustGated(dangerousTool, {
 *     apiKey: process.env.AGENTLAIR_API_KEY,
 *     minimumScore: 700,
 *   });
 */

import type { AgentLairConfig, TrustScore, TrustGateResult, VerifiedAgent } from './types.js';

// ─── Trust gate config ───────────────────────────────────────────────────────

export interface TrustGateOptions extends AgentLairConfig {
  /**
   * Minimum trust score (0–1000) required to execute the tool.
   * @default 500
   */
  minimumScore?: number;

  /**
   * Required trust tier. If set, overrides minimumScore.
   */
  requiredTier?: TrustScore['tier'];

  /**
   * Required scopes. The agent must have ALL listed scopes.
   */
  requiredScopes?: string[];

  /**
   * Custom gate function. Receives the verified agent and returns
   * whether execution should proceed. Overrides score/tier checks.
   */
  gate?: (agent: VerifiedAgent) => boolean | Promise<boolean>;

  /**
   * Action to take when the gate denies access.
   * - 'throw': throw an error (default)
   * - 'return-error': return a structured error result
   */
  onDenied?: 'throw' | 'return-error';

  /**
   * Function to extract the agent identity from the tool execution context.
   * By default, looks for `context.requestContext?.agent`.
   */
  extractAgent?: (context: unknown) => VerifiedAgent | undefined;
}

// ─── Trust gate check ────────────────────────────────────────────────────────

/**
 * Check trust for an agent against configured gates.
 */
async function checkTrust(
  agent: VerifiedAgent,
  options: TrustGateOptions,
): Promise<TrustGateResult> {
  const minimumScore = options.minimumScore ?? 500;

  // Custom gate takes priority
  if (options.gate) {
    const allowed = await options.gate(agent);
    return {
      allowed,
      score: agent.trustScore?.score,
      tier: agent.trustScore?.tier,
      reason: allowed ? undefined : 'Custom gate denied access',
      requiredScore: minimumScore,
    };
  }

  // Check scopes
  if (options.requiredScopes?.length) {
    const agentScopes = new Set(agent.scopes);
    const hasWildcard = agentScopes.has('*');
    for (const scope of options.requiredScopes) {
      if (!hasWildcard && !agentScopes.has(scope)) {
        return {
          allowed: false,
          score: agent.trustScore?.score,
          tier: agent.trustScore?.tier,
          reason: `Missing required scope: ${scope}`,
          requiredScore: minimumScore,
        };
      }
    }
  }

  // If no trust score available and we need one, try fetching
  if (!agent.trustScore) {
    if (options.apiKey) {
      const baseUrl = (options.baseUrl ?? 'https://agentlair.dev').replace(/\/$/, '');
      try {
        const response = await fetch(
          `${baseUrl}/v1/trust/${encodeURIComponent(agent.accountId)}`,
          {
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        );
        if (response.ok) {
          agent.trustScore = (await response.json()) as TrustScore;
        }
      } catch {
        // Trust fetch failed — will be denied if score is required
      }
    }

    if (!agent.trustScore) {
      return {
        allowed: false,
        reason: 'No trust score available',
        requiredScore: minimumScore,
      };
    }
  }

  // Check tier
  if (options.requiredTier) {
    const tierOrder: TrustScore['tier'][] = ['untrusted', 'provisional', 'trusted', 'verified'];
    const agentTierIdx = tierOrder.indexOf(agent.trustScore.tier);
    const requiredTierIdx = tierOrder.indexOf(options.requiredTier);
    if (agentTierIdx < requiredTierIdx) {
      return {
        allowed: false,
        score: agent.trustScore.score,
        tier: agent.trustScore.tier,
        reason: `Trust tier "${agent.trustScore.tier}" below required "${options.requiredTier}"`,
        requiredScore: minimumScore,
      };
    }
  }

  // Check score
  if (agent.trustScore.score < minimumScore) {
    return {
      allowed: false,
      score: agent.trustScore.score,
      tier: agent.trustScore.tier,
      reason: `Trust score ${agent.trustScore.score} below minimum ${minimumScore}`,
      requiredScore: minimumScore,
    };
  }

  return {
    allowed: true,
    score: agent.trustScore.score,
    tier: agent.trustScore.tier,
    requiredScore: minimumScore,
  };
}

// ─── Default agent extractor ─────────────────────────────────────────────────

function defaultExtractAgent(context: unknown): VerifiedAgent | undefined {
  if (!context || typeof context !== 'object') return undefined;

  // Check Mastra's requestContext pattern
  const ctx = context as Record<string, unknown>;
  if (ctx.requestContext && typeof ctx.requestContext === 'object') {
    const reqCtx = ctx.requestContext as Record<string, unknown>;
    if (reqCtx.agent && typeof reqCtx.agent === 'object') {
      return reqCtx.agent as VerifiedAgent;
    }
  }

  // Check direct context
  if (ctx.agent && typeof ctx.agent === 'object') {
    return ctx.agent as VerifiedAgent;
  }

  return undefined;
}

// ─── Trust-gated tool wrapper ────────────────────────────────────────────────

/**
 * Minimal tool interface (duck-typed to avoid @mastra/core dependency).
 */
interface ToolLike<TIn = unknown, TOut = unknown> {
  id: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  execute?: (input: TIn, context: unknown) => Promise<TOut>;
  [key: string]: unknown;
}

/**
 * Wrap a Mastra tool with a trust gate.
 *
 * Before the tool's `execute` function runs, the wrapper:
 * 1. Extracts the calling agent's identity from the execution context
 * 2. Checks the agent's trust score against the configured threshold
 * 3. Either allows execution or denies with a structured error
 *
 * @param tool The Mastra tool to wrap
 * @param options Trust gate configuration
 * @returns A new tool with the same interface but trust-gated execution
 *
 * @example
 * const safeTool = trustGated(myDangerousTool, {
 *   apiKey: process.env.AGENTLAIR_API_KEY,
 *   minimumScore: 700,
 *   requiredTier: 'trusted',
 *   requiredScopes: ['write:data'],
 * });
 */
export function trustGated<TIn, TOut>(
  tool: ToolLike<TIn, TOut>,
  options: TrustGateOptions,
): ToolLike<TIn, TOut | { error: string; trustGate: TrustGateResult }> {
  const extractAgent = options.extractAgent ?? defaultExtractAgent;
  const onDenied = options.onDenied ?? 'throw';

  return {
    ...tool,
    id: tool.id,
    description: `[Trust-gated: min score ${options.minimumScore ?? 500}] ${tool.description}`,
    execute: async (input: TIn, context: unknown) => {
      const agent = extractAgent(context);

      if (!agent) {
        const msg = `Trust gate: no agent identity found in context for tool "${tool.id}"`;
        if (onDenied === 'throw') throw new Error(msg);
        return {
          error: msg,
          trustGate: { allowed: false, reason: 'No agent identity', requiredScore: options.minimumScore ?? 500 },
        } as TOut | { error: string; trustGate: TrustGateResult };
      }

      const result = await checkTrust(agent, options);

      if (!result.allowed) {
        const msg = `Trust gate denied: ${result.reason}`;
        if (onDenied === 'throw') throw new Error(msg);
        return { error: msg, trustGate: result } as TOut | { error: string; trustGate: TrustGateResult };
      }

      // Gate passed — execute the original tool
      if (!tool.execute) {
        throw new Error(`Tool "${tool.id}" has no execute function`);
      }
      return tool.execute(input, context);
    },
  };
}

/**
 * Wrap multiple tools with the same trust gate configuration.
 *
 * @param tools Record of tools to wrap
 * @param options Trust gate configuration applied to all tools
 * @returns New record with all tools trust-gated
 */
export function trustGateAll<T extends Record<string, ToolLike>>(
  tools: T,
  options: TrustGateOptions,
): T {
  const gated: Record<string, ToolLike> = {};
  for (const [key, tool] of Object.entries(tools)) {
    gated[key] = trustGated(tool, options);
  }
  return gated as T;
}

// ─── Re-exports ──────────────────────────────────────────────────────────────

export type { TrustGateResult, VerifiedAgent, TrustScore } from './types.js';
