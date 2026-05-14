// ─── A2A Leaderboard Slug Helper — Unit Tests ─────────────────────────────────

import { describe, test, expect } from 'bun:test';
import { computeSlug, buildSlugIndex, lookupRow } from './a2a-leaderboard-slug.js';
import type { LeaderboardRow } from './a2a-leaderboard-job.js';

function makeRow(overrides: Partial<LeaderboardRow> & { url: string }): LeaderboardRow {
  return {
    name: 'Test',
    url: overrides.url,
    well_known: overrides.well_known ?? overrides.url,
    grade: 'A',
    score: 80,
    layers: { l1: 80, l2: 80, l3: 80, l4: 80 },
    ts: '2026-05-14T00:00:00Z',
    ...overrides,
  };
}

describe('computeSlug', () => {
  test('SLUG-1 simple domain from well_known', async () => {
    const row = makeRow({ url: 'https://buywhere.ai', well_known: 'https://buywhere.ai/.well-known/agent.json' });
    const slug = await computeSlug(row);
    expect(slug).toBe('buywhere-ai');
  });

  test('SLUG-2 no well_known, fallback to url', async () => {
    const row = makeRow({ url: 'https://example.com/agent', well_known: undefined });
    const slug = await computeSlug(row);
    expect(slug).toBe('example-com');
  });

  test('SLUG-3 strips www. prefix', async () => {
    const row = makeRow({ url: 'https://www.foo.com', well_known: 'https://www.foo.com/.well-known/agent.json' });
    const slug = await computeSlug(row);
    expect(slug).toBe('foo-com');
  });

  test('SLUG-4 very-long hostname truncated to 40 chars with hash suffix', async () => {
    // 50-char hostname: a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t (after processing → very long)
    const longHost = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefgh.example.com';
    const row = makeRow({ url: `https://${longHost}`, well_known: `https://${longHost}/.well-known/agent.json` });
    const slug = await computeSlug(row);
    expect(slug.length).toBe(40);
    // Must end with -<6 hex chars>
    expect(slug).toMatch(/-[0-9a-f]{6}$/);
  });

  test('SLUG-5 buildSlugIndex over 3 rows where 2 share hostname → 3 distinct keys, deterministic', async () => {
    const rowA = makeRow({ name: 'SharedA', url: 'https://shared.example.com/a', well_known: 'https://shared.example.com/a/.well-known/agent.json' });
    const rowB = makeRow({ name: 'SharedB', url: 'https://shared.example.com/b', well_known: 'https://shared.example.com/b/.well-known/agent.json' });
    const rowC = makeRow({ name: 'Other',   url: 'https://other.example.com',    well_known: 'https://other.example.com/.well-known/agent.json' });

    const index = await buildSlugIndex([rowA, rowB, rowC]);
    expect(index.size).toBe(3);

    // All keys must be distinct
    const keys = [...index.keys()];
    const unique = new Set(keys);
    expect(unique.size).toBe(3);

    // Determinism: same call twice must produce same keys
    const index2 = await buildSlugIndex([rowC, rowB, rowA]); // different input order
    const keys2 = [...index2.keys()].sort();
    expect(keys.sort()).toEqual(keys2);
  });

  test('SLUG-6 lookupRow is case-insensitive', async () => {
    const row = makeRow({ url: 'https://alpha.example.com', well_known: 'https://alpha.example.com/.well-known/agent.json' });
    const result = await lookupRow('ALPHA-EXAMPLE-COM', [row]);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Test');
  });

  test('SLUG-7 computeSlug is idempotent', async () => {
    const row = makeRow({ url: 'https://openai.com', well_known: 'https://openai.com/.well-known/agent.json' });
    const slug1 = await computeSlug(row);
    const slug2 = await computeSlug(row);
    expect(slug1).toBe(slug2);
  });

  test('SLUG-8 punycode IDN produces stable a-z0-9- only', async () => {
    const row = makeRow({ url: 'https://xn--bcher-kva.example', well_known: 'https://xn--bcher-kva.example/.well-known/agent.json' });
    const slug = await computeSlug(row);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.length).toBeGreaterThan(0);
  });
});
