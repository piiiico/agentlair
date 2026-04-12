/**
 * @agentlair/mastra — Mastra Tools
 *
 * AgentLair capabilities exposed as Mastra-compatible tools.
 * Uses Mastra's createTool() with Zod schemas for type-safe tool definitions.
 *
 * Three categories:
 * 1. Identity — verify agent tokens, lookup agent info
 * 2. Trust — check trust scores, record observations
 * 3. Communication — send/receive email via AgentLair
 *
 * Usage:
 *   import { createAgentLairTools } from '@agentlair/mastra/tools';
 *
 *   const tools = createAgentLairTools({ apiKey: process.env.AGENTLAIR_API_KEY });
 *   const agent = new Agent({ tools });
 */

import { z } from 'zod';
import type { AgentLairConfig, TrustScore } from './types.js';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const verifyAgentInputSchema = z.object({
  token: z.string().describe('EdDSA-signed JWT (AAT) to verify'),
  audience: z.string().optional().describe('Expected audience claim'),
});

const verifyAgentOutputSchema = z.object({
  valid: z.boolean(),
  agentId: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  auditUrl: z.string().optional(),
  error: z.string().optional(),
});

const trustScoreInputSchema = z.object({
  agentId: z.string().describe('AgentLair account ID to look up'),
});

const trustScoreOutputSchema = z.object({
  agentId: z.string(),
  score: z.number().min(0).max(1000),
  tier: z.enum(['untrusted', 'provisional', 'trusted', 'verified']),
  breakdown: z.object({
    behavioral: z.number(),
    consistency: z.number(),
    reputation: z.number(),
    transparency: z.number(),
  }),
  computedAt: z.string(),
  observationCount: z.number(),
  error: z.string().optional(),
});

const trustGateInputSchema = z.object({
  agentId: z.string().describe('AgentLair account ID to check'),
  minimumScore: z
    .number()
    .min(0)
    .max(1000)
    .default(500)
    .describe('Minimum trust score required'),
  requiredTier: z
    .enum(['untrusted', 'provisional', 'trusted', 'verified'])
    .optional()
    .describe('Minimum trust tier required (overrides minimumScore)'),
});

const trustGateOutputSchema = z.object({
  allowed: z.boolean(),
  score: z.number().optional(),
  tier: z.enum(['untrusted', 'provisional', 'trusted', 'verified']).optional(),
  reason: z.string().optional(),
  requiredScore: z.number(),
});

const recordObservationInputSchema = z.object({
  topic: z.string().describe('Observation topic (e.g., "tool-usage", "behavioral-anomaly")'),
  content: z.string().max(10000).describe('Observation content (max 10K chars)'),
  shared: z.boolean().default(false).describe('Make visible to all authenticated agents'),
});

const recordObservationOutputSchema = z.object({
  id: z.string(),
  topic: z.string(),
  recorded: z.boolean(),
  error: z.string().optional(),
});

const sendEmailInputSchema = z.object({
  from: z.string().describe('Sender address (must be a claimed @agentlair.dev address)'),
  to: z.union([z.string(), z.array(z.string())]).describe('Recipient address(es)'),
  subject: z.string().describe('Email subject'),
  text: z.string().optional().describe('Plain text body'),
  html: z.string().optional().describe('HTML body'),
});

const sendEmailOutputSchema = z.object({
  id: z.string(),
  status: z.enum(['sent', 'queued']),
  error: z.string().optional(),
});

const checkInboxInputSchema = z.object({
  address: z.string().describe('AgentLair email address to check'),
  limit: z.number().min(1).max(100).default(20).describe('Max messages to return'),
});

const checkInboxOutputSchema = z.object({
  messages: z.array(
    z.object({
      messageId: z.string(),
      from: z.string(),
      subject: z.string(),
      snippet: z.string(),
      receivedAt: z.string(),
      read: z.boolean(),
    }),
  ),
  count: z.number(),
  hasMore: z.boolean(),
  error: z.string().optional(),
});

// ─── Tool implementations ────────────────────────────────────────────────────

