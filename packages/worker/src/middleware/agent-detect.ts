/**
 * agent-detect: Middleware for serving agent-optimized content
 *
 * The insight: AI agents browsing the web see HTML designed for humans.
 * They waste tokens on nav bars, CSS, and JS bundles instead of the data
 * they need. Detect agents, serve them machine-optimized content instead.
 *
 * This is HTTP content negotiation for the agent era.
 *
 * Adapted from /workspace/memory/play/agent-first/agent-detect.ts
 * for Cloudflare Workers (standard Web APIs only — no Bun-specific code).
 */

// User-agent patterns that indicate an AI agent or headless browser
const AGENT_UA_PATTERNS = [
  /HeadlessChrome/i,
  /ClaudeBot/i,
  /GPTBot/i,
  /ChatGPT-User/i,
  /anthropic-ai/i,
  /PerplexityBot/i,
  /curl\//,    // Agents often use curl or similar
  /python-requests/i,
  /axios/i,
  /got\//i,
  /node-fetch/i,
  /undici/i,
];

// Explicit agent headers
const AGENT_EXPLICIT_HEADERS = [
  'x-agent-request',
  'x-llm-request',
  'x-ai-client',
  'x-openai-client',
  'x-anthropic-client',
];

export interface DetectionResult {
  isAgent: boolean;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}

/**
 * Detect if a request comes from an AI agent or automated client.
 * Works with standard Web API Headers (CF Workers compatible).
 */
export function detectAgent(headers: Headers): DetectionResult {
  const signals: string[] = [];

  const ua = headers.get('user-agent') || '';
  const accept = headers.get('accept') || '';

  // Check explicit agent headers (high confidence)
  for (const h of AGENT_EXPLICIT_HEADERS) {
    if (headers.get(h) !== null) {
      signals.push(`explicit-header:${h}`);
    }
  }

  // Check user-agent patterns
  for (const pattern of AGENT_UA_PATTERNS) {
    if (pattern.test(ua)) {
      signals.push(`ua-match:${pattern.source}`);
    }
  }

  // HeadlessChrome without sec-ch-ua is a strong signal
  if (ua.includes('HeadlessChrome') && !headers.get('sec-ch-ua')) {
    signals.push('headless-no-hints');
  }

  // No cookies + no referer = likely programmatic
  if (!headers.get('cookie') && !headers.get('referer')) {
    signals.push('no-cookie-no-referer');
  }

  // Accept: application/json only (no HTML) = definitely API client
  if (accept && !accept.includes('text/html') && accept.includes('application/json')) {
    signals.push('json-only-accept');
  }

  // Accept: application/agent+json = explicit agent protocol
  if (accept.includes('application/agent+json')) {
    signals.push('agent-accept-header');
  }

  // No accept header at all = likely programmatic (browsers always send Accept)
  if (!accept) {
    signals.push('no-accept-header');
  }

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'low';
  const highSignals = signals.filter(
    (s) => s.startsWith('explicit-header') || s.startsWith('agent-accept'),
  );
  const medSignals = signals.filter(
    (s) =>
      s === 'headless-no-hints' ||
      s === 'json-only-accept' ||
      s.includes('ClaudeBot') ||
      s.includes('GPTBot'),
  );

  if (highSignals.length > 0) confidence = 'high';
  else if (medSignals.length > 0 || signals.length >= 2) confidence = 'medium';
  else if (signals.length >= 1) confidence = 'low';

  return {
    isAgent: signals.length > 0,
    confidence,
    signals,
  };
}

/**
 * The AgentLair agent manifest.
 * Served to AI agents and automated clients instead of the HTML landing page.
 */
