import { describe, test, expect } from 'bun:test';
import { handleAuthRoutes, sanitizeRef } from './auth.js';
import type { Env } from '../types.js';

class MockKV {
  store = new Map<string, string>();
  failPrefix: string | null = null;
  async get(k: string) { return this.store.get(k) ?? null; }
  async put(k: string, v: string) {
    if (this.failPrefix && k.startsWith(this.failPrefix)) throw new Error('boom');
    this.store.set(k, v);
  }
  async delete(k: string) { this.store.delete(k); }
  async list() { return { keys: [...this.store.keys()].map((name) => ({ name })) }; }
}

const EXEC = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function register(body: unknown, kv = new MockKV(), path = '/v1/auth/agent-register', q = '') {
  const env = { KEYS: kv, EMAILS: new MockKV() } as unknown as Env;
  const url = new URL('https://agentlair.dev' + path + q);
  const req = new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'CF-Connecting-IP': Math.random().toString() } });
  const res = await handleAuthRoutes(req, env, EXEC, { url, path, method: 'POST', account: null });
  return { res: res!, kv };
}

function refKeys(kv: MockKV) { return [...kv.store.keys()].filter((k) => k.startsWith('ref-accounts:')); }
function account(kv: MockKV) {
  const k = [...kv.store.keys()].find((k) => k.startsWith('key:'))!;
  return JSON.parse(kv.store.get(k)!);
}

describe('ref capture', () => {
  test('agent-register stores ref and appends ref-accounts', async () => {
    const { res, kv } = await register({ name: 'bot', ref: 'Skills' });
    expect(res.status).toBe(201);
    const data = await res.json() as { account_id: string };
    expect(account(kv).ref).toBe('skills');
    const list = JSON.parse(kv.store.get('ref-accounts:skills')!);
    expect(list).toHaveLength(1);
    expect(list[0].account_id).toBe(data.account_id);
    expect(list[0].name).toBe('bot');
    expect(data).not.toHaveProperty('ref');
  });

  test('keys endpoint stores ref from query fallback', async () => {
    const { res, kv } = await register({ name: 'k' }, new MockKV(), '/v1/auth/keys', '?ref=skills');
    expect(res.status).toBe(201);
    expect(account(kv).ref).toBe('skills');
    expect(JSON.parse(kv.store.get('ref-accounts:skills')!)).toHaveLength(1);
  });

  test('appends, not overwrites', async () => {
    const kv = new MockKV();
    await register({ ref: 'skills' }, kv);
    await register({ ref: 'skills' }, kv);
    expect(JSON.parse(kv.store.get('ref-accounts:skills')!)).toHaveLength(2);
  });

  test('invalid refs dropped', async () => {
    for (const bad of ['<script>', 'a'.repeat(100), 42, '']) {
      const { res, kv } = await register({ ref: bad });
      expect(res.status).toBe(201);
      expect(account(kv).ref).toBeUndefined();
      expect(refKeys(kv)).toHaveLength(0);
    }
    expect(sanitizeRef('a'.repeat(32))).toBe('a'.repeat(32));
    expect(sanitizeRef('a'.repeat(33))).toBeUndefined();
  });

  test('absent ref: no ref field, no ref-accounts write', async () => {
    const { res, kv } = await register({ name: 'x' });
    expect(res.status).toBe(201);
    expect('ref' in account(kv)).toBe(false);
    expect(refKeys(kv)).toHaveLength(0);
  });

  test('ref-accounts write failure does not break 201', async () => {
    const kv = new MockKV();
    kv.failPrefix = 'ref-accounts:';
    const { res } = await register({ ref: 'skills' }, kv);
    expect(res.status).toBe(201);
    expect(account(kv).ref).toBe('skills');
  });
});
