// ─── a2a-leaderboard-stats — unit tests ─────────────────────────────────────

import { describe, test, expect } from 'bun:test';
import { computeLeaderboardStats } from './a2a-leaderboard-stats.js';
import type { LeaderboardRow, LeaderboardRowSet } from './a2a-leaderboard-job.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<LeaderboardRow> & { url: string }): LeaderboardRow {
  return {
    name: overrides.url,
    well_known: overrides.url + '/.well-known/agent.json',
    grade: 'F',
    score: 50,
    layers: { l1: 50, l2: 50, l3: 50, l4: 50 },
    ts: '2026-05-14T00:00:00Z',
    ...overrides,
  };
}

function makeRowSet(results: LeaderboardRow[], extra?: Partial<LeaderboardRowSet>): LeaderboardRowSet {
  return {
    refreshed_at: '2026-05-14T12:00:00Z',
    total: results.length,
    registry_url: 'https://a2aregistry.org/api/agents',
    results,
    ...extra,
  };
}

/** Build a simple slug index: url-hostname → row (no collision handling) */
function simpleSlugIndex(rows: LeaderboardRow[]): Map<string, LeaderboardRow> {
  const m = new Map<string, LeaderboardRow>();
  for (const row of rows) {
    try {
      const host = new URL(row.url).hostname.replace(/\./g, '-');
      if (!m.has(host)) m.set(host, row);
    } catch {
      // skip
    }
  }
  return m;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeLeaderboardStats', () => {
  test('empty rowSet → zeros + bottomHidden', () => {
    const rowSet = makeRowSet([]);
    const slugIndex = new Map<string, LeaderboardRow>();
    const stats = computeLeaderboardStats(rowSet, slugIndex);

    expect(stats.total).toBe(0);
    expect(stats.topByScore).toEqual([]);
    expect(stats.bottomByScore).toEqual([]);
    expect(stats.bottomHidden).toBe(true);
    expect(stats.layerMeans).toEqual({ l1: 0, l2: 0, l3: 0, l4: 0 });
    expect(stats.layerFailRates).toEqual({ l1: 0, l2: 0, l3: 0, l4: 0 });
    for (const entry of stats.gradeDistribution) {
      expect(entry.count).toBe(0);
      expect(entry.pct).toBe(0);
    }
  });

  test('single row → 100% one grade, bottomHidden (total < 10)', () => {
    const row = makeRow({ url: 'https://single.example.com', grade: 'F', score: 48 });
    const rowSet = makeRowSet([row]);
    const slugIndex = simpleSlugIndex([row]);
    const stats = computeLeaderboardStats(rowSet, slugIndex);

    const fEntry = stats.gradeDistribution.find(e => e.grade === 'F')!;
    expect(fEntry.pct).toBe(100);
    for (const entry of stats.gradeDistribution.filter(e => e.grade !== 'F')) {
      expect(entry.pct).toBe(0);
    }
    expect(stats.bottomHidden).toBe(true); // total < 10
  });

  test('uniform 10×grade-F, same score → bottomHidden (range = 0)', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ url: `https://agent${i}.example.com`, grade: 'F', score: 20 })
    );
    const rowSet = makeRowSet(rows, { total: 10 });
    const slugIndex = simpleSlugIndex(rows);
    const stats = computeLeaderboardStats(rowSet, slugIndex);

    expect(stats.bottomHidden).toBe(true); // range = 0 < 10
    const fEntry = stats.gradeDistribution.find(e => e.grade === 'F')!;
    expect(fEntry.count).toBe(10);
    for (const top of stats.topByScore) {
      expect(top.grade).toBe('F');
    }
  });

  test('typical 51 rows mixed grades — pct sums ≈100, bottomHidden=false, top/bottom length=5', () => {
    const gradeMap: Array<[string, string, number, { l1: number; l2: number; l3: number; l4: number }]> = [
      // grade, base-url, score, layers
      ...Array.from({ length: 3 }, (_, i) => [`https://a${i}.dev`, 'A', 85 + i, { l1: 90, l2: 90, l3: 85, l4: 80 }] as [string, string, number, { l1: number; l2: number; l3: number; l4: number }]),
      ...Array.from({ length: 5 }, (_, i) => [`https://b${i}.dev`, 'B', 70 + i, { l1: 80, l2: 75, l3: 70, l4: 65 }] as [string, string, number, { l1: number; l2: number; l3: number; l4: number }]),
      ...Array.from({ length: 10 }, (_, i) => [`https://c${i}.dev`, 'C', 55 + i, { l1: 70, l2: 60, l3: 50, l4: 45 }] as [string, string, number, { l1: number; l2: number; l3: number; l4: number }]),
      ...Array.from({ length: 12 }, (_, i) => [`https://d${i}.dev`, 'D', 40 + i, { l1: 60, l2: 45, l3: 35, l4: 30 }] as [string, string, number, { l1: number; l2: number; l3: number; l4: number }]),
      ...Array.from({ length: 18 }, (_, i) => [`https://f${i}.dev`, 'F', 15 + i, { l1: 30, l2: 20, l3: 10, l4: 5 }] as [string, string, number, { l1: number; l2: number; l3: number; l4: number }]),
      ...Array.from({ length: 3 }, (_, i) => [`https://e${i}.dev`, 'E', 0, { l1: 0, l2: 0, l3: 0, l4: 0 }] as [string, string, number, { l1: number; l2: number; l3: number; l4: number }]),
    ];
    const rows = gradeMap.map(([url, grade, score, layers]) =>
      makeRow({ url: url as string, grade: grade as LeaderboardRow['grade'], score: score as number, layers: layers as { l1: number; l2: number; l3: number; l4: number } })
    );
    const rowSet = makeRowSet(rows, { total: 51 });
    const slugIndex = simpleSlugIndex(rows);
    const stats = computeLeaderboardStats(rowSet, slugIndex);

    const pctSum = stats.gradeDistribution.reduce((s, e) => s + e.pct, 0);
    expect(Math.abs(pctSum - 100)).toBeLessThanOrEqual(2); // ±2 due to rounding
    expect(stats.layerMeans.l1).toBeGreaterThan(0);
    expect(stats.bottomHidden).toBe(false);
    expect(stats.topByScore.length).toBe(5);
    expect(stats.bottomByScore.length).toBe(5);
  });

  test('all rows L4=0 → fail rate 100', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ url: `https://agent${i}.example.com`, grade: 'F', score: 20 + i, layers: { l1: 50, l2: 50, l3: 50, l4: 0 } })
    );
    const rowSet = makeRowSet(rows, { total: 10 });
    const slugIndex = simpleSlugIndex(rows);
    const stats = computeLeaderboardStats(rowSet, slugIndex);

    expect(stats.layerFailRates.l4).toBe(100);
    expect(stats.layerFailRates.l1).toBe(0);
  });

  test('slug missing for one row → skip, remainder fills slots', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRow({ url: `https://agent${i}.example.com`, score: 90 - i * 5 })
    );
    const rowSet = makeRowSet(rows, { total: 7 });
    // omit rows[0] from slug index → it should be skipped
    const slugIndex = simpleSlugIndex(rows.slice(1));
    const stats = computeLeaderboardStats(rowSet, slugIndex);

    // rows[0] has highest score but no slug — should be skipped
    // top should have at most 5, none pointing at the missing row
    for (const top of stats.topByScore) {
      expect(top.slug).not.toBe(''); // all have slugs
    }
    // None of the top entries should be the orphaned one (agent0 has url agent0.example.com → slug agent0-example-com)
    const agent0Slug = 'agent0-example-com';
    expect(stats.topByScore.some(t => t.slug === agent0Slug)).toBe(false);
  });

  test('score range exactly 9 → bottomHidden=true', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      makeRow({ url: `https://agent${i}.example.com`, score: 70 + Math.min(i, 9) })
    );
    // min=70 max=79 → range=9 < 10
    const rowSet = makeRowSet(rows, { total: 12 });
    const slugIndex = simpleSlugIndex(rows);
    const stats = computeLeaderboardStats(rowSet, slugIndex);

    expect(stats.bottomHidden).toBe(true);
  });

  test('score range 10 with 10+ rows → bottomHidden=false, bottom has 5 entries', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ url: `https://agent${i}.example.com`, score: 70 + i }) // min=70 max=79+1=79... wait
    );
    // 10 rows: scores 70..79, range = 9. That's bottomHidden.
    // Need range >= 10: scores 70..80 with 11 rows, or 70 and 80 with 10 rows
    const rows2 = [
      makeRow({ url: 'https://low.example.com', score: 70 }),
      ...Array.from({ length: 8 }, (_, i) => makeRow({ url: `https://mid${i}.example.com`, score: 75 })),
      makeRow({ url: 'https://high.example.com', score: 80 }),
    ];
    const rowSet = makeRowSet(rows2, { total: 10 });
    const slugIndex = simpleSlugIndex(rows2);
    const stats = computeLeaderboardStats(rowSet, slugIndex);

    expect(stats.bottomHidden).toBe(false);
    expect(stats.bottomByScore.length).toBe(5);
  });

  test('grade buckets always present — length is exactly 6', () => {
    const row = makeRow({ url: 'https://only-a.example.com', grade: 'A', score: 99 });
    const rowSet = makeRowSet([row]);
    const slugIndex = simpleSlugIndex([row]);
    const stats = computeLeaderboardStats(rowSet, slugIndex);

    expect(stats.gradeDistribution.length).toBe(6);
    const grades = stats.gradeDistribution.map(e => e.grade);
    expect(grades).toContain('A');
    expect(grades).toContain('B');
    expect(grades).toContain('C');
    expect(grades).toContain('D');
    expect(grades).toContain('F');
    expect(grades).toContain('E');
  });
});
