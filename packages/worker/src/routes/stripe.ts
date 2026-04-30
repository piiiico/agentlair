// ─── Stripe Checkout Sessions ─────────────────────────────────────────────────
// Traditional card-based checkout for AgentLair paid tiers.
// Uses native fetch to call Stripe REST API (no npm package — CF Workers compatible).
//
// Activation (Håkon):
//   1. Create Stripe account at dashboard.stripe.com
//   2. Create products: Starter ($29/mo) and Pro ($149/mo)
//   3. Run: wrangler secret put STRIPE_SECRET_KEY
//          wrangler secret put STRIPE_WEBHOOK_SECRET
//   4. Deploy via agentlair-pipeline skill
//
// Routes:
//   POST /v1/checkout            — Create checkout session (auth required)
//   POST /v1/stripe/webhook      — Handle Stripe events (no auth, signature verified)

import type { Env, Account } from '../types.js';
import { json, err, hmacSha256 } from '../utils.js';

// ─── Tier Config ──────────────────────────────────────────────────────────────

interface TierConfig {
  name: string;
  unitAmount: number; // cents
  tier: 'starter' | 'pro';
}

const TIER_CONFIG: Record<string, TierConfig> = {
  starter: { name: 'AgentLair Starter', unitAmount: 2900, tier: 'starter' },
  pro:     { name: 'AgentLair Pro',     unitAmount: 14900, tier: 'pro' },
};

