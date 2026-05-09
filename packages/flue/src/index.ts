/**
 * @agentlair/flue
 *
 * AgentLair integration for the Flue agent harness framework.
 *
 * Adds agent identity (AATs), JWKS-verified inbound auth, and
 * trust-gated MCP connections to any Flue agent.
 *
 * Three entry points:
 *
 *   1. `withAgentLair(handler, options)` — wrap your agent, get `aal` injected
 *   2. `verifyIncomingAAT(token, options)` — verify callers in webhook handlers
 *   3. `mcpOptions(url, aal)` — attach AAT to outbound MCP connections
 *
 * Quick start:
 *
 *   import { withAgentLair, verifyIncomingAAT, mcpOptions } from '@agentlair/flue';
 */

// Primary integration
export { withAgentLair } from './wrapper.js';

// AAT issuance (lower-level — use withAgentLair for most cases)
export { issueAAT } from './issue.js';

// Inbound verification
export { verifyIncomingAAT, clearJWKSCache } from './verify.js';

// MCP helpers
export { mcpOptions, isAATValid, refreshAAT } from './mcp.js';

// Types
export type {
  AATContext,
  AATClaims,
  IssueAATOptions,
  VerifyAATOptions,
  VerifiedAgent,
  WithAgentLairOptions,
  FlueContextWithAAL,
  FlueContext,
} from './types.js';
