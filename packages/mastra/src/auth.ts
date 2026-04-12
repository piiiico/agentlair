/**
 * @agentlair/mastra — Auth Provider
 *
 * AgentLair identity verification as a Mastra-compatible auth provider.
 * Verifies EdDSA-signed JWTs (AATs) against AgentLair's JWKS endpoint,
 * optionally enriches with behavioral trust scores.
 *
 * Usage:
 *   import { AgentLairAuth } from '@agentlair/mastra/auth';
 *
 *   const auth = new AgentLairAuth({
 *     apiKey: process.env.AGENTLAIR_API_KEY,
 *     audience: 'https://my-service.com',
 *   });
 *
 *   // In Mastra server config:
 *   const mastra = new Mastra({
 *     server: {
 *       middleware: [auth.middleware()],
 *     },
 *   });
 */

import { verifyAAT, clearJWKSCache } from './jwks.js';
import type { AgentLairConfig, AATClaims, VerifiedAgent, TrustScore } from './types.js';

// ─── Auth Provider ───────────────────────────────────────────────────────────

export interface AgentLairAuthOptions extends AgentLairConfig {
  /**
   * Expected JWT audience. If set, tokens with a different `aud` claim are rejected.
   */
  audience?: string;

  /**
   * Expected JWT issuer.
   * @default "https://agentlair.dev"
   */
  issuer?: string;

  /**
   * Clock skew tolerance in seconds.
   * @default 60
   */
  clockSkew?: number;

  /**
   * Whether to fetch trust scores during authentication.
   * Requires `apiKey` to be set.
   * @default false
   */
  fetchTrustScore?: boolean;

  /**
   * Minimum trust score required for authentication to succeed.
   * Set to 0 to allow all verified agents regardless of trust level.
   * @default 0
   */
  minimumTrustScore?: number;
}

/**
 * AgentLair authentication provider for Mastra.
 *
 * Verifies agent identity tokens (AATs) using EdDSA/Ed25519 signatures
 * verified against AgentLair's JWKS endpoint. Optionally enforces
 * minimum trust scores via the behavioral trust scoring API.
 *
 * The provider follows Mastra's auth pattern — use it in middleware
 * or call `authenticate()` directly in tool execution contexts.
 */
export class AgentLairAuth {
  private readonly baseUrl: string;
  private readonly jwksUrl: string;
  private readonly apiKey?: string;
  private readonly audience?: string;
  private readonly issuer: string;
  private readonly clockSkew: number;
  private readonly cacheTtl: number;
  private readonly fetchTrustScore: boolean;
  private readonly minimumTrustScore: number;

  constructor(options: AgentLairAuthOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://agentlair.dev').replace(/\/$/, '');
    this.jwksUrl = options.jwksUrl ?? `${this.baseUrl}/.well-known/jwks.json`;
    this.apiKey = options.apiKey;
    this.audience = options.audience;
    this.issuer = options.issuer ?? 'https://agentlair.dev';
    this.clockSkew = options.clockSkew ?? 60;
    this.cacheTtl = options.jwksCacheTtl ?? 3600;
    this.fetchTrustScore = options.fetchTrustScore ?? false;
    this.minimumTrustScore = options.minimumTrustScore ?? 0;
  }

  /**
   * Verify an agent token and return the verified agent identity.
   *
   * @param token Bearer token (AAT JWT string)
   * @returns Verified agent with decoded claims and optional trust score
   * @throws Error if token is invalid, expired, or below minimum trust threshold
   */
  async authenticate(token: string): Promise<VerifiedAgent> {
    // Strip "Bearer " prefix if present
    const jwt = token.startsWith('Bearer ') ? token.slice(7) : token;

    // Verify JWT signature and claims
    const claims = await verifyAAT(jwt, {
      jwksUrl: this.jwksUrl,
      audience: this.audience,
      issuer: this.issuer,
      clockSkew: this.clockSkew,
      cacheTtl: this.cacheTtl,
    });

    // Build verified agent
    const agent: VerifiedAgent = {
      accountId: claims.sub,
      name: claims.al_name,
      email: claims.al_email,
      scopes: claims.al_scopes ?? [],
      auditUrl: claims.al_audit_url,
      token: jwt,
      claims,
    };

    // Optionally fetch trust score
    if (this.fetchTrustScore && this.apiKey) {
      try {
        agent.trustScore = await this.getTrustScore(claims.sub);
      } catch {
        // Trust score fetch failure is non-fatal — agent is still verified
      }
    }

    // Enforce minimum trust score if configured
    if (this.minimumTrustScore > 0 && agent.trustScore) {
      if (agent.trustScore.score < this.minimumTrustScore) {
        throw new Error(
          `Agent ${claims.sub} trust score ${agent.trustScore.score} below minimum ${this.minimumTrustScore}`,
        );
      }
    }

    return agent;
  }

  /**
   * Check if an agent has a specific scope.
   */
  hasScope(agent: VerifiedAgent, scope: string): boolean {
    return agent.scopes.includes(scope) || agent.scopes.includes('*');
  }

  /**
   * Check if an agent meets a minimum trust tier.
   */
  meetsTrustTier(
    agent: VerifiedAgent,
    requiredTier: TrustScore['tier'],
  ): boolean {
    if (!agent.trustScore) return false;
    const tierOrder: TrustScore['tier'][] = ['untrusted', 'provisional', 'trusted', 'verified'];
    const agentTierIndex = tierOrder.indexOf(agent.trustScore.tier);
    const requiredTierIndex = tierOrder.indexOf(requiredTier);
    return agentTierIndex >= requiredTierIndex;
  }

  /**
   * Fetch the behavioral trust score for an agent.
   *
   * @param agentId AgentLair account ID
   * @returns Trust score with category breakdown
   */
  async getTrustScore(agentId: string): Promise<TrustScore> {
    if (!this.apiKey) {
      throw new Error('API key required for trust score lookups');
    }

    const response = await fetch(
      `${this.baseUrl}/v1/trust/${encodeURIComponent(agentId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Trust score lookup failed: HTTP ${response.status}`);
    }

    return response.json() as Promise<TrustScore>;
  }

  /**
   * Create a Hono-compatible middleware function for Mastra's server config.
   *
   * Extracts the Authorization header, verifies the AAT, and stores
   * the verified agent in the request context (c.set('agent', verifiedAgent)).
   *
   * @param path URL path pattern to protect @default "/api/*"
   */
  middleware(path: string = '/api/*'): { handler: MiddlewareFn; path: string } {
    const self = this;
    return {
      path,
      handler: async (c: HonoContext, next: () => Promise<void>) => {
        const authHeader = c.req.header('Authorization');
        if (!authHeader) {
          return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        try {
          const agent = await self.authenticate(authHeader);
          c.set('agent', agent);
          await next();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Authentication failed';
          const status = message.includes('trust score') ? 403 : 401;
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    };
  }

  /**
   * Clear the JWKS key cache. Useful after key rotation.
   */
  clearCache(): void {
    clearJWKSCache();
  }
}

// ─── Hono-compatible types (duck-typed, no hard dependency) ──────────────────

interface HonoRequest {
  header(name: string): string | undefined;
}

interface HonoContext {
  req: HonoRequest;
  set(key: string, value: unknown): void;
}

type MiddlewareFn = (c: HonoContext, next: () => Promise<void>) => Response | Promise<Response | void>;

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { verifyAAT, clearJWKSCache } from './jwks.js';
export type { AATClaims, VerifiedAgent, TrustScore, TrustBreakdown, AgentLairConfig } from './types.js';
