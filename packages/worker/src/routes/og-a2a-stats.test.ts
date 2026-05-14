// ─── OG A2A Stats Route — Unit tests ─────────────────────────────────────────

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { ogA2aStatsRoutes, renderStatsOgSvg } from './og-a2a-stats.js';
import type { HonoEnv } from '../types.js';
import type { LeaderboardRowSet } from '../lib/a2a-leaderboard-job.js';
import { buildSlugIndex } from '../lib/a2a-leaderboard-slug.js';
import { computeLeaderboardStats } from '../lib/a2a-leaderboard-stats.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function makeApp(kv?: KVNamespace) {
  const app = new Hono<HonoEnv>();
  app.route('/og/a2a-stats.png', ogA2aStatsRoutes);
  return { app, env: { A2A_LEADERBOARD: kv } };
}

async function req(app: Hono<HonoEnv>, path: string, env: Record<string, unknown>) {
  return app.fetch(new Request(`https://test${path}`), env as HonoEnv['Bindings']);
}

// 51-row fixture matching live shape
const FIXTURE_51: LeaderboardRowSet = {
  refreshed_at: '2026-05-14T12:00:00.000Z',
  total: 51,
  registry_url: 'https://a2aregistry.org/api/agents',
  results: [
    ...Array.from({ length: 3 }, (_, i) => ({
      name: `AAgent${i}`, url: `https://aagent${i}.example.com`,
      well_known: `https://aagent${i}.example.com/.well-known/agent.json`,
      grade: 'A' as const, score: 90 + i, layers: { l1: 95, l2: 92, l3: 88, l4: 85 }, ts: '2026-05-14T00:00:00Z',
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `BAgent${i}`, url: `https://bagent${i}.example.com`,
      well_known: `https://bagent${i}.example.com/.well-known/agent.json`,
      grade: 'B' as const, score: 75 + i, layers: { l1: 80, l2: 78, l3: 72, l4: 70 }, ts: '2026-05-14T00:00:00Z',
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      name: `CAgent${i}`, url: `https://cagent${i}.example.com`,
      well_known: `https://cagent${i}.example.com/.well-known/agent.json`,
      grade: 'C' as const, score: 55 + i, layers: { l1: 65, l2: 58, l3: 52, l4: 48 }, ts: '2026-05-14T00:00:00Z',
    })),
    ...Array.from({ length: 12 }, (_, i) => ({
      name: `DAgent${i}`, url: `https://dagent${i}.example.com`,
      well_known: `https://dagent${i}.example.com/.well-known/agent.json`,
      grade: 'D' as const, score: 40 + i, layers: { l1: 55, l2: 42, l3: 35, l4: 30 }, ts: '2026-05-14T00:00:00Z',
    })),
    ...Array.from({ length: 18 }, (_, i) => ({
      name: `FAgent${i}`, url: `https://fagent${i}.example.com`,
      well_known: `https://fagent${i}.example.com/.well-known/agent.json`,
      grade: 'F' as const, score: 10 + i, layers: { l1: 25, l2: 15, l3: 8, l4: 5 }, ts: '2026-05-14T00:00:00Z',
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      name: `EAgent${i}`, url: `https://eagent${i}.example.com`,
      well_known: `https://eagent${i}.example.com/.well-known/agent.json`,
      grade: 'E' as const, score: 0, layers: { l1: 0, l2: 0, l3: 0, l4: 0 }, ts: '2026-05-14T00:00:00Z',
    })),
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /og/a2a-stats.png', () => {
  test('OG-STATS-1: 200 image/png when KV populated', async () => {
    const { app, env } = makeApp(makeKv(FIXTURE_51));
    const res = await req(app, '/og/a2a-stats.png', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(1000);
  });

  test('OG-STATS-2: 503 when KV empty', async () => {
    const { app, env } = makeApp(makeKv());
    const res = await req(app, '/og/a2a-stats.png', env);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('300');
  });
});

describe('renderStatsOgSvg', () => {
  test('OG-STATS-3: SVG headline contains pct and total', async () => {
    const slugIndex = await buildSlugIndex(FIXTURE_51.results);
    const stats = computeLeaderboardStats(FIXTURE_51, slugIndex);
    const svg = renderStatsOgSvg(stats);

    expect(svg).toContain(`${stats.layerFailRates.l4}%`);
    expect(svg).toContain(`${stats.total} A2A agents`);
  });

  test('OG-STATS-4: SVG escapes XML in grade pill labels (defence-in-depth)', async () => {
    // Inject a synthetically-crafted grade label with XML-special chars to verify
    // escapeXml is called on every grade pill. Grades are enums in practice but
    // the render helper must be defence-in-depth.
    const fakeStats = {
      total: 51,
      refreshedAt: '2026-05-14T12:00:00Z',
      gradeDistribution: [
        { grade: '<script>' as any, count: 1, pct: 2 },
        { grade: 'B', count: 5, pct: 10 },
        { grade: 'C', count: 10, pct: 20 },
        { grade: 'D', count: 12, pct: 24 },
        { grade: 'F', count: 20, pct: 39 },
        { grade: 'E', count: 3, pct: 6 },
      ],
      layerMeans: { l1: 50, l2: 45, l3: 40, l4: 35 },
      layerFailRates: { l1: 10, l2: 20, l3: 30, l4: 40 },
      topByScore: [],
      bottomByScore: [],
      bottomHidden: true,
    } as any;

    const svg = renderStatsOgSvg(fakeStats);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
