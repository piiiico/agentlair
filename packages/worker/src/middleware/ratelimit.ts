// ─── Rate Limiting ─────────────────────────────────────────────────────────────

import type { Env } from '../types.js';

// IP-based rate limit for unauthenticated endpoints (key creation, vault store)
// Returns { allowed: boolean, remaining: number }
export async function checkIpRateLimit(env: Env, ip: string, action: string, maxPerHour: number) {
  if (!ip || !env.KEYS) return { allowed: true, remaining: maxPerHour };
  try {
    const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const key = `ip-rl:${action}:${ip}:${hour}`;
    const current = parseInt(await env.KEYS.get(key) || '0');
    if (current >= maxPerHour) {
      return { allowed: false, remaining: 0 };
    }
    await env.KEYS.put(key, String(current + 1), { expirationTtl: 7200 });
    return { allowed: true, remaining: maxPerHour - current - 1 };
  } catch {
    // Fail open: if KV is unavailable (e.g. write quota exceeded), allow the request
    return { allowed: true, remaining: maxPerHour };
  }
}

export async function checkRateLimit(env: Env, accountId: string, tier: string) {
  try {
    const limit = tier === 'paid' ? 10000 : 100; // requests/day
    const today = new Date().toISOString().slice(0, 10);
    const counterKey = 'rl:' + accountId + ':' + today;
    const current = parseInt(await env.KEYS.get(counterKey) || '0');
    if (current >= limit) return false;
    await env.KEYS.put(counterKey, String(current + 1), { expirationTtl: 86400 });
    return true;
  } catch {
    // Fail open: if KV is unavailable (e.g. write quota exceeded), allow the request
    return true;
  }
}

// ─── Email-Specific Rate Limiting & Abuse Prevention ───────────────────────────
//
// Limits (separate from general API rate limits):
//   Free tier:  10 emails/day per account, 5/hour per from-address
//   Paid tier: 1000 emails/day per account, 200/hour per from-address
//
// Abuse signals tracked:
//   - Bounce rate per address (suspended if >10% of last 100 sends)
//   - Rapid send detection (>5 emails/minute from same address)

export const EMAIL_LIMITS = {
  free:  { daily: 10,   hourly: 5,   burst: 3 },
  paid:  { daily: 1000, hourly: 200, burst: 60 },
};

export const ADDRESS_LIMITS = {
  free:  10,
  paid:  25,
};

export async function countOwnedAddresses(env: Env, accountId: string) {
  if (!env.EMAILS) return 0;
  const list = await env.EMAILS.list({ prefix: 'email-owner:' });
  let count = 0;
  for (const k of list.keys) {
    const owner = await env.EMAILS.get(k.name);
    if (owner === accountId) count++;
  }
  return count;
}

