import { describe, expect, test } from 'bun:test';
import { checkEmailRateLimit, emailLimitTier, EMAIL_LIMITS, FREE_GLOBAL_DAILY_CAP } from './ratelimit';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, _m: m } as any;
}
const today = () => new Date().toISOString().slice(0, 10);

describe('email limits key paying tiers written by Stripe (starter/pro) as paid', () => {
  test('emailLimitTier maps paid/starter/pro/enterprise → paid, else free', () => {
    for (const t of ['paid', 'starter', 'pro', 'enterprise']) expect(emailLimitTier(t)).toBe('paid');
    for (const t of ['free', undefined, '', 'whatever', 'Pro']) expect(emailLimitTier(t as any)).toBe('free');
  });

  for (const t of ['starter', 'pro', 'enterprise']) {
    test(`${t} bypasses an exhausted global free cap and does not count toward it`, async () => {
      const env = { EMAILS: kv() } as any;
      const key = `email_global_free:${today()}`;
      env.EMAILS._m.set(key, String(FREE_GLOBAL_DAILY_CAP));
      const r = await checkEmailRateLimit(env, `acct-${t}`, t, `${t}@agentlair.dev`);
      expect(r.allowed).toBe(true);
      expect(env.EMAILS._m.get(key)).toBe(String(FREE_GLOBAL_DAILY_CAP));
    });

    test(`${t} gets paid daily limit, not free`, async () => {
      const env = { EMAILS: kv() } as any;
      env.EMAILS._m.set(`email_daily:acct-${t}:${today()}`, String(EMAIL_LIMITS.free.daily));
      const r = await checkEmailRateLimit(env, `acct-${t}`, t, `${t}@agentlair.dev`);
      expect(r.allowed).toBe(true);
    });
  }

  test('free is still blocked by the exhausted global cap', async () => {
    const env = { EMAILS: kv() } as any;
    env.EMAILS._m.set(`email_global_free:${today()}`, String(FREE_GLOBAL_DAILY_CAP));
    const r = await checkEmailRateLimit(env, 'f', 'free', 'f@agentlair.dev');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('global_free_cap');
  });

  test('free still hits the free daily limit', async () => {
    const env = { EMAILS: kv() } as any;
    env.EMAILS._m.set(`email_daily:f:${today()}`, String(EMAIL_LIMITS.free.daily));
    const r = await checkEmailRateLimit(env, 'f', 'free', 'f@agentlair.dev');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('daily_limit');
  });
});
