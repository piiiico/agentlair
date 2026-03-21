// ─── Stack Routes ─────────────────────────────────────────────────────────────
// Handles: /v1/stack, /v1/usage, /v1/billing, /v1/observations, /v1/dns, /v1/hosting
//
// All routes require authentication (account !== null).

import { json, err } from '../utils.js';
import type { Env, RouteContext } from '../types.js';
import { EMAIL_LIMITS } from '../middleware/ratelimit.js';
import { X402_CONFIG, EMAIL_PAYMENT_AMOUNT } from '../x402.js';
import { tursoExecute } from '../email-provider.js';
import { nanoid } from '../utils.js';

export async function handleStackRoutes(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  { url, path, method, account }: RouteContext,
): Promise<Response | null> {

  // All stack/usage/billing/observation routes require auth
  if (!account) return null;

  // Pod keys cannot manage stacks (pod keys have no stacks[] field)
  if (account.type === 'pod' && (path === '/v1/stack')) {
    return err('Pod keys cannot manage stacks. Use your platform API key.', 403, 'pod_stack_forbidden');
  }

  // POST /v1/stack — provision a new stack
  if (path === '/v1/stack' && method === 'POST') {
    let body: any = {};
    try { body = await request.json(); } catch {}
    const domain = body.domain;

    if (!domain) return err('domain is required. Example: {"domain": "myagent.dev"}', 400, 'missing_domain');

    if (account.stacks.length >= 1 && account.tier === 'free') {
      return json({
        error: 'upgrade_required',
        message: 'Free tier allows 1 stack. Upgrade for unlimited stacks.',
        upgrade_url: 'https://agentlair.dev/pricing',
        current_stacks: account.stacks,
      }, 402);
    }

    const stackKey = 'stack:' + account.id + ':' + domain;
    const existingStack = await env.KEYS.get(stackKey);
    if (existingStack) {
      return json(JSON.parse(existingStack));
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

    await env.KEYS.put(stackKey, JSON.stringify(stack));

    account.stacks.push(stackId);
    const keyHash = await env.KEYS.get('account:' + account.id);
    if (keyHash) await env.KEYS.put('key:' + keyHash, JSON.stringify(account));

    return json(stack, 201);
  }

  // GET /v1/stack — list stacks for account
  if (path === '/v1/stack' && method === 'GET') {
    const stacks: any[] = [];
    for (const stackId of account.stacks) {
      stacks.push({ id: stackId });
    }
    return json({ stacks, count: stacks.length });
  }

  // GET /v1/usage — show account usage stats
  if (path === '/v1/usage' && method === 'GET') {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const counterKey = 'rl:' + account.id + ':' + today;
    const emailDailyKey = `email_daily:${account.id}:${today}`;

    const [usedToday, emailDailyRaw] = await Promise.all([
      env.KEYS.get(counterKey),
      env.EMAILS ? env.EMAILS.get(emailDailyKey) : Promise.resolve(null),
    ]);

    const emailLimits = EMAIL_LIMITS[account.tier as keyof typeof EMAIL_LIMITS] || EMAIL_LIMITS.free;
    const emailDailyUsed = parseInt(emailDailyRaw || '0');
    const resetAt = new Date(now);
    resetAt.setUTCDate(resetAt.getUTCDate() + 1);
    resetAt.setUTCHours(0, 0, 0, 0);

    return json({
      account_id: account.id,
      tier: account.tier,
      period: today,
      requests: { used: parseInt(usedToday || '0'), limit: account.tier === 'paid' ? 10000 : 100 },
      stacks: { used: account.stacks.length, limit: account.tier === 'free' ? 1 : 999 },
      emails: {
        daily_used: emailDailyUsed,
        daily_limit: emailLimits.daily,
        daily_remaining: Math.max(0, emailLimits.daily - emailDailyUsed),
        hourly_limit: emailLimits.hourly,
        reset_at: resetAt.toISOString(),
      },
      status: 'active',
    });
  }

  // GET /v1/billing — show billing info
  if (path === '/v1/billing' && method === 'GET') {
    return json({
      account_id: account.id,
      tier: account.tier,
      plan: account.tier === 'free' ? 'Free Beta' : 'Pro',
      next_invoice: null,
      upgrade_url: 'https://agentlair.dev/pricing',
      note: 'Free tier includes rate-limited email. When limits are exceeded, pay per-email via x402 (0.01 USDC on Base).',
      x402: {
        supported: true,
        network: X402_CONFIG.network,
        asset: X402_CONFIG.asset,
        facilitator: X402_CONFIG.facilitator,
        email_price: '0.01 USDC',
        email_price_atomic: EMAIL_PAYMENT_AMOUNT,
        how_it_works: 'When email rate limit is hit, API returns HTTP 402 with payment requirements. Send X-PAYMENT header with base64-encoded payment payload to bypass limits.',
      },
    });
  }

  // ── Observations ─────────────────────────────────────────────────────────────

  if (!path.startsWith('/v1/observations')) return null;

  // POST /v1/observations — write an observation
  if (path === '/v1/observations' && method === 'POST') {
    let body: any = {};
    try { body = await request.json(); } catch {
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

      await tursoExecute(env,
        'INSERT INTO shared_observations (id, agent_id, topic, content, created_at, account_id, shared, display_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, agent_id, topic, content, created_at, account.id, String(shared), display_name],
      );

      return json({ id, agent_id, display_name, topic, shared: !!shared, created_at }, 201);
    } catch (e: any) {
      return err(`Failed to write observation: ${e.message}`, 502, 'turso_error');
    }
  }

  // GET /v1/observations/topics — list distinct topics
  if (path === '/v1/observations/topics' && method === 'GET') {
    try {
      const result = await tursoExecute(env,
        'SELECT topic, COUNT(*) as count, MAX(created_at) as latest FROM shared_observations WHERE account_id = ? OR shared = 1 GROUP BY topic ORDER BY latest DESC',
        [account.id],
      );
      return json({ topics: result.rows, count: result.rows.length });
    } catch (e: any) {
      return err(`Failed to list topics: ${e.message}`, 502, 'turso_error');
    }
  }

  // GET /v1/observations — read observations (own + shared by default)
  if (path === '/v1/observations' && method === 'GET') {
    const topic = url.searchParams.get('topic');
    const agent_id = url.searchParams.get('agent_id');
    const since = url.searchParams.get('since');
    const scope = url.searchParams.get('scope') || 'all';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

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
      const result = await tursoExecute(env,
        `SELECT id, agent_id, display_name, topic, content, created_at, shared FROM shared_observations ${where} ORDER BY created_at DESC LIMIT ?`,
        args,
      );

      const observations = result.rows.map((r: any) => ({ ...r, shared: r.shared === '1' || r.shared === 1 }));

      return json({
        observations,
        count: observations.length,
        filters: { topic: topic || null, agent_id: agent_id || null, since: since || null, scope, limit },
      });
    } catch (e: any) {
      return err(`Failed to read observations: ${e.message}`, 502, 'turso_error');
    }
  }

  // Catch-all for other /v1/observations/* routes
  return json({
    available: [
      'POST /v1/observations — write an observation (body: {topic, content, shared?, display_name?})',
      'GET /v1/observations?topic=X&agent_id=Y&since=ISO&scope=all|mine|shared&limit=N',
      'GET /v1/observations/topics — list distinct topics (own + shared)',
    ],
    note: 'Observations are account-scoped by default. Set shared: true when writing to make visible to all agents. Read with scope=mine|shared|all (default: all = own + shared).',
  }, 200);
}
