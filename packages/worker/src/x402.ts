// ─── x402 Payment Config ──────────────────────────────────────────────────────
// x402 enables autonomous agents to pay USDC when service limits are hit.
// Flow: limit hit → 402 with payment requirements → agent pays USDC on Base → retries with X-PAYMENT header
// Ref: https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md

import type { Env, X402VerifyResult, X402SettleResult } from './types.js';
import { verifyAATFromX402Extensions, type X402PaymentPayload } from './x402-identity.js';

export const X402_CONFIG = {
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  /** Primary facilitator — ultravioletadao.xyz (supports Base mainnet).
   *  CDP facilitator (x402.org) only supports Base Sepolia as of 2026-04-21.
   *  When CDP adds Base mainnet, swap primary/fallback. */
  facilitator: 'https://facilitator.ultravioletadao.xyz',
  facilitatorFallback: 'https://x402.org/facilitator',
  payTo: '0x90EE1EbcCFA2021711C595E1410e22401570B4AC',
  maxTimeoutSeconds: 60,
  x402Version: 2,
};

// ─── Per-Service Pricing ──────────────────────────────────────────────────────
// Each service has its own resource URL, price, and description.
// Amounts are in USDC atomic units (6 decimals): 10000 = 0.01 USDC.

export interface ServicePaymentConfig {
  amount: string;
  resource: string;
  description: string;
  mimeType: string;
  /** Bazaar discovery metadata — enables agentic.market auto-indexing. */
  discovery?: BazaarDiscovery;
}

// ─── Bazaar Discovery Metadata ────────────────────────────────────────────────
// Inline Bazaar extension builder — same output as @x402/extensions/bazaar
// but zero dependencies. Structure matches x402 Bazaar spec.

export interface BazaarDiscovery {
  bodyType?: 'json' | 'form-data' | 'text';
  input?: Record<string, unknown>;
  inputSchema?: {
    properties: Record<string, { type: string; description?: string; enum?: string[]; required?: boolean; default?: unknown }>;
    required?: string[];
  };
  output?: { example: Record<string, unknown> };
}

/** Build Bazaar discovery extension object for inclusion in 402 response `extensions`. */
function buildBazaarExtension(discovery: BazaarDiscovery) {
  const isPost = !!discovery.bodyType;

  const inputInfo: Record<string, unknown> = { type: 'http' };
  const inputSchemaProps: Record<string, unknown> = {
    type: { type: 'string', const: 'http' },
    method: {
      type: 'string',
      enum: isPost ? ['POST', 'PUT', 'PATCH'] : ['GET', 'HEAD', 'DELETE'],
    },
  };
  const inputSchemaRequired: string[] = ['type', 'method'];

  if (isPost) {
    inputInfo.bodyType = discovery.bodyType;
    if (discovery.input) inputInfo.body = discovery.input;
    inputSchemaProps.bodyType = { type: 'string', enum: ['json', 'form-data', 'text'] };
    if (discovery.inputSchema) {
      inputSchemaProps.body = {
        properties: discovery.inputSchema.properties,
        ...(discovery.inputSchema.required ? { required: discovery.inputSchema.required } : {}),
      };
    }
    inputSchemaRequired.push('bodyType', 'body');
  } else {
    if (discovery.input) inputInfo.queryParams = discovery.input;
    if (discovery.inputSchema) {
      inputSchemaProps.queryParams = {
        type: 'object',
        properties: discovery.inputSchema.properties,
        ...(discovery.inputSchema.required ? { required: discovery.inputSchema.required } : {}),
      };
    }
  }

  const outputInfo: Record<string, unknown> = { type: 'json' };
  if (discovery.output?.example) outputInfo.example = discovery.output.example;

  return {
    bazaar: {
      info: {
        input: inputInfo,
        output: outputInfo,
      },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: inputSchemaProps,
            required: inputSchemaRequired,
            additionalProperties: false,
          },
          output: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              example: { type: 'object' },
            },
            required: ['type'],
          },
        },
        required: ['input'],
      },
    },
  };
}

