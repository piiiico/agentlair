// ─── A2A Leaderboard Slug Helper ─────────────────────────────────────────────
//
// Computes URL-safe slugs from leaderboard rows for per-agent permalinks.
// Slug algorithm: pick source URL (well_known || url) → hostname → lowercase →
// strip www. → . to - → strip non-[a-z0-9-] → truncate-with-hash at 40 chars.
// Collision suffix: deterministic by url sort, hash6 = sha256(source)[0:6].

import { sha256hex } from '../utils.js';
import type { LeaderboardRow } from './a2a-leaderboard-job.js';

/** Compute a single URL-safe slug from a row's source URL. */
export async function computeSlug(row: { name: string; url: string; well_known?: string }): Promise<string> {
  const source = row.well_known || row.url;
  const u = new URL(source);
  let host = u.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  host = host.replace(/\./g, '-');
  host = host.replace(/[^a-z0-9-]/g, '');

  if (host.length <= 40) return host;

  // Truncated: keep first 33 chars + '-' + first 6 hex chars of sha256(source) = 40 total
  const hash = await sha256hex(source);
  const hash6 = hash.slice(0, 6);
  return host.slice(0, 33) + '-' + hash6;
}

/**
 * Build a slug → row map. Deterministic: rows sorted by url before processing.
 * Collision suffix: second (and later) rows with the same base slug get
 * `-<hash6>` appended, where hash6 = first 6 hex chars of sha256(source URL).
 */
export async function buildSlugIndex(rows: LeaderboardRow[]): Promise<Map<string, LeaderboardRow>> {
  const sorted = [...rows].sort((a, b) => a.url.localeCompare(b.url));
  const map = new Map<string, LeaderboardRow>();

  for (const row of sorted) {
    const base = await computeSlug(row);
    if (!map.has(base)) {
      map.set(base, row);
    } else {
      // Collision — append hash6 of this row's source URL
      const source = row.well_known || row.url;
      const hash = await sha256hex(source);
      const hash6 = hash.slice(0, 6);
      map.set(base + '-' + hash6, row);
    }
  }
  return map;
}

/**
 * Case-insensitive slug lookup. Returns the matching row or null.
 */
export async function lookupRow(slug: string, rows: LeaderboardRow[]): Promise<LeaderboardRow | null> {
  const lower = slug.toLowerCase();
  const index = await buildSlugIndex(rows);
  return index.get(lower) ?? null;
}
