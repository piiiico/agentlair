import { describe, expect, test } from 'bun:test';
import { checkEmailRateLimit, FREE_GLOBAL_DAILY_CAP } from './ratelimit';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, _m: m } as any;
}
const today = () => new Date().toISOString().slice(0, 10);

describe('free-tier global daily email cap', () => {
  test('Sybil: fresh accounts each within per-account limits are stopped at the global cap', async () => {
    const env = { EMAILS: kv() } as any;
    let allowed = 0;
    for (let i = 0; i < 40; i++) {
      const r = await checkEmailRateLimit(env, `acct${i}`, 'free', `agent${i}@agentlair.dev`);
      if (r.allowed) allowed++;
      else expect(r.reason).toBe('global_free_cap');
    }
    expect(allowed).toBe(FREE_GLOBAL_DAILY_CAP);
  });

  test('paid tier ignores the global cap and does not count toward it', async () => {
    const env = { EMAILS: kv() } as any;
    env.EMAILS._m.set(`email_global_free:${today()}`, String(FREE_GLOBAL_DAILY_CAP));
    const r = await checkEmailRateLimit(env, 'paid1', 'paid', 'p@agentlair.dev');
    expect(r.allowed).toBe(true);
    expect(env.EMAILS._m.get(`email_global_free:${today()}`)).toBe(String(FREE_GLOBAL_DAILY_CAP));
  });

  test('env override FREE_EMAIL_GLOBAL_DAILY_CAP is respected', async () => {
    const env = { EMAILS: kv(), FREE_EMAIL_GLOBAL_DAILY_CAP: '2' } as any;
    const a = await checkEmailRateLimit(env, 'a', 'free', 'a@agentlair.dev');
    const b = await checkEmailRateLimit(env, 'b', 'free', 'b@agentlair.dev');
    const c = await checkEmailRateLimit(env, 'c', 'free', 'c@agentlair.dev');
    expect([a.allowed, b.allowed, c.allowed]).toEqual([true, true, false]);
    expect(c.reason).toBe('global_free_cap');
  });

  test('unknown tier (undefined → free) is capped too', async () => {
    const env = { EMAILS: kv(), FREE_EMAIL_GLOBAL_DAILY_CAP: '1' } as any;
    expect((await checkEmailRateLimit(env, 'x', 'whatever', 'x@agentlair.dev')).allowed).toBe(true);
    expect((await checkEmailRateLimit(env, 'y', 'whatever', 'y@agentlair.dev')).allowed).toBe(false);
  });
});
