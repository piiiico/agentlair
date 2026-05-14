// ─── Leaderboard A2A Routes — Unit tests ──────────────────────────────────────

import { describe, test, expect, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { leaderboardA2ARoutes } from './leaderboard.a2a.js';
import type { HonoEnv } from '../types.js';
import type { LeaderboardRowSet } from '../lib/a2a-leaderboard-job.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const savedFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = savedFetch; });

function makeKv(initial?: LeaderboardRowSet): KVNamespace {
  let stored: string | null = initial ? JSON.stringify(initial) : null;
  return {
    get: async () => stored,
    put: async (_key: string, value: string) => { stored = value; },
    getWithMetadata: async () => ({ value: stored, metadata: null }),
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
  } as unknown as KVNamespace;
}

const SAMPLE_ROWSET: LeaderboardRowSet = {
  refreshed_at: '2026-05-13T04:00:00.000Z',
  total: 2,
  registry_url: 'https://a2aregistry.org/api/agents',
  results: [
    { name: 'Alpha', url: 'https://alpha.example.com', well_known: 'https://alpha.example.com/.well-known/agent.json', grade: 'A', score: 92, layers: { l1: 95, l2: 90, l3: 88, l4: 92 }, ts: '2026-05-13T04:00:01Z' },
    { name: 'Beta',  url: 'https://beta.example.com',  well_known: 'https://beta.example.com/.well-known/agent.json',  grade: 'F', score: 20, layers: { l1: 30, l2: 10, l3: 5,  l4: 15 }, ts: '2026-05-13T04:00:02Z' },
  ],
};

const SECRET = 'test-secret-abc';

function makeApp(kv?: KVNamespace, secret?: string) {
  const app = new Hono<HonoEnv>();
  app.route('/leaderboard', leaderboardA2ARoutes);
  return { app, env: { A2A_LEADERBOARD: kv, LEADERBOARD_REFRESH_SECRET: secret } };
}

async function req(app: Hono<HonoEnv>, method: string, path: string, env: Record<string, unknown>, headers?: Record<string, string>, body?: string) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...(headers ?? {}) } };
  if (body) init.body = body;
  return app.fetch(new Request(`https://test${path}`, init), env as HonoEnv['Bindings']);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /leaderboard/a2a', () => {
  test('returns 200 + text/html when KV has rows', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('A2A Trust Leaderboard');
  });

  test('returns 503 + Retry-After when KV is empty', async () => {
    const { app, env } = makeApp(makeKv(), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('300');
  });

  test('hero banner shows correct l4Zero count', async () => {
    // SAMPLE_ROWSET has 2 entries: Alpha (l4=92) and Beta (l4=15) — neither is 0
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    const body = await res.text();
    expect(body).toContain('0 of 2 agents score 0 on L4');
    expect(body).toContain('Static identity is not enough.');
    expect(body).toContain('Audit your A2A endpoint');
    expect(body).toContain('agents-are-shrinking-trust-problem-isnt');
  });

  test('hero banner l4Zero counts only l4=0 entries', async () => {
    const rowSetWithZero: LeaderboardRowSet = {
      ...SAMPLE_ROWSET,
      total: 2,
      results: [
        { ...SAMPLE_ROWSET.results[0], layers: { l1: 95, l2: 90, l3: 88, l4: 0 } },
        { ...SAMPLE_ROWSET.results[1], layers: { l1: 30, l2: 10, l3: 5, l4: 0 } },
      ],
    };
    const { app, env } = makeApp(makeKv(rowSetWithZero), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    const body = await res.text();
    expect(body).toContain('2 of 2 agents score 0 on L4');
  });

  test('HTML-escapes XSS payload in agent name', async () => {
    const xssRowSet: LeaderboardRowSet = {
      ...SAMPLE_ROWSET,
      results: [{
        name: '<script>alert(1)</script>',
        url: 'https://xss.example.com',
        well_known: 'https://xss.example.com/.well-known/agent.json',
        grade: 'F', score: 0,
        layers: { l1: 0, l2: 0, l3: 0, l4: 0 },
        ts: '2026-05-13T04:00:00Z',
      }],
    };
    const { app, env } = makeApp(makeKv(xssRowSet), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    const body = await res.text();
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;');
  });
});

describe('GET /leaderboard/a2a.json', () => {
  test('returns 200 + JSON with shape {refreshed_at, total, results}', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a.json', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json() as LeaderboardRowSet;
    expect(body).toHaveProperty('refreshed_at');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('results');
  });

  test('returns 503 with {error:"unavailable"} when KV empty', async () => {
    const { app, env } = makeApp(makeKv(), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a.json', env);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unavailable');
  });

  test('JSON rows are sorted score DESC', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a.json', env);
    const body = await res.json() as LeaderboardRowSet;
    expect(body.results[0].score).toBeGreaterThanOrEqual(body.results[1].score);
  });
});

describe('POST /leaderboard/a2a/refresh', () => {
  test('returns 401 without Authorization header', async () => {
    const { app, env } = makeApp(makeKv(), SECRET);
    const res = await req(app, 'POST', '/leaderboard/a2a/refresh', env);
    expect(res.status).toBe(401);
  });

  test('returns 401 with wrong secret', async () => {
    const { app, env } = makeApp(makeKv(), SECRET);
    const res = await req(app, 'POST', '/leaderboard/a2a/refresh', env, { Authorization: 'Bearer wrong-secret' });
    expect(res.status).toBe(401);
  });

  test('returns 200 with {refreshed_at, count} on valid bearer, KV row updated', async () => {
    const kv = makeKv();
    const { app, env } = makeApp(kv, SECRET);

    const agentCard = {
      name: 'TestAgent', url: 'https://test.example.com',
      description: 'A test agent description', skills: [],
      defaultInputModes: ['text'], defaultOutputModes: ['text'],
    };

    globalThis.fetch = async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : (url as Request).url ?? url.toString();
      if (u.includes('a2aregistry.org')) {
        return new Response(JSON.stringify({
          agents: [{ name: 'TestAgent', url: 'https://test.example.com', wellKnownURI: 'https://test.example.com/.well-known/agent.json' }],
          total: 1,
        }), { status: 200 });
      }
      return new Response(JSON.stringify(agentCard), { status: 200 });
    };

    const res = await req(app, 'POST', '/leaderboard/a2a/refresh', env, { Authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    const body = await res.json() as { refreshed_at: string; count: number };
    expect(body).toHaveProperty('refreshed_at');
    expect(body.count).toBe(1);

    // KV must have been written
    const stored = await kv.get('v1:results');
    expect(stored).not.toBeNull();
  });

  test('Cache-Control is no-store on refresh response', async () => {
    const kv = makeKv();
    const { app, env } = makeApp(kv, SECRET);

    globalThis.fetch = async () => new Response(JSON.stringify({
      agents: [{ name: 'X', url: 'https://x.example.com', wellKnownURI: 'https://x.example.com/.well-known/agent.json' }],
      total: 1,
    }), { status: 200 });

    const res = await req(app, 'POST', '/leaderboard/a2a/refresh', env, { Authorization: `Bearer ${SECRET}` });
    // Just verify it doesn't cache — no-store or absent
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toContain('no-store');
  });
});
