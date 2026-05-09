/**
 * @agentlair/flue — AAT Issuance
 *
 * Issues an Agent Authentication Token (AAT) from AgentLair's
 * /v1/tokens/issue endpoint. Call once per Flue agent session.
 */

import type { AATContext, AATClaims, IssueAATOptions } from './types.js';

interface IssueResponse {
  token: string;
  expires_at: string;
  jti: string;
  audit_url?: string;
}

/**
 * Issue an AAT for this agent session.
 *
 * Calls AgentLair's `POST /v1/tokens/issue` endpoint and returns a typed
 * context object with the token and decoded claims ready to use.
 *
 * @example
 * ```typescript
 * export default async function ({ init, payload, env }: FlueContext) {
 *   const aal = await issueAAT({
 *     apiKey: env.AGENTLAIR_API_KEY!,
 *     audience: 'https://my-service.com',
 *     scopes: ['mcp:tools:execute', 'email:send'],
 *   });
 *
 *   // Use aal.bearer to authenticate outbound MCP calls
 *   const mcp = await connectMcpServer('partner', {
 *     url: 'https://api.partner.com/mcp',
 *     headers: { Authorization: aal.bearer },
 *   });
 * }
 * ```
 */
export async function issueAAT(options: IssueAATOptions): Promise<AATContext> {
  const baseUrl = (options.baseUrl ?? 'https://agentlair.dev').replace(/\/$/, '');

  const response = await fetch(`${baseUrl}/v1/tokens/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audience: options.audience,
      scopes: options.scopes ?? [],
      ttl: options.ttl ?? 3600,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `AgentLair token issuance failed: HTTP ${response.status} — ${body}`,
    );
  }

  const data = (await response.json()) as IssueResponse;

  // Decode the JWT payload (no verification — we trust AgentLair's issuance)
  const claims = decodeJWTPayload(data.token);

  return {
    token: data.token,
    bearer: `Bearer ${data.token}`,
    claims,
    name: claims.al_name,
    accountId: claims.sub,
    scopes: claims.al_scopes ?? [],
    expiresAt: new Date(data.expires_at),
    auditUrl: data.audit_url ?? claims.al_audit_url,
  };
}

/**
 * Decode a JWT payload without verification.
 *
 * Safe to use for tokens we just issued — no need to re-verify
 * a token we received directly from AgentLair's HTTPS endpoint.
 */
function decodeJWTPayload(token: string): AATClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = parts[1];
  // Handle URL-safe base64
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  const json = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json) as AATClaims;
}
