/**
 * @agentlair/mastra
 *
 * AgentLair integration for Mastra — agent identity, behavioral trust scoring,
 * and trust-gated tool execution.
 *
 * Three integration layers:
 *
 * 1. **Identity** (`@agentlair/mastra/auth`)
 *    Verify EdDSA-signed agent tokens (AATs) against AgentLair's JWKS endpoint.
 *    Use as Mastra auth middleware to authenticate agents before they interact
 *    with your service.
 *
 * 2. **Trust** (`@agentlair/mastra/tools`)
 *    Look up behavioral trust scores, check trust gates, and record observations.
 *    Expose as Mastra tools so your agents can reason about trust.
 *
 * 3. **Trust-Gated Execution** (`@agentlair/mastra/middleware`)
 *    Wrap any Mastra tool with a trust gate — require minimum trust scores
 *    before allowing sensitive operations.
 *
 * @example Quick start
 * ```typescript
 * import { AgentLairAuth } from '@agentlair/mastra/auth';
 * import { createAgentLairTools } from '@agentlair/mastra/tools';
 * import { trustGated } from '@agentlair/mastra/middleware';
 * import { Agent } from '@mastra/core/agent';
 * import { Mastra } from '@mastra/core';
 *
 * // 1. Set up auth
 * const auth = new AgentLairAuth({
 *   apiKey: process.env.AGENTLAIR_API_KEY,
 *   audience: 'https://my-service.com',
 *   fetchTrustScore: true,
 * });
 *
 * // 2. Create tools
 * const tools = createAgentLairTools({
 *   apiKey: process.env.AGENTLAIR_API_KEY,
 * });
 *
 * // 3. Trust-gate sensitive tools
 * const safeDeploy = trustGated(myDeployTool, {
 *   apiKey: process.env.AGENTLAIR_API_KEY,
 *   minimumScore: 700,
 *   requiredTier: 'trusted',
 * });
 *
 * // 4. Wire into Mastra
 * const agent = new Agent({
 *   id: 'my-service-agent',
 *   tools: { ...tools, safeDeploy },
 * });
 *
 * const mastra = new Mastra({
 *   agents: { myAgent: agent },
 *   server: { middleware: [auth.middleware()] },
 * });
 * ```
 *
 * @see https://agentlair.dev/docs/mastra
 */

// ── Auth ─────────────────────────────────────────────────────────────────────
export { AgentLairAuth } from './auth.js';
export type { AgentLairAuthOptions } from './auth.js';
export { verifyAAT, clearJWKSCache } from './jwks.js';

// ── Tools ────────────────────────────────────────────────────────────────────
export { createAgentLairTools } from './tools.js';
export type { CreateToolsOptions } from './tools.js';

// ── Middleware ────────────────────────────────────────────────────────────────
export { trustGated, trustGateAll } from './middleware.js';
export type { TrustGateOptions } from './middleware.js';

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  AgentLairConfig,
  AATClaims,
  VerifiedAgent,
  TrustScore,
  TrustBreakdown,
  TrustGateResult,
  JWK,
  JWKS,
} from './types.js';
