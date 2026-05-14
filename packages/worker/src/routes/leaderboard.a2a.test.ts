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

/** Stateful KV mock backed by a Map — needed for rate-limit counter persistence across calls */
function makeStatefulKv(): KVNamespace & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    _store: store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    getWithMetadata: async (key: string) => ({ value: store.get(key) ?? null, metadata: null }),
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
  } as unknown as KVNamespace & { _store: Map<string, string> };
  return kv;
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

function makeApp(kv?: KVNamespace, secret?: string, keysKv?: KVNamespace) {
  const app = new Hono<HonoEnv>();
  app.route('/leaderboard', leaderboardA2ARoutes);
  return { app, env: { A2A_LEADERBOARD: kv, LEADERBOARD_REFRESH_SECRET: secret, KEYS: keysKv } };
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

describe('GET /leaderboard/a2a — embed badge', () => {
  test('LB-EMBED-1: rendered HTML contains <th>Embed</th>', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    const body = await res.text();
    expect(body).toContain('<th>Embed</th>');
  });

  test('LB-EMBED-2: embed cell contains base64url-encoded badge img src for a known URL', async () => {
    const cardUrl = 'https://example.com/.well-known/agent-card.json';
    const encoded = btoa(cardUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const rowSet: LeaderboardRowSet = {
      ...SAMPLE_ROWSET,
      total: 1,
      results: [{ name: 'Example', url: cardUrl, well_known: cardUrl, grade: 'A', score: 80, layers: { l1: 80, l2: 80, l3: 80, l4: 0 }, ts: '2026-05-14T00:00:00Z' }],
    };
    const { app, env } = makeApp(makeKv(rowSet), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    const body = await res.text();
    expect(body).toContain(`https://agentlair.dev/badge/a2a/${encoded}.svg`);
  });

  test('LB-EMBED-3: rendered HTML contains <details><summary>Embed</summary> for at least one row', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    const body = await res.text();
    expect(body).toContain('<details><summary>Embed</summary>');
  });

  test('LB-EMBED-4: hero-embed-hint paragraph is present', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    const body = await res.text();
    expect(body).toContain('hero-embed-hint');
    expect(body).toContain('Each row has an Embed snippet');
  });

  test('LB-EMBED-5: r.name with HTML-special chars is escaped inside the embed snippet', async () => {
    const rowSet: LeaderboardRowSet = {
      ...SAMPLE_ROWSET,
      total: 1,
      results: [{ name: 'Foo & <Bar>', url: 'https://foo.example.com', well_known: 'https://foo.example.com/.well-known/agent.json', grade: 'B', score: 70, layers: { l1: 70, l2: 70, l3: 70, l4: 0 }, ts: '2026-05-14T00:00:00Z' }],
    };
    const { app, env } = makeApp(makeKv(rowSet), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a', env);
    const body = await res.text();
    expect(body).toContain('Foo &amp; &lt;Bar&gt;');
    expect(body).not.toContain('Foo & <Bar>');
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

// ─── Submit tests ─────────────────────────────────────────────────────────────
//
// Note: checkIpRateLimit uses env.KEYS (not env.RATE_LIMIT) — spec comment about
// "RATE_LIMIT KV namespace" refers to the conceptual namespace, but the actual
// implementation reads/writes env.KEYS. Tests pass KEYS for stateful rate-limit mocking.

const SAMPLE_CARD = {
  name: 'TestAgent',
  url: 'https://test.example.com',
  description: 'A test agent',
  skills: [],
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
};

function mockFetchWithCard(card = SAMPLE_CARD) {
  globalThis.fetch = async () => new Response(JSON.stringify(card), { status: 200 });
}

describe('GET /leaderboard/a2a/submit', () => {
  test('LB-SUBMIT-1: returns 200 HTML with form pointing to correct action', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/submit', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<form');
    expect(body).toContain('action="/leaderboard/a2a/submit"');
    expect(body).toContain('method="POST"');
  });
});

describe('POST /leaderboard/a2a/submit', () => {
  test('LB-SUBMIT-2: valid URL persists row and redirects to leaderboard', async () => {
    mockFetchWithCard();
    const kv = makeKv();
    const { app, env } = makeApp(kv, SECRET, makeStatefulKv());
    const res = await req(app, 'POST', '/leaderboard/a2a/submit', env,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      'url=https%3A%2F%2Ftest.example.com%2F.well-known%2Fagent.json',
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/leaderboard/a2a#submitted');

    const stored = await kv.get('v1:results');
    expect(stored).not.toBeNull();
    const rowset = JSON.parse(stored!) as { results: Array<{ url?: string; well_known?: string }> };
    const found = rowset.results.find(r =>
      r.url?.includes('test.example.com') || r.well_known?.includes('test.example.com'),
    );
    expect(found).toBeTruthy();
  });

  test('LB-SUBMIT-3: invalid URL returns 400 with invalid_url', async () => {
    const { app, env } = makeApp(makeKv(), SECRET, makeStatefulKv());
    const res = await req(app, 'POST', '/leaderboard/a2a/submit', env,
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      JSON.stringify({ url: 'not-a-url' }),
    );
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('invalid_url');
  });

  test('LB-SUBMIT-4: unreachable URL returns 422 with unreachable', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const { app, env } = makeApp(makeKv(), SECRET, makeStatefulKv());
    const res = await req(app, 'POST', '/leaderboard/a2a/submit', env,
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      JSON.stringify({ url: 'https://unreachable.example.com' }),
    );
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain('unreachable');
  });

  test('LB-SUBMIT-5: rate-limit kicks in on 6th request from same IP', async () => {
    mockFetchWithCard();
    const kv = makeKv();
    const keysKv = makeStatefulKv();
    const { app, env } = makeApp(kv, SECRET, keysKv);

    // 5 successful POSTs from same IP
    for (let i = 0; i < 5; i++) {
      const res = await req(app, 'POST', '/leaderboard/a2a/submit', env,
        { 'Content-Type': 'application/json', 'Accept': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        JSON.stringify({ url: 'https://test.example.com/.well-known/agent.json' }),
      );
      expect(res.status).toBe(200);
    }

    // 6th should be rate-limited
    const res = await req(app, 'POST', '/leaderboard/a2a/submit', env,
      { 'Content-Type': 'application/json', 'Accept': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
      JSON.stringify({ url: 'https://test.example.com/.well-known/agent.json' }),
    );
    expect(res.status).toBe(429);
  });

  test('LB-SUBMIT-6: duplicate URL re-submission updates in place (no duplicate rows)', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      // Return slightly different ts each time to verify update
      return new Response(JSON.stringify({ ...SAMPLE_CARD, version: `v${callCount}` }), { status: 200 });
    };

    const kv = makeKv();
    const keysKv = makeStatefulKv();
    const { app, env } = makeApp(kv, SECRET, keysKv);
    const targetUrl = 'https://test.example.com/.well-known/agent.json';

    // First submission
    const res1 = await req(app, 'POST', '/leaderboard/a2a/submit', env,
      { 'Content-Type': 'application/json', 'Accept': 'application/json', 'CF-Connecting-IP': '1.1.1.1' },
      JSON.stringify({ url: targetUrl }),
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as { submitted_at: string };
    const ts1 = body1.submitted_at;

    // Wait a tick so timestamps differ
    await new Promise(r => setTimeout(r, 5));

    // Second submission of same URL
    const res2 = await req(app, 'POST', '/leaderboard/a2a/submit', env,
      { 'Content-Type': 'application/json', 'Accept': 'application/json', 'CF-Connecting-IP': '1.1.1.2' },
      JSON.stringify({ url: targetUrl }),
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as { submitted_at: string };
    const ts2 = body2.submitted_at;

    const stored = JSON.parse((await kv.get('v1:results'))!) as { results: Array<{ url: string; ts: string }> };
    const matches = stored.results.filter(r =>
      r.url?.includes('test.example.com') || r.url === targetUrl,
    );
    expect(matches.length).toBe(1);
    // Second ts should be >= first
    expect(new Date(ts2).getTime()).toBeGreaterThanOrEqual(new Date(ts1).getTime());
  });

  test('LB-SUBMIT-7: JSON Accept returns JSON with grade + score + layers + submitted_at', async () => {
    mockFetchWithCard();
    const { app, env } = makeApp(makeKv(), SECRET, makeStatefulKv());
    const res = await req(app, 'POST', '/leaderboard/a2a/submit', env,
      { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      JSON.stringify({ url: 'https://test.example.com/.well-known/agent.json' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('url');
    expect(body).toHaveProperty('grade');
    expect(body).toHaveProperty('score');
    expect(body).toHaveProperty('layers');
    expect(body).toHaveProperty('submitted_at');
  });
});

// ─── Permalink tests ──────────────────────────────────────────────────────────

describe('GET /leaderboard/a2a/:slug — permalinks', () => {
  // SAMPLE_ROWSET has Alpha (well_known: https://alpha.example.com/.well-known/agent.json → slug: alpha-example-com)
  // and Beta (well_known: https://beta.example.com/.well-known/agent.json → slug: beta-example-com)

  test('PERMALINK-1: known slug returns 200 HTML with agent data and OG tags', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/alpha-example-com', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Alpha');
    expect(body).toContain('A');          // grade pill
    expect(body).toContain('92/100');     // score
    expect(body).toContain('<meta property="og:title"');
    expect(body).toContain('<meta property="og:image"');
  });

  test('PERMALINK-2: unknown slug returns 404 HTML with Submit CTA', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/nonexistent-xyz-zzz', env);
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('/leaderboard/a2a/submit');
  });

  test('PERMALINK-3: collision — base slug and suffixed slug each resolve to distinct rows', async () => {
    const rowA: LeaderboardRowSet['results'][0] = {
      name: 'SharedA', url: 'https://shared.example.com/a',
      well_known: 'https://shared.example.com/a/.well-known/agent.json',
      grade: 'A', score: 80, layers: { l1: 80, l2: 80, l3: 80, l4: 80 }, ts: '2026-05-14T00:00:00Z',
    };
    const rowB: LeaderboardRowSet['results'][0] = {
      name: 'SharedB', url: 'https://shared.example.com/b',
      well_known: 'https://shared.example.com/b/.well-known/agent.json',
      grade: 'B', score: 60, layers: { l1: 60, l2: 60, l3: 60, l4: 60 }, ts: '2026-05-14T00:00:00Z',
    };
    const collisionRowset: LeaderboardRowSet = {
      refreshed_at: '2026-05-14T04:00:00.000Z', total: 2,
      registry_url: 'https://a2aregistry.org/api/agents', results: [rowA, rowB],
    };

    const { app, env } = makeApp(makeKv(collisionRowset), SECRET);

    // Base slug → rowA (first by url sort)
    const resBase = await req(app, 'GET', '/leaderboard/a2a/shared-example-com', env);
    expect(resBase.status).toBe(200);
    const bodyBase = await resBase.text();
    expect(bodyBase).toContain('SharedA');

    // Suffixed slug → rowB (hash6 of rowB's well_known: 4ecdbc)
    const resSuffixed = await req(app, 'GET', '/leaderboard/a2a/shared-example-com-4ecdbc', env);
    expect(resSuffixed.status).toBe(200);
    const bodySuffixed = await resSuffixed.text();
    expect(bodySuffixed).toContain('SharedB');
  });

  test('PERMALINK-4: case-insensitive slug lookup', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/ALPHA-EXAMPLE-COM', env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Alpha');
    expect(body).toContain('92/100');
  });

  test('PERMALINK-5: canonical link is exact match', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/alpha-example-com', env);
    const body = await res.text();
    expect(body).toContain('<link rel="canonical" href="https://agentlair.dev/leaderboard/a2a/alpha-example-com">');
  });

  test('PERMALINK-6: re-audit CTA contains encoded source URL', async () => {
    const { app, env } = makeApp(makeKv(SAMPLE_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/alpha-example-com', env);
    const body = await res.text();
    // Source URL for Alpha is well_known: https://alpha.example.com/.well-known/agent.json
    const expectedEncoded = encodeURIComponent('https://alpha.example.com/.well-known/agent.json');
    expect(body).toContain(expectedEncoded);
  });

  test('PERMALINK-7: KV empty returns 503 with Retry-After', async () => {
    const { app, env } = makeApp(makeKv(), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/whatever', env);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('300');
  });
});

// ─── Stats page tests ─────────────────────────────────────────────────────────

const STATS_ROWSET: LeaderboardRowSet = {
  refreshed_at: '2026-05-14T12:00:00.000Z',
  total: 3,
  registry_url: 'https://a2aregistry.org/api/agents',
  results: [
    { name: 'Alpha', url: 'https://alpha.example.com', well_known: 'https://alpha.example.com/.well-known/agent.json', grade: 'A', score: 90, layers: { l1: 95, l2: 90, l3: 85, l4: 90 }, ts: '2026-05-14T00:00:00Z' },
    { name: 'Beta',  url: 'https://beta.example.com',  well_known: 'https://beta.example.com/.well-known/agent.json',  grade: 'C', score: 55, layers: { l1: 60, l2: 55, l3: 50, l4: 55 }, ts: '2026-05-14T00:00:00Z' },
    { name: 'Gamma', url: 'https://gamma.example.com', well_known: 'https://gamma.example.com/.well-known/agent.json', grade: 'F', score: 10, layers: { l1: 20, l2: 10, l3: 5, l4: 0 }, ts: '2026-05-14T00:00:00Z' },
  ],
};

describe('GET /leaderboard/a2a/stats', () => {
  test('STATS-1: populated KV → 200, text/html, og:image points at /og/a2a-stats.png, all six grade letters present', async () => {
    const { app, env } = makeApp(makeKv(STATS_ROWSET), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/stats', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('/og/a2a-stats.png');
    // All six grade letters as content tokens in grade-pill spans
    for (const g of ['A', 'B', 'C', 'D', 'F', 'E']) {
      expect(body).toContain(`>${g}:`);
    }
  });

  test('STATS-2: no KV key → 503 with Retry-After: 300', async () => {
    const { app, env } = makeApp(makeKv(), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/stats', env);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('300');
  });

  test('STATS-3: all-l4-zero KV → headline contains "100%" and "Layer 4"', async () => {
    const allL4Zero: LeaderboardRowSet = {
      refreshed_at: '2026-05-14T12:00:00.000Z',
      total: 12,
      registry_url: 'https://a2aregistry.org/api/agents',
      results: Array.from({ length: 12 }, (_, i) => ({
        name: `Agent${i}`,
        url: `https://agent${i}.example.com`,
        well_known: `https://agent${i}.example.com/.well-known/agent.json`,
        grade: 'F' as const,
        score: 10 + i * 5,
        layers: { l1: 30, l2: 20, l3: 10, l4: 0 },
        ts: '2026-05-14T00:00:00Z',
      })),
    };
    const { app, env } = makeApp(makeKv(allL4Zero), SECRET);
    const res = await req(app, 'GET', '/leaderboard/a2a/stats', env);
    const body = await res.text();
    expect(body).toContain('100%');
    expect(body).toContain('Layer 4');
  });
});
