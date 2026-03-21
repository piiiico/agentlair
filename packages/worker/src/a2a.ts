// ─── A2A Agent Card ──────────────────────────────────────────────────────────

export const AGENT_CARD = {
  schema_version: '0.8',
  name: 'AgentLair',
  description: 'Complete identity infrastructure for AI agents. Email addresses, encrypted vault, DNS, and hosting — all via REST API. No human gatekeeping.',
  url: 'https://agentlair.dev',
  iconUrl: 'https://agentlair.dev/favicon.ico',
  version: '0.17.0',
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
  ],
  authentication: {
    schemes: ['bearer'],
    description: 'AgentLair API key (al_live_...) — obtain free from POST /v1/auth/keys, no account required.',
  },
  contact: {
    email: 'api@agentlair.dev',
    url: 'https://agentlair.dev',
  },
};
