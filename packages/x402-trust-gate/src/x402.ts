/**
 * @agentlair/x402-trust-gate — x402 protocol helpers
 *
 * Builds 402 Payment Required responses and verifies payments
 * via the x402 facilitator.
 *
 * Spec: https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md
 */

import type { X402PaymentRequired, X402VerifyResult, X402SettleResult } from "./types.js";

// ─── Build 402 Response ───────────────────────────────────────────────────────

export interface PaymentRequiredOptions {
  /** Effective price after trust multiplier (USDC atomic units) */
  amount: string;
  /** USDC contract address */
  asset: string;
  /** Network (e.g. "eip155:8453" for Base mainnet) */
  network: string;
  /** Wallet address to receive payment */
  payTo: string;
  /** Resource URL */
  resourceUrl: string;
  /** Resource description */
  description: string;
  /** Max seconds the payment authorization remains valid */
  maxTimeoutSeconds?: number;
  /** Extra metadata to include (e.g. trust tier info) */
  extra?: Record<string, unknown>;
}

/**
 * Build the PaymentRequired JSON object for a 402 response.
 */
export function buildPaymentRequired(opts: PaymentRequiredOptions): X402PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: opts.resourceUrl,
      description: opts.description,
    },
    accepts: [
      {
        scheme: "exact",
        network: opts.network,
        asset: opts.asset,
        amount: opts.amount,
        payTo: opts.payTo,
        maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 60,
        extra: opts.extra ?? {},
      },
    ],
  };
}

/**
 * Base64-encode a string safely (handles Unicode via UTF-8 encoding).
 * @internal exported for use in middleware
 */
export function safeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Build a 402 Payment Required HTTP response.
 *
 * The PAYMENT-REQUIRED header contains a base64-encoded JSON PaymentRequired object.
 * The body includes a human-readable explanation.
 */
export function build402Response(
  paymentRequired: X402PaymentRequired,
  trustInfo?: { agentId: string; tier: string; multiplier: number }
): Response {
  const encoded = safeBase64(JSON.stringify(paymentRequired));

  const body = {
    error: "Payment required",
    message: trustInfo
      ? `This endpoint requires payment. Your trust tier is '${trustInfo.tier}' (${trustInfo.multiplier}x price multiplier). Trusted agents (senior/principal level) pay the base price.`
      : "This endpoint requires payment. Include payment in the PAYMENT-SIGNATURE header.",
    x402: paymentRequired,
    learnMore: "https://agentlair.dev/docs/x402-trust-gate",
  };

  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": encoded,
      "X-Trust-Tier": trustInfo?.tier ?? "unknown",
      "X-Price-Multiplier": String(trustInfo?.multiplier ?? 10),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, X-Trust-Tier, X-Price-Multiplier",
    },
  });
}

/**
 * Build a 403 Forbidden response for blocked agents.
 */
export function build403Response(agentId: string): Response {
  return new Response(
    JSON.stringify({
      error: "Forbidden",
      message: `Agent '${agentId}' is flagged or blocked. Contact support@agentlair.dev if you believe this is incorrect.`,
      learnMore: "https://agentlair.dev/docs/trust",
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

// ─── Payment Verification ─────────────────────────────────────────────────────

/**
 * Extract the PAYMENT-SIGNATURE header from a request.
 * Returns null if not present.
 */
export function extractPaymentSignature(request: Request): string | null {
  return request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("X-PAYMENT") ?? null;
}

interface FacilitatorVerifyResponse {
  isValid: boolean;
  errorReason?: string;
  invalidReason?: string;
  payer?: string;
}

/**
 * Verify a payment signature via the x402 facilitator.
 *
 * @param paymentSignature - Base64-encoded PaymentPayload from client
 * @param paymentRequired - The PaymentRequired we issued in the 402
 * @param facilitatorUrl - Facilitator URL (e.g. https://facilitator.ultravioletadao.xyz)
 */
export async function verifyPayment(
  paymentSignature: string,
  paymentRequired: X402PaymentRequired,
  facilitatorUrl: string
): Promise<X402VerifyResult> {
  let paymentPayload: unknown;
  try {
    paymentPayload = JSON.parse(atob(paymentSignature));
  } catch {
    return { isValid: false, error: "Invalid payment signature encoding" };
  }

  const verifyUrl = `${facilitatorUrl}/verify`;

  let res: Response;
  try {
    res = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment: paymentPayload,
        paymentRequirements: paymentRequired.accepts[0],
        x402Version: paymentRequired.x402Version,
      }),
    });
  } catch (err) {
    return {
      isValid: false,
      error: `Facilitator network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { isValid: false, error: `Facilitator HTTP ${res.status}: ${body}` };
  }

  const result = (await res.json()) as FacilitatorVerifyResponse;

  return {
    isValid: result.isValid === true,
    error: result.errorReason ?? result.invalidReason,
    payer: result.payer,
  };
}

interface FacilitatorSettleResponse {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * Settle (broadcast) a payment via the x402 facilitator.
 *
 * @param paymentSignature - Base64-encoded PaymentPayload
 * @param paymentRequired - The PaymentRequired we issued
 * @param facilitatorUrl - Facilitator URL
 */
export async function settlePayment(
  paymentSignature: string,
  paymentRequired: X402PaymentRequired,
  facilitatorUrl: string
): Promise<X402SettleResult> {
  let paymentPayload: unknown;
  try {
    paymentPayload = JSON.parse(atob(paymentSignature));
  } catch {
    return { success: false, error: "Invalid payment signature encoding" };
  }

  const settleUrl = `${facilitatorUrl}/settle`;

  let res: Response;
  try {
    res = await fetch(settleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment: paymentPayload,
        paymentRequirements: paymentRequired.accepts[0],
        x402Version: paymentRequired.x402Version,
      }),
    });
  } catch (err) {
    return {
      success: false,
      error: `Facilitator network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { success: false, error: `Facilitator HTTP ${res.status}: ${body}` };
  }

  const result = (await res.json()) as FacilitatorSettleResponse;

  return {
    success: result.success === true,
    txHash: result.txHash,
    error: result.error,
  };
}
