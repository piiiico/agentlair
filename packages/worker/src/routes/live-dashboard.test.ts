/**
 * Live Dashboard Endpoints — Tests
 *
 * Verifies the public read-only aggregation endpoints that power the live
 * trust dashboard at agentlair.dev/live:
 *   GET /v1/scitt/corpus?order=desc — newest-first cursor pagination
 *   GET /v1/trust/distribution      — score histogram
 *   GET /v1/stats/agents            — total + 24h/7d deltas
 *
 * All three are unauthenticated; the dashboard must render even when D1/KV
 * is degraded, so failure paths must return an empty-but-valid shape
 * (never 5xx).
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { publicScittRoutes } from './scitt.js';
import { publicTrustRoutes } from './trust.js';
import { publicStatsRoutes } from './stats.js';
import type { HonoEnv } from '../types.js';

// ─── D1 mock ──────────────────────────────────────────────────────────────────

interface ScittRow {
  entry_id: string;
  leaf_index: number;
  tree_size: number;
  root_hash: string;
  created_at: string;
  account_id: string;
  category: string;
  action: string;
  signature: string;
}

interface TrustProfileRow {
  agent_id: string;
  score: number;
}

function makeScittD1(rows: ScittRow[]): D1Database {
  let lastSql = '';
  let bindings: unknown[] = [];
  const makeStmt = (sql: string) => {
    lastSql = sql;
    const stmt = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        return null as T | null;
      },
      async all<T>(): Promise<D1Result<T>> {
        const q = lastSql.toLowerCase();
        // scitt_receipts JOIN audit_log → corpus query
        if (q.includes('scitt_receipts') && q.includes('join audit_log')) {
          const after = bindings[0] as number;
          const limit = bindings[1] as number;
          const isDesc = q.includes('order by r.leaf_index desc');
          let result = isDesc
            ? rows.filter((r) => r.leaf_index < after).sort((a, b) => b.leaf_index - a.leaf_index)
            : rows.filter((r) => r.leaf_index > after).sort((a, b) => a.leaf_index - b.leaf_index);
          result = result.slice(0, limit);
          return { results: result as T[], success: true, meta: {} as D1ResultInfo };
        }
        return { results: [] as T[], success: true, meta: {} as D1ResultInfo };
      },
      async run() {
        return { results: [], success: true, meta: {} as D1ResultInfo };
      },
    };
    return stmt;
  };
  return {
    prepare: makeStmt,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

function makeTrustD1(rows: TrustProfileRow[], throwError?: string): D1Database {
  let lastSql = '';
  const makeStmt = (sql: string) => {
    lastSql = sql;
    const stmt = {
      bind() {
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (throwError) throw new Error(throwError);
        const q = lastSql.toLowerCase();
        if (q.includes('count(*)') && q.includes('avg(score)')) {
          const n = rows.length;
          const avg_score = n > 0 ? rows.reduce((s, r) => s + r.score, 0) / n : null;
          return { n, avg_score } as unknown as T;
        }
        return null as T | null;
      },
      async all<T>(): Promise<D1Result<T>> {
        if (throwError) throw new Error(throwError);
        const q = lastSql.toLowerCase();
        if (q.includes('group by bucket')) {
          const buckets = new Map<string, number>();
          for (const r of rows) {
            const range =
              r.score < 20 ? '0-19'
              : r.score < 40 ? '20-39'
              : r.score < 60 ? '40-59'
              : r.score < 80 ? '60-79'
              : '80-100';
            buckets.set(range, (buckets.get(range) ?? 0) + 1);
          }
          const results = Array.from(buckets.entries()).map(([bucket, count]) => ({ bucket, count }));
          return { results: results as T[], success: true, meta: {} as D1ResultInfo };
        }
        return { results: [] as T[], success: true, meta: {} as D1ResultInfo };
      },
      async run() {
        return { results: [], success: true, meta: {} as D1ResultInfo };
      },
    };
    return stmt;
  };
  return {
    prepare: makeStmt,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

// ─── KV mock for stats/agents ─────────────────────────────────────────────────

/**
 * Lightweight KV mock for the counter-based stats endpoint.
 * The counters object is mutated in place so put-back persistence is testable.
 * list() returns keys matching the prefix — supports the lazy-init fallback path.
 */