async function apiRequest<T>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(baseUrl + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// ─── Tool factory ────────────────────────────────────────────────────────────

/**
 * Tool definition compatible with Mastra's ToolAction interface.
 * Uses duck-typing — no hard dependency on @mastra/core at runtime.
 */
interface ToolDef<TIn, TOut> {
  id: string;
  description: string;
  inputSchema: z.ZodType<TIn>;
  outputSchema: z.ZodType<TOut>;
  execute: (input: TIn, context?: unknown) => Promise<TOut>;
}

export interface CreateToolsOptions extends AgentLairConfig {
  /**
   * Include identity verification tools.
   * @default true
   */
  includeIdentity?: boolean;
  /**
   * Include trust scoring tools.
   * @default true
   */
  includeTrust?: boolean;
  /**
   * Include communication (email) tools.
   * @default true
   */
  includeCommunication?: boolean;
}

/**
 * Create AgentLair tools for use in a Mastra agent.
 *
 * Returns a Record<string, ToolAction> that can be spread directly into
 * the agent's `tools` config, or passed to `createTool()` for wrapping.
 *
 * @example
 * import { createAgentLairTools } from '@agentlair/mastra/tools';
 * import { Agent } from '@mastra/core/agent';
 *
 * const tools = createAgentLairTools({ apiKey: process.env.AGENTLAIR_API_KEY });
 * const agent = new Agent({ tools: { ...tools, ...otherTools } });
 */
export function createAgentLairTools(options: CreateToolsOptions = {}) {
  const baseUrl = (options.baseUrl ?? 'https://agentlair.dev').replace(/\/$/, '');
  const jwksUrl = options.jwksUrl ?? `${baseUrl}/.well-known/jwks.json`;
  const apiKey = options.apiKey ?? '';

  const tools: Record<string, ToolDef<any, any>> = {};

  // ── Identity tools ─────────────────────────────────────────────────────────

  if (options.includeIdentity !== false) {
    tools['agentlair-verify-agent'] = {
      id: 'agentlair-verify-agent',
      description:
        'Verify an AgentLair agent identity token (AAT). Returns the agent\'s identity claims if the EdDSA signature is valid and the token is not expired.',
      inputSchema: verifyAgentInputSchema,
      outputSchema: verifyAgentOutputSchema,
      execute: async (input) => {
        try {
          // Dynamic import to avoid circular dependency
          const { verifyAAT } = await import('./jwks.js');
          const claims = await verifyAAT(input.token, {
            jwksUrl,
            audience: input.audience,
          });
          return {
            valid: true,
            agentId: claims.sub,
            name: claims.al_name,
            email: claims.al_email,
            scopes: claims.al_scopes,
            auditUrl: claims.al_audit_url,
          };
        } catch (err) {
          return {
            valid: false,
            error: err instanceof Error ? err.message : 'Verification failed',
          };
        }
      },
    };
  }

  // ── Trust tools ────────────────────────────────────────────────────────────

  if (options.includeTrust !== false) {
    tools['agentlair-trust-score'] = {
      id: 'agentlair-trust-score',
      description:
        'Look up the behavioral trust score for an agent. Returns a 0–1000 score with breakdown by category (behavioral, consistency, reputation, transparency).',
      inputSchema: trustScoreInputSchema,
      outputSchema: trustScoreOutputSchema,
      execute: async (input) => {
        try {
          const score = await apiRequest<TrustScore>(
            baseUrl,
            apiKey,
            'GET',
            `/v1/trust/${encodeURIComponent(input.agentId)}`,
          );
          return score;
        } catch (err) {
          return {
            agentId: input.agentId,
            score: 0,
            tier: 'untrusted' as const,
            breakdown: { behavioral: 0, consistency: 0, reputation: 0, transparency: 0 },
            computedAt: new Date().toISOString(),
            observationCount: 0,
            error: err instanceof Error ? err.message : 'Trust score lookup failed',
          };
        }
      },
    };

    tools['agentlair-trust-gate'] = {
      id: 'agentlair-trust-gate',
      description:
        'Check if an agent meets a minimum trust threshold before allowing a sensitive action. Use this before executing high-risk operations to ensure the requesting agent is trustworthy.',
      inputSchema: trustGateInputSchema,
      outputSchema: trustGateOutputSchema,
      execute: async (input) => {
        try {
          const score = await apiRequest<TrustScore>(
            baseUrl,
            apiKey,
            'GET',
            `/v1/trust/${encodeURIComponent(input.agentId)}`,
          );

          // Check tier if specified
          if (input.requiredTier) {
            const tierOrder = ['untrusted', 'provisional', 'trusted', 'verified'];
            const agentTierIdx = tierOrder.indexOf(score.tier);
            const requiredTierIdx = tierOrder.indexOf(input.requiredTier);
            if (agentTierIdx < requiredTierIdx) {
              return {
                allowed: false,
                score: score.score,
                tier: score.tier,
                reason: `Agent tier "${score.tier}" below required "${input.requiredTier}"`,
                requiredScore: input.minimumScore,
              };
            }
          }

          // Check score
          const allowed = score.score >= input.minimumScore;
          return {
            allowed,
            score: score.score,
            tier: score.tier,
            reason: allowed ? undefined : `Score ${score.score} below minimum ${input.minimumScore}`,
            requiredScore: input.minimumScore,
          };
        } catch (err) {
          return {
            allowed: false,
            reason: err instanceof Error ? err.message : 'Trust check failed',
            requiredScore: input.minimumScore,
          };
        }
      },
    };

    tools['agentlair-record-observation'] = {
      id: 'agentlair-record-observation',
      description:
        'Record a behavioral observation about an agent or event. Observations feed into the trust scoring system. Use this to report anomalies, successful interactions, or behavioral patterns.',
      inputSchema: recordObservationInputSchema,
      outputSchema: recordObservationOutputSchema,
      execute: async (input) => {
        try {
          const result = await apiRequest<{ id: string; topic: string }>(
            baseUrl,
            apiKey,
            'POST',
            '/v1/observations',
            { topic: input.topic, content: input.content, shared: input.shared },
          );
          return { id: result.id, topic: result.topic, recorded: true };
        } catch (err) {
          return {
            id: '',
            topic: input.topic,
            recorded: false,
            error: err instanceof Error ? err.message : 'Failed to record observation',
          };
        }
      },
    };
  }

  // ── Communication tools ────────────────────────────────────────────────────

  if (options.includeCommunication !== false) {
    tools['agentlair-send-email'] = {
      id: 'agentlair-send-email',
      description:
        'Send an email from an @agentlair.dev address. The sender address must be claimed by the authenticated account.',
      inputSchema: sendEmailInputSchema,
      outputSchema: sendEmailOutputSchema,
      execute: async (input) => {
        try {
          const result = await apiRequest<{ id: string; status: string }>(
            baseUrl,
            apiKey,
            'POST',
            '/v1/email/send',
            input,
          );
          return { id: result.id, status: result.status as 'sent' | 'queued' };
        } catch (err) {
          return {
            id: '',
            status: 'queued' as const,
            error: err instanceof Error ? err.message : 'Send failed',
          };
        }
      },
    };

    tools['agentlair-check-inbox'] = {
      id: 'agentlair-check-inbox',
      description:
        'Check the email inbox for an @agentlair.dev address. Returns message previews (not full bodies).',
      inputSchema: checkInboxInputSchema,
      outputSchema: checkInboxOutputSchema,
      execute: async (input) => {
        try {
          const result = await apiRequest<{
            messages: Array<{
              message_id: string;
              from: string;
              subject: string;
              snippet: string;
              received_at: string;
              read: boolean;
            }>;
            count: number;
            has_more: boolean;
          }>(baseUrl, apiKey, 'GET', '/v1/email/inbox', {
            address: input.address,
            limit: String(input.limit),
          });
          return {
            messages: result.messages.map((m) => ({
              messageId: m.message_id,
              from: m.from,
              subject: m.subject,
              snippet: m.snippet,
              receivedAt: m.received_at,
              read: m.read,
            })),
            count: result.count,
            hasMore: result.has_more,
          };
        } catch (err) {
          return {
            messages: [],
            count: 0,
            hasMore: false,
            error: err instanceof Error ? err.message : 'Inbox check failed',
          };
        }
      },
    };
  }

  return tools;
}

// ─── Re-export schemas for consumers who want to use createTool() directly ──

export {
  verifyAgentInputSchema,
  verifyAgentOutputSchema,
  trustScoreInputSchema,
  trustScoreOutputSchema,
  trustGateInputSchema,
  trustGateOutputSchema,
  recordObservationInputSchema,
  recordObservationOutputSchema,
  sendEmailInputSchema,
  sendEmailOutputSchema,
  checkInboxInputSchema,
  checkInboxOutputSchema,
};
