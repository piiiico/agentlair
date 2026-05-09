/**
 * @agentlair/flue — Trust-Gated MCP Connections
 *
 * Helpers for attaching AATs to outbound MCP server connections
 * and for verifying incoming AATs before accepting A2A delegations.
 */

import type { AATContext } from './types.js';

/**
 * Options for Flue's `connectMcpServer()` call.
 * Duck-typed to avoid hard dependency on @flue/sdk internals.
 */
export interface McpConnectOptions {
  url: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Build `connectMcpServer()` options with AAT auth attached.
 *
 * Merges your AAT as the Authorization header so the MCP server
 * can verify your agent's identity via AgentLair's JWKS endpoint.
 *
 * @example
 * ```typescript
 * import { issueAAT, mcpOptions } from '@agentlair/flue';
 *
 * export default async function ({ init, payload, env }: FlueContext) {
 *   const aal = await issueAAT({
 *     apiKey: env.AGENTLAIR_API_KEY!,
 *     audience: 'https://partner.example.com',
 *     scopes: ['mcp:tools:execute'],
 *   });
 *
 *   const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });
 *
 *   // connectMcpServer is a Flue SDK function — pass options directly
 *   const partnerTools = await connectMcpServer(
 *     'partner',
 *     mcpOptions('https://partner.example.com/mcp', aal)
 *   );
 *
 *   const session = await agent.session();
 *   return await session.prompt(payload.message as string, {
 *     tools: [partnerTools],
 *   });
 * }
 * ```
 */
export function mcpOptions(
  url: string,
  aal: AATContext,
  extra?: Record<string, unknown>,
): McpConnectOptions {
  return {
    url,
    headers: {
      Authorization: aal.bearer,
      'X-AgentLair-Agent': aal.accountId,
      'X-AgentLair-Token-Ref': aal.claims.jti,
    },
    ...extra,
  };
}

/**
 * Check whether an AAT is still valid (not expired).
 *
 * Flue agents may run for extended periods — call this before reusing
 * a cached AAT to ensure it's still live.
 *
 * @example
 * ```typescript
 * if (!isAATValid(aal)) {
 *   aal = await issueAAT({ apiKey: env.AGENTLAIR_API_KEY!, audience });
 * }
 * ```
 */
export function isAATValid(aal: AATContext, bufferSeconds = 60): boolean {
  return aal.expiresAt.getTime() > Date.now() + bufferSeconds * 1000;
}

/**
 * Refresh an AAT if it's expired or close to expiry.
 *
 * @example
 * ```typescript
 * import { issueAAT, refreshAAT } from '@agentlair/flue';
 *
 * // Cache the AAT in agent state and refresh as needed
 * let aal = await issueAAT({ apiKey, audience, scopes });
 * aal = await refreshAAT(aal, { apiKey, audience, scopes });
 * ```
 */
export async function refreshAAT(
  current: AATContext,
  options: import('./types.js').IssueAATOptions,
): Promise<AATContext> {
  if (isAATValid(current)) {
    return current;
  }
  const { issueAAT } = await import('./issue.js');
  return issueAAT(options);
}