export const SERVICE_PRICES: Record<string, ServicePaymentConfig> = {
  email_send: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/email/send',
    description: 'AgentLair email send — 0.01 USDC per email when rate limit exceeded.',
    mimeType: 'application/json',
    discovery: {
      bodyType: 'json',
      input: { to: 'recipient@example.com', subject: 'Hello', text: 'Message body' },
      inputSchema: {
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          text: { type: 'string', description: 'Plain text email body' },
          html: { type: 'string', description: 'HTML email body (optional)' },
        },
        required: ['to', 'subject', 'text'],
      },
      output: { example: { messageId: 'msg_abc123', status: 'sent' } },
    },
  },
  vault_write: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/vault',
    description: 'AgentLair vault write — 0.01 USDC per key beyond free tier limit.',
    mimeType: 'application/json',
    discovery: {
      bodyType: 'json',
      input: { key: 'my-secret', value: 'encrypted-data' },
      inputSchema: {
        properties: {
          key: { type: 'string', description: 'Vault key name' },
          value: { type: 'string', description: 'Encrypted value (client-side AES-256-GCM)' },
        },
        required: ['key', 'value'],
      },
      output: { example: { key: 'my-secret', written: true } },
    },
  },
  calendar_event: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/calendar/events',
    description: 'AgentLair calendar event — 0.01 USDC per event beyond free tier limit.',
    mimeType: 'application/json',
    discovery: {
      bodyType: 'json',
      input: { title: 'Meeting', start: '2026-05-01T10:00:00Z', end: '2026-05-01T11:00:00Z' },
      inputSchema: {
        properties: {
          title: { type: 'string', description: 'Event title' },
          start: { type: 'string', description: 'Start time (ISO 8601)' },
          end: { type: 'string', description: 'End time (ISO 8601)' },
          description: { type: 'string', description: 'Event description' },
        },
        required: ['title', 'start'],
      },
      output: { example: { id: 'evt_123', title: 'Meeting', created: true } },
    },
  },
  stack_create: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/stack',
    description: 'AgentLair stack provision — 0.01 USDC per stack beyond free tier limit.',
    mimeType: 'application/json',
    discovery: {
      bodyType: 'json',
      input: { name: 'my-agent-stack' },
      inputSchema: {
        properties: {
          name: { type: 'string', description: 'Stack name' },
          config: { type: 'string', description: 'Stack configuration (JSON)' },
        },
        required: ['name'],
      },
      output: { example: { id: 'stk_abc', name: 'my-agent-stack', status: 'provisioned' } },
    },
  },
  tier_upgrade: {
    amount: '5000000', // 5.00 USDC
    resource: 'https://agentlair.dev/v1/account/upgrade',
    description: 'AgentLair tier upgrade — 5.00 USDC for 30 days of paid tier (10K req/day, 1K emails/day, 999 stacks).',
    mimeType: 'application/json',
    discovery: {
      bodyType: 'json',
      input: {},
      inputSchema: { properties: {}, required: [] },
      output: { example: { tier: 'paid', expires_at: '2026-06-01T00:00:00Z' } },
    },
  },
  general_api: {
    amount: '1000', // 0.001 USDC
    resource: 'https://agentlair.dev/v1/*',
    description: 'AgentLair API request — 0.001 USDC per request beyond free tier.',
    mimeType: 'application/json',
  },
  token_verify: {
    amount: '1000', // 0.001 USDC
    resource: 'https://agentlair.dev/v1/tokens/introspect',
    description: 'AgentLair token verification — 0.001 USDC per verification beyond free tier (1,000/month).',
    mimeType: 'application/json',
    discovery: {
      bodyType: 'json',
      input: { token: 'aat_...' },
      inputSchema: {
        properties: {
          token: { type: 'string', description: 'Agent Authentication Token (AAT) to verify' },
        },
        required: ['token'],
      },
      output: { example: { valid: true, agent_id: 'agent_123', issuer: 'agentlair.dev', expires_at: '2026-05-01T00:00:00Z' } },
    },
  },
  agent_provision: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/register',
    description: 'AgentLair agent registration — 0.01 USDC per agent beyond free tier (3 agents).',
    mimeType: 'application/json',
    discovery: {
      bodyType: 'json',
      input: { name: 'my-agent' },
      inputSchema: {
        properties: {
          name: { type: 'string', description: 'Agent display name' },
          description: { type: 'string', description: 'Agent description' },
        },
        required: ['name'],
      },
      output: { example: { agent_id: 'agent_abc', name: 'my-agent', aat: 'aat_...' } },
    },
  },
  // Event submit overage pricing — three tiers, one resource URL.
  // Free tier hits daily limit first (500/day); overage at $0.001/event.
  // Starter tier hits at 5,000/day; overage at $0.0005/event.
  // Pro tier hits at 50,000/day; overage at $0.0003/event.
  event_submit_free: {
    amount: '1000', // 0.001 USDC ($0.001)
    resource: 'https://agentlair.dev/v1/events',
    description: 'AgentLair event submit — 0.001 USDC per event when Free tier daily limit (500/day) is exceeded.',
    mimeType: 'application/json',
    discovery: {
      bodyType: 'json',
      input: { type: 'audit', action: 'email.send', agent_id: 'agent_123' },
      inputSchema: {
        properties: {
          type: { type: 'string', description: 'Event type (audit, metric, log)' },
          action: { type: 'string', description: 'Action identifier' },
          agent_id: { type: 'string', description: 'Source agent ID' },
          data: { type: 'string', description: 'Event payload (JSON)' },
        },
        required: ['type', 'action', 'agent_id'],
      },
      output: { example: { id: 'evt_abc', accepted: true } },
    },
  },
  event_submit_paid: {
    amount: '500', // 0.0005 USDC ($0.0005)
    resource: 'https://agentlair.dev/v1/events',
    description: 'AgentLair event submit — 0.0005 USDC per event when Starter tier daily limit (5,000/day) is exceeded.',
    mimeType: 'application/json',
  },
  event_submit_pro: {
    amount: '300', // 0.0003 USDC ($0.0003)
    resource: 'https://agentlair.dev/v1/events',
    description: 'AgentLair event submit — 0.0003 USDC per event when Pro tier daily limit (50,000/day) is exceeded.',
    mimeType: 'application/json',
  },
  // ─── Anonymous (no API key) x402-gated endpoints ─────────────────────────────
  // These are accessible without an AgentLair account — payment IS the authentication.
  trust_query: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/trust',
    description: 'AgentLair trust score query — 0.01 USDC per lookup.',
    mimeType: 'application/json',
    discovery: {
      input: { agent_id: 'acc_abc123' },
      inputSchema: {
        properties: {
          agent_id: { type: 'string', description: 'Agent ID to query trust score for (acc_...)' },
        },
        required: ['agent_id'],
      },
      output: {
        example: {
          agent_id: 'acc_abc123',
          score: 78.4,
          atf_level: 'junior',
          confidence: 0.82,
          observations: 142,
        },
      },
    },
  },
  memory_trust: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/agents/{id}/memory-trust',
    description: 'AgentLair memory trust query — 0.01 USDC per lookup. Returns verified memory behavioral patterns for an agent.',
    mimeType: 'application/json',
    discovery: {
      input: { agent_id: 'acc_abc123' },
      inputSchema: {
        properties: {
          agent_id: { type: 'string', description: 'Agent ID to query memory behavior for (acc_...)' },
        },
        required: ['agent_id'],
      },
      output: {
        example: {
          agent_id: 'acc_abc123',
          memory_behavior: {
            total_memory_tokens: 47,
            memory_read_count: 38,
            memory_write_count: 9,
            read_write_ratio: 0.809,
            access_pattern: 'read_heavy',
            consistency_score: 0.87,
          },
          verified_by: 'agentlair.dev',
        },
      },
    },
  },
  agent_lookup: {
    amount: '5000', // 0.005 USDC
    resource: 'https://agentlair.dev/v1/agents/lookup',
    description: 'AgentLair agent discovery lookup — 0.005 USDC to resolve agent name to identity.',
    mimeType: 'application/json',
    discovery: {
      input: { handle: 'research-agent' },
      inputSchema: {
        properties: {
          handle: { type: 'string', description: 'Agent handle (name part of @agentlair.dev email)' },
          email: { type: 'string', description: 'Full @agentlair.dev email address' },
          id: { type: 'string', description: 'Agent account ID (acc_...)' },
        },
      },
      output: {
        example: {
          id: 'acc_abc123',
          name: 'research-agent',
          email: 'research-agent@agentlair.dev',
          did: 'did:web:agentlair.dev:agents:acc_abc123',
          jwks_url: 'https://agentlair.dev/agents/acc_abc123/.well-known/jwks.json',
          registered_at: '2026-03-15T10:00:00Z',
          verified: true,
        },
      },
    },
  },
  audit_lookup: {
    amount: '1000', // 0.001 USDC
    resource: 'https://agentlair.dev/v1/audit',
    description: 'AgentLair token audit lookup — 0.001 USDC per JTI metadata query.',
    mimeType: 'application/json',
    discovery: {
      input: { jti: 'aat_AbCdEfGhIjKlMn01' },
      inputSchema: {
        properties: {
          jti: { type: 'string', description: 'Agent Authentication Token ID (aat_[A-Za-z0-9]{16}) — used as path segment: /v1/audit/{jti}' },
        },
        required: ['jti'],
      },
      output: {
        example: {
          jti: 'aat_AbCdEfGhIjKlMn01',
          issued_at: '2026-04-25T00:00:00Z',
          expires_at: '2026-04-26T00:00:00Z',
          audience: 'example.com',
          scopes: ['email:send'],
          status: 'active',
          revoked_at: null,
          revocation_reason: null,
          audit_log_url: 'https://agentlair.dev/v1/audit/log?action=auth.token_issue',
        },
      },
    },
  },
  event_submit_anon: {
    amount: '100', // 0.0001 USDC
    resource: 'https://agentlair.dev/v1/events',
    description: 'AgentLair behavioral event submission — 0.0001 USDC per batch (anonymous, no API key required).',
    mimeType: 'application/json',
    discovery: {
      bodyType: 'json',
      input: {
        agent_id: 'acc_abc123',
        events: [{ event_id: 'evt_001', timestamp: '2026-04-21T00:00:00Z', category: 'tool', action: 'tool.call', result: 'success' }],
      },
      inputSchema: {
        properties: {
          agent_id: { type: 'string', description: 'Agent account ID (acc_...) — required for anonymous submission', required: true },
          events: { type: 'string', description: 'Array of behavioral event objects' },
        },
        required: ['agent_id', 'events'],
      },
      output: { example: { accepted: 1, rejected: 0, source: 'anonymous' } },
    },
  },
} as const;

