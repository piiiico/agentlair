// ─── Stack Routes ─────────────────────────────────────────────────────────────
// Handles: /v1/stack (create, list), /v1/usage, /v1/billing, /v1/observations
//
// All routes require authentication (account !== null).
// Auth is enforced by middleware in index.ts; each handler also belt-and-suspenders.
//
// Mounted in index.ts as: app.route('/v1', stackRoutes)
// Since routes span multiple prefixes (stack, usage, billing, observations),
// we mount at /v1 rather than a shared prefix.

import { Hono } from 'hono';
import { json, err, nanoid } from '../utils.js';
import type { HonoEnv } from '../types.js';
import { EMAIL_LIMITS } from '../middleware/ratelimit.js';
import { X402_CONFIG, SERVICE_PRICES, verifyX402Payment, settleX402Payment, make402Response, getX402Spend, trackX402Spend, autoUpgradeIfThreshold, checkSpendingCap } from '../x402.js';
import { tursoExecute } from '../email-provider.js';

// ─── Request body types ─────────────────────────────────────────────────────

interface StackCreateBody {
  domain?: string;
}

interface ObservationCreateBody {
  topic?: string;
  content?: unknown;
  shared?: boolean;
  display_name?: unknown;
}

export const stackRoutes = new Hono<HonoEnv>();

// ── POST /v1/stack — provision a new stack ────────────────────────────────────

stackRoutes.post('/stack', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  // Pod keys cannot manage stacks
  if (account.type === 'pod') {
    return err('Pod keys cannot manage stacks. Use your platform API key.', 403, 'pod_stack_forbidden');
  }

  const stacks = account.stacks ?? [];
  let body: StackCreateBody = {};
  try { body = await c.req.json() as StackCreateBody; } catch { /* empty body OK */ }
  const domain = body.domain;

  if (!domain) return err('domain is required. Example: {"domain": "myagent.dev"}', 400, 'missing_domain');

  // Idempotency check: if this domain already has a stack, return it (before tier limits)
  const stackKey = 'stack:' + account.id + ':' + domain;
  const existingStack = await c.env.KEYS.get(stackKey);
  if (existingStack) {
    return json(JSON.parse(existingStack));
  }

  let stackPaymentReceipt: string | undefined;
  if (stacks.length >= 1 && account.tier === 'free') {
    // Free tier limit reached — allow bypass via x402 payment
    const paymentHeader = c.req.raw.headers.get('X-PAYMENT');
    if (!paymentHeader) {
      return make402Response(SERVICE_PRICES.stack_create, {
        stack_limit: {
          current: stacks.length,
          limit: 1,
          tier: account.tier,
          upgrade_url: 'https://agentlair.dev/pricing',
          current_stacks: stacks,
        },
      });
    }
    // Verify the x402 payment
    const verification = await verifyX402Payment(paymentHeader, SERVICE_PRICES.stack_create);
    if (!verification.valid) {
      return new Response(JSON.stringify({
        error: 'payment_invalid',
        message: verification.error,
      }), {
        status: 402,
        headers: { 'Content-Type': 'application/json', 'X-402-Version': String(X402_CONFIG.x402Version) },
      });
    }
    // Check spending caps if this is a pod account
    if (account.type === 'pod' && account.pod_id) {
      try {
        const podRaw = await c.env.KEYS.get('pod:' + account.pod_id);
        if (podRaw) {
          const pod = JSON.parse(podRaw);
          if (pod.spending_caps) {
            const capCheck = await checkSpendingCap(c.env, account.id, SERVICE_PRICES.stack_create.amount, pod.spending_caps);
            if (!capCheck.allowed) {
              const periodLabel = capCheck.exceeded || 'period';
              const capUsdc = ((capCheck.cap || 0) / 1_000_000).toFixed(2);
              const currentUsdc = ((capCheck.current || 0) / 1_000_000).toFixed(2);
              return new Response(JSON.stringify({
                error: `Spending cap exceeded: ${periodLabel} limit of ${capUsdc} USDC reached (current: ${currentUsdc} USDC). Payment blocked by pod spending cap.`,
                code: 'spending_cap_exceeded',
                cap: { period: periodLabel, limit_usdc: capUsdc, current_usdc: currentUsdc },
              }), {
                status: 402,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }
        }
      } catch { /* fail-open: don't block payment for cap check error */ }
    }
    // Payment verified — settle and track spend
    try {
      const settlement = await settleX402Payment(paymentHeader, SERVICE_PRICES.stack_create);
      if (settlement.settled && settlement.receipt) {
        stackPaymentReceipt = settlement.receipt;
      }
    } catch {
      // Settlement is non-critical — proceed
    }
    try {
      const spend = await trackX402Spend(c.env, account.id, SERVICE_PRICES.stack_create.amount, { payer: verification.payer, service: 'stack_create' });
      await autoUpgradeIfThreshold(c.env, account, spend);
    } catch {
      // Non-critical
    }
  }

  const stackId = 'stk_' + nanoid(16);
  const now = new Date().toISOString();
  const stack = {
    id: stackId,
    domain,
    status: 'provisioning',
    account_id: account.id,
    created_at: now,
    email: 'contact@' + domain,
    nameservers: ['ns1.agentlair.dev', 'ns2.agentlair.dev'],
    note: 'Beta: DNS provisioning is stubbed. Full CF DNS integration coming Q2 2026.',
    next_steps: [
      'Update your domain nameservers to ns1.agentlair.dev + ns2.agentlair.dev',
      'Wait 24-48h for propagation',
      'GET /v1/stack/' + stackId + ' to check status',
    ],
  };

  await c.env.KEYS.put(stackKey, JSON.stringify(stack));

  stacks.push(stackId);
  account.stacks = stacks;
  const keyHash = await c.env.KEYS.get('account:' + account.id);
  if (keyHash) await c.env.KEYS.put('key:' + keyHash, JSON.stringify(account));

  if (stackPaymentReceipt) {
    return new Response(JSON.stringify(stack), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'X-Payment-Response': stackPaymentReceipt,
      },
    });
  }
  return json(stack, 201);
});

