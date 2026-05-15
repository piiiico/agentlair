/**
 * @agentlair/x402-trust-gate — types
 */

// ─── Trust ────────────────────────────────────────────────────────────────────

export type TrustLevel = "principal" | "senior" | "junior" | "intern";

export interface TrustResult {
  /** Canonical trust tier */
  level: TrustLevel;
  /** 0–100 trust score */
  score: number;
  /** Agent identifier (sub claim from AAT, or 'anonymous') */
  agentId: string;
  /** Whether the agent is flagged/blocked */
  blocked: boolean;
  /** Raw introspection data if available */
  raw?: Record<string, unknown>;
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

export interface PriceTier {
  /** Human-readable tier name */
  name: string;
  /** Price multiplier relative to base (1.0 = base price) */
  multiplier: number;
  /** Whether requests are blocked (no payment option) */
  blocked: boolean;
}

export interface TrustGateConfig {
  /** Base price in USDC atomic units (6 decimals). e.g. 10000 = 0.01 USDC */
  baseAmount: string;

  /** USDC contract address on the target network */
  asset: string;

  /** Network identifier. Default: Base mainnet */
  network: string;

  /** Address to receive payments */
  payTo: string;

  /** x402 facilitator URL for payment verification */
  facilitator: string;

  /** Resource URL (used in PaymentRequired) */
  resourceUrl: string;

  /** Resource description (used in PaymentRequired) */
  description: string;

  /** AgentLair API base URL. Default: https://agentlair.dev */
  agentlairBase?: string;

  /** AgentLair API key (required for trust check endpoint). Optional — token introspection is public. */
  agentlairApiKey?: string;

  /**
   * Optional price tier overrides.
   * Defaults: trusted=1x, junior=5x, unknown=10x, blocked=403
   */
  tiers?: {
    trusted?: Pick<PriceTier, "multiplier">;
    junior?: Pick<PriceTier, "multiplier">;
    unknown?: Pick<PriceTier, "multiplier">;
  };

  /** Upstream URL to proxy requests to after payment verification. Optional for standalone mode. */
  upstream?: string;

  /** max x402 timeout seconds. Default: 60 */
  maxTimeoutSeconds?: number;
}

// ─── x402 Protocol ────────────────────────────────────────────────────────────

export interface X402PaymentRequired {
  x402Version: number;
  resource: {
    url: string;
    description: string;
  };
  accepts: X402PaymentOption[];
}

export interface X402PaymentOption {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402VerifyResult {
  isValid: boolean;
  error?: string;
  payer?: string;
}

export interface X402SettleResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export interface TrustGateResult {
  /** Whether the request is allowed to proceed */
  allowed: boolean;

  /** Trust information */
  trust: TrustResult;

  /** The price shown to the agent (after trust multiplier) */
  effectiveAmount: string;

  /** Reason for blocking (if applicable) */
  blockedReason?: string;
}