// ─── Backward-compatible email exports ────────────────────────────────────────
// These are used by email.ts and stacks.ts billing endpoint.

export const EMAIL_PAYMENT_AMOUNT = SERVICE_PRICES.email_send.amount;

export const EMAIL_PAYMENT_REQUIREMENTS = getPaymentRequirements(SERVICE_PRICES.email_send);

export const EMAIL_PAYMENT_REQUIRED_RESPONSE = {
  x402Version: X402_CONFIG.x402Version,
  error: 'Payment required: 0.01 USDC on Base to send email beyond rate limit.',
  accepts: [EMAIL_PAYMENT_REQUIREMENTS],
  ...(SERVICE_PRICES.email_send.discovery
    ? { extensions: buildBazaarExtension(SERVICE_PRICES.email_send.discovery) }
    : {}),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build x402 payment requirements object for a given service. */
export function getPaymentRequirements(service: ServicePaymentConfig) {
  return {
    scheme: 'exact' as const,
    network: X402_CONFIG.network,
    maxAmountRequired: service.amount,
    asset: X402_CONFIG.asset,
    payTo: X402_CONFIG.payTo,
    resource: service.resource,
    description: service.description,
    mimeType: service.mimeType,
    maxTimeoutSeconds: X402_CONFIG.maxTimeoutSeconds,
    extra: { name: 'USDC', version: '2' },
  };
}

/** Format atomic USDC amount to human-readable string. */
function formatUSDC(atomicAmount: string): string {
  const n = parseInt(atomicAmount);
  return (n / 1_000_000).toFixed(n % 10000 === 0 ? 2 : 3);
}

/** Build a full 402 response body for a given service. */
export function make402ResponseBody(service: ServicePaymentConfig, extra?: Record<string, unknown>) {
  const requirements = getPaymentRequirements(service);
  const body: Record<string, unknown> = {
    x402Version: X402_CONFIG.x402Version,
    error: `Payment required: ${formatUSDC(service.amount)} USDC on Base — ${service.description}`,
    accepts: [requirements],
    ...extra,
  };
  // Include Bazaar discovery metadata if defined — enables agentic.market auto-indexing
  if (service.discovery) {
    body.extensions = buildBazaarExtension(service.discovery);
  }
  return body;
}

/** Build a complete HTTP 402 Response for a service limit. */
export function make402Response(service: ServicePaymentConfig, extra?: Record<string, unknown>): Response {
  const body = make402ResponseBody(service, extra);
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-402-Version': String(X402_CONFIG.x402Version),
    },
  });
}

