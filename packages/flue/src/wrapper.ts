/**
 * @agentlair/flue — withAgentLair wrapper
 *
 * `withAgentLair` wraps a Flue agent handler to:
 *   1. Issue an AAT at session start (reads AGENTLAIR_API_KEY from env)
 *   2. Inject `aal` into the handler context
 *   3. Rethrow with clear error messages when AAT issuance fails
 *
 * This is the primary integration point — wrap your handler once,
 * get identity everywhere inside it.
 */

import { issueAAT } from './issue.js';
import type {
  FlueContext,
  FlueContextWithAAL,
  WithAgentLairOptions,
  AATContext,
} from './types.js';

/**
 * Wrap a Flue agent handler with AgentLair identity.
 *
 * Issues an AAT before your handler runs and injects it as `aal`.
 * The token is live for the duration of the handler (default: 1 hour).
 *
 * @example
 * ```typescript
 * // .flue/agents/my-agent.ts
 * import { withAgentLair } from '@agentlair/flue';
 *
 * export const triggers = { webhook: true };
 *
 * export default withAgentLair(
 *   async ({ init, payload, env, aal }) => {
 *     // aal.token    — raw JWT
 *     // aal.bearer   — "Bearer eyJ..." ready for Authorization header
 *     // aal.name     — agent display name
 *     // aal.scopes   — granted scopes
 *     // aal.auditUrl — link to AgentLair audit trail
 *
 *     const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });
 *     const session = await agent.session();
 *     return await session.prompt(payload.message as string);
 *   },
 *   {
 *     // Optional: explicit API key (default: reads env.AGENTLAIR_API_KEY)
 *     audience: 'https://my-service.com',
 *     scopes: ['mcp:tools:execute', 'email:send'],
 *   }
 * );
 * ```
 */
export function withAgentLair<
  TResult = unknown,
  TEnv extends Record<string, string | undefined> = Record<string, string | undefined>,
>(
  handler: (ctx: FlueContextWithAAL<TEnv>) => Promise<TResult>,
  options: WithAgentLairOptions & { audience: string },
): (ctx: FlueContext) => Promise<TResult> {
  return async (ctx: FlueContext): Promise<TResult> => {
    const apiKey = options.apiKey ?? (ctx.env.AGENTLAIR_API_KEY as string | undefined);
    if (!apiKey) {
      throw new Error(
        '[AgentLair] No API key found. Set AGENTLAIR_API_KEY in your Flue environment ' +
          'or pass apiKey to withAgentLair().',
      );
    }

    let aal: AATContext;
    try {
      aal = await issueAAT({
        apiKey,
        audience: options.audience,
        scopes: options.scopes,
        ttl: options.ttl,
        baseUrl: options.baseUrl,
      });
    } catch (err) {
      throw new Error(
        `[AgentLair] Failed to issue AAT: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return handler({
      ...(ctx as unknown as FlueContextWithAAL<TEnv>),
      env: ctx.env as TEnv,
      aal,
    });
  };
}
