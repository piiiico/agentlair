/**
 * Stripe Routes — Unit Tests. Production-correctness gate for handleCheckout
 * and handleStripeWebhook. Webhook handles real money: HMAC sig verification,
 * replay protection, idempotency must be correct or revenue leaks.
 * Run: bun test src/routes/stripe.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { handleCheckout, handleStripeWebhook } from './stripe.js';
import { hmacSha256 } from '../utils.js';
import type { Env, Account } from '../types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────
class MockKV {
  store = new Map<string, string>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async put(k: string, v: string) { this.store.set(k, v); }
  async delete(k: string) { this.store.delete(k); }
  _set(k: string, v: string) { this.store.set(k, v); }
}
interface LedgerRow { id: string; account_id: string; amount_usdc: number; category: string; }
class MockD1Stmt {
  private b: unknown[] = [];
  constructor(public sql: string, public db: MockD1) {}
  bind(...v: unknown[]) { this.b = v; return this; }
  async run() {
    if (this.sql.includes('INSERT INTO spend_ledger')) {
      const id = String(this.b[0] ?? '');
      if (this.db.ledgerById.has(id)) return { success: true, meta: { changes: 0 } };
      this.db.ledgerById.set(id, { id, account_id: String(this.b[1] ?? ''),
        amount_usdc: Number(this.b[4] ?? 0), category: String(this.b[5] ?? '') });
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }
}
class MockD1 {
  ledgerById = new Map<string, LedgerRow>();
  prepare(sql: string) { return new MockD1Stmt(sql, this); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const SECRET = 'whsec_test_for_unit_tests';
const makeEnv = (o: { stripeSecret?: string; webhookSecret?: string; keys?: MockKV; audit?: MockD1 } = {}): Env => ({
  KEYS: (o.keys ?? new MockKV()) as unknown as KVNamespace,
  EMAILS: new MockKV() as unknown as KVNamespace,
  VAULT: new MockKV() as unknown as KVNamespace,
  AE_ANALYTICS: undefined as unknown as AnalyticsEngineDataset,
  INBOX_NOTIFIER: undefined as unknown as DurableObjectNamespace,
  STRIPE_SECRET_KEY: o.stripeSecret, STRIPE_WEBHOOK_SECRET: o.webhookSecret,
  AUDIT: o.audit as unknown as D1Database,
});
const acct = (o: Partial<Account> = {}): Account => ({ id: 'acc_test123', tier: 'free', ...o });
const checkoutReq = (body: unknown) => new Request('https://agentlair.dev/v1/checkout', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const webhookReq = (rawBody: string, sig?: string) => new Request('https://agentlair.dev/v1/stripe/webhook', {
  method: 'POST', body: rawBody,
  headers: sig ? { 'Content-Type': 'application/json', 'Stripe-Signature': sig } : { 'Content-Type': 'application/json' },
});
/** Build a Stripe-Signature header matching `${ts}.${rawBody}` HMAC. */
async function signed(payload: object, opts: { tsOverride?: number; secret?: string } = {}) {
  const rawBody = JSON.stringify(payload);
  const ts = opts.tsOverride ?? Math.floor(Date.now() / 1000);
  const sig = await hmacSha256(opts.secret ?? SECRET, `${ts}.${rawBody}`);
  return { rawBody, header: `t=${ts},v1=${sig}` };
}
function upgradeEvent(o: {
  sessionId?: string; accountId?: string; tier?: string; amount?: number;
  /** Replaces metadata entirely (use for partial/missing-metadata cases). */
  metadata?: Record<string, string>;
} = {}): object {
  const metadata = o.metadata !== undefined ? o.metadata
    : { account_id: o.accountId ?? 'acc_test123', tier: o.tier ?? 'starter' };
  return { type: 'checkout.session.completed',
    data: { object: { id: o.sessionId ?? 'cs_default', amount_total: o.amount ?? 2900, metadata } } };
}
function seedAccount(keys: MockKV, accountId: string) {
  const keyHash = `hash_${accountId}`;
  keys._set(`account:${accountId}`, keyHash);
  keys._set(`key:${keyHash}`, JSON.stringify({ id: accountId, tier: 'free' }));
}
const errOf = async (r: Response) => ((await r.json()) as { error: string }).error;
const bodyOf = async (r: Response) => (await r.json()) as Record<string, unknown>;