// ─── x402 Payment Types ──────────────────────────────────────────────────────

// Re-export X402PaymentPayload for callers that need the typed shape.
export type { X402PaymentPayload } from './x402-identity.js';

// Local alias with backward-compat signature (payload?: unknown still present).
type PaymentPayload = X402PaymentPayload;

interface FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

// ─── x402 Payment Verification & Settlement ──────────────────────────────────

/**
 * Verify an x402 payment against the facilitator.
 * @param paymentHeader Base64-encoded X-PAYMENT header value
 * @param service Service config to verify against (defaults to email for backward compat)
 */
export async function verifyX402Payment(
  paymentHeader: string,
  service: ServicePaymentConfig = SERVICE_PRICES.email_send,
): Promise<X402VerifyResult> {
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = JSON.parse(atob(paymentHeader)) as PaymentPayload;
  } catch {
    return { valid: false, error: 'Invalid X-PAYMENT header: not valid base64 JSON' };
  }

  // Extract inner payload (signature + authorization) — facilitator expects this, not the full envelope
  const innerPayload = paymentPayload.payload || paymentPayload;
  const requirements = getPaymentRequirements(service);

  const verifyBody = {
    x402Version: X402_CONFIG.x402Version,
    payload: innerPayload,
    resource: {
      url: requirements.resource,
      description: requirements.description,
      mimeType: requirements.mimeType,
    },
    accepted: {
      scheme: requirements.scheme,
      network: requirements.network,
      asset: requirements.asset,
      amount: requirements.maxAmountRequired,
      payTo: requirements.payTo,
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    },
  };

  // Try primary facilitator, then fallback on network errors.
  // HTTP 4xx/5xx = legitimate rejection → do NOT retry (security: don't shop for a permissive facilitator).
  // Fetch/network error = infrastructure issue → retry with fallback.
  const facilitators = [X402_CONFIG.facilitator, X402_CONFIG.facilitatorFallback];
  let lastError = '';

  for (const facilitatorUrl of facilitators) {
    try {
      const res = await fetch(`${facilitatorUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyBody),
      });

      // HTTP error = legitimate rejection, return immediately (don't retry)
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return { valid: false, error: `Facilitator verify failed (${res.status}): ${text}` };
      }

      const result = (await res.json()) as FacilitatorVerifyResponse;
      if (!result.isValid) {
        return { valid: false, error: result.invalidReason || 'Payment verification failed' };
      }

      // Log if fallback was used
      if (facilitatorUrl !== X402_CONFIG.facilitator) {
        console.log(`x402: verification succeeded via fallback facilitator ${facilitatorUrl}`);
      }

      // Opportunistically extract AgentLair identity from extensions (non-blocking).
      // Identity extraction failure never fails payment verification.
      const identity = await verifyAATFromX402Extensions(paymentPayload, {
        resourceUrl: requirements.resource,
      }).catch(() => null);

      return { valid: true, payer: result.payer, rawPayload: paymentPayload, facilitatorUrl, identity };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      lastError = message;
      // Network/fetch error → try next facilitator
      if (facilitatorUrl === X402_CONFIG.facilitator) {
        console.warn(`x402: primary facilitator unreachable (${message}), trying fallback...`);
      }
    }
  }

  return { valid: false, error: `All facilitators unreachable: ${lastError}` };
}

/**
 * Settle an x402 payment via the facilitator.
 * @param paymentHeader Base64-encoded X-PAYMENT header value
 * @param service Service config to settle against (defaults to email for backward compat)
 */
export async function settleX402Payment(
  paymentHeader: string,
  service: ServicePaymentConfig = SERVICE_PRICES.email_send,
  facilitatorUrl: string = X402_CONFIG.facilitator,
): Promise<X402SettleResult> {
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = JSON.parse(atob(paymentHeader)) as PaymentPayload;
  } catch {
    return { settled: false, error: 'Invalid payment for settlement' };
  }

  const innerPayload = paymentPayload.payload || paymentPayload;
  const requirements = getPaymentRequirements(service);

  const settleBody = {
    x402Version: X402_CONFIG.x402Version,
    payload: innerPayload,
    resource: {
      url: requirements.resource,
      description: requirements.description,
      mimeType: requirements.mimeType,
    },
    accepted: {
      scheme: requirements.scheme,
      network: requirements.network,
      asset: requirements.asset,
      amount: requirements.maxAmountRequired,
      payTo: requirements.payTo,
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    },
  };

  try {
    const res = await fetch(`${facilitatorUrl}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settleBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { settled: false, error: `Facilitator settle failed (${res.status}): ${text}` };
    }

    const result = (await res.json()) as Record<string, unknown>;
    return { settled: true, receipt: btoa(JSON.stringify(result)) };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { settled: false, error: `Facilitator settle unreachable: ${message}` };
  }
}

