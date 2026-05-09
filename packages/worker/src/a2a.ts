// ─── A2A Agent Card ──────────────────────────────────────────────────────────

import { getPublicKey, computeKeyId, signJWS } from './jwt.js';

export const AGENT_CARD = {
  schema_version: '0.8',
  name: 'AgentLair',
  description: 'Complete identity infrastructure for AI agents. Email addresses, encrypted vault, DNS, and hosting — all via REST API. No human gatekeeping.',
  url: 'https://agentlair.dev',
  iconUrl: 'https://agentlair.dev/favicon.ico',
  version: '0.18.3',
  did: 'did:web:agentlair.dev',
  jwks_uri: 'https://agentlair.dev/.well-known/jwks.json',
  provider: {
    organization: 'Amdal Solutions AS',
    url: 'https://agentlair.dev',
  },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  skills: [
    {
      id: 'email-claim',
      name: 'Claim email address',
      description: 'Claim an @agentlair.dev email address for an AI agent. Returns active address ready to send/receive.',
      tags: ['email', 'infrastructure', 'provisioning'],
      examples: [
        'give my agent an email address',
        'provision email for code-review-agent',
        'claim research-agent@agentlair.dev',
      ],
    },
    {
      id: 'email-send',
      name: 'Send email',
      description: 'Send DKIM-signed email from a claimed @agentlair.dev address to any recipient.',
      tags: ['email', 'send', 'communication'],
      examples: [
        'send email to user@example.com from my agent',
        'email the client from my-agent@agentlair.dev',
      ],
    },
    {
      id: 'email-inbox',
      name: 'Read email inbox',
      description: 'Check inbox of any claimed @agentlair.dev address. Returns messages with full body and threading context.',
      tags: ['email', 'inbox', 'read'],
      examples: [
        'check inbox for my agent',
        'read emails received by my-agent@agentlair.dev',
      ],
    },
    {
      id: 'token-issue',
      name: 'Issue AAT',
      description: 'Issue an Agent Authentication Token (EdDSA JWT) for cross-org authentication.',
      tags: ['identity', 'authentication', 'jwt'],
      examples: [
        'issue a token for my agent',
        'get an AAT for cross-service auth',
      ],
    },
    {
      id: 'trust-query',
      name: 'Query agent trust',
      description: 'Retrieve behavioral trust score for any AgentLair-registered agent.',
      tags: ['trust', 'behavioral', 'monitoring'],
      examples: [
        'check trust score for agent X',
        'what is the behavioral trust level of this agent',
      ],
    },
  ],
  authentication: {
    schemes: ['bearer'],
    description: 'AgentLair API key (al_live_...) — obtain free from POST /v1/auth/keys, no account required.',
  },
  trust_attestation: {
    self_reported: true,
    trust_endpoint_template: 'https://agentlair.dev/v1/trust/{agentId}',
  },
  audit_trail_url_template: 'https://agentlair.dev/v1/audit/{jti}',
  behavioral_monitoring: {
    provider: 'agentlair.dev',
    type: 'continuous',
    description: 'Cross-org behavioral observation with trust score computation. 10+ observations required for attestation.',
  },
  contact: {
    email: 'api@agentlair.dev',
    url: 'https://agentlair.dev',
  },
};

/**
 * Build the agent card object, optionally signing it with the audit key.
 * Used by the /.well-known/agent.json route and internally by badge.ts
 * to bypass CF Worker self-fetch (which returns 522).
 */
export async function buildSignedAgentCard(
  signingKey?: string,
): Promise<Record<string, unknown>> {
  const card: Record<string, unknown> = { ...AGENT_CARD };

  if (signingKey) {
    const publicKeyBytes = getPublicKey(signingKey);
    const kid = await computeKeyId(publicKeyBytes);
    card.card_signature = signJWS(
      AGENT_CARD as unknown as Record<string, unknown>,
      signingKey,
      kid,
      'https://agentlair.dev/.well-known/jwks.json',
    );
  }

  return card;
}
