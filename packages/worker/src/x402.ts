// ─── x402 Payment Config ──────────────────────────────────────────────────────
// x402 enables autonomous agents to pay per-email when rate limits are hit.
// Flow: rate limit hit → 402 with payment requirements → agent pays USDC on Base → retries with X-PAYMENT header
// Ref: https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md

import type { X402VerifyResult, X402SettleResult } from './types.js';

export const X402_CONFIG = {
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  facilitator: 'https://facilitator.ultravioletadao.xyz',
  payTo: '0x90EE1EbcCFA2021711C595E1410e22401570B4AC',
  maxTimeoutSeconds: 60,
  x402Version: 2,
};

// 0.01 USDC per email send (6 decimals = 10000 atomic units)
export const EMAIL_PAYMENT_AMOUNT = '10000';

export const EMAIL_PAYMENT_REQUIREMENTS = {
  scheme: 'exact',
  network: X402_CONFIG.network,
  maxAmountRequired: EMAIL_PAYMENT_AMOUNT,
  asset: X402_CONFIG.asset,
  payTo: X402_CONFIG.payTo,
  resource: 'https://agentlair.dev/v1/email/send',
  description: 'AgentLair email send — 0.01 USDC per email when rate limit exceeded.',
  mimeType: 'application/json',
  maxTimeoutSeconds: X402_CONFIG.maxTimeoutSeconds,
  extra: { name: 'USDC', version: '2' },
};

export const EMAIL_PAYMENT_REQUIRED_RESPONSE = {
  x402Version: X402_CONFIG.x402Version,
  error: 'Payment required: 0.01 USDC on Base to send email beyond rate limit.',
  accepts: [EMAIL_PAYMENT_REQUIREMENTS],
};

// ─── x402 Payment Types ──────────────────────────────────────────────────────

interface PaymentPayload {
  payload?: unknown;
  [key: string]: unknown;
}

interface FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

// ─── x402 Payment Verification & Settlement ──────────────────────────────────

export async function verifyX402Payment(paymentHeader: string): Promise<X402VerifyResult> {
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = JSON.parse(atob(paymentHeader)) as PaymentPayload;
  } catch {
    return { valid: false, error: 'Invalid X-PAYMENT header: not valid base64 JSON' };
  }

  // Extract inner payload (signature + authorization) — facilitator expects this, not the full envelope
  const innerPayload = paymentPayload.payload || paymentPayload;

  const verifyBody = {
    x402Version: X402_CONFIG.x402Version,
    payload: innerPayload,
    resource: {
      url: EMAIL_PAYMENT_REQUIREMENTS.resource,
      description: EMAIL_PAYMENT_REQUIREMENTS.description,
      mimeType: EMAIL_PAYMENT_REQUIREMENTS.mimeType,
    },
    accepted: {
      scheme: EMAIL_PAYMENT_REQUIREMENTS.scheme,
      network: EMAIL_PAYMENT_REQUIREMENTS.network,
      asset: EMAIL_PAYMENT_REQUIREMENTS.asset,
      amount: EMAIL_PAYMENT_REQUIREMENTS.maxAmountRequired,
      payTo: EMAIL_PAYMENT_REQUIREMENTS.payTo,
      maxTimeoutSeconds: EMAIL_PAYMENT_REQUIREMENTS.maxTimeoutSeconds,
    },
  };

  try {
    const res = await fetch(`${X402_CONFIG.facilitator}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verifyBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { valid: false, error: `Facilitator verify failed (${res.status}): ${text}` };
    }

    const result = (await res.json()) as FacilitatorVerifyResponse;
    if (!result.isValid) {
      return { valid: false, error: result.invalidReason || 'Payment verification failed' };
    }

    return { valid: true, payer: result.payer, rawPayload: paymentPayload };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { valid: false, error: `Facilitator unreachable: ${message}` };
  }
}

export async function settleX402Payment(paymentHeader: string): Promise<X402SettleResult> {
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = JSON.parse(atob(paymentHeader)) as PaymentPayload;
  } catch {
    return { settled: false, error: 'Invalid payment for settlement' };
  }

  const innerPayload = paymentPayload.payload || paymentPayload;

  const settleBody = {
    x402Version: X402_CONFIG.x402Version,
    payload: innerPayload,
    resource: {
      url: EMAIL_PAYMENT_REQUIREMENTS.resource,
      description: EMAIL_PAYMENT_REQUIREMENTS.description,
      mimeType: EMAIL_PAYMENT_REQUIREMENTS.mimeType,
    },
    accepted: {
      scheme: EMAIL_PAYMENT_REQUIREMENTS.scheme,
      network: EMAIL_PAYMENT_REQUIREMENTS.network,
      asset: EMAIL_PAYMENT_REQUIREMENTS.asset,
      amount: EMAIL_PAYMENT_REQUIREMENTS.maxAmountRequired,
      payTo: EMAIL_PAYMENT_REQUIREMENTS.payTo,
      maxTimeoutSeconds: EMAIL_PAYMENT_REQUIREMENTS.maxTimeoutSeconds,
    },
  };

  try {
    const res = await fetch(`${X402_CONFIG.facilitator}/settle`, {
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