// ─── x402 Spend Tracking ──────────────────────────────────────────────────────
// Tracks cumulative x402 spend per account for billing visibility and auto-upgrade.

export interface X402SpendRecord {
  total: number;       // cumulative atomic USDC
  payments: number;    // total payment count
  last_at: string | null;
  payers?: Record<string, number>; // payer wallet address → payment count
}

// ─── Known/Internal Payer Addresses ─────────────────────────────────────────
// Wallet addresses we recognize (our own agents, test wallets, etc.)
// Payments from unknown addresses trigger an alert.
const KNOWN_PAYER_ADDRESSES: Set<string> = new Set([
  '0x90EE1EbcCFA2021711C595E1410e22401570B4AC'.toLowerCase(), // AgentLair payTo / internal
]);

/** Record an x402 payment for an account. Returns updated spend record. */
export async function trackX402Spend(
  env: Env,
  accountId: string,
  amount: string,
  opts?: { payer?: string; service?: string },
): Promise<X402SpendRecord> {
  const key = `x402-spend:${accountId}`;
  const payer = opts?.payer?.toLowerCase() || undefined;
  try {
    const raw = await env.KEYS.get(key);
    const current: X402SpendRecord = raw
      ? JSON.parse(raw)
      : { total: 0, payments: 0, last_at: null, payers: {} };
    current.total += parseInt(amount);
    current.payments += 1;
    current.last_at = new Date().toISOString();
    if (payer) {
      if (!current.payers) current.payers = {};
      current.payers[payer] = (current.payers[payer] || 0) + 1;
    }
    await env.KEYS.put(key, JSON.stringify(current), { expirationTtl: 86400 * 365 });

    // Track period spend for spending cap enforcement
    await trackPeriodSpend(env, accountId, amount);

    // Track in global revenue ledger
    await trackGlobalRevenue(env, amount, accountId, payer, opts?.service);

    // Alert on new/unknown payer
    if (payer && !KNOWN_PAYER_ADDRESSES.has(payer)) {
      await alertNewPayer(env, payer, accountId, amount, opts?.service);
    }

    return current;
  } catch {
    return { total: parseInt(amount), payments: 1, last_at: new Date().toISOString() };
  }
}

// ─── Global Revenue Tracking ────────────────────────────────────────────────
// Single KV key tracking aggregate revenue across all accounts.

export interface GlobalRevenueRecord {
  total: number;            // cumulative atomic USDC
  payments: number;         // total payment count
  first_at: string | null;
  last_at: string | null;
  by_service: Record<string, { total: number; payments: number }>;
  by_payer: Record<string, { total: number; payments: number; first_at: string; last_at: string }>;
  by_account: Record<string, { total: number; payments: number }>;
}

const GLOBAL_REVENUE_KEY = 'x402-revenue:global';

