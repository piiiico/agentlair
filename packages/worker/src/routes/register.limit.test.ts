/**
 * Agent Registration Limit — Unit Tests
 *
 * Tests the x402-gated agent count limit enforced in POST /v1/register.
 * Free tier: max 3 agents per recovery_email.
 * Anonymous registrations (no recovery_email) are exempt from the limit.
 *
 * Run: bun test src/routes/register.limit.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { handleRegisterRoute } from './register.js';
import type { Env, RouteContext } from '../types.js';

// ─── MockKV ───────────────────────────────────────────────────────────────────

class MockKV {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && Date.now() / 1000 > entry.expiration) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiration = options?.expirationTtl
      ? Math.floor(Date.now() / 1000) + options.expirationTtl
      : undefined;
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<{ keys: { name: string }[] }> {
    return { keys: [...this.store.keys()].map((name) => ({ name })) };
  }

  _set(key: string, value: string): void {
    this.store.set(key, { value });
  }

  _get(key: string): string | undefined {
    return this.store.get(key)?.value;
  }
}

// ─── Env + context builders ───────────────────────────────────────────────────

function makeEnv(opts: { keysKV?: MockKV; emailsKV?: MockKV } = {}): {
  env: Env;
  keys: MockKV;
  emails: MockKV;
} {
  const keys = opts.keysKV ?? new MockKV();
  const emails = opts.emailsKV ?? new MockKV();
  const env: Env = {
    KEYS: keys as unknown as KVNamespace,
    EMAILS: emails as unknown as KVNamespace,
    VAULT: new MockKV() as unknown as KVNamespace,
    AE_ANALYTICS: undefined as unknown as AnalyticsEngineDataset,
    INBOX_NOTIFIER: undefined as unknown as DurableObjectNamespace,
    // No RESEND_API_KEY → OTP emails won't be attempted
  };
  return { env, keys, emails };
}

const ROUTE_CONTEXT: RouteContext = {
  url: new URL('https://agentlair.dev/v1/register'),
  path: '/v1/register',
  method: 'POST',
  account: null,
};

const EXEC_CTX = {
  waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function makeRegisterRequest(body: Record<string, unknown>, paymentHeader?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (paymentHeader) headers['X-PAYMENT'] = paymentHeader;
  return new Request('https://agentlair.dev/v1/register', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    // Simulate no CF-Connecting-IP so rate limit uses 'unknown' → passes (empty KV)
  });
}

// ─── Payment header helpers ───────────────────────────────────────────────────

const VALID_PAYMENT_HEADER = btoa(JSON.stringify({
  payload: { signature: '0xabcdef', authorization: { from: '0xtest_operator', value: '10000' } },
}));

const BAD_PAYMENT_HEADER = 'not!!!valid!!!base64!!!';

// ─── Facilitator fetch mock ───────────────────────────────────────────────────

let facilitatorShouldSucceed = true;
const originalFetch = globalThis.fetch;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('agent registration limit', () => {
  beforeEach(() => {
    facilitatorShouldSucceed = true;
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const urlStr = url instanceof Request ? url.url : String(url);
      if (urlStr.includes('facilitator')) {
        if (urlStr.endsWith('/verify')) {
          return new Response(
            JSON.stringify(
              facilitatorShouldSucceed
                ? { isValid: true, payer: '0xtest_operator' }
                : { isValid: false, invalidReason: 'test_payment_rejection' },
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ settled: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // Resend calls won't reach here because we don't set RESEND_API_KEY
      throw new Error(`Unexpected network call in test: ${urlStr}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── No recovery_email: always succeeds, no limit check ────────────────────

  test('no recovery_email → succeeds without limit check (201)', async () => {
    const { env, keys } = makeEnv();
    // Seed agent-count to 100 — should NOT be checked since no recovery_email
    keys._set('agent-count:operator@test.com', '100');

    const req = makeRegisterRequest({});
    const res = await handleRegisterRoute(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.api_key).toMatch(/^al_live_/);
    expect(body.account_id).toMatch(/^acc_/);
  });

  // ── Under limit with recovery_email: succeeds ─────────────────────────────

  test('recovery_email, agent count below limit (2/3) → succeeds (201)', async () => {
    const { env, keys } = makeEnv();
    // 2 agents registered, limit is 3 → should succeed without payment
    keys._set('agent-count:operator@test.com', '2');

    const req = makeRegisterRequest({ recovery_email: 'operator@test.com' });
    const res = await handleRegisterRoute(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.api_key).toMatch(/^al_live_/);
    expect(body.account_id).toMatch(/^acc_/);
    // Status is restricted because recovery_email is present
    expect(body.status).toBe('restricted');
  });

  test('recovery_email, no previous agents (0/3) → succeeds (201)', async () => {
    const { env } = makeEnv();
    // Empty KV → count = 0

    const req = makeRegisterRequest({ recovery_email: 'newoperator@test.com' });
    const res = await handleRegisterRoute(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);
  });

  // ── At limit: no payment → 402 ────────────────────────────────────────────

  test('recovery_email, at limit (3/3), no payment header → 402 with agent_limit_exceeded', async () => {
    const { env, keys } = makeEnv();
    keys._set('agent-count:operator@test.com', '3');

    const req = makeRegisterRequest({ recovery_email: 'operator@test.com' });
    const res = await handleRegisterRoute(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.error).toBe('agent_limit_exceeded');
    expect(body.current_agents).toBe(3);
    expect(body.limit).toBe(3);
    expect(typeof body.upgrade_url).toBe('string');
  });

  test('recovery_email, over limit (5/3), no payment header → 402 with agent_limit_exceeded', async () => {
    const { env, keys } = makeEnv();
    keys._set('agent-count:operator@test.com', '5');

    const req = makeRegisterRequest({ recovery_email: 'operator@test.com' });
    const res = await handleRegisterRoute(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.error).toBe('agent_limit_exceeded');
    expect(body.current_agents).toBe(5);
  });

  // ── At limit: invalid payment → 402 payment_invalid ──────────────────────

  test('recovery_email, at limit, invalid payment (bad base64) → 402 payment_invalid', async () => {
    const { env, keys } = makeEnv();
    keys._set('agent-count:operator@test.com', '3');

    const req = makeRegisterRequest(
      { recovery_email: 'operator@test.com' },
      BAD_PAYMENT_HEADER,
    );
    const res = await handleRegisterRoute(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.error).toBe('payment_invalid');
  });

  test('recovery_email, at limit, facilitator-rejected payment → 402 payment_invalid', async () => {
    facilitatorShouldSucceed = false;
    const { env, keys } = makeEnv();
    keys._set('agent-count:operator@test.com', '3');

    const req = makeRegisterRequest(
      { recovery_email: 'operator@test.com' },
      VALID_PAYMENT_HEADER,
    );
    const res = await handleRegisterRoute(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.error).toBe('payment_invalid');
  });

  // ── At limit: valid payment → succeeds ───────────────────────────────────

  test('recovery_email, at limit (3/3), valid x402 payment → succeeds (201)', async () => {
    const { env, keys } = makeEnv();
    keys._set('agent-count:operator@test.com', '3');

    const req = makeRegisterRequest(
      { recovery_email: 'operator@test.com' },
      VALID_PAYMENT_HEADER,
    );
    const res = await handleRegisterRoute(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);
    const body = await res!.json() as Record<string, unknown>;
    expect(body.api_key).toMatch(/^al_live_/);
    expect(body.account_id).toMatch(/^acc_/);
    expect(body.status).toBe('restricted');
  });

  // ── Agent count incremented after successful registration ─────────────────

  test('successful registration with recovery_email increments agent count', async () => {
    const { env, keys } = makeEnv();
    // Start at 1 agent
    keys._set('agent-count:tracker@test.com', '1');

    const req = makeRegisterRequest({ recovery_email: 'tracker@test.com' });
    const res = await handleRegisterRoute(req, env, EXEC_CTX, ROUTE_CONTEXT);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);

    // incrementAgentCount is called with void (fire-and-forget).
    // Flush the microtask queue to ensure it has run.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    const countRaw = keys._get('agent-count:tracker@test.com');
    expect(countRaw).toBe('2');
  });
});