// ── GET /v1/stack — list stacks for account ───────────────────────────────────

stackRoutes.get('/stack', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const stacks = account.stacks ?? [];
  const stackList = stacks.map((stackId: string) => ({ id: stackId }));
  return json({ stacks: stackList, count: stackList.length });
});

// ── GET /v1/usage — show account usage stats ──────────────────────────────────

stackRoutes.get('/usage', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const stacks = account.stacks ?? [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const counterKey = 'rl:' + account.id + ':' + today;
  const emailDailyKey = `email_daily:${account.id}:${today}`;

  const [usedToday, emailDailyRaw] = await Promise.all([
    c.env.KEYS.get(counterKey),
    c.env.EMAILS ? c.env.EMAILS.get(emailDailyKey) : Promise.resolve(null),
  ]);

  const emailLimits = EMAIL_LIMITS[account.tier as keyof typeof EMAIL_LIMITS] || EMAIL_LIMITS.free;
  const emailDailyUsed = parseInt(emailDailyRaw || '0');
  const resetAt = new Date(now);
  resetAt.setUTCDate(resetAt.getUTCDate() + 1);
  resetAt.setUTCHours(0, 0, 0, 0);

  return json({
    account_id: account.id,
    tier: account.tier,
    tier_upgraded_at: account.tier_upgraded_at || null,
    tier_expires_at: account.tier_expires_at || null,
    period: today,
    requests: { used: parseInt(usedToday || '0'), limit: account.tier === 'paid' ? 10000 : 100 },
    stacks: { used: stacks.length, limit: account.tier === 'free' ? 1 : 999 },
    emails: {
      daily_used: emailDailyUsed,
      daily_limit: emailLimits.daily,
      daily_remaining: Math.max(0, emailLimits.daily - emailDailyUsed),
      hourly_limit: emailLimits.hourly,
      reset_at: resetAt.toISOString(),
    },
    status: 'active',
  });
});

// ── GET /v1/billing — show billing info ───────────────────────────────────────

stackRoutes.get('/billing', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const spend = await getX402Spend(c.env, account.id);

  return json({
    account_id: account.id,
    tier: account.tier,
    tier_upgraded_at: account.tier_upgraded_at || null,
    tier_expires_at: account.tier_expires_at || null,
    plan: account.tier === 'free' ? 'Free Beta' : 'Pro',
    next_invoice: null,
    upgrade_url: 'https://agentlair.dev/pricing',
    upgrade_endpoint: 'POST /v1/account/upgrade',
    note: 'Free tier includes rate-limited services. When service limits are exceeded, pay 0.01 USDC per write via x402 (USDC on Base). No Stripe needed — agents pay autonomously. Reads are always free. Upgrade to paid tier for 30 days via POST /v1/account/upgrade (5.00 USDC).',
    x402_spend: {
      total_atomic: spend.total,
      total_human: (spend.total / 1_000_000).toFixed(2) + ' USDC',
      payments_count: spend.payments,
      last_payment_at: spend.last_at,
    },
    x402: {
      supported: true,
      network: X402_CONFIG.network,
      asset: X402_CONFIG.asset,
      facilitator: X402_CONFIG.facilitator,
      how_it_works: 'When a service limit is hit, API returns HTTP 402 with payment requirements. Send X-PAYMENT header with base64-encoded payment payload to bypass limits.',
      services: {
        tier_upgrade: {
          price: '5.00 USDC',
          price_atomic: SERVICE_PRICES.tier_upgrade.amount,
          trigger: 'POST /v1/account/upgrade — one-time payment for 30 days of paid tier',
          resource: SERVICE_PRICES.tier_upgrade.resource,
        },
        email_send: {
          price: '0.01 USDC',
          price_atomic: SERVICE_PRICES.email_send.amount,
          trigger: 'Email rate limit exceeded (daily/hourly/burst)',
          resource: SERVICE_PRICES.email_send.resource,
        },
        vault_write: {
          price: '0.01 USDC',
          price_atomic: SERVICE_PRICES.vault_write.amount,
          trigger: 'Vault key limit reached on free tier',
          resource: SERVICE_PRICES.vault_write.resource,
        },
        calendar_event: {
          price: '0.01 USDC',
          price_atomic: SERVICE_PRICES.calendar_event.amount,
          trigger: 'Calendar event limit reached on free tier',
          resource: SERVICE_PRICES.calendar_event.resource,
        },
        stack_create: {
          price: '0.01 USDC',
          price_atomic: SERVICE_PRICES.stack_create.amount,
          trigger: 'Stack limit reached on free tier (1 stack free)',
          resource: SERVICE_PRICES.stack_create.resource,
        },
      },
    },
  });
});