async function trackGlobalRevenue(
  env: Env,
  amount: string,
  accountId: string,
  payer?: string,
  service?: string,
): Promise<void> {
  try {
    const raw = await env.KEYS.get(GLOBAL_REVENUE_KEY);
    const record: GlobalRevenueRecord = raw
      ? JSON.parse(raw)
      : { total: 0, payments: 0, first_at: null, last_at: null, by_service: {}, by_payer: {}, by_account: {} };
    const now = new Date().toISOString();
    const amt = parseInt(amount);
    record.total += amt;
    record.payments += 1;
    if (!record.first_at) record.first_at = now;
    record.last_at = now;

    // By service
    const svc = service || 'unknown';
    if (!record.by_service[svc]) record.by_service[svc] = { total: 0, payments: 0 };
    record.by_service[svc].total += amt;
    record.by_service[svc].payments += 1;

    // By payer
    if (payer) {
      if (!record.by_payer[payer]) record.by_payer[payer] = { total: 0, payments: 0, first_at: now, last_at: now };
      record.by_payer[payer].total += amt;
      record.by_payer[payer].payments += 1;
      record.by_payer[payer].last_at = now;
    }

    // By account
    if (!record.by_account[accountId]) record.by_account[accountId] = { total: 0, payments: 0 };
    record.by_account[accountId].total += amt;
    record.by_account[accountId].payments += 1;

    await env.KEYS.put(GLOBAL_REVENUE_KEY, JSON.stringify(record), { expirationTtl: 86400 * 365 });
  } catch {
    // Non-critical — don't fail the payment
  }
}

/** Get global revenue data (for admin endpoint). */
export async function getGlobalRevenue(env: Env): Promise<GlobalRevenueRecord> {
  try {
    const raw = await env.KEYS.get(GLOBAL_REVENUE_KEY);
    return raw
      ? JSON.parse(raw)
      : { total: 0, payments: 0, first_at: null, last_at: null, by_service: {}, by_payer: {}, by_account: {} };
  } catch {
    return { total: 0, payments: 0, first_at: null, last_at: null, by_service: {}, by_payer: {}, by_account: {} };
  }
}

// ─── New Payer Alert ────────────────────────────────────────────────────────
// Tracks seen payer addresses in KV. When a never-before-seen payer pays,
// sends an email alert to the operator.

async function alertNewPayer(
  env: Env,
  payer: string,
  accountId: string,
  amount: string,
  service?: string,
): Promise<void> {
  const seenKey = `x402-payer-seen:${payer}`;
  try {
    const existing = await env.KEYS.get(seenKey);
    if (existing) return; // Already seen — no alert

    // Mark as seen (before sending alert to avoid duplicate alerts on race)
    const now = new Date().toISOString();
    await env.KEYS.put(seenKey, JSON.stringify({
      first_seen: now,
      first_account: accountId,
      first_service: service || 'unknown',
    }), { expirationTtl: 86400 * 365 });

    // Send email alert via Resend (if configured)
    if (!env.RESEND_API_KEY) return;
    const usdcAmount = (parseInt(amount) / 1_000_000).toFixed(6);
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AgentLair Revenue <noreply@agentlair.dev>',
        to: ['hakon@amdal.dev'],
        subject: `[AgentLair] New payer: ${payer.slice(0, 10)}...${payer.slice(-6)}`,
        text: [
          `New x402 payer detected on AgentLair.`,
          ``,
          `Payer:   ${payer}`,
          `Account: ${accountId}`,
          `Amount:  ${usdcAmount} USDC`,
          `Service: ${service || 'unknown'}`,
          `Time:    ${now}`,
          ``,
          `This is the first payment from this wallet address.`,
          `View on BaseScan: https://basescan.org/address/${payer}`,
        ].join('\n'),
      }),
    });
  } catch {
    // Non-critical — don't fail the payment for an alert
  }
}

/** Get cumulative x402 spend for an account. */
export async function getX402Spend(env: Env, accountId: string): Promise<X402SpendRecord> {
  try {
    const key = `x402-spend:${accountId}`;
    const raw = await env.KEYS.get(key);
    return raw ? JSON.parse(raw) : { total: 0, payments: 0, last_at: null };
  } catch {
    return { total: 0, payments: 0, last_at: null };
  }
}

// ─── Spending Cap Period Tracking ─────────────────────────────────────────────
// Tracks per-period USDC spend for spending cap enforcement.
// KV keys: x402-cap:{accountId}:day:{YYYY-MM-DD}
//          x402-cap:{accountId}:week:{YYYY-WNN}
//          x402-cap:{accountId}:month:{YYYY-MM}
// TTL: 35 days (covers monthly period + buffer)