// ─── handleCheckout ──────────────────────────────────────────────────────────

describe('handleCheckout', () => {
  const originalFetch = globalThis.fetch;
  let calls: { url: string; init: RequestInit | undefined }[] = [];

  const mockStripe = (impl: (url: string) => Response) => {
    globalThis.fetch = async (url, init) => {
      const u = url instanceof Request ? url.url : String(url);
      calls.push({ url: u, init });
      return impl(u);
    };
  };
  const stripeOk = (id = 'cs_ok', url = 'https://checkout.stripe.com/c/pay/cs_ok') =>
    mockStripe(() => new Response(JSON.stringify({ url, id }), { status: 200 }));

  beforeEach(() => { calls = []; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('1. 503 stripe_not_configured when STRIPE_SECRET_KEY missing', async () => {
    const r = await handleCheckout(checkoutReq({ tier: 'starter' }), makeEnv({}), acct());
    expect(r.status).toBe(503);
    const b = await bodyOf(r);
    expect(b.error).toBe('stripe_not_configured');
    expect(b.stripe_available).toBe(false);
  });

  test('2. 400 invalid_body on malformed JSON', async () => {
    const r = await handleCheckout(checkoutReq('not json'), makeEnv({ stripeSecret: 'sk' }), acct());
    expect(r.status).toBe(400);
    expect(await errOf(r)).toBe('invalid_body');
  });

  test('3. 400 invalid_tier on bad tier name', async () => {
    const r = await handleCheckout(checkoutReq({ tier: 'enterprise' }), makeEnv({ stripeSecret: 'sk' }), acct());
    expect(r.status).toBe(400);
    expect(await errOf(r)).toBe('invalid_tier');
  });

  test('4. starter builds Stripe params (2900 cents, monthly, metadata, auth header)', async () => {
    stripeOk('cs_starter');
    const r = await handleCheckout(checkoutReq({ tier: 'starter' }), makeEnv({ stripeSecret: 'sk_live' }), acct());
    expect(r.status).toBe(200);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const p = new URLSearchParams(String(calls[0].init?.body));
    expect(p.get('mode')).toBe('subscription');
    expect(p.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('2900');
    expect(p.get('line_items[0][price_data][recurring][interval]')).toBe('month');
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe('AgentLair Starter');
    expect(p.get('metadata[account_id]')).toBe('acc_test123');
    expect(p.get('metadata[tier]')).toBe('starter');
    expect((calls[0].init?.headers as Record<string, string>)['Authorization']).toBe('Bearer sk_live');
  });

  test('5. pro builds Stripe params (14900 cents)', async () => {
    stripeOk('cs_pro');
    await handleCheckout(checkoutReq({ tier: 'pro' }), makeEnv({ stripeSecret: 'sk' }), acct());
    const p = new URLSearchParams(String(calls[0].init?.body));
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('14900');
    expect(p.get('metadata[tier]')).toBe('pro');
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe('AgentLair Pro');
  });

  test('6. customer_email: operator_email preferred, recovery_email fallback', async () => {
    stripeOk();
    // operator_email wins when both present
    await handleCheckout(checkoutReq({ tier: 'starter' }), makeEnv({ stripeSecret: 'sk' }),
      acct({ operator_email: 'op@test.com', recovery_email: 'rec@test.com' }));
    expect(new URLSearchParams(String(calls[0].init?.body)).get('customer_email')).toBe('op@test.com');
    calls = [];
    // recovery_email used when operator_email missing
    await handleCheckout(checkoutReq({ tier: 'starter' }), makeEnv({ stripeSecret: 'sk' }),
      acct({ recovery_email: 'rec@test.com' }));
    expect(new URLSearchParams(String(calls[0].init?.body)).get('customer_email')).toBe('rec@test.com');
  });

  test('7. 502 stripe_error on Stripe API 4xx', async () => {
    mockStripe(() => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }));
    const r = await handleCheckout(checkoutReq({ tier: 'starter' }), makeEnv({ stripeSecret: 'sk_bad' }), acct());
    expect(r.status).toBe(502);
    expect(await errOf(r)).toBe('stripe_error');
  });

  test('8. 502 stripe_no_url when Stripe omits url field', async () => {
    mockStripe(() => new Response(JSON.stringify({ id: 'cs_test' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const r = await handleCheckout(checkoutReq({ tier: 'starter' }), makeEnv({ stripeSecret: 'sk' }), acct());
    expect(r.status).toBe(502);
    expect(await errOf(r)).toBe('stripe_no_url');
  });

  test('9. 200 with {url, session_id} on success', async () => {
    stripeOk('cs_starter_ok', 'https://checkout.stripe.com/c/pay/cs_starter_ok');
    const r = await handleCheckout(checkoutReq({ tier: 'starter' }), makeEnv({ stripeSecret: 'sk' }), acct());
    expect(r.status).toBe(200);
    const b = await r.json() as { url: string; session_id: string };
    expect(b.url).toBe('https://checkout.stripe.com/c/pay/cs_starter_ok');
    expect(b.session_id).toBe('cs_starter_ok');
  });
});

// ─── handleStripeWebhook ─────────────────────────────────────────────────────

describe('handleStripeWebhook', () => {
  test('10. 200 skipped:true when STRIPE_WEBHOOK_SECRET missing (no Stripe retries)', async () => {
    const r = await handleStripeWebhook(webhookReq('{}'), makeEnv({}));
    expect(r.status).toBe(200);
    const b = await bodyOf(r);
    expect(b.ok).toBe(true);
    expect(b.skipped).toBe(true);
  });

  test('11. 400 missing_signature when Stripe-Signature absent', async () => {
    const r = await handleStripeWebhook(webhookReq('{}'), makeEnv({ webhookSecret: SECRET }));
    expect(r.status).toBe(400);
    expect(await errOf(r)).toBe('missing_signature');
  });

  test('12. 400 invalid_signature on malformed sig header', async () => {
    const r = await handleStripeWebhook(webhookReq('{}', 'garbage_no_kv_pairs'), makeEnv({ webhookSecret: SECRET }));
    expect(r.status).toBe(400);
    expect(await errOf(r)).toBe('invalid_signature');
  });

  test('13. 400 stale_webhook when timestamp >5min old (replay protection)', async () => {
    const env = makeEnv({ webhookSecret: SECRET });
    const { rawBody, header } = await signed(upgradeEvent(),
      { tsOverride: Math.floor(Date.now() / 1000) - 600 });
    const r = await handleStripeWebhook(webhookReq(rawBody, header), env);
    expect(r.status).toBe(400);
    expect(await errOf(r)).toBe('stale_webhook');
  });

  test('14. 400 signature_mismatch when computed HMAC does not match v1', async () => {
    const env = makeEnv({ webhookSecret: SECRET });
    // Sign with a DIFFERENT secret → won't match what route computes from SECRET
    const { rawBody, header } = await signed(upgradeEvent(), { secret: 'wrong_secret' });
    const r = await handleStripeWebhook(webhookReq(rawBody, header), env);
    expect(r.status).toBe(400);
    expect(await errOf(r)).toBe('signature_mismatch');
  });

  test('15. GOLDEN: accepts valid v1 sig with correct timestamp+payload (HMAC computed manually)', async () => {
    // Production-correctness gate: we compute Stripe-Signature exactly as Stripe
    // does — HMAC-SHA256(secret, "{ts}.{rawBody}") — and verify the route accepts.
    const keys = new MockKV(); seedAccount(keys, 'acc_test123');
    const env = makeEnv({ webhookSecret: SECRET, keys });
    const { rawBody, header } = await signed(upgradeEvent());
    const r = await handleStripeWebhook(webhookReq(rawBody, header), env);
    expect(r.status).toBe(200);
    const b = await bodyOf(r);
    expect(b.ok).toBe(true);
    expect(b.account_id).toBe('acc_test123');
    expect(b.tier).toBe('starter');
  });

  test('16. checkout.session.completed → upgrades account in KV + logs to AUDIT', async () => {
    const keys = new MockKV(); seedAccount(keys, 'acc_paid_user');
    const audit = new MockD1();
    const env = makeEnv({ webhookSecret: SECRET, keys, audit });
    const { rawBody, header } = await signed(upgradeEvent({
      sessionId: 'cs_revenue_event_1', accountId: 'acc_paid_user', tier: 'pro', amount: 14900,
    }));
    expect((await handleStripeWebhook(webhookReq(rawBody, header), env)).status).toBe(200);
    // KV: account upgraded
    const updated = JSON.parse(keys.store.get('key:hash_acc_paid_user')!) as Account;
    expect(updated.tier).toBe('pro');
    expect(updated.tier_upgrade_source).toBe('stripe');
    expect(updated.tier_stripe_session_id).toBe('cs_revenue_event_1');
    expect(typeof updated.tier_upgraded_at).toBe('string');
    expect(typeof updated.tier_expires_at).toBe('string');
    // D1: spend_ledger row
    expect(audit.ledgerById.size).toBe(1);
    const row = audit.ledgerById.get('cs_revenue_event_1')!;
    expect(row.account_id).toBe('acc_paid_user');
    expect(row.amount_usdc).toBe(14900 * 10000); // cents → micro-USDC
    expect(row.category).toBe('stripe_pro');
  });

  test('17. missing metadata.account_id → 200 skipped:missing_metadata', async () => {
    const env = makeEnv({ webhookSecret: SECRET });
    const { rawBody, header } = await signed(upgradeEvent({ metadata: { tier: 'starter' } }));
    const r = await handleStripeWebhook(webhookReq(rawBody, header), env);
    expect(r.status).toBe(200);
    const b = await bodyOf(r);
    expect(b.skipped).toBe(true);
    expect(b.reason).toBe('missing_metadata');
  });

  test('18. 500 upgrade_failed when KV upgrade throws (Stripe will retry)', async () => {
    // Account NOT seeded → upgradeAccountTier throws "Account not found" → caught → 500
    const env = makeEnv({ webhookSecret: SECRET });
    const { rawBody, header } = await signed(upgradeEvent({ accountId: 'acc_not_seeded' }));
    const r = await handleStripeWebhook(webhookReq(rawBody, header), env);
    expect(r.status).toBe(500);
    expect(await errOf(r)).toBe('upgrade_failed');
  });

  test('19. unknown event type → 200 ok:true skipped:true', async () => {
    const env = makeEnv({ webhookSecret: SECRET });
    const { rawBody, header } = await signed({ type: 'invoice.paid', data: { object: {} } });
    const r = await handleStripeWebhook(webhookReq(rawBody, header), env);
    expect(r.status).toBe(200);
    const b = await bodyOf(r);
    expect(b.ok).toBe(true);
    expect(b.skipped).toBe(true);
    expect(b.event_type).toBe('invoice.paid');
  });

  test('20. IDEMPOTENCY: same session.id delivered twice → spend_ledger has only 1 row', async () => {
    const keys = new MockKV(); seedAccount(keys, 'acc_dup_user');
    const audit = new MockD1();
    const env = makeEnv({ webhookSecret: SECRET, keys, audit });
    const { rawBody, header } = await signed(upgradeEvent({
      sessionId: 'cs_duplicate_event', accountId: 'acc_dup_user', tier: 'starter', amount: 2900,
    }));
    expect((await handleStripeWebhook(webhookReq(rawBody, header), env)).status).toBe(200);
    // Stripe redelivers (network blip, retry, dupe webhook) — must not double-credit
    expect((await handleStripeWebhook(webhookReq(rawBody, header), env)).status).toBe(200);
    expect(audit.ledgerById.size).toBe(1);
    expect(audit.ledgerById.get('cs_duplicate_event')!.amount_usdc).toBe(2900 * 10000);
  });
});