export async function handleCheckout(
  request: Request,
  env: Env,
  account: Account,
): Promise<Response> {
  // Feature flag: Stripe must be configured
  if (!env.STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({
      error: 'stripe_not_configured',
      message: 'Stripe checkout is not yet active. Join the waitlist while we finish setup.',
      stripe_available: false,
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { tier?: string };
  try {
    body = await request.json() as { tier?: string };
  } catch {
    return err('Invalid JSON body.', 400, 'invalid_body');
  }

  const tierKey = (body.tier || '').toLowerCase().trim();
  const tierCfg = TIER_CONFIG[tierKey];
  if (!tierCfg) {
    return err('Tier must be "starter" or "pro".', 400, 'invalid_tier');
  }

  // Build form-encoded checkout session request
  const params = new URLSearchParams({
    mode: 'subscription',
    success_url: 'https://agentlair.dev/pricing?checkout=success',
    cancel_url: 'https://agentlair.dev/pricing?checkout=cancelled',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': tierCfg.name,
    'line_items[0][price_data][unit_amount]': String(tierCfg.unitAmount),
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][quantity]': '1',
    'metadata[account_id]': account.id,
    'metadata[tier]': tierCfg.tier,
  });

  // Prefill email if available
  const email = account.operator_email || account.recovery_email;
  if (email && typeof email === 'string') {
    params.set('customer_email', email);
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const errBody = await stripeRes.json() as { error?: { message?: string } };
    console.error('Stripe checkout error:', errBody);
    return err(
      errBody?.error?.message || 'Failed to create checkout session. Please try again.',
      502,
      'stripe_error',
    );
  }

  const session = await stripeRes.json() as { url?: string; id?: string };
  if (!session.url) {
    return err('Stripe returned no checkout URL.', 502, 'stripe_no_url');
  }

  return json({ url: session.url, session_id: session.id });
}

// ─── POST /v1/stripe/webhook ──────────────────────────────────────────────────
// Processes Stripe events. No auth — Stripe signature verification instead.
// Must read raw body before any JSON parsing to verify signature.

export async function handleStripeWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    // Return 200 so Stripe doesn't retry — we just can't verify it yet
    console.warn('STRIPE_WEBHOOK_SECRET not set — webhook received but not processed');
    return json({ ok: true, skipped: true });
  }

  const sigHeader = request.headers.get('Stripe-Signature');
  if (!sigHeader) {
    return err('Missing Stripe-Signature header.', 400, 'missing_signature');
  }

  // Read raw body (required for signature verification)
  const rawBody = await request.text();

  // Verify webhook signature
  // Stripe-Signature: t=timestamp,v1=hash,v0=hash
  const sigParts: Record<string, string[]> = {};
  for (const part of sigHeader.split(',')) {
    const [k, v] = part.split('=');
    if (k && v) {
      sigParts[k] = sigParts[k] || [];
      sigParts[k].push(v);
    }
  }

  const timestamp = sigParts['t']?.[0];
  const v1Signatures = sigParts['v1'] || [];

  if (!timestamp || v1Signatures.length === 0) {
    return err('Invalid Stripe-Signature format.', 400, 'invalid_signature');
  }

  // Reject events older than 5 minutes (replay protection)
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) {
    return err('Webhook timestamp too old.', 400, 'stale_webhook');
  }

  // Compute expected signature: HMAC-SHA256(secret, "{timestamp}.{body}")
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = await hmacSha256(env.STRIPE_WEBHOOK_SECRET, signedPayload);

  const signatureValid = v1Signatures.some(sig => sig === expected);
  if (!signatureValid) {
    return err('Webhook signature mismatch.', 400, 'signature_mismatch');
  }

  // Parse event
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return err('Invalid JSON in webhook body.', 400, 'invalid_json');
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session['metadata'] as Record<string, string> | undefined;
    const accountId = metadata?.['account_id'];
    const tier = metadata?.['tier'];

    if (!accountId || !tier || !TIER_CONFIG[tier as string]) {
      console.error('Stripe webhook: missing account_id or tier in session metadata', session['id']);
      return json({ ok: true, skipped: true, reason: 'missing_metadata' });
    }

    // Upgrade account tier in KV
    try {
      await upgradeAccountTier(env, accountId, tier as 'starter' | 'pro', session);
    } catch (upgradeErr) {
      console.error('Stripe webhook: tier upgrade failed:', upgradeErr);
      // Return 500 so Stripe retries
      return new Response(JSON.stringify({ error: 'upgrade_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Log to D1 revenue ledger
    if (env.AUDIT) {
      const amountTotal = (session['amount_total'] as number) || 0;
      try {
        await logStripeRevenue(env, accountId, tier, amountTotal, session['id'] as string);
      } catch (logErr) {
        // Non-blocking — upgrade already succeeded
        console.error('Stripe webhook: revenue log failed:', logErr);
      }
    }

    return json({ ok: true, account_id: accountId, tier: tier as string });
  }

  // Ignore other event types (return 200 so Stripe doesn't retry)
  return json({ ok: true, skipped: true, event_type: event.type });
}

// ─── Account Tier Upgrade ─────────────────────────────────────────────────────
// Mirrors the x402.ts auto-upgrade pattern.

async function upgradeAccountTier(
  env: Env,
  accountId: string,
  tier: 'starter' | 'pro',
  sessionData: Record<string, unknown>,
): Promise<void> {
  const keyHash = await env.KEYS.get('account:' + accountId);
  if (!keyHash) throw new Error(`Account not found: ${accountId}`);

  const raw = await env.KEYS.get('key:' + keyHash);
  if (!raw) throw new Error(`Account data not found for key hash: ${keyHash}`);

  const account = JSON.parse(raw) as Account;
  const now = new Date().toISOString();
  // 30 days from now — webhook fires on each billing cycle if we want recurring
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const updatedAccount: Account = {
    ...account,
    tier,
    tier_upgraded_at: now,
    tier_expires_at: expiresAt,
    tier_upgrade_source: 'stripe',
    tier_stripe_session_id: sessionData['id'] as string | undefined,
  };

  // Remove ephemeral session field before persisting
  delete (updatedAccount as Record<string, unknown>)['_session'];

  await env.KEYS.put('key:' + keyHash, JSON.stringify(updatedAccount));
}

// ─── Revenue Ledger ───────────────────────────────────────────────────────────
// Logs Stripe payment to D1 spend_ledger (same table as x402 payments).

async function logStripeRevenue(
  env: Env,
  accountId: string,
  tier: string,
  amountCents: number,
  sessionId: string,
): Promise<void> {
  if (!env.AUDIT) return;

  // Convert cents to micro-USDC equivalent (cents → dollars → USDC atomic units)
  // Note: we store as USD cents in description, use 6-decimal representation for ledger
  const amountUsdc = amountCents * 10000; // cents → USDC atomic units (1 cent = 10000 units)

  try {
    await env.AUDIT.prepare(
      `INSERT INTO spend_ledger (id, account_id, key_id, timestamp, amount_usdc, category, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`
    ).bind(
      sessionId,
      accountId,
      'stripe',
      new Date().toISOString(),
      amountUsdc,
      `stripe_${tier}`,
      `Stripe checkout — ${tier} tier — $${(amountCents / 100).toFixed(2)}/mo`,
    ).run();
  } catch (e) {
    // spend_ledger may not exist in all deployments — non-fatal
    console.warn('Stripe revenue log (spend_ledger):', e);
  }
}