function getPeriodKeys(): { day: string; week: string; month: string } {
  const now = new Date();
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // ISO week number
  const tmp = new Date(now.valueOf());
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((tmp.valueOf() - yearStart.valueOf()) / 86400000) + 1) / 7);
  const week = `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;

  const month = now.toISOString().slice(0, 7); // YYYY-MM

  return { day, week, month };
}

export interface PeriodSpend {
  daily: number;
  weekly: number;
  monthly: number;
}

/** Get current period spend for an account (for spending cap checks). */
export async function getPeriodSpend(env: Env, accountId: string): Promise<PeriodSpend> {
  const { day, week, month } = getPeriodKeys();
  try {
    const [dayRaw, weekRaw, monthRaw] = await Promise.all([
      env.KEYS.get(`x402-cap:${accountId}:day:${day}`),
      env.KEYS.get(`x402-cap:${accountId}:week:${week}`),
      env.KEYS.get(`x402-cap:${accountId}:month:${month}`),
    ]);
    return {
      daily:   parseInt(dayRaw   || '0'),
      weekly:  parseInt(weekRaw  || '0'),
      monthly: parseInt(monthRaw || '0'),
    };
  } catch {
    return { daily: 0, weekly: 0, monthly: 0 };
  }
}

/** Track spend for the current day/week/month periods. Fire-and-forget safe. */
export async function trackPeriodSpend(env: Env, accountId: string, amount: string): Promise<void> {
  const { day, week, month } = getPeriodKeys();
  const amt = parseInt(amount);
  const ttl = 86400 * 35; // 35 days
  try {
    await Promise.all([
      (async () => {
        const raw = await env.KEYS.get(`x402-cap:${accountId}:day:${day}`);
        const cur = parseInt(raw || '0');
        await env.KEYS.put(`x402-cap:${accountId}:day:${day}`, String(cur + amt), { expirationTtl: ttl });
      })(),
      (async () => {
        const raw = await env.KEYS.get(`x402-cap:${accountId}:week:${week}`);
        const cur = parseInt(raw || '0');
        await env.KEYS.put(`x402-cap:${accountId}:week:${week}`, String(cur + amt), { expirationTtl: ttl });
      })(),
      (async () => {
        const raw = await env.KEYS.get(`x402-cap:${accountId}:month:${month}`);
        const cur = parseInt(raw || '0');
        await env.KEYS.put(`x402-cap:${accountId}:month:${month}`, String(cur + amt), { expirationTtl: ttl });
      })(),
    ]);
  } catch {
    // Non-critical — don't fail the payment for tracking
  }
}

export interface SpendCapCheckResult {
  allowed: boolean;
  exceeded?: 'daily' | 'weekly' | 'monthly';
  current?: number;   // current period spend (atomic USDC)
  cap?: number;       // configured cap (atomic USDC)
}

/**
 * Check if a payment amount is within spending caps.
 * Returns { allowed: true } if no caps configured or within limits.
 * Returns { allowed: false, exceeded, current, cap } if would exceed a cap.
 */
export async function checkSpendingCap(
  env: Env,
  accountId: string,
  amount: string,
  caps: import('./types.js').SpendingCaps,
): Promise<SpendCapCheckResult> {
  if (!caps.daily && !caps.weekly && !caps.monthly) {
    return { allowed: true };
  }

  const amt = parseInt(amount);
  const spend = await getPeriodSpend(env, accountId);

  if (caps.daily != null && (spend.daily + amt) > caps.daily) {
    return { allowed: false, exceeded: 'daily', current: spend.daily, cap: caps.daily };
  }
  if (caps.weekly != null && (spend.weekly + amt) > caps.weekly) {
    return { allowed: false, exceeded: 'weekly', current: spend.weekly, cap: caps.weekly };
  }
  if (caps.monthly != null && (spend.monthly + amt) > caps.monthly) {
    return { allowed: false, exceeded: 'monthly', current: spend.monthly, cap: caps.monthly };
  }

  return { allowed: true };
}

/**
 * Auto-upgrade account to paid tier if cumulative spend crosses 1,000,000 atomic USDC (~1 USDC).
 * Silent — does not change the response shape. Fire-and-forget safe.
 */
export async function autoUpgradeIfThreshold(
  env: Env,
  account: { id: string; tier?: string; [key: string]: unknown },
  spend: X402SpendRecord,
): Promise<void> {
  // Pod accounts never auto-upgrade: their tier is always 'free' (enforced at creation).
  // Spending caps, not tier limits, control pod resource usage. See: task 27f24650db70c089
  if (spend.total < 1_000_000 || account.tier === 'paid' || account.type === 'pod') return;
  try {
    const keyHash = await env.KEYS.get('account:' + account.id);
    if (!keyHash) return;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const updatedAccount = { ...account, tier: 'paid', tier_upgraded_at: now, tier_expires_at: expiresAt };
    delete (updatedAccount as Record<string, unknown>)['_session'];
    await env.KEYS.put('key:' + keyHash, JSON.stringify(updatedAccount));
  } catch {
    // Silent — auto-upgrade is best-effort
  }
}

// ─── Billing Anomaly Detection ─────────────────────────────────────────────
// Compares each spend event against the 7-day rolling average for the same
// (account_id, category) tuple. Alerts when a single transaction exceeds 3x
// the rolling average — structural protection against silent billing spikes
// (see HERMES.md CVE, Anthropic anti-abuse system, Apr 2026).
//
// Thresholds (all configurable here):
//   MIN_SAMPLE:     3 prior transactions required (avoids false positives on new accounts)
//   ALERT_FACTOR:   3x rolling average triggers alert
//   MIN_AMOUNT:  1000 atomic USDC (~0.001 USDC) — skip noise from tiny transactions

const ANOMALY_MIN_SAMPLE = 3;
const ANOMALY_ALERT_FACTOR = 3;
const ANOMALY_MIN_AMOUNT = 1000; // 0.001 USDC in atomic units

export interface BillingAnomalyRow {
  id: string;
  account_id: string;
  category: string;
  timestamp: string;
  amount_usdc: number;
  rolling_avg_usdc: number;
  multiplier: number;
  spend_ledger_id: string;
  alerted: number;
  created_at: string;
}

/**
 * Check if a spend event is anomalous. If so, record it in billing_anomalies and
 * send an email alert. Fire-and-forget safe — never throws or blocks the caller.
 */
export async function checkAndAlertBillingAnomaly(
  env: Env,
  accountId: string,
  category: string,
  amountUsdc: number,
  spendLedgerId: string,
): Promise<void> {
  if (!env.AUDIT) return;
  if (amountUsdc < ANOMALY_MIN_AMOUNT) return;

  try {
    // Ensure table exists (idempotent DDL — safe to run per-request)
    await env.AUDIT.prepare(`
      CREATE TABLE IF NOT EXISTS billing_anomalies (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        category TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        amount_usdc INTEGER NOT NULL,
        rolling_avg_usdc INTEGER NOT NULL,
        multiplier REAL NOT NULL,
        spend_ledger_id TEXT NOT NULL,
        alerted INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // Compute 7-day rolling average, excluding current transaction
    const stats = await env.AUDIT.prepare(`
      SELECT AVG(amount_usdc) AS avg_amount, COUNT(*) AS tx_count
      FROM spend_ledger
      WHERE account_id = ?
        AND category = ?
        AND timestamp >= datetime('now', '-7 days')
        AND id != ?
    `).bind(accountId, category, spendLedgerId).first<{ avg_amount: number | null; tx_count: number }>();

    if (!stats || stats.tx_count < ANOMALY_MIN_SAMPLE || stats.avg_amount == null) return;

    const rollingAvg = Math.round(stats.avg_amount);
    if (rollingAvg === 0) return;

    const multiplier = amountUsdc / rollingAvg;
    if (multiplier <= ANOMALY_ALERT_FACTOR) return;

    // Record anomaly in DB
    const anomalyId = `ba_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const now = new Date().toISOString();
    const alerted = env.RESEND_API_KEY ? 1 : 0;

    await env.AUDIT.prepare(`
      INSERT INTO billing_anomalies
        (id, account_id, category, timestamp, amount_usdc, rolling_avg_usdc, multiplier, spend_ledger_id, alerted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(anomalyId, accountId, category, now, amountUsdc, rollingAvg, multiplier, spendLedgerId, alerted).run();

    // Email alert (if Resend configured)
    if (!env.RESEND_API_KEY) return;

    const usdcAmount = (amountUsdc / 1_000_000).toFixed(6);
    const avgUsdc = (rollingAvg / 1_000_000).toFixed(6);

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AgentLair Billing <noreply@agentlair.dev>',
        to: ['hakon@amdal.dev'],
        subject: `[AgentLair] Billing anomaly: ${multiplier.toFixed(1)}x spike on ${category}`,
        text: [
          'Billing anomaly detected on AgentLair.',
          '',
          `Account:    ${accountId}`,
          `Category:   ${category}`,
          `Amount:     ${usdcAmount} USDC`,
          `7-day avg:  ${avgUsdc} USDC`,
          `Multiplier: ${multiplier.toFixed(2)}x`,
          `Time:       ${now}`,
          '',
          `This transaction is ${multiplier.toFixed(1)}x the rolling 7-day average for this account/category.`,
          '',
          `Anomaly ID: ${anomalyId}`,
          `Ledger ref: ${spendLedgerId}`,
          '',
          'Review dashboard: https://agentlair.dev/v1/admin/billing-anomalies',
        ].join('\n'),
      }),
    });
  } catch {
    // Non-critical — never fail a payment for anomaly detection
  }
}

/**
 * Query billing anomalies for the admin dashboard.
 * Returns most recent anomalies first, up to `limit`.
 */
export async function getBillingAnomalies(
  db: D1Database,
  opts?: { limit?: number; accountId?: string },
): Promise<BillingAnomalyRow[]> {
  try {
    const limit = Math.min(opts?.limit ?? 50, 200);
    if (opts?.accountId) {
      const { results } = await db.prepare(
        `SELECT * FROM billing_anomalies WHERE account_id = ? ORDER BY timestamp DESC LIMIT ?`
      ).bind(opts.accountId, limit).all();
      return results as unknown as BillingAnomalyRow[];
    }
    const { results } = await db.prepare(
      `SELECT * FROM billing_anomalies ORDER BY timestamp DESC LIMIT ?`
    ).bind(limit).all();
    return results as unknown as BillingAnomalyRow[];
  } catch {
    return [];
  }
}
