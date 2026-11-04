import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { adminStatsRoutes, isInternalAccount } from './admin-stats.js';

function kv(accounts: Record<string, unknown>[]) {
  const store = new Map<string, string>();
  accounts.forEach((a, i) => {
    store.set(`account:acc_${i}`, `h${i}`);
    store.set(`key:h${i}`, JSON.stringify(a));
  });
  store.set('account:acc_0:keys', '[]'); // sub-record must be skipped
  return {
    async get(k: string) { return store.get(k) ?? null; },
    async list({ prefix }: { prefix: string }) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const today = new Date().toISOString();
const ACCTS = [
  { name: 'mybot', email: null, created_at: today },
  { name: 'integration-test-abc', created_at: today },
  { name: 'x', email: 'hakon@amdal.dev', created_at: today },
  { name: 'y', operator_email: 'ops@agentlair.dev', created_at: today },
  { name: 'agent', email: 'someone@example.com', created_at: today },
  { name: 'old', created_at: '2020-01-01T00:00:00Z' },
];

function app(env: Record<string, unknown>) {
  const a = new Hono<any>();
  a.route('/v1/admin/stats', adminStatsRoutes);
  return (path: string, init?: RequestInit) => a.request(path, init, env);
}

describe('GET /v1/admin/stats/accounts-per-day', () => {
  test('401 without auth', async () => {
    const r = await app({ ADMIN_KEY: 'k', KEYS: kv(ACCTS) })('/v1/admin/stats/accounts-per-day');
    expect(r.status).toBe(401);
  });
  test('401 with wrong key, and when ADMIN_KEY unset', async () => {
    expect((await app({ ADMIN_KEY: 'k', KEYS: kv(ACCTS) })('/v1/admin/stats/accounts-per-day', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await app({ KEYS: kv(ACCTS) })('/v1/admin/stats/accounts-per-day', { headers: { Authorization: 'Bearer ' } })).status).toBe(401);
  });
  test('shape: counts only, outside excludes internal', async () => {
    const r = await app({ ADMIN_KEY: 'k', KEYS: kv(ACCTS) })('/v1/admin/stats/accounts-per-day?days=3', { headers: { Authorization: 'Bearer k' } });
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.days).toHaveLength(3);
    expect(Object.keys(body.days[0]).sort()).toEqual(['created', 'created_outside', 'day']);
    const last = body.days[2];
    expect(last.day).toBe(today.slice(0, 10));
    expect(last.created).toBe(5);
    expect(last.created_outside).toBe(2);
    expect(body.scanned).toBe(6);
    expect(body.complete).toBe(true);
    const txt = JSON.stringify(body);
    expect(txt).not.toMatch(/acc_\d|hakon@|someone@|mybot/);
  });
});

describe('isInternalAccount', () => {
  test('arms', () => {
    expect(isInternalAccount({ email: 'a@AMDAL.dev' })).toBe(true);
    expect(isInternalAccount({ email: 'a@notamdal.dev' })).toBe(false);
    expect(isInternalAccount({ name: 'integration-test-alt-1' })).toBe(true);
    expect(isInternalAccount({ name: 'my-integration-test' })).toBe(false);
    expect(isInternalAccount({})).toBe(false);
  });
});