export const AGENTLAIR_MANIFEST = {
  type: 'agent-manifest',
  version: '1.0',
  service: {
    name: 'AgentLair',
    description: 'Infrastructure for AI agents: email, secrets vault, persistent storage, and agent isolation',
    base_url: 'https://agentlair.dev/v1',
  },
  auth: {
    type: 'api_key',
    header: 'Authorization: Bearer al_live_...',
    description: 'Get a free API key at https://agentlair.dev or by calling POST /v1/auth/keys (no credentials required for first key)',
  },
  tools: [
    {
      name: 'register',
      description: 'Create a new API key — no credentials required. Self-service onboarding for agents.',
      method: 'POST',
      path: '/auth/keys',
      returns: '{ api_key: "al_live_...", account_id: "..." }',
    },
    {
      name: 'claim_email',
      description: 'Claim an @agentlair.dev email address for receiving and sending mail. Pass public_key to enable E2E encryption.',
      method: 'POST',
      path: '/email/claim',
      body: {
        address: { type: 'string', description: 'Email address to claim (e.g., myagent@agentlair.dev)', required: true },
        public_key: { type: 'string', description: 'Optional X25519 public key (base64url, 32 bytes) for E2E encryption', required: false },
      },
      returns: '{ claimed: true, address: "myagent@agentlair.dev" }',
    },
    {
      name: 'send_email',
      description: 'Send an email from your claimed @agentlair.dev address to any recipient.',
      method: 'POST',
      path: '/email/send',
      body: {
        to: { type: 'string', description: 'Recipient email address', required: true },
        from: { type: 'string', description: 'Your claimed @agentlair.dev address', required: true },
        subject: { type: 'string', description: 'Email subject line', required: true },
        body: { type: 'string', description: 'Plain text email body', required: true },
      },
      returns: '{ sent: true, message_id: "..." }',
    },
    {
      name: 'read_inbox',
      description: 'List emails received at a claimed address. Supports pagination.',
      method: 'GET',
      path: '/email/inbox',
      params: {
        address: { type: 'string', description: 'Your @agentlair.dev email address', required: true },
        limit: { type: 'number', description: 'Max emails to return (default 20, max 100)', required: false },
      },
      returns: '{ messages: [{ message_id, from, subject, body_preview, received_at }], count: N }',
    },
    {
      name: 'read_message',
      description: 'Read full email message body. If E2E encrypted, returns ciphertext for client-side decryption.',
      method: 'GET',
      path: '/email/messages/{id}',
      params: {
        address: { type: 'string', description: 'The @agentlair.dev address that received the message', required: true },
      },
      returns: '{ message_id, from, to, subject, body, received_at } or { e2e_encrypted: true, ciphertext: "..." }',
    },
    {
      name: 'vault_store',
      description: 'Store a secret or encrypted blob in the persistent vault under a named key.',
      method: 'PUT',
      path: '/vault/{key}',
      body: {
        value: { type: 'string', description: 'Data to store (encrypt client-side before storing — AgentLair does not hold your encryption keys)', required: true },
      },
      returns: '{ stored: true, key: "...", version: N }',
    },
    {
      name: 'vault_get',
      description: 'Retrieve a stored secret or blob from the vault by key name.',
      method: 'GET',
      path: '/vault/{key}',
      returns: '{ key: "...", value: "...", version: N }',
    },
    {
      name: 'provision_stack',
      description: 'Provision a persistent key-value stack for durable agent state across sessions.',
      method: 'POST',
      path: '/stack',
      body: {
        name: { type: 'string', description: 'Human-readable stack name (optional)', required: false },
      },
      returns: '{ stack_id: "...", api_key: "al_live_..." }',
    },
    {
      name: 'create_pod',
      description: 'Create an isolated agent pod with its own API key and fully isolated namespace. Ideal for multi-tenant platforms.',
      method: 'POST',
      path: '/pods',
      body: {
        name: { type: 'string', description: 'Pod name (optional)', required: false },
      },
      returns: '{ pod_id: "...", api_key: "al_pod_..." }',
    },
  ],
  hints: {
    preferred_format: 'application/agent+json',
    rate_limits: 'Free tier: 100 req/day. Upgrade at https://agentlair.dev',
    best_practices: [
      'Set Accept: application/agent+json on requests to always receive this machine-optimized manifest',
      'Add ?verbose=false to any request to strip human-readable guidance and reduce token usage',
      'Use POST /v1/auth/keys to self-register — no human or credentials required',
      'Email addresses are auto-created on first claim — pick any available @agentlair.dev address',
      'Encrypt secrets client-side before vault storage — AgentLair cannot read your encrypted data',
      'Use pods to give each tenant or sub-agent a fully isolated namespace',
      'Register webhooks at POST /v1/email/webhooks to receive push notifications on email arrival',
    ],
  },
} as const;