function makeStatsCounterKV(counters: Record<string, string | undefined>): KVNamespace {
  return {
    async get(key: string): Promise<string | null> {
      return counters[key] ?? null;
    },
    async put(key: string, value: string): Promise<void> {
      counters[key] = value;
    },
    async list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = opts?.prefix ?? '';
      const limit = opts?.limit ?? 1000;
      const matched = Object.keys(counters)
        .filter((k) => k.startsWith(prefix))
        .slice(0, limit)
        .map((k) => ({ name: k }));
      return {
        keys: matched,
        list_complete: matched.length < limit,
        cacheStatus: null,
      };
    },
    async delete() {},
    async getWithMetadata() {
      return { value: null, metadata: null };
    },
  } as unknown as KVNamespace;
}

// ─── App builders ─────────────────────────────────────────────────────────────

function makeApp(env: Record<string, unknown>) {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('account', null);
    await next();
  });
  app.route('/v1/scitt', publicScittRoutes);
  app.route('/v1/trust', publicTrustRoutes);
  app.route('/v1/stats', publicStatsRoutes);
  return { app, env };
}

// ─── Tests: GET /v1/scitt/corpus order param ─────────────────────────────────

describe('GET /v1/scitt/corpus order param', () => {
  const sampleRows: ScittRow[] = [1, 2, 3, 4, 5].map((i) => ({
    entry_id: `entry-${i}`,
    leaf_index: i,
    tree_size: 5,
    root_hash: 'r' + i,
    created_at: new Date(2026, 0, i).toISOString(),
    account_id: `acc_${i}`,
    category: 'test',
    action: 'noop',
    signature: 'sig',
  }));

  test('default order is asc, returns earliest first', async () => {
    const { app, env } = makeApp({ AUDIT: makeScittD1(sampleRows) });
    const res = await app.fetch(new Request('http://x/v1/scitt/corpus?limit=3'), env as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { leaf_index: number }[]; order: string };
    expect(body.order).toBe('asc');
    expect(body.items.map((i) => i.leaf_index)).toEqual([1, 2, 3]);
  });

  test('order=desc returns newest first', async () => {
    const { app, env } = makeApp({ AUDIT: makeScittD1(sampleRows) });
    const res = await app.fetch(
      new Request('http://x/v1/scitt/corpus?order=desc&limit=3'),
      env as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { leaf_index: number }[]; order: string };
    expect(body.order).toBe('desc');
    expect(body.items.map((i) => i.leaf_index)).toEqual([5, 4, 3]);
  });

  test('order=desc with after cursor returns older entries', async () => {
    const { app, env } = makeApp({ AUDIT: makeScittD1(sampleRows) });
    const res = await app.fetch(
      new Request('http://x/v1/scitt/corpus?order=desc&limit=2&after=4'),
      env as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { leaf_index: number }[] };
    expect(body.items.map((i) => i.leaf_index)).toEqual([3, 2]);
  });

  test('invalid order rejected with 400', async () => {
    const { app, env } = makeApp({ AUDIT: makeScittD1(sampleRows) });
    const res = await app.fetch(
      new Request('http://x/v1/scitt/corpus?order=descx'),
      env as never,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_order');
  });
});

// ─── Tests: GET /v1/trust/distribution ───────────────────────────────────────

describe('GET /v1/trust/distribution', () => {
  test('returns histogram with all 5 buckets and avg_score', async () => {
    const rows: TrustProfileRow[] = [
      { agent_id: 'a', score: 10 },  // 0-19
      { agent_id: 'b', score: 25 },  // 20-39
      { agent_id: 'c', score: 50 },  // 40-59
      { agent_id: 'd', score: 75 },  // 60-79
      { agent_id: 'e', score: 95 },  // 80-100
      { agent_id: 'f', score: 80 },  // 80-100
    ];
    const { app, env } = makeApp({ AUDIT: makeTrustD1(rows) });
    const res = await app.fetch(
      new Request('http://x/v1/trust/distribution'),
      env as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      buckets: { range: string; count: number }[];
      total_agents_scored: number;
      avg_score: number | null;
    };
    expect(body.buckets).toHaveLength(5);
    expect(body.buckets.map((b) => b.range)).toEqual(['0-19', '20-39', '40-59', '60-79', '80-100']);
    expect(body.buckets.find((b) => b.range === '80-100')?.count).toBe(2);
    expect(body.buckets.find((b) => b.range === '40-59')?.count).toBe(1);
    expect(body.total_agents_scored).toBe(6);
    // avg = (10+25+50+75+95+80) / 6 = 55.83 → rounded 56
    expect(body.avg_score).toBe(56);
  });

  test('empty trust_profiles returns all-zero buckets', async () => {
    const { app, env } = makeApp({ AUDIT: makeTrustD1([]) });
    const res = await app.fetch(
      new Request('http://x/v1/trust/distribution'),
      env as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      buckets: { range: string; count: number }[];
      total_agents_scored: number;
      avg_score: number | null;
    };
    expect(body.buckets.every((b) => b.count === 0)).toBe(true);
    expect(body.total_agents_scored).toBe(0);
    expect(body.avg_score).toBeNull();
  });

  test('missing AUDIT binding degrades gracefully (not 503)', async () => {
    const { app, env } = makeApp({});
    const res = await app.fetch(
      new Request('http://x/v1/trust/distribution'),
      env as never,
    );
    // Critical: dashboard must render even when D1 binding is missing
    expect(res.status).toBe(200);
    const body = (await res.json()) as { buckets: { count: number }[]; avg_score: number | null };
    expect(body.buckets.every((b) => b.count === 0)).toBe(true);
    expect(body.avg_score).toBeNull();
  });

  test('table missing returns empty (no 503)', async () => {
    const { app, env } = makeApp({
      AUDIT: makeTrustD1([], 'no such table: trust_profiles'),
    });
    const res = await app.fetch(
      new Request('http://x/v1/trust/distribution'),
      env as never,
    );
    expect(res.status).toBe(200);
  });
});

// ─── Tests: GET /v1/stats/agents ─────────────────────────────────────────────

describe('GET /v1/stats/agents', () => {
  test('reads counters and returns total + 24h/7d deltas', async () => {
    const now = new Date();
    const hourKey2h = 'stats:hourly:' + new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString().slice(0, 13);
    const dayKeyNow = 'stats:daily:' + now.toISOString().slice(0, 10);
    const dayKey3d  = 'stats:daily:' + new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const counters: Record<string, string | undefined> = {
      'stats:total': '4',
      [hourKey2h]: '1',   // within last 24h → last_24h += 1
      [dayKeyNow]: '1',   // within last 7d  → last_7d  += 1
      [dayKey3d]:  '1',   // within last 7d  → last_7d  += 1
    };

    const { app, env } = makeApp({ KEYS: makeStatsCounterKV(counters) });
    const res = await app.fetch(new Request('http://x/v1/stats/agents'), env as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; last_24h: number; last_7d: number };
    expect(body.total).toBe(4);
    expect(body.last_24h).toBe(1);
    expect(body.last_7d).toBe(2);
  });

  test('zero counters and zero accounts returns zeros', async () => {
    // No stats:total → fallback runs, list returns 0 account: keys → total=0
    const counters: Record<string, string | undefined> = {};
    const { app, env } = makeApp({ KEYS: makeStatsCounterKV(counters) });
    const res = await app.fetch(new Request('http://x/v1/stats/agents'), env as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; last_24h: number; last_7d: number };
    expect(body.total).toBe(0);
    expect(body.last_24h).toBe(0);
    expect(body.last_7d).toBe(0);
  });

  test('missing stats:total falls back to paginated list count and persists', async () => {
    // No stats:total, but 4 account: keys seeded
    const counters: Record<string, string | undefined> = {
      'account:acc1': 'h1',
      'account:acc2': 'h2',
      'account:acc3': 'h3',
      'account:acc4': 'h4',
    };
    const { app, env } = makeApp({ KEYS: makeStatsCounterKV(counters) });
    const res = await app.fetch(new Request('http://x/v1/stats/agents'), env as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(4);
    // Verify the lazy-init put-back persisted the total
    expect(counters['stats:total']).toBe('4');
  });

  test('missing KEYS binding degrades to error stat (not 5xx)', async () => {
    // Pass an env without KEYS — endpoint should catch the access error
    const { app, env } = makeApp({});
    const res = await app.fetch(new Request('http://x/v1/stats/agents'), env as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; error?: string };
    expect(body.total).toBe(0);
    expect(body.error).toBe('stats_unavailable');
  });
});