// ── POST /v1/observations — write an observation ──────────────────────────────

stackRoutes.post('/observations', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  let body: ObservationCreateBody = {};
  try { body = await c.req.json() as ObservationCreateBody; } catch {
    return err('Invalid JSON body.', 400, 'invalid_body');
  }

  const { topic, content } = body;
  const shared = body.shared === true ? 1 : 0;
  const display_name = body.display_name || null;
  if (!topic || !content) {
    return err('Required: topic, content. Optional: shared (bool, default false), display_name (string, max 100 chars).', 400, 'missing_fields');
  }
  const agent_id = account.id;
  if (typeof content !== 'string' || content.length > 10000) {
    return err('content must be a string, max 10,000 characters.', 400, 'invalid_content');
  }
  if (display_name !== null && (typeof display_name !== 'string' || display_name.length > 100)) {
    return err('display_name must be a string, max 100 characters.', 400, 'invalid_display_name');
  }

  try {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const created_at = new Date().toISOString();

    await tursoExecute(c.env,
      'INSERT INTO shared_observations (id, agent_id, topic, content, created_at, account_id, shared, display_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, agent_id, topic, content, created_at, account.id, String(shared), display_name],
    );

    return json({ id, agent_id, display_name, topic, shared: !!shared, created_at }, 201);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to write observation: ${message}`, 502, 'turso_error');
  }
});

// ── GET /v1/observations/topics — list distinct topics ────────────────────────
// NOTE: Must be registered before GET /observations to avoid param ambiguity.

stackRoutes.get('/observations/topics', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  try {
    const result = await tursoExecute(c.env,
      'SELECT topic, COUNT(*) as count, MAX(created_at) as latest FROM shared_observations WHERE account_id = ? OR shared = 1 GROUP BY topic ORDER BY latest DESC',
      [account.id],
    );
    return json({ topics: result.rows, count: result.rows.length });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to list topics: ${message}`, 502, 'turso_error');
  }
});

// ── GET /v1/observations — read observations (own + shared by default) ─────────

stackRoutes.get('/observations', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  const topic = c.req.query('topic');
  const agent_id = c.req.query('agent_id');
  const since = c.req.query('since');
  const scope = c.req.query('scope') || 'all';
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);

  const conditions: string[] = [];
  const args: string[] = [];

  if (scope === 'mine') {
    conditions.push('account_id = ?');
    args.push(account.id);
  } else if (scope === 'shared') {
    conditions.push('shared = 1');
  } else {
    conditions.push('(account_id = ? OR shared = 1)');
    args.push(account.id);
  }

  if (topic) { conditions.push('topic = ?'); args.push(topic); }
  if (agent_id) { conditions.push('agent_id = ?'); args.push(agent_id); }
  if (since) { conditions.push('created_at >= ?'); args.push(since); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  args.push(String(limit));

  try {
    const result = await tursoExecute(c.env,
      `SELECT id, agent_id, display_name, topic, content, created_at, shared FROM shared_observations ${where} ORDER BY created_at DESC LIMIT ?`,
      args,
    );

    const observations = result.rows.map((r) => ({ ...r, shared: r.shared === '1' || r.shared === 1 }));

    return json({
      observations,
      count: observations.length,
      filters: { topic: topic || null, agent_id: agent_id || null, since: since || null, scope, limit },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Failed to read observations: ${message}`, 502, 'turso_error');
  }
});

// ── Catch-all for /v1/observations/* — return available routes info ────────────

stackRoutes.all('/observations/*', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  return json({
    available: [
      'POST /v1/observations — write an observation (body: {topic, content, shared?, display_name?})',
      'GET /v1/observations?topic=X&agent_id=Y&since=ISO&scope=all|mine|shared&limit=N',
      'GET /v1/observations/topics — list distinct topics (own + shared)',
    ],
    note: 'Observations are account-scoped by default. Set shared: true when writing to make visible to all agents. Read with scope=mine|shared|all (default: all = own + shared).',
  }, 200);
});