export async function checkEmailRateLimit(env: Env, accountId: string, tier: string, fromAddr: string) {
  const limits = EMAIL_LIMITS[tier as keyof typeof EMAIL_LIMITS] || EMAIL_LIMITS.free;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);           // YYYY-MM-DD
  const hour  = now.toISOString().slice(0, 13);           // YYYY-MM-DDTHH
  const minute = now.toISOString().slice(0, 16);          // YYYY-MM-DDTHH:MM

  // Extract local part of from-address for per-address keys
  const fromLocal = fromAddr.replace(/<([^>]+)>/, '$1').split('@')[0];

  const dailyKey  = `email_daily:${accountId}:${today}`;
  const hourlyKey = `email_hourly:${fromLocal}:${hour}`;
  const burstKey  = `email_burst:${fromLocal}:${minute}`;

  // Read all counters in parallel
  const [dailyRaw, hourlyRaw, burstRaw] = await Promise.all([
    env.EMAILS.get(dailyKey),
    env.EMAILS.get(hourlyKey),
    env.EMAILS.get(burstKey),
  ]);

  const daily  = parseInt(dailyRaw  || '0');
  const hourly = parseInt(hourlyRaw || '0');
  const burst  = parseInt(burstRaw  || '0');

  const resetAt = new Date(now);
  resetAt.setUTCDate(resetAt.getUTCDate() + 1);
  resetAt.setUTCHours(0, 0, 0, 0);

  if (daily >= limits.daily) {
    return {
      allowed: false,
      reason: 'daily_limit',
      limit: limits.daily,
      remaining: 0,
      reset_at: resetAt.toISOString(),
      upgrade_hint: tier === 'free' ? 'Upgrade to Pro for 1,000 emails/day. See /pricing.' : null,
    };
  }

  if (hourly >= limits.hourly) {
    const hourReset = new Date(now);
    hourReset.setUTCMinutes(0, 0, 0);
    hourReset.setUTCHours(hourReset.getUTCHours() + 1);
    return {
      allowed: false,
      reason: 'hourly_limit',
      limit: limits.hourly,
      remaining: 0,
      reset_at: hourReset.toISOString(),
      upgrade_hint: 'Limit is per address. Distribute sends across multiple addresses or upgrade.',
    };
  }

  if (burst >= limits.burst) {
    return {
      allowed: false,
      reason: 'burst_limit',
      limit: limits.burst,
      remaining: 0,
      reset_at: new Date(now.getTime() + 60000).toISOString(),
      upgrade_hint: 'Too many emails per minute from this address. Slow down or upgrade.',
    };
  }

  // Check bounce-rate suspension
  const bounceKey = `email_bounce:${fromLocal}`;
  const bounceRaw = await env.EMAILS.get(bounceKey);
  if (bounceRaw) {
    const bounce = JSON.parse(bounceRaw);
    if (bounce.suspended) {
      return {
        allowed: false,
        reason: 'address_suspended',
        limit: 0,
        remaining: 0,
        reset_at: null,
        upgrade_hint: `Address ${fromAddr} suspended due to high bounce rate (${bounce.rate}%). Contact support@agentlair.dev.`,
      };
    }
  }

  // All checks passed — increment counters (fail-open: if writes fail, allow the send)
  try {
    await Promise.all([
      env.EMAILS.put(dailyKey,  String(daily  + 1), { expirationTtl: 86400 * 2 }),
      env.EMAILS.put(hourlyKey, String(hourly + 1), { expirationTtl: 7200 }),
      env.EMAILS.put(burstKey,  String(burst  + 1), { expirationTtl: 120 }),
    ]);
  } catch {
    // KV write failed (quota?) — allow send anyway, counters will be stale
  }

  return {
    allowed: true,
    daily_remaining: limits.daily - daily - 1,
    hourly_remaining: limits.hourly - hourly - 1,
    reset_at: resetAt.toISOString(),
  };
}

// Record a bounce for an address — call after delivery failure
export async function recordEmailBounce(env: Env, fromAddr: string) {
  try {
    const fromLocal = fromAddr.replace(/<([^>]+)>/, '$1').split('@')[0];
    const bounceKey = `email_bounce:${fromLocal}`;
    const statsKey  = `email_stats:${fromLocal}`;

    const [bounceRaw, statsRaw] = await Promise.all([
      env.EMAILS.get(bounceKey),
      env.EMAILS.get(statsKey),
    ]);

    const stats = statsRaw ? JSON.parse(statsRaw) : { sent: 0, bounced: 0 };
    stats.sent    += 0; // incremented at send time
    stats.bounced += 1;
    stats.last_bounce = new Date().toISOString();

    const rate = stats.sent > 0 ? (stats.bounced / stats.sent) : 1;

    const bounce = bounceRaw ? JSON.parse(bounceRaw) : {};
    bounce.count = (bounce.count || 0) + 1;
    bounce.rate  = Math.round(rate * 100);
    bounce.last  = stats.last_bounce;

    // Suspend if >10% bounce rate after at least 10 sends
    if (rate > 0.10 && stats.sent >= 10) {
      bounce.suspended = true;
      bounce.suspended_at = new Date().toISOString();
    }

    await Promise.all([
      env.EMAILS.put(bounceKey, JSON.stringify(bounce), { expirationTtl: 86400 * 30 }),
      env.EMAILS.put(statsKey,  JSON.stringify(stats),  { expirationTtl: 86400 * 30 }),
    ]);
  } catch {
    // Fail open: bounce tracking is best-effort — don't crash the caller
  }
}

// Increment sent stats for an address
export async function recordEmailSent(env: Env, fromAddr: string) {
  try {
    const fromLocal = fromAddr.replace(/<([^>]+)>/, '$1').split('@')[0];
    const statsKey  = `email_stats:${fromLocal}`;
    const statsRaw  = await env.EMAILS.get(statsKey);
    const stats = statsRaw ? JSON.parse(statsRaw) : { sent: 0, bounced: 0 };
    stats.sent += 1;
    stats.last_sent = new Date().toISOString();
    await env.EMAILS.put(statsKey, JSON.stringify(stats), { expirationTtl: 86400 * 30 });
  } catch {
    // Fail open: stats tracking is best-effort
  }
}
