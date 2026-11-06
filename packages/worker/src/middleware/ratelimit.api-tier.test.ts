import { describe, expect, test } from 'bun:test';
import { checkRateLimit, apiRequestLimit, getEventRateLimitTier } from './ratelimit';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, _m: m } as any;
}
const today = () => new Date().toISOString().slice(0, 10);

async function req101(tier: any) {
  const env = { KEYS: kv() } as any;
  const key = `rl:acct:${today()}`;
  env.KEYS._m.set(key, '100'); // 100 already used today
  const allowed = await checkRateLimit(env, 'acct', tier);
  return { allowed, count: env.KEYS._m.get(key) };
}

describe('API rate limit keys paying tiers written by Stripe (starter/pro) as paid', () => {
  for (const t of ['starter', 'pro', 'enterprise', 'paid']) {
    test(`${t}: 101st request of the day is allowed and counted`, async () => {
      const r = await req101(t);
      expect(r.allowed).toBe(true);
      expect(r.count).toBe('101');
      expect(apiRequestLimit(t)).toBe(10000);
    });
  }

  for (const t of ['free', undefined, '', 'Pro']) {
    test(`${JSON.stringify(t)}: 101st request of the day is blocked`, async () => {
      const r = await req101(t);
      expect(r.allowed).toBe(false);
      expect(r.count).toBe('100');
      expect(apiRequestLimit(t as any)).toBe(100);
    });
  }

  test('paid tier is blocked at its own 10000 ceiling', async () => {
    const env = { KEYS: kv() } as any;
    env.KEYS._m.set(`rl:acct:${today()}`, '10000');
    expect(await checkRateLimit(env, 'acct', 'starter')).toBe(false);
  });

  test('event tier: enterprise → pro, pro → pro, paid/starter → paid, else free', () => {
    expect(getEventRateLimitTier('enterprise')).toBe('pro');
    expect(getEventRateLimitTier('pro')).toBe('pro');
    expect(getEventRateLimitTier('paid')).toBe('paid');
    expect(getEventRateLimitTier('starter')).toBe('paid');
    expect(getEventRateLimitTier('free')).toBe('free');
    expect(getEventRateLimitTier('Pro')).toBe('free');
  });
});
