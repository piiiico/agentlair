// ─── x402 Payment Config ──────────────────────────────────────────────────────
// x402 enables autonomous agents to pay USDC when service limits are hit.
// Flow: limit hit → 402 with payment requirements → agent pays USDC on Base → retries with X-PAYMENT header
// Ref: https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md

import type { Env, X402VerifyResult, X402SettleResult } from './types.js';

export const X402_CONFIG = {
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  facilitator: 'https://facilitator.ultravioletadao.xyz',
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
}

export const SERVICE_PRICES: Record<string, ServicePaymentConfig> = {
  email_send: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/email/send',
    description: 'AgentLair email send — 0.01 USDC per email when rate limit exceeded.',
    mimeType: 'application/json',
  },
  vault_write: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/vault',
    description: 'AgentLair vault write — 0.01 USDC per key beyond free tier limit.',
    mimeType: 'application/json',
  },
  calendar_event: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/calendar/events',
    description: 'AgentLair calendar event — 0.01 USDC per event beyond free tier limit.',
    mimeType: 'application/json',
  },
  stack_create: {
    amount: '10000', // 0.01 USDC
    resource: 'https://agentlair.dev/v1/stack',
    description: 'AgentLair stack provision — 0.01 USDC per stack beyond free tier limit.',
    mimeType: 'application/json',
  },
  tier_upgrade: {
    amount: '5000000', // 5.00 USDC
    resource: 'https://agentlair.dev/v1/account/upgrade',
    description: 'AgentLair tier upgrade — 5.00 USDC for 30 days of paid tier (10K req/day, 1K emails/day, 999 stacks).',
    mimeType: 'application/json',
  },
  general_api: {
    amount: '1000', // 0.001 USDC
    resource: 'https://agentlair.dev/v1/*',
    description: 'AgentLair API request — 0.001 USDC per request beyond free tier.',
    mimeType: 'application/json',
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
  return {
    x402Version: X402_CONFIG.x402Version,
    error: `Payment required: ${formatUSDC(service.amount)} USDC on Base — ${service.description}`,
    accepts: [requirements],
    ...extra,
  };
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

/**
 * Settle an x402 payment via the facilitator.
 * @param paymentHeader Base64-encoded X-PAYMENT header value
 * @param service Service config to settle against (defaults to email for backward compat)
 */
export async function settleX402Payment(
  paymentHeader: string,
  service: ServicePaymentConfig = SERVICE_PRICES.email_send,
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
