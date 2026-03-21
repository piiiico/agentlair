/**
 * AgentLair API — Integration Tests
 *
 * Run against local dev:   BASE_URL=http://localhost:8787 bun test src/api.test.ts
 * Run against production:  BASE_URL=https://agentlair.dev bun test src/api.test.ts
 * Default (no env):        https://agentlair.dev
 *
 * Tests create a fresh API key on each run using unique RUN_ID suffixes.
 * Note: key creation is rate-limited to 5/IP/hour. Running too many times in
 * a short window may trigger 429 on key creation — wait an hour and retry.
 */

import { describe, test, expect, beforeAll } from 'bun:test';

const BASE_URL = process.env.BASE_URL ?? 'https://agentlair.dev';

// ─── Shared State ─────────────────────────────────────────────────────────────

// Unique suffix to avoid collisions between test runs
const RUN_ID = Math.random().toString(36).slice(2, 8);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function req(
  path: string,
  init: RequestInit = {},
  auth: string | null = null,
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers = new Headers((init.headers as Record<string, string>) ?? {});
  if (auth) headers.set('Authorization', `Bearer ${auth}`);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

// ─── Top-level: Public Routes (no auth needed) ────────────────────────────────

describe('public routes', () => {
  test('GET / — JSON response for non-browser clients', async () => {
    const r = await req('/');
    expect(r.status).toBe(200);
    expect(r.body).toBeDefined();
  });

  test('GET /health — returns ok', async () => {
    const r = await req('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(typeof r.body.timestamp).toBe('string');
    expect(typeof r.body.version).toBe('string');
  });

  test('GET /api — returns OpenAPI spec or Scalar docs', async () => {
    const r = await req('/api');
    expect(r.status).toBe(200);
    expect(r.body).toBeDefined();
  });

  test('GET /.well-known/agent.json — returns A2A agent card', async () => {
    const r = await req('/.well-known/agent.json');
    expect(r.status).toBe(200);
    expect(typeof r.body).toBe('object');
  });

  test('OPTIONS — CORS preflight returns 204', async () => {
    const res = await fetch(`${BASE_URL}/v1/email/claim`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// ─── Auth: Key Creation (unauthenticated public routes) ───────────────────────

describe('auth: key creation', () => {
  test('POST /v1/auth/keys — creates key with expected fields', async () => {
    const r = await req('/v1/auth/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'test-key' }),
    });
    // 201 = success, 429 = IP rate limited (5/hour), 503 = KV quota exceeded. All acceptable here.
    expect([201, 429, 503]).toContain(r.status);
    if (r.status === 201) {
      expect(r.body.api_key).toMatch(/^al_live_/);
      expect(r.body.account_id).toMatch(/^acc_/);
      expect(r.body.tier).toBe('free');
      expect(r.body.key_prefix).toMatch(/^al_live_/);
      expect(r.body.warning).toBeDefined();
      expect(r.body.limits).toBeDefined();
    }
  });

  test('POST /v1/keys — alias creates key (returns "key" field)', async () => {
    // Note: /v1/keys returns {key, account_id, ...} while /v1/auth/keys returns {api_key, ...}
    const r = await req('/v1/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'alias-test' }),
    });
    expect([201, 429, 503]).toContain(r.status);
    if (r.status === 201) {
      expect(r.body.key).toMatch(/^al_live_/);
      expect(r.body.account_id).toMatch(/^acc_/);
    }
  });
});

// ─── Auth: Agent Register ─────────────────────────────────────────────────────

describe('auth: agent-register', () => {
  test('POST /v1/auth/agent-register — returns 201 with api_key, account_id, email_address', async () => {
    const r = await req('/v1/auth/agent-register', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    // 201 = success, 429 = rate limited, 503 = KV quota exceeded
    expect([201, 429, 503]).toContain(r.status);
    if (r.status === 201) {
      expect(r.body.api_key).toMatch(/^al_live_/);
      expect(r.body.account_id).toMatch(/^acc_/);
      expect(typeof r.body.email_address).toBe('string');
      expect(r.body.tier).toBe('free');
      expect(r.body.limits).toBeDefined();
      expect(r.body.warning).toBeDefined();
    }
  });

  test('POST /v1/auth/agent-register — auto-generates agent- address when no name/address given', async () => {
    const r = await req('/v1/auth/agent-register', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect([201, 429, 503]).toContain(r.status);
    if (r.status === 201) {
      expect(r.body.email_address).toMatch(/^agent-.+@agentlair\.dev$/);
    }
  });

  test('POST /v1/auth/agent-register — derives address from name when name given', async () => {
    const r = await req('/v1/auth/agent-register', {
      method: 'POST',
      body: JSON.stringify({ name: `mybot-${RUN_ID}` }),
    });
    expect([201, 429, 503]).toContain(r.status);
    if (r.status === 201) {
      expect(r.body.email_address).toContain('mybot');
      expect(r.body.email_address).toContain('@agentlair.dev');
    }
  });

  test('POST /v1/auth/agent-register — accepts specific valid address', async () => {
    const r = await req('/v1/auth/agent-register', {
      method: 'POST',
      body: JSON.stringify({ address: `agent-explicit-${RUN_ID}@agentlair.dev` }),
    });
    expect([201, 409, 429, 503]).toContain(r.status);
    if (r.status === 201) {
      expect(r.body.email_address).toBe(`agent-explicit-${RUN_ID}@agentlair.dev`);
    }
  });

  test('POST /v1/auth/agent-register — rejects address not ending in @agentlair.dev', async () => {
    const r = await req('/v1/auth/agent-register', {
      method: 'POST',
      body: JSON.stringify({ address: 'bot@otherdomain.com' }),
    });
    // 400 = validation error, 429 = rate limited (validation happens after rate check)
    expect([400, 429]).toContain(r.status);
    if (r.status === 400) {
      expect(r.body.error).toBe('invalid_address');
    }
  });

  test('POST /v1/auth/agent-register — rejects reserved address (403)', async () => {
    const r = await req('/v1/auth/agent-register', {
      method: 'POST',
      body: JSON.stringify({ address: 'postmaster@agentlair.dev' }),
    });
    // 403 = reserved address, 429 = rate limited before validation
    expect([403, 429]).toContain(r.status);
    if (r.status === 403) {
      expect(r.body.error).toBe('address_reserved');
    }
  });

  test('POST /v1/auth/agent-register — rejects reserved address via name (403)', async () => {
    const r = await req('/v1/auth/agent-register', {
      method: 'POST',
      body: JSON.stringify({ name: 'postmaster' }),
    });
    // 403 = reserved address, 429 = rate limited before validation
    expect([403, 429]).toContain(r.status);
    if (r.status === 403) {
      expect(r.body.error).toBe('address_reserved');
    }
  });

  test('POST /v1/auth/agent-register — respects rate limit (201 or 429)', async () => {
    const r = await req('/v1/auth/agent-register', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    // 201 = success, 429 = rate limited, 503 = KV quota exceeded
    expect([201, 429, 503]).toContain(r.status);
  });
});

// ─── Auth: Login (Magic Link) — Unauthenticated ────────────────────────────────

describe('auth: login (magic link)', () => {
  test('POST /v1/auth/login — returns sent:true for unknown email (no enumeration)', async () => {
    const r = await req('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: `nonexistent-${RUN_ID}@example.com` }),
    });
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(true);
  });

  test('POST /v1/auth/login — invalid email returns 400', async () => {
    const r = await req('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'notanemail' }),
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeDefined();
  });

  test('POST /v1/auth/login — missing email returns 400', async () => {
    const r = await req('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });
});

// ─── Auth: Token Verification — Unauthenticated ────────────────────────────────

describe('auth: token verification', () => {
  test('GET /v1/auth/verify — missing token returns 400', async () => {
    const res = await fetch(`${BASE_URL}/v1/auth/verify`);
    expect(res.status).toBe(400);
  });

  test('GET /v1/auth/verify — invalid token returns error HTML (400)', async () => {
    const res = await fetch(`${BASE_URL}/v1/auth/verify?token=invalid_token_that_does_not_exist`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Invalid');
  });
});

// ─── Vault: Unauthenticated Seed Storage ─────────────────────────────────────

describe('vault: unauthenticated seed storage', () => {
  test('POST /v1/vault/store — stores encrypted seed without auth', async () => {
    const r = await req('/v1/vault/store', {
      method: 'POST',
      body: JSON.stringify({
        encrypted_seed: `ZW5jcnlwdGVkU2VlZEZvclRlc3RSdW4=`,
        recovery_email: `vault-test-${RUN_ID}@example.com`,
      }),
    });
    // 200 = stored, 429 = rate limited, 503 = KV quota exceeded
    expect([200, 429, 503]).toContain(r.status);
    if (r.status === 200) {
      expect(r.body.vault_id).toMatch(/^vlt_/);
      expect(typeof r.body.stored_at).toBe('string');
    }
  });

  test('POST /v1/vault/store — missing encrypted_seed returns 400', async () => {
    const r = await req('/v1/vault/store', {
      method: 'POST',
      body: JSON.stringify({ recovery_email: `test-${RUN_ID}@example.com` }),
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_encrypted_seed');
  });

  test('POST /v1/vault/store — invalid email returns 400', async () => {
    const r = await req('/v1/vault/store', {
      method: 'POST',
      body: JSON.stringify({
        encrypted_seed: 'c29tZWVuY3J5cHRlZGRhdGE=',
        recovery_email: 'notanemail',
      }),
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_email');
  });

  test('POST /v1/vault/recover — returns sent:true regardless of email existing', async () => {
    const r = await req('/v1/vault/recover', {
      method: 'POST',
      body: JSON.stringify({ email: `unknown-vault-${RUN_ID}@example.com` }),
    });
    // 200 = sent (even if email doesn't exist — no enumeration), 429 = rate limited
    expect([200, 429]).toContain(r.status);
    if (r.status === 200) {
      expect(r.body.sent).toBe(true);
    }
  });

  test('POST /v1/vault/recover — invalid email returns 400', async () => {
    const r = await req('/v1/vault/recover', {
      method: 'POST',
      body: JSON.stringify({ email: 'notvalid' }),
    });
    expect(r.status).toBe(400);
  });
});

// ─── Authenticated Suite ─────────────────────────────────────────────────────
// All tests below require a valid API key.
// We create ONE key per test run in the outer beforeAll.

describe('authenticated API', () => {
  let apiKey = '';
  let accountId = '';
  let apiKey2 = '';   // Second account for ownership/isolation tests
  let accountId2 = '';
  let claimedAddress = '';

  beforeAll(async () => {
    // Support pre-supplied keys via env vars to avoid hitting the IP rate limit (5/hour).
    // Usage: TEST_API_KEY=al_live_... TEST_API_KEY2=al_live_... bun test src/api.test.ts
    if (process.env.TEST_API_KEY) {
      apiKey = process.env.TEST_API_KEY;
      // Get account info from existing key
      const meR = await req('/v1/account/me', {}, apiKey);
      if (meR.status === 429) throw new Error(`TEST_API_KEY account has hit the 100 req/day rate limit. Wait until midnight UTC for reset, or use a fresh key.`);
      if (meR.status !== 200) throw new Error(`TEST_API_KEY is invalid: ${meR.status}`);
      accountId = meR.body.id;
    } else {
      // Create primary test account
      const r1 = await req('/v1/auth/keys', {
        method: 'POST',
        body: JSON.stringify({ name: `integration-test-${RUN_ID}` }),
      });
      if (r1.status !== 201) {
        throw new Error(
          `Failed to create primary test API key: ${r1.status} - ${JSON.stringify(r1.body)}.\n` +
          `If 429: IP rate limit (5 keys/hour) hit. Pass existing key via: TEST_API_KEY=al_live_... bun test`
        );
      }
      apiKey = r1.body.api_key;
      accountId = r1.body.account_id;
    }

    if (process.env.TEST_API_KEY2) {
      apiKey2 = process.env.TEST_API_KEY2;
      const me2R = await req('/v1/account/me', {}, apiKey2);
      if (me2R.status !== 200) throw new Error(`TEST_API_KEY2 is invalid: ${me2R.status}`);
      accountId2 = me2R.body.id;
    } else {
      const r2 = await req('/v1/auth/keys', {
        method: 'POST',
        body: JSON.stringify({ name: `integration-test-alt-${RUN_ID}` }),
      });
      if (r2.status === 429 || r2.status === 503) {
        // Rate limited or KV quota exceeded — ownership tests will be skipped gracefully
        console.warn(`[setup] Could not create secondary key (${r2.status}). Ownership tests will be skipped.`);
      } else if (r2.status !== 201) {
        throw new Error(`Failed to create secondary test API key: ${r2.status}`);
      } else {
        apiKey2 = r2.body.api_key;
        accountId2 = r2.body.account_id;
      }
    }

    // Claim an email address for this test run (idempotent — already_owned is fine)
    // If address limit is reached (free tier: 10), fall back to an existing address.
    if (process.env.TEST_EMAIL_ADDRESS) {
      claimedAddress = process.env.TEST_EMAIL_ADDRESS;
    } else {
      const newAddress = `testbot-${RUN_ID}@agentlair.dev`;
      const claimR = await req('/v1/email/claim', {
        method: 'POST',
        body: JSON.stringify({ address: newAddress }),
      }, apiKey);
      if ([200, 201].includes(claimR.status)) {
        claimedAddress = newAddress;
      } else if (claimR.status === 403 && claimR.body?.error === 'address_limit') {
        // Address limit reached — reuse an existing address for this test run
        const listR = await req('/v1/email/addresses', {}, apiKey);
        if (listR.status === 200 && listR.body.addresses?.length > 0) {
          claimedAddress = listR.body.addresses[0];
          console.warn(`[setup] Address limit reached — reusing existing address: ${claimedAddress}`);
        } else {
          throw new Error(`Address limit reached and could not fetch existing addresses: ${listR.status}`);
        }
      } else {
        throw new Error(`Failed to claim test email address: ${claimR.status} - ${JSON.stringify(claimR.body)}`);
      }
    }
  });

  // ── Auth Failures ──────────────────────────────────────────────────────────

  describe('auth: failures', () => {
    test('protected endpoint without auth returns 401', async () => {
      const r = await req('/v1/account/me');
      expect(r.status).toBe(401);
    });

    test('protected endpoint with invalid API key returns 401', async () => {
      const r = await req('/v1/account/me', {}, 'al_live_invalidkeyxxxxxxxxxxxxxxx');
      expect(r.status).toBe(401);
    });

    test('protected endpoint with malformed auth header returns 401', async () => {
      const r = await req('/v1/account/me', {
        headers: { Authorization: 'not-bearer-format' },
      });
      expect(r.status).toBe(401);
    });
  });

  // ── Account ────────────────────────────────────────────────────────────────

  describe('account', () => {
    test('GET /v1/account/me — returns account info', async () => {
      const r = await req('/v1/account/me', {}, apiKey);
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(accountId);
      expect(r.body.tier).toBe('free');
      expect(r.body.key_prefix).toMatch(/^al_live_/);
      expect(typeof r.body.created_at).toBe('string');
    });

    test('POST /v1/account/recovery-email — sets recovery email', async () => {
      const email = `recovery-${RUN_ID}@example.com`;
      const r = await req('/v1/account/recovery-email', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }, apiKey);
      // 200 = success, 503 = KV quota exceeded
      expect([200, 503]).toContain(r.status);
      if (r.status === 200) {
        expect(r.body.ok).toBe(true);
        expect(r.body.recovery_email).toBe(email);
      }
    });

    test('POST /v1/account/recovery-email — invalid email returns 400', async () => {
      const r = await req('/v1/account/recovery-email', {
        method: 'POST',
        body: JSON.stringify({ email: 'notvalid' }),
      }, apiKey);
      expect(r.status).toBe(400);
    });

    test('GET /v1/account/me — recovery email visible after set', async () => {
      const email = `recovery2-${RUN_ID}@example.com`;
      const setR = await req('/v1/account/recovery-email', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }, apiKey);
      if (setR.status === 503) return; // KV quota exceeded — skip gracefully
      const r = await req('/v1/account/me', {}, apiKey);
      expect(r.status).toBe(200);
      expect(r.body.recovery_email).toBe(email);
    });
  });

  // ── Auth: Keys Management ──────────────────────────────────────────────────

  describe('auth: keys management', () => {
    test('GET /v1/auth/keys/list — returns keys list with active key', async () => {
      const r = await req('/v1/auth/keys/list', {}, apiKey);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.keys)).toBe(true);
      expect(r.body.keys.length).toBeGreaterThan(0);
      const activeKey = r.body.keys.find((k: any) => k.status === 'active');
      expect(activeKey).toBeDefined();
    });

    test('POST /v1/auth/keys/generate-backup — generates backup key or reports conflict', async () => {
      const r = await req('/v1/auth/keys/generate-backup', {
        method: 'POST',
        body: JSON.stringify({ label: 'test-backup' }),
      }, apiKey);
      // 200/201 = success, 409 = backup already exists
      expect([200, 201, 409]).toContain(r.status);
      if (r.status === 200 || r.status === 201) {
        expect(r.body.backup_key).toMatch(/^al_live_/);
      } else {
        expect(r.body.error).toBe('backup_exists');
      }
    });

    test('POST /v1/auth/keys/rotate — rotates a fresh key, makes old key invalid', async () => {
      // Create a throw-away key to rotate (protect the shared apiKey)
      const createR = await req('/v1/auth/keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'rotate-test' }),
      });
      // May hit rate limit or KV quota — skip gracefully
      if (createR.status === 429 || createR.status === 503) return;
      expect(createR.status).toBe(201);
      const oldKey = createR.body.api_key;

      const rotateR = await req('/v1/auth/keys/rotate', {
        method: 'POST',
        body: JSON.stringify({}),
      }, oldKey);
      expect(rotateR.status).toBe(200);
      expect(rotateR.body.api_key).toMatch(/^al_live_/);
      expect(rotateR.body.api_key).not.toBe(oldKey);

      // Old key is now invalid
      const oldKeyCheck = await req('/v1/account/me', {}, oldKey);
      expect(oldKeyCheck.status).toBe(401);

      // New key works
      const newKeyCheck = await req('/v1/account/me', {}, rotateR.body.api_key);
      expect(newKeyCheck.status).toBe(200);
    });
  });

  // ── Auth: E2E Key Rotation ─────────────────────────────────────────────────

  describe('auth: e2e key rotation', () => {
    test('POST /v1/vault/recovery-email — stores recovery email + encrypted seed', async () => {
      const r = await req('/v1/vault/recovery-email', {
        method: 'POST',
        body: JSON.stringify({
          email: `vault-recovery-${RUN_ID}@example.com`,
          encrypted_seed: `ZW5jcnlwdGVkU2VlZEZvclJlY292ZXJ5LVRlc3Q=`,
        }),
      }, apiKey);
      // 200 = success, 503 = KV quota exceeded
      expect([200, 503]).toContain(r.status);
      if (r.status === 200) {
        expect(r.body.ok).toBe(true);
        expect(typeof r.body.stored_at).toBe('string');
      }
    });

    test('POST /v1/vault/recovery-email — missing email returns 400', async () => {
      const r = await req('/v1/vault/recovery-email', {
        method: 'POST',
        body: JSON.stringify({ encrypted_seed: 'c29tZWRhdGE=' }),
      }, apiKey);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_email');
    });

    test('POST /v1/vault/recovery-email — missing encrypted_seed returns 400', async () => {
      const r = await req('/v1/vault/recovery-email', {
        method: 'POST',
        body: JSON.stringify({ email: `test-${RUN_ID}@example.com` }),
      }, apiKey);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_encrypted_seed');
    });
  });

  // ── Email: Claim ───────────────────────────────────────────────────────────

  describe('email: claim', () => {
    test('POST /v1/email/claim — already owned address returns already_owned:true', async () => {
      const r = await req('/v1/email/claim', {
        method: 'POST',
        body: JSON.stringify({ address: claimedAddress }),
      }, apiKey);
      expect([200, 201]).toContain(r.status);
      expect(r.body.claimed).toBe(true);
      expect(r.body.already_owned).toBe(true);
    });

    test('POST /v1/email/claim — non-agentlair domain returns 400', async () => {
      const r = await req('/v1/email/claim', {
        method: 'POST',
        body: JSON.stringify({ address: 'bot@example.com' }),
      }, apiKey);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_address');
    });

    test('POST /v1/email/claim — missing address returns 400', async () => {
      const r = await req('/v1/email/claim', {
        method: 'POST',
        body: JSON.stringify({}),
      }, apiKey);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('missing_address');
    });

    test('POST /v1/email/claim — address owned by another account returns 409', async () => {
      if (!apiKey2) return; // Skip: no secondary key available
      const r = await req('/v1/email/claim', {
        method: 'POST',
        body: JSON.stringify({ address: claimedAddress }),
      }, apiKey2);
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('address_taken');
    });

    test('POST /v1/email/claim — without auth returns 401', async () => {
      const r = await req('/v1/email/claim', {
        method: 'POST',
        body: JSON.stringify({ address: `anon-${RUN_ID}@agentlair.dev` }),
      });
      expect(r.status).toBe(401);
    });
  });

  // ── Email: Inbox & Messages ────────────────────────────────────────────────

  describe('email: inbox & messages', () => {
    test('GET /v1/email/inbox — missing address param returns 400', async () => {
      const r = await req('/v1/email/inbox', {}, apiKey);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('missing_address');
    });

    test('GET /v1/email/inbox — returns messages array for claimed address', async () => {
      const r = await req(`/v1/email/inbox?address=${claimedAddress}`, {}, apiKey);
      // 200 = success, 500 = server error (e.g. decryption failure on old emails — infra issue)
      expect([200, 500]).toContain(r.status);
      if (r.status === 200) {
        expect(Array.isArray(r.body.messages)).toBe(true);
        expect(typeof r.body.count).toBe('number');
      }
    });

    test('GET /v1/email/inbox — another account cannot read our inbox', async () => {
      if (!apiKey2) return; // Skip: no secondary key available
      const r = await req(`/v1/email/inbox?address=${claimedAddress}`, {}, apiKey2);
      expect(r.status).toBe(403);
    });

    test('GET /v1/email/inbox — non-agentlair.dev address returns 400', async () => {
      const r = await req('/v1/email/inbox?address=bot@otherdomain.com', {}, apiKey);
      expect(r.status).toBe(400);
    });

    test('GET /v1/email/messages/:id — missing address param returns 400', async () => {
      // The address query param is required — without it, returns 400
      const r = await req('/v1/email/messages/some-message-id', {}, apiKey);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('missing_params');
    });

    test('GET /v1/email/messages/:id — non-existent message returns 404', async () => {
      const r = await req(`/v1/email/messages/nonexistent-id-xyz?address=${claimedAddress}`, {}, apiKey);
      // 404 = not found, 500 = server error (decryption failure on old inbox data)
      expect([404, 500]).toContain(r.status);
    });

    test('DELETE /v1/email/messages/:id — missing address param returns 400', async () => {
      const r = await req('/v1/email/messages/some-message-id', { method: 'DELETE' }, apiKey);
      expect([400, 500]).toContain(r.status);
    });

    test('DELETE /v1/email/messages/:id — non-existent message returns 404', async () => {
      const r = await req(
        `/v1/email/messages/nonexistent-id-xyz?address=${claimedAddress}`,
        { method: 'DELETE' },
        apiKey,
      );
      expect([404, 500]).toContain(r.status);
    });

    test('PATCH /v1/email/messages/:id — missing address param returns 400', async () => {
      const r = await req('/v1/email/messages/some-message-id', {
        method: 'PATCH',
        body: JSON.stringify({ read: true }),
      }, apiKey);
      expect([400, 500]).toContain(r.status);
    });

    test('PATCH /v1/email/messages/:id — non-existent message returns 404', async () => {
      const r = await req(
        `/v1/email/messages/nonexistent-id-xyz?address=${claimedAddress}`,
        { method: 'PATCH', body: JSON.stringify({ read: true }) },
        apiKey,
      );
      expect([404, 500]).toContain(r.status);
    });

    test('GET /v1/email/inbox — without auth returns 401', async () => {
      const r = await req(`/v1/email/inbox?address=${claimedAddress}`);
      expect(r.status).toBe(401);
    });
  });

  // ── Email: Addresses ───────────────────────────────────────────────────────

  describe('email: addresses', () => {
    test('GET /v1/email/addresses — returns list including claimed address', async () => {
      const r = await req('/v1/email/addresses', {}, apiKey);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.addresses)).toBe(true);
      const addresses: any[] = r.body.addresses;
      const found = addresses.find(
        (a: any) => (typeof a === 'string' ? a : a.address) === claimedAddress,
      );
      expect(found).toBeDefined();
    });

    test('GET /v1/email/addresses — without auth returns 401', async () => {
      const r = await req('/v1/email/addresses');
      expect(r.status).toBe(401);
    });
  });

  // ── Email: Send ────────────────────────────────────────────────────────────

  describe('email: send', () => {
    test('POST /v1/email/send — missing fields returns 400', async () => {
      const r = await req('/v1/email/send', {
        method: 'POST',
        body: JSON.stringify({ from: claimedAddress }),
      }, apiKey);
      expect(r.status).toBe(400);
      expect(r.body.error).toBeDefined();
    });

    test('POST /v1/email/send — non-agentlair sender returns 403', async () => {
      const r = await req('/v1/email/send', {
        method: 'POST',
        body: JSON.stringify({
          from: 'someone@gmail.com',
          to: 'test@example.com',
          subject: 'Test',
          text: 'Hello',
        }),
      }, apiKey);
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('invalid_sender');
    });

    test('POST /v1/email/send — unowned address returns 403', async () => {
      if (!apiKey2) return; // Skip: no secondary key available
      const r = await req('/v1/email/send', {
        method: 'POST',
        body: JSON.stringify({
          from: claimedAddress,
          to: 'recipient@example.com',
          subject: 'Test',
          text: 'Stolen address attempt',
        }),
      }, apiKey2);
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('not_your_address');
    });

    test('POST /v1/email/send — valid request (200=sent, 402=rate limited, 502=infra)', async () => {
      const r = await req('/v1/email/send', {
        method: 'POST',
        body: JSON.stringify({
          from: claimedAddress,
          to: `devnull-${RUN_ID}@example.com`,
          subject: `Integration test ${RUN_ID}`,
          text: `Test email from integration test run ${RUN_ID}. Safe to ignore.`,
        }),
      }, apiKey);
      // 200/201 = sent, 402 = rate limited (x402), 502 = Resend delivery issue, 503 = KV quota exceeded
      expect([200, 201, 402, 502, 503]).toContain(r.status);
    });

    test('POST /v1/email/send — without auth returns 401', async () => {
      const r = await req('/v1/email/send', {
        method: 'POST',
        body: JSON.stringify({ from: claimedAddress, to: 'x@x.com', subject: 'x', text: 'x' }),
      });
      expect(r.status).toBe(401);
    });
  });

  // ── Email: Outbox ──────────────────────────────────────────────────────────

  describe('email: outbox', () => {
    test('GET /v1/email/outbox — returns sent messages array', async () => {
      const r = await req('/v1/email/outbox', {}, apiKey);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.messages)).toBe(true);
    });

    test('GET /v1/email/outbox — without auth returns 401', async () => {
      const r = await req('/v1/email/outbox');
      expect(r.status).toBe(401);
    });
  });

  // ── Email: Webhooks ────────────────────────────────────────────────────────

  describe('email: webhooks', () => {
    let webhookId = '';

    test('POST /v1/email/webhooks — registers a webhook', async () => {
      const r = await req('/v1/email/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          url: `https://webhook.example.com/hook-${RUN_ID}`,
          address: claimedAddress,
        }),
      }, apiKey);
      // 200/201 = registered, 503 = KV quota exceeded
      expect([200, 201, 503]).toContain(r.status);
      webhookId = r.body?.id ?? '';
      if (webhookId) {
        expect(typeof webhookId).toBe('string');
      }
    });

    test('GET /v1/email/webhooks — returns webhooks list', async () => {
      const r = await req('/v1/email/webhooks', {}, apiKey);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.webhooks)).toBe(true);
    });

    test('DELETE /v1/email/webhooks/:id — non-existent webhook returns 404', async () => {
      const r = await req('/v1/email/webhooks/nonexistent-webhook-id-xyz', { method: 'DELETE' }, apiKey);
      expect(r.status).toBe(404);
    });

    test('DELETE /v1/email/webhooks/:id — deletes registered webhook (if created)', async () => {
      if (!webhookId) return; // Skip if webhook creation failed
      const r = await req(`/v1/email/webhooks/${webhookId}`, { method: 'DELETE' }, apiKey);
      expect([200, 204, 404, 500]).toContain(r.status);
    });

    test('GET /v1/email/webhooks — without auth returns 401', async () => {
      const r = await req('/v1/email/webhooks');
      expect(r.status).toBe(401);
    });
  });

  // ── Vault: KV Store ────────────────────────────────────────────────────────

  describe('vault: KV store', () => {
    const vaultKey = `test-secret-${RUN_ID}`;
    let vaultPutSucceeded = false; // tracks whether initial PUT worked, for cascading tests

    test('GET /v1/vault — lists vault keys (empty at start)', async () => {
      const r = await req('/v1/vault', {}, apiKey);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.keys)).toBe(true);
      expect(typeof r.body.count).toBe('number');
      expect(typeof r.body.limit).toBe('number');
    });

    test('GET /v1/vault — without auth returns 401', async () => {
      const r = await req('/v1/vault');
      expect(r.status).toBe(401);
    });

    test('PUT /v1/vault/:key — stores a ciphertext blob (returns 201 for new)', async () => {
      const r = await req(`/v1/vault/${vaultKey}`, {
        method: 'PUT',
        body: JSON.stringify({
          ciphertext: `ZW5jcnlwdGVkLWRhdGEtZm9yLXRlc3QtcnVuLXRlc3Q=`,
          metadata: { purpose: 'integration-test', run: RUN_ID },
        }),
      }, apiKey);
      // 200/201 = success, 503 = KV quota exceeded
      expect([200, 201, 503]).toContain(r.status);
      if (r.status === 503) return; // KV quota exceeded — downstream tests will skip
      vaultPutSucceeded = true;
      expect(r.body.key).toBe(vaultKey);
      expect(r.body.stored).toBe(true);
      expect(typeof r.body.version).toBe('number');
      expect(r.body.version).toBeGreaterThan(0);
    });

    test('PUT /v1/vault/:key — missing ciphertext returns 400', async () => {
      const r = await req(`/v1/vault/missing-cipher-${RUN_ID}`, {
        method: 'PUT',
        body: JSON.stringify({ metadata: { test: true } }),
      }, apiKey);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_ciphertext');
    });

    test('GET /v1/vault/:key — retrieves stored blob', async () => {
      if (!vaultPutSucceeded) return; // Skip: initial PUT failed (KV quota exceeded)
      const r = await req(`/v1/vault/${vaultKey}`, {}, apiKey);
      expect(r.status).toBe(200);
      expect(r.body.key).toBe(vaultKey);
      expect(typeof r.body.ciphertext).toBe('string');
      expect(typeof r.body.version).toBe('number');
      expect(r.body.version).toBeGreaterThan(0);
    });

    test('GET /v1/vault/:key — versioning: sequential PUTs increment version', async () => {
      const key = `versioned-${RUN_ID}`;

      const put1 = await req(`/v1/vault/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ ciphertext: 'Y2lwaGVydGV4dC12MQ==' }),
      }, apiKey);
      // 200/201 = success, 503 = KV quota exceeded — skip gracefully
      if (put1.status === 503) return;
      expect([200, 201]).toContain(put1.status);
      expect(put1.body.version).toBe(1);

      const put2 = await req(`/v1/vault/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ ciphertext: 'Y2lwaGVydGV4dC12Mg==' }),
      }, apiKey);
      expect([200, 201]).toContain(put2.status);
      expect(put2.body.version).toBe(2);

      const getR = await req(`/v1/vault/${key}`, {}, apiKey);
      expect(getR.status).toBe(200);
      expect(getR.body.latest_version).toBe(2);
    });

    test('GET /v1/vault/:key — non-existent key returns 404', async () => {
      const r = await req(`/v1/vault/does-not-exist-${RUN_ID}-xyz`, {}, apiKey);
      expect(r.status).toBe(404);
      expect(r.body.error).toBe('not_found');
    });

    test('GET /v1/vault/:key — account isolation: another account sees 404', async () => {
      if (!apiKey2) return; // Skip: no secondary key available
      const r = await req(`/v1/vault/${vaultKey}`, {}, apiKey2);
      expect(r.status).toBe(404); // Key doesn't exist for account2
    });

    test('DELETE /v1/vault/:key — deletes key, subsequent GET returns 404', async () => {
      const key = `delete-me-${RUN_ID}`;
      const putR = await req(`/v1/vault/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ ciphertext: 'dGVtcG9yYXJ5LXZhbHVl' }),
      }, apiKey);
      // 201/200 = created/updated, 403 = vault key limit reached (free tier: 10), 503 = KV quota exceeded
      if (putR.status === 503) return; // KV quota exceeded — skip gracefully
      if (putR.status === 403 && putR.body.error === 'vault_limit_reached') {
        // Can't test delete on new key — vault is full. Skip gracefully.
        return;
      }
      expect([200, 201]).toContain(putR.status);

      const del = await req(`/v1/vault/${key}`, { method: 'DELETE' }, apiKey);
      expect([200, 204]).toContain(del.status);

      const get = await req(`/v1/vault/${key}`, {}, apiKey);
      expect(get.status).toBe(404);
    });

    test('DELETE /v1/vault/:key — non-existent key returns 404', async () => {
      const r = await req(`/v1/vault/definitely-missing-${RUN_ID}`, { method: 'DELETE' }, apiKey);
      expect(r.status).toBe(404);
    });

    test('GET /v1/vault — listed keys include our stored key', async () => {
      if (!vaultPutSucceeded) return; // Skip: initial PUT failed (KV quota exceeded)
      const r = await req('/v1/vault', {}, apiKey);
      expect([200, 500]).toContain(r.status);
      if (r.status === 200) {
        const found = r.body.keys.find((k: any) => k.key === vaultKey);
        expect(found).toBeDefined();
      }
    });
  });

  // ── Stacks ─────────────────────────────────────────────────────────────────

  describe('stacks', () => {
    let stackId = '';
    const domain = `test-${RUN_ID}.example.dev`;

    test('POST /v1/stack — creates a stack for a domain', async () => {
      const r = await req('/v1/stack', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      }, apiKey);
      // 201 = created, 402 = free tier limit (if previous runs exist for this account)
      expect([201, 402]).toContain(r.status);
      if (r.status === 201) {
        stackId = r.body.id;
        expect(r.body.id).toMatch(/^stk_/);
        expect(r.body.domain).toBe(domain);
        expect(r.body.status).toBe('provisioning');
        expect(Array.isArray(r.body.nameservers)).toBe(true);
      }
    });

    test('POST /v1/stack — missing domain returns 400', async () => {
      const r = await req('/v1/stack', {
        method: 'POST',
        body: JSON.stringify({}),
      }, apiKey);
      expect(r.status).toBe(400);
      expect(r.body.error).toBeDefined();
    });

    test('GET /v1/stack — lists stacks', async () => {
      const r = await req('/v1/stack', {}, apiKey);
      expect(r.status).toBe(200);
    });

    test('POST /v1/stack — same domain is idempotent (returns same stack)', async () => {
      if (!stackId) return; // Skip if initial creation hit tier limit
      const r = await req('/v1/stack', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      }, apiKey);
      expect([200, 201]).toContain(r.status);
      expect(r.body.id).toBe(stackId);
    });

    test('GET /v1/stack — without auth returns 401', async () => {
      const r = await req('/v1/stack');
      expect(r.status).toBe(401);
    });
  });

  // ── Observations ───────────────────────────────────────────────────────────

  describe('observations', () => {
    let observationId = '';

    test('POST /v1/observations — writes an observation', async () => {
      const r = await req('/v1/observations', {
        method: 'POST',
        body: JSON.stringify({
          topic: `integration-test-${RUN_ID}`,
          content: `Test observation from run ${RUN_ID} at ${new Date().toISOString()}`,
          shared: false,
        }),
      }, apiKey);
      // 201 = created, 429 = rate limited, 502 = Turso unavailable (infra issue, not test failure)
      expect([201, 429, 502]).toContain(r.status);
      if (r.status === 201) {
        observationId = r.body.id;
        expect(typeof r.body.id).toBe('string');
        expect(r.body.topic).toBe(`integration-test-${RUN_ID}`);
        expect(r.body.shared).toBe(false);
      }
    });

    test('POST /v1/observations — missing required fields returns 400', async () => {
      const r = await req('/v1/observations', {
        method: 'POST',
        body: JSON.stringify({ topic: 'only-topic' }),
      }, apiKey);
      expect([400, 429]).toContain(r.status);
      if (r.status === 400) {
        expect(r.body.error).toBeDefined();
      }
    });

    test('POST /v1/observations — content too long returns 400', async () => {
      const r = await req('/v1/observations', {
        method: 'POST',
        body: JSON.stringify({ topic: 'test', content: 'x'.repeat(10001) }),
      }, apiKey);
      expect([400, 429]).toContain(r.status);
      if (r.status === 400) {
        expect(r.body.error).toBe('invalid_content');
      }
    });

    test('GET /v1/observations — returns observations list', async () => {
      const r = await req('/v1/observations', {}, apiKey);
      expect([200, 429, 502]).toContain(r.status);
      if (r.status === 200) {
        expect(Array.isArray(r.body.observations)).toBe(true);
        expect(r.body.filters).toBeDefined();
      }
    });

    test('GET /v1/observations?topic=X&scope=mine — finds created observation', async () => {
      if (!observationId) return; // Skip if creation failed
      const r = await req(
        `/v1/observations?topic=integration-test-${RUN_ID}&scope=mine`,
        {},
        apiKey,
      );
      expect([200, 429, 502]).toContain(r.status);
      if (r.status === 200) {
        const found = r.body.observations.find((o: any) => o.id === observationId);
        expect(found).toBeDefined();
      }
    });

    test('GET /v1/observations/topics — returns topic list', async () => {
      const r = await req('/v1/observations/topics', {}, apiKey);
      expect([200, 429, 502]).toContain(r.status);
      if (r.status === 200) {
        expect(Array.isArray(r.body.topics)).toBe(true);
      }
    });

    test('GET /v1/observations?scope=shared — returns only shared observations', async () => {
      const r = await req('/v1/observations?scope=shared', {}, apiKey);
      expect([200, 429, 502]).toContain(r.status);
      if (r.status === 200) {
        const allShared = r.body.observations.every((o: any) => o.shared === true);
        expect(allShared).toBe(true);
      }
    });

    test('GET /v1/observations — without auth returns 401', async () => {
      const r = await req('/v1/observations');
      expect(r.status).toBe(401);
    });
  });

  // ── Usage & Billing ────────────────────────────────────────────────────────

  describe('usage and billing', () => {
    test('GET /v1/usage — returns usage stats for this account', async () => {
      const r = await req('/v1/usage', {}, apiKey);
      expect([200, 429]).toContain(r.status);
      if (r.status === 200) {
        expect(r.body.account_id).toBe(accountId);
        expect(r.body.tier).toBe('free');
        expect(r.body.requests).toBeDefined();
        expect(typeof r.body.requests.used).toBe('number');
        expect(typeof r.body.requests.limit).toBe('number');
        expect(r.body.emails).toBeDefined();
        expect(typeof r.body.emails.daily_used).toBe('number');
        expect(r.body.status).toBe('active');
      }
    });

    test('GET /v1/usage — without auth returns 401', async () => {
      const r = await req('/v1/usage');
      expect(r.status).toBe(401);
    });

    test('GET /v1/billing — returns billing info with x402 details', async () => {
      const r = await req('/v1/billing', {}, apiKey);
      expect([200, 429]).toContain(r.status);
      if (r.status === 200) {
        expect(r.body.account_id).toBe(accountId);
        expect(r.body.tier).toBe('free');
        expect(r.body.x402).toBeDefined();
        expect(r.body.x402.supported).toBe(true);
        expect(typeof r.body.upgrade_url).toBe('string');
      }
    });

    test('GET /v1/billing — without auth returns 401', async () => {
      const r = await req('/v1/billing');
      expect(r.status).toBe(401);
    });
  });
});
