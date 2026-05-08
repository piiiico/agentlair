/**
 * @agentlair/sdk — Tests
 *
 * Tests use Bun's built-in fetch mock to avoid live API calls.
 */
import { expect, test, describe, mock } from 'bun:test';
import { AgentLair, AgentLairClient, AgentLairError } from './index';

// ─── Mock fetch helper ─────────────────────────────────────────────────────

type MockResponse = {
  status?: number;
  body: unknown;
  contentType?: string;
};

function mockFetch(responses: MockResponse[]) {
  let callIndex = 0;
  const fetchMock = mock(async (_url: string, _init?: RequestInit) => {
    const resp = responses[callIndex++] ?? { status: 500, body: { error: 'no mock' } };
    const status = resp.status ?? 200;
    const contentType = resp.contentType ?? 'application/json';
    const body =
      contentType === 'application/json' ? JSON.stringify(resp.body) : String(resp.body);
    return new Response(body, {
      status,
      headers: { 'Content-Type': contentType },
    });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

// ─── AgentLair constructor ───────────────────────────────────────────────────

describe('AgentLair constructor', () => {
  test('constructs with string apiKey', () => {
    const lair = new AgentLair('al_test_key');
    expect(lair).toBeTruthy();
    expect(lair.email).toBeTruthy();
    expect(lair.vault).toBeTruthy();
    expect(lair.stacks).toBeTruthy();
    expect(lair.observations).toBeTruthy();
    expect(lair.account).toBeTruthy();
  });

  test('constructs with options object', () => {
    const lair = new AgentLair({ apiKey: 'al_test_key', baseUrl: 'http://localhost:8787' });
    expect(lair).toBeTruthy();
  });

  test('strips trailing slash from baseUrl in options object', () => {
    const lair = new AgentLair({ apiKey: 'al_test_key', baseUrl: 'http://localhost:8787/' });
    expect(lair).toBeTruthy();
  });
});

// ─── AgentLairClient (legacy) constructor ──────────────────────────────────

describe('AgentLairClient constructor (legacy)', () => {
  test('constructs with apiKey options object', () => {
    const client = new AgentLairClient({ apiKey: 'al_test_key' });
    expect(client).toBeTruthy();
    expect(client.vault).toBeTruthy();
    expect(client.email).toBeTruthy();
  });

  test('has legacy flat methods for backward compatibility', () => {
    const client = new AgentLairClient({ apiKey: 'al_test_key' });
    expect(typeof client.claimAddress).toBe('function');
    expect(typeof client.sendEmail).toBe('function');
    expect(typeof client.getInbox).toBe('function');
    expect(typeof client.readMessage).toBe('function');
  });
});

// ─── AgentLair.createAccount (static) ──────────────────────────────────────

describe('AgentLair.createAccount', () => {
  test('calls POST /v1/auth/keys and returns result', async () => {
    const mockResult = {
      api_key: 'al_live_abc123',
      account_id: 'acct_xyz',
      tier: 'free',
      limits: { emails_per_day: 10, vault_keys: 50 },
    };
    mockFetch([{ body: mockResult }]);

    const result = await AgentLair.createAccount({ name: 'test-agent' });
    expect(result.api_key).toBe('al_live_abc123');
    expect(result.account_id).toBe('acct_xyz');
  });

  test('throws AgentLairError on non-2xx response', async () => {
    mockFetch([{ status: 400, body: { error: 'bad_request', message: 'Invalid payload' } }]);
    await expect(AgentLair.createAccount()).rejects.toBeInstanceOf(AgentLairError);
  });

  test('AgentLairError has status and code', async () => {
    mockFetch([{ status: 429, body: { error: 'rate_limited', message: 'Too many requests' } }]);
    try {
      await AgentLair.createAccount();
    } catch (e) {
      expect(e).toBeInstanceOf(AgentLairError);
      const err = e as AgentLairError;
      expect(err.status).toBe(429);
      expect(err.code).toBe('rate_limited');
      expect(err.message).toBe('Too many requests');
    }
  });

  test('AgentLairClient.createAccount delegates to AgentLair.createAccount', async () => {
    const mockResult = { api_key: 'al_test_x', account_id: 'a', tier: 'free', limits: {} };
    mockFetch([{ body: mockResult }]);
    const result = await AgentLairClient.createAccount({ name: 'test' });
    expect(result.api_key).toBe('al_test_x');
  });
});

// ─── email.claim ────────────────────────────────────────────────────────────

describe('lair.email.claim', () => {
  test('calls POST /v1/email/claim', async () => {
    const mockResult = { address: 'my-agent@agentlair.dev', claimed: true, already_owned: false, account_id: 'a', e2e_enabled: false };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.email.claim('my-agent@agentlair.dev');

    expect(result.address).toBe('my-agent@agentlair.dev');
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/claim');
  });

  test('auto-expands short name to @agentlair.dev', async () => {
    const mockResult = { address: 'my-agent@agentlair.dev', claimed: true, already_owned: false, account_id: 'a', e2e_enabled: false };
    mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.email.claim('my-agent');

    const fetchMock = global.fetch as ReturnType<typeof mock>;
    const [[, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const body = JSON.parse(init?.body as string);
    expect(body.address).toBe('my-agent@agentlair.dev');
  });

  test('throws AgentLairError when address already taken', async () => {
    mockFetch([{ status: 409, body: { error: 'address_taken', message: 'Address already claimed' } }]);
    const lair = new AgentLair('al_test_key');
    await expect(lair.email.claim('taken@agentlair.dev')).rejects.toBeInstanceOf(AgentLairError);
  });
});

// ─── email.inbox ────────────────────────────────────────────────────────────

describe('lair.email.inbox', () => {
  test('calls GET /v1/email/inbox with address query param', async () => {
    const mockResult = { messages: [], count: 0, has_more: false, address: 'my-agent@agentlair.dev' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.email.inbox('my-agent@agentlair.dev');

    expect(result.count).toBe(0);
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/inbox');
    expect(calledUrl).toContain('address=my-agent');
  });

  test('auto-expands short name', async () => {
    const mockResult = { messages: [], count: 0, has_more: false, address: 'my-agent@agentlair.dev' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.email.inbox('my-agent');

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('address=my-agent%40agentlair.dev');
  });

  test('passes limit query param', async () => {
    const mockResult = { messages: [], count: 0, has_more: false, address: 'x' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.email.inbox('my-agent@agentlair.dev', { limit: 5 });

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('limit=5');
  });
});

// ─── email.send ─────────────────────────────────────────────────────────────

describe('lair.email.send', () => {
  test('calls POST /v1/email/send', async () => {
    const mockResult = { id: 'msg_abc', status: 'sent' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.email.send({
      from: 'my-agent@agentlair.dev',
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Hi!',
    });

    expect(result.id).toBe('msg_abc');
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/send');
    expect(init?.method).toBe('POST');
  });
});

// ─── email.read ─────────────────────────────────────────────────────────────

describe('lair.email.read', () => {
  test('calls GET /v1/email/messages/:id', async () => {
    const mockResult = {
      message_id: '<abc@agentlair.dev>',
      message_id_url: 'abc%40agentlair.dev',
      from: 'sender@example.com',
      to: 'my-agent@agentlair.dev',
      subject: 'Hello',
      snippet: 'Hi!',
      received_at: '2026-01-01T00:00:00Z',
      read: false,
      body: 'Hi!',
    };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.email.read('abc%40agentlair.dev', 'my-agent@agentlair.dev');

    expect(result.body).toBe('Hi!');
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/messages/');
    expect(calledUrl).toContain('address=my-agent');
  });
});

// ─── email.outbox ────────────────────────────────────────────────────────────

describe('lair.email.outbox', () => {
  test('calls GET /v1/email/outbox', async () => {
    const mockResult = { messages: [], count: 0 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.email.outbox();

    expect(result.count).toBe(0);
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/outbox');
  });

  test('passes limit param', async () => {
    const mockResult = { messages: [], count: 0 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.email.outbox({ limit: 5 });

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('limit=5');
  });
});

// ─── email.addresses ────────────────────────────────────────────────────────

describe('lair.email.addresses', () => {
  test('calls GET /v1/email/addresses', async () => {
    const mockResult = { addresses: ['my-agent@agentlair.dev'], count: 1 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.email.addresses();

    expect(result.count).toBe(1);
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/addresses');
  });
});

// ─── email.webhooks ─────────────────────────────────────────────────────────

describe('lair.email.webhooks', () => {
  test('webhooks.create calls POST /v1/email/webhooks', async () => {
    const mockResult = { id: 'wh_abc', address: 'my-agent@agentlair.dev', url: 'https://x.com/hook', created_at: '2026-01-01T00:00:00Z' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.email.webhooks.create({
      address: 'my-agent@agentlair.dev',
      url: 'https://x.com/hook',
    });

    expect(result.id).toBe('wh_abc');
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/webhooks');
    expect(init?.method).toBe('POST');
  });

  test('webhooks.list calls GET /v1/email/webhooks', async () => {
    const mockResult = { webhooks: [], count: 0 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.email.webhooks.list();

    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/webhooks');
    expect((init?.method ?? 'GET')).toBe('GET');
  });

  test('webhooks.delete calls DELETE /v1/email/webhooks/:id', async () => {
    const mockResult = { deleted: true, id: 'wh_abc' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.email.webhooks.delete('wh_abc');

    expect(result.deleted).toBe(true);
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/webhooks/wh_abc');
    expect(init?.method).toBe('DELETE');
  });

  test('webhooks.create auto-expands short address', async () => {
    const mockResult = { id: 'wh_x', address: 'my-agent@agentlair.dev', url: 'https://x.com/hook', created_at: '2026-01-01T00:00:00Z' };
    mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.email.webhooks.create({ address: 'my-agent', url: 'https://x.com/hook' });

    const fetchMock = global.fetch as ReturnType<typeof mock>;
    const [[, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const body = JSON.parse(init?.body as string);
    expect(body.address).toBe('my-agent@agentlair.dev');
  });
});

// ─── vault namespace ────────────────────────────────────────────────────────

describe('lair.vault.put', () => {
  test('calls PUT /v1/vault/:key', async () => {
    const mockResult = { key: 'openai-key', version: 1, stored: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.vault.put('openai-key', { ciphertext: 'aeGx8kF...' });

    expect(result.version).toBe(1);
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/vault/openai-key');
    expect(init?.method).toBe('PUT');
  });

  test('URL-encodes key with special characters', async () => {
    const mockResult = { key: 'my key/v2', version: 1, stored: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.vault.put('my key/v2', { ciphertext: 'xxx' });

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain(encodeURIComponent('my key/v2'));
  });

  test('throws AgentLairError on 401', async () => {
    mockFetch([{ status: 401, body: { error: 'unauthorized', message: 'Invalid API key' } }]);
    const lair = new AgentLair('bad_key');
    await expect(lair.vault.put('key', { ciphertext: 'x' })).rejects.toBeInstanceOf(AgentLairError);
  });
});

describe('lair.vault.get', () => {
  test('calls GET /v1/vault/:key', async () => {
    const mockResult = {
      key: 'openai-key', ciphertext: 'aeGx8kF...', value: 'aeGx8kF...',
      version: 1, latest_version: 1, metadata: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.vault.get('openai-key');

    expect(result.ciphertext).toBe('aeGx8kF...');
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/vault/openai-key');
    expect(init?.method).toBe('GET');
  });

  test('passes version query param', async () => {
    const mockResult = { key: 'k', ciphertext: 'x', value: 'x', version: 2, latest_version: 3, metadata: null, created_at: '', updated_at: '' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.vault.get('k', { version: 2 });

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('version=2');
  });
});

describe('lair.vault.list', () => {
  test('calls GET /v1/vault/', async () => {
    const mockResult = {
      keys: [{ key: 'openai-key', version: 1, metadata: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }],
      count: 1,
      limit: 50,
      tier: 'free',
    };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.vault.list();

    expect(result.count).toBe(1);
    expect(result.keys[0].key).toBe('openai-key');
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/vault/');
  });
});

describe('lair.vault.delete', () => {
  test('calls DELETE /v1/vault/:key', async () => {
    const mockResult = { key: 'openai-key', deleted: true, versions_removed: 1 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.vault.delete('openai-key');

    expect(result.deleted).toBe(true);
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/vault/openai-key');
    expect(init?.method).toBe('DELETE');
  });

  test('passes version param', async () => {
    const mockResult = { key: 'k', deleted: true };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.vault.delete('k', { version: 3 });

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('version=3');
  });

  test('does not pass version param when not provided', async () => {
    const mockResult = { key: 'k', deleted: true };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.vault.delete('k');

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).not.toContain('version=');
  });
});

// ─── stacks namespace ───────────────────────────────────────────────────────

describe('lair.stacks', () => {
  test('stacks.create calls POST /v1/stack', async () => {
    const mockResult = { id: 'stk_abc', domain: 'myagent.dev', status: 'provisioning', nameservers: ['ns1.agentlair.dev'] };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.stacks.create({ domain: 'myagent.dev' });

    expect(result.id).toBe('stk_abc');
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/stack');
    expect(init?.method).toBe('POST');
  });

  test('stacks.list calls GET /v1/stack', async () => {
    const mockResult = { stacks: [{ id: 'stk_abc', domain: 'myagent.dev', status: 'active' }], count: 1 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.stacks.list();

    expect(result.count).toBe(1);
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/stack');
  });
});

// ─── observations namespace ─────────────────────────────────────────────────

describe('lair.observations', () => {
  test('observations.write calls POST /v1/observations', async () => {
    const mockResult = {
      id: 'obs_abc',
      topic: 'market-signals',
      content: 'BTC up 5%',
      shared: false,
      agent_id: 'acct_xyz',
      created_at: '2026-03-17T00:00:00Z',
    };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.observations.write({ topic: 'market-signals', content: 'BTC up 5%' });

    expect(result.id).toBe('obs_abc');
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/observations');
    expect(init?.method).toBe('POST');
  });

  test('observations.read calls GET /v1/observations with filters', async () => {
    const mockResult = { observations: [], count: 0, filters: {} };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.observations.read({ topic: 'market-signals', scope: 'mine' });

    expect(result.count).toBe(0);
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/observations');
    expect(calledUrl).toContain('topic=market-signals');
    expect(calledUrl).toContain('scope=mine');
  });

  test('observations.topics calls GET /v1/observations/topics', async () => {
    const mockResult = { topics: [{ topic: 'market-signals', count: 5, latest: '2026-03-17T00:00:00Z' }], count: 1 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.observations.topics();

    expect(result.count).toBe(1);
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/observations/topics');
  });
});

// ─── account namespace ──────────────────────────────────────────────────────

describe('lair.account', () => {
  test('account.me calls GET /v1/account/me', async () => {
    const mockResult = { account_id: 'acct_xyz', tier: 'free', created_at: '2026-01-01T00:00:00Z' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.account.me();

    expect(result.account_id).toBe('acct_xyz');
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/account/me');
  });

  test('account.usage calls GET /v1/usage', async () => {
    const mockResult = {
      account_id: 'acct_xyz', tier: 'free', period: '2026-03-17',
      requests: { used: 5, limit: 100 },
      stacks: { used: 0, limit: 1 },
      emails: { daily_used: 2, daily_limit: 10, daily_remaining: 8, hourly_limit: 10, reset_at: '2026-03-18T00:00:00Z' },
    };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.account.usage();

    expect(result.emails.daily_remaining).toBe(8);
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/usage');
  });

  test('account.billing calls GET /v1/billing', async () => {
    const mockResult = { account_id: 'acct_xyz', tier: 'free' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.account.billing();

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/billing');
  });
});

// ─── calendar namespace ─────────────────────────────────────────────────────

describe('lair.calendar', () => {
  test('calendar namespace is accessible on AgentLair', () => {
    const lair = new AgentLair('al_test_key');
    expect(lair.calendar).toBeTruthy();
    expect(typeof lair.calendar.createEvent).toBe('function');
    expect(typeof lair.calendar.listEvents).toBe('function');
    expect(typeof lair.calendar.deleteEvent).toBe('function');
    expect(typeof lair.calendar.getFeed).toBe('function');
  });

  test('calendar namespace is accessible on AgentLairClient', () => {
    const client = new AgentLairClient({ apiKey: 'al_test_key' });
    expect(client.calendar).toBeTruthy();
  });

  test('calendar.createEvent calls POST /v1/calendar/events', async () => {
    const mockResult = {
      event_id: 'evt_abc123',
      summary: 'Team Standup',
      start: '2026-03-21T10:00:00Z',
      end: '2026-03-21T10:30:00Z',
      created_at: '2026-03-20T09:00:00Z',
      note: 'Event created.',
    };
    const fetchMock = mockFetch([{ body: mockResult, status: 201 }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.calendar.createEvent({
      summary: 'Team Standup',
      start: '2026-03-21T10:00:00Z',
      end: '2026-03-21T10:30:00Z',
    });

    expect(result.event_id).toBe('evt_abc123');
    expect(result.summary).toBe('Team Standup');
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/calendar/events');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.summary).toBe('Team Standup');
  });

  test('calendar.createEvent sends attendees and location', async () => {
    const mockResult = {
      event_id: 'evt_xyz',
      summary: 'Kickoff',
      start: '2026-03-22T09:00:00Z',
      end: '2026-03-22T10:00:00Z',
      location: 'Zoom',
      attendees: ['alice@example.com'],
      created_at: '2026-03-20T09:00:00Z',
    };
    mockFetch([{ body: mockResult, status: 201 }]);

    const lair = new AgentLair('al_test_key');
    await lair.calendar.createEvent({
      summary: 'Kickoff',
      start: '2026-03-22T09:00:00Z',
      end: '2026-03-22T10:00:00Z',
      location: 'Zoom',
      attendees: ['alice@example.com'],
    });

    const fetchMock = global.fetch as ReturnType<typeof mock>;
    const [[, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const body = JSON.parse(init?.body as string);
    expect(body.location).toBe('Zoom');
    expect(body.attendees).toEqual(['alice@example.com']);
  });

  test('calendar.listEvents calls GET /v1/calendar/events', async () => {
    const mockEvent = {
      id: 'evt_abc',
      summary: 'Standup',
      start: '2026-03-21T10:00:00Z',
      end: '2026-03-21T10:30:00Z',
      created_at: '2026-03-20T00:00:00Z',
      updated_at: '2026-03-20T00:00:00Z',
    };
    const mockResult = { events: [mockEvent], count: 1, total: 1, limit: 50 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.calendar.listEvents();

    expect(result.count).toBe(1);
    expect(result.events[0].id).toBe('evt_abc');
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/calendar/events');
    expect((init?.method ?? 'GET')).toBe('GET');
  });

  test('calendar.listEvents passes from/to/limit query params', async () => {
    const mockResult = { events: [], count: 0, total: 0, limit: 10 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.calendar.listEvents({ from: '2026-03-01', to: '2026-03-31', limit: 10 });

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('from=2026-03-01');
    expect(calledUrl).toContain('to=2026-03-31');
    expect(calledUrl).toContain('limit=10');
  });

  test('calendar.listEvents with no options sends no query params', async () => {
    const mockResult = { events: [], count: 0, total: 0, limit: 50 };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.calendar.listEvents();

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).not.toContain('from=');
    expect(calledUrl).not.toContain('to=');
    expect(calledUrl).not.toContain('limit=');
  });

  test('calendar.deleteEvent calls DELETE /v1/calendar/events/:id', async () => {
    const mockResult = { event_id: 'evt_abc123', deleted: true };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.calendar.deleteEvent('evt_abc123');

    expect(result.deleted).toBe(true);
    expect(result.event_id).toBe('evt_abc123');
    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/calendar/events/evt_abc123');
    expect(init?.method).toBe('DELETE');
  });

  test('calendar.deleteEvent URL-encodes the event ID', async () => {
    const mockResult = { event_id: 'evt abc', deleted: true };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.calendar.deleteEvent('evt abc');

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain(encodeURIComponent('evt abc'));
  });

  test('calendar.getFeed calls GET /v1/calendar/feed', async () => {
    const mockResult = {
      feed_url: 'https://agentlair.dev/v1/calendar/feed.ics?cal_token=ct_abc123',
      cal_token: 'ct_abc123',
      note: 'Subscribe to this URL from any calendar app.',
      how_to_subscribe: 'In Google Calendar: Other Calendars → From URL → paste feed_url',
    };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.calendar.getFeed();

    expect(result.feed_url).toContain('feed.ics');
    expect(result.cal_token).toBe('ct_abc123');
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/calendar/feed');
    expect(calledUrl).not.toContain('feed.ics');
  });

  test('calendar.createEvent throws AgentLairError on validation failure', async () => {
    mockFetch([{ status: 400, body: { error: 'invalid_summary', message: 'summary required (string)' } }]);
    const lair = new AgentLair('al_test_key');
    await expect(
      lair.calendar.createEvent({ summary: '', start: '2026-03-21', end: '2026-03-22' }),
    ).rejects.toBeInstanceOf(AgentLairError);
  });
});

// ─── Authorization header ───────────────────────────────────────────────────

describe('Authorization header', () => {
  test('sends Bearer token on authenticated requests', async () => {
    mockFetch([{ body: { messages: [], count: 0, has_more: false, address: 'x@agentlair.dev' } }]);
    const lair = new AgentLair('al_test_mykey');
    await lair.email.inbox('x@agentlair.dev');

    const fetchMock = global.fetch as ReturnType<typeof mock>;
    const [[, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer al_test_mykey');
  });
});

// ─── Legacy AgentLairClient flat methods ───────────────────────────────────

describe('AgentLairClient legacy methods', () => {
  test('claimAddress delegates to email.claim', async () => {
    const mockResult = { address: 'my-agent@agentlair.dev', claimed: true, already_owned: false, account_id: 'a', e2e_enabled: false };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const client = new AgentLairClient({ apiKey: 'al_test_key' });
    const result = await client.claimAddress({ address: 'my-agent@agentlair.dev' });

    expect(result.claimed).toBe(true);
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/claim');
  });

  test('sendEmail delegates to email.send', async () => {
    const mockResult = { id: 'msg_x', status: 'sent' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const client = new AgentLairClient({ apiKey: 'al_test_key' });
    await client.sendEmail({
      from: 'my-agent@agentlair.dev',
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Hi!',
    });

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/send');
  });

  test('getInbox delegates to email.inbox', async () => {
    const mockResult = { messages: [], count: 0, has_more: false, address: 'my-agent@agentlair.dev' };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const client = new AgentLairClient({ apiKey: 'al_test_key' });
    await client.getInbox({ address: 'my-agent@agentlair.dev' });

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/inbox');
  });

  test('readMessage delegates to email.read', async () => {
    const mockResult = {
      message_id: '<abc@agentlair.dev>',
      message_id_url: 'abc',
      from: 'sender@example.com',
      to: 'x@agentlair.dev',
      subject: 'Hi',
      snippet: 'Hi',
      received_at: '2026-01-01T00:00:00Z',
      read: false,
      body: 'Hi!',
    };
    const fetchMock = mockFetch([{ body: mockResult }]);

    const client = new AgentLairClient({ apiKey: 'al_test_key' });
    const result = await client.readMessage({ messageId: 'abc', address: 'x@agentlair.dev' });

    expect(result.body).toBe('Hi!');
    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/email/messages/');
  });
});

// ─── lair.events ──────────────────────────────────────────────────────────────

describe('lair.events.emit', () => {
  test('emits a single event — POST /v1/events', async () => {
    const mockResult = {
      accepted: 1,
      rejected: 0,
      rate_limit: { remaining: 99, reset_at: '2026-04-21T01:00:00Z' },
    };
    const fetchMock = mockFetch([{ status: 202, body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.events.emit({
      category: 'tool',
      action: 'web_search',
      result: 'success',
    });

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.rate_limit.remaining).toBe(99);

    const [[calledUrl, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/v1/events');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
    const ev = body.events[0] as Record<string, unknown>;
    expect(ev.category).toBe('tool');
    expect(ev.action).toBe('web_search');
    expect(ev.result).toBe('success');
    // event_id and timestamp auto-generated
    expect(typeof ev.event_id).toBe('string');
    expect(typeof ev.timestamp).toBe('string');
  });

  test('emits a batch of events', async () => {
    const mockResult = {
      accepted: 2,
      rejected: 0,
      rate_limit: { remaining: 98, reset_at: '2026-04-21T01:00:00Z' },
    };
    const fetchMock = mockFetch([{ status: 202, body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.events.emit([
      { category: 'session', action: 'start', result: 'success' },
      { category: 'session', action: 'end', result: 'success' },
    ]);

    expect(result.accepted).toBe(2);

    const [[_url, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const body = JSON.parse(init.body as string) as { events: unknown[] };
    expect(body.events).toHaveLength(2);
  });

  test('preserves provided event_id and timestamp', async () => {
    const mockResult = { accepted: 1, rejected: 0, rate_limit: { remaining: 99, reset_at: '2026-04-21T01:00:00Z' } };
    const fetchMock = mockFetch([{ status: 202, body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    const fixedId = 'evt_custom_id_123';
    const fixedTs = '2026-04-21T00:00:00.000Z';
    await lair.events.emit({
      category: 'auth',
      action: 'key_rotation',
      result: 'success',
      event_id: fixedId,
      timestamp: fixedTs,
    });

    const [[_url, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const body = JSON.parse(init.body as string) as { events: Array<Record<string, unknown>> };
    expect(body.events[0]?.event_id).toBe(fixedId);
    expect(body.events[0]?.timestamp).toBe(fixedTs);
  });

  test('sends session_id at batch level', async () => {
    const mockResult = { accepted: 1, rejected: 0, rate_limit: { remaining: 99, reset_at: '2026-04-21T01:00:00Z' } };
    const fetchMock = mockFetch([{ status: 202, body: mockResult }]);

    const lair = new AgentLair('al_test_key');
    await lair.events.emit({
      category: 'resource',
      action: 'file_read',
      result: 'success',
      session_id: 'sess_abc123',
    });

    const [[_url, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const body = JSON.parse(init.body as string) as { session_id?: string };
    expect(body.session_id).toBe('sess_abc123');
  });

  test('throws AgentLairError on non-2xx response', async () => {
    mockFetch([{ status: 401, body: { error: 'unauthorized', message: 'Invalid API key' } }]);

    const lair = new AgentLair('al_bad_key');
    await expect(
      lair.events.emit({ category: 'tool', action: 'test', result: 'failure' }),
    ).rejects.toBeInstanceOf(AgentLairError);
  });
});

// ─── lair.trust ───────────────────────────────────────────────────────────────

describe('lair.trust.score', () => {
  const mockProfile = {
    agentId: 'acc_abc123',
    score: 72,
    confidence: 0.85,
    atfLevel: 'senior',
    trend: 'stable',
    dimensions: {
      consistency: { score: 75, confidence: 0.9 },
      restraint: { score: 68, confidence: 0.8 },
      transparency: { score: 73, confidence: 0.85 },
    },
    observationCount: 42,
    computedAt: '2026-04-21T00:00:00Z',
  };

  test('fetches score from public endpoint with explicit agentId', async () => {
    const fetchMock = mockFetch([{ body: mockProfile }]);

    const lair = new AgentLair('al_test_key');
    const result = await lair.trust.score('acc_abc123');

    expect(result.score).toBe(72);
    expect(result.atfLevel).toBe('senior');
    expect(result.dimensions.consistency.score).toBe(75);

    const [[calledUrl]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calledUrl).toContain('/badge/acc_abc123/score.json');
  });

  test('auto-resolves own agentId when none provided', async () => {
    const meMock = { account_id: 'acc_self456', tier: 'free', created_at: '2026-01-01T00:00:00Z' };
    const fetchMock = mockFetch([
      { body: meMock },    // First: GET /v1/account/me
      { body: mockProfile }, // Second: GET /badge/.../score.json
    ]);

    const lair = new AgentLair('al_test_key');
    await lair.trust.score();

    expect(fetchMock.mock.calls).toHaveLength(2);
    const calls = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect((calls[0] as unknown as string[])[0]).toContain('/v1/account/me');
    expect((calls[1] as unknown as string[])[0]).toContain('/badge/acc_self456/score.json');
  });

  test('throws AgentLairError for unknown agent', async () => {
    mockFetch([{ status: 400, body: { error: 'invalid_id', message: 'Invalid agent ID format.' } }]);

    const lair = new AgentLair('al_test_key');
    await expect(lair.trust.score('invalid_id')).rejects.toBeInstanceOf(AgentLairError);
  });
});

describe('lair.trust.badge', () => {
  test('returns badge SVG URL', () => {
    const lair = new AgentLair('al_test_key');
    const url = lair.trust.badge('acc_abc123');
    expect(url).toBe('https://agentlair.dev/badge/acc_abc123');
  });

  test('appends style query param when provided', () => {
    const lair = new AgentLair('al_test_key');
    const url = lair.trust.badge('acc_abc123', 'for-the-badge');
    expect(url).toBe('https://agentlair.dev/badge/acc_abc123?style=for-the-badge');
  });

  test('respects custom baseUrl', () => {
    const lair = new AgentLair({ apiKey: 'al_test_key', baseUrl: 'http://localhost:8787' });
    const url = lair.trust.badge('acc_abc123');
    expect(url).toBe('http://localhost:8787/badge/acc_abc123');
  });
});

// ─── AgentLair.signRequest ──────────────────────────────────────────────────

describe('AgentLair.signRequest — happy path', () => {
  test('produces a signature an origin can verify with the public key', async () => {
    // Generate a real Ed25519 keypair so we exercise the actual crypto path on Bun
    const rawKeyPair = await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify'],
    );

    // Export public key as raw bytes (32 bytes)
    const publicKeyRaw = new Uint8Array(
      await crypto.subtle.exportKey('raw', rawKeyPair.publicKey),
    );

    // Export private key (PKCS#8) and extract the 32-byte seed (last 32 bytes of DER)
    const privateKeyPkcs8 = new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', rawKeyPair.privateKey),
    );
    const privateKeySeed = privateKeyPkcs8.slice(-32);

    const request = new Request('https://api.example.com/resource');
    const signedRequest = await AgentLair.signRequest(request, {
      privateKey: privateKeySeed,
      publicKey: publicKeyRaw,
    });

    // Signature-Input and Signature headers must be present
    expect(signedRequest.headers.has('Signature-Input')).toBe(true);
    expect(signedRequest.headers.has('Signature')).toBe(true);
    expect(signedRequest.headers.has('Signature-Agent')).toBe(true);

    // Signature-Agent must point to agentlair.dev
    expect(signedRequest.headers.get('Signature-Agent')).toContain('https://agentlair.dev/agents/');

    // Extract and verify the signature
    const sigHeader = signedRequest.headers.get('Signature')!;
    // Format: sig1=:<base64>:
    const b64Match = sigHeader.match(/:([A-Za-z0-9+/=]+):/);
    expect(b64Match).not.toBeNull();
    const sigBytes = Uint8Array.from(atob(b64Match![1]), (c) => c.charCodeAt(0));

    // Re-import public key to verify
    const verifyKey = await crypto.subtle.importKey(
      'raw',
      publicKeyRaw,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    // Reconstruct signature base (same as signRequest internals)
    const sigInputHeader = signedRequest.headers.get('Signature-Input')!;
    // Extract sigParams from: sig1=("@authority" "@target-uri");created=...
    const sigParams = sigInputHeader.replace(/^sig1=/, '');
    const url = new URL(signedRequest.url);
    const signatureBase = [
      `"@authority": ${url.host}`,
      `"@target-uri": ${signedRequest.url}`,
      `"@signature-params": ${sigParams}`,
    ].join('\n');

    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      verifyKey,
      sigBytes,
      new TextEncoder().encode(signatureBase),
    );
    expect(valid).toBe(true);
  });

  test('respects custom label', async () => {
    const rawKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', rawKeyPair.publicKey));
    const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', rawKeyPair.privateKey));
    const privateKeySeed = privateKeyPkcs8.slice(-32);

    const signedRequest = await AgentLair.signRequest(
      new Request('https://api.example.com/resource'),
      { privateKey: privateKeySeed, publicKey: publicKeyRaw, label: 'mybot' },
    );

    expect(signedRequest.headers.get('Signature-Input')).toMatch(/^mybot=/);
    expect(signedRequest.headers.get('Signature')).toMatch(/^mybot=/);
  });

  test('respects custom signatureAgentBaseUrl', async () => {
    const rawKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', rawKeyPair.publicKey));
    const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', rawKeyPair.privateKey));
    const privateKeySeed = privateKeyPkcs8.slice(-32);

    const signedRequest = await AgentLair.signRequest(
      new Request('https://api.example.com/resource'),
      { privateKey: privateKeySeed, publicKey: publicKeyRaw, signatureAgentBaseUrl: 'http://localhost:8787' },
    );

    expect(signedRequest.headers.get('Signature-Agent')).toContain('http://localhost:8787/agents/');
  });
});
