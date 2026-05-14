// ─── A2A Leaderboard Stats — Pure Aggregate Function ─────────────────────────
//
// No KV reads, no fetch, no Date.now(). All derived from rowSet + slugIndex.
// Called by GET /a2a/stats and GET /og/a2a-stats.png.

import type { LeaderboardRow, LeaderboardRowSet, LeaderboardGrade } from './a2a-leaderboard-job.js';

export interface GradeDistEntry {
  grade: LeaderboardGrade;   // 'A' | 'B' | 'C' | 'D' | 'F' | 'E'
  count: number;
  pct: number;               // integer 0–100, rounded
}

export interface TopBottomRow {
  name: string;
  slug: string;              // pre-computed via buildSlugIndex
  score: number;
  grade: LeaderboardGrade;
}

export interface LeaderboardStats {
  total: number;
  refreshedAt: string;
  // grade buckets always include A,B,C,D,F,E (even when count=0) so the
  // grade-distribution row renders the same shape every refresh.
  gradeDistribution: GradeDistEntry[];
  layerMeans: { l1: number; l2: number; l3: number; l4: number };  // 0-100 ints, rounded
  layerFailRates: { l1: number; l2: number; l3: number; l4: number }; // % of rows scoring 0 on each layer
  topByScore: TopBottomRow[];        // up to 5; empty if total=0
  bottomByScore: TopBottomRow[];     // up to 5 BUT hidden when score range is degenerate (see below)
  bottomHidden: boolean;             // true iff (max - min < 10) OR total < 10 — render hides bottom-5 in this case
}

const GRADE_ORDER: LeaderboardGrade[] = ['A', 'B', 'C', 'D', 'F', 'E'];

/**
 * Pure function. No KV reads, no fetch, no Date.now(). All values derived
 * from `rowSet`. Caller passes a pre-built slug index to avoid re-hashing.
 */
export function computeLeaderboardStats(
  rowSet: LeaderboardRowSet,
  slugIndex: Map<string, LeaderboardRow>,
): LeaderboardStats {
  const { total, results, refreshed_at } = rowSet;

  // Build reverse map: row → slug (for top/bottom lookup)
  const rowToSlug = new Map<LeaderboardRow, string>();
  for (const [slug, row] of slugIndex) {
    // First slug wins — preserves the same deterministic assignment as buildSlugIndex
    if (!rowToSlug.has(row)) {
      rowToSlug.set(row, slug);
    }
  }

  // 1. gradeDistribution — initialise {A:0, B:0, C:0, D:0, F:0, E:0}, count, then return as array
  const gradeCounts: Record<LeaderboardGrade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0, E: 0 };
  for (const row of results) {
    gradeCounts[row.grade] = (gradeCounts[row.grade] ?? 0) + 1;
  }
  const gradeDistribution: GradeDistEntry[] = GRADE_ORDER.map(grade => ({
    grade,
    count: gradeCounts[grade],
    pct: total > 0 ? Math.round(gradeCounts[grade] / total * 100) : 0,
  }));

  // 2. layerMeans — sum each layer, divide by total
  let sumL1 = 0, sumL2 = 0, sumL3 = 0, sumL4 = 0;
  for (const row of results) {
    sumL1 += row.layers.l1;
    sumL2 += row.layers.l2;
    sumL3 += row.layers.l3;
    sumL4 += row.layers.l4;
  }
  const layerMeans = total > 0
    ? {
        l1: Math.round(sumL1 / total),
        l2: Math.round(sumL2 / total),
        l3: Math.round(sumL3 / total),
        l4: Math.round(sumL4 / total),
      }
    : { l1: 0, l2: 0, l3: 0, l4: 0 };

  // 3. layerFailRates — % of rows with layer value === 0
  const failL1 = results.filter(r => r.layers.l1 === 0).length;
  const failL2 = results.filter(r => r.layers.l2 === 0).length;
  const failL3 = results.filter(r => r.layers.l3 === 0).length;
  const failL4 = results.filter(r => r.layers.l4 === 0).length;
  const layerFailRates = total > 0
    ? {
        l1: Math.round(failL1 / total * 100),
        l2: Math.round(failL2 / total * 100),
        l3: Math.round(failL3 / total * 100),
        l4: Math.round(failL4 / total * 100),
      }
    : { l1: 0, l2: 0, l3: 0, l4: 0 };

  // 4. topByScore — sort DESC by score, take 5
  const sortedDesc = [...results].sort((a, b) => b.score - a.score);
  const topByScore: TopBottomRow[] = [];
  for (const row of sortedDesc) {
    if (topByScore.length >= 5) break;
    const slug = rowToSlug.get(row);
    if (slug === undefined) continue; // orphaned row — skip
    topByScore.push({ name: row.name, slug, score: row.score, grade: row.grade });
  }

  // 5. bottomByScore — sort ASC by score, take 5, check degenerate range
  const scores = results.map(r => r.score);
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const bottomHidden = (maxScore - minScore < 10) || total < 10;

  let bottomByScore: TopBottomRow[] = [];
  if (!bottomHidden) {
    const sortedAsc = [...results].sort((a, b) => a.score - b.score);
    for (const row of sortedAsc) {
      if (bottomByScore.length >= 5) break;
      const slug = rowToSlug.get(row);
      if (slug === undefined) continue; // orphaned row — skip
      bottomByScore.push({ name: row.name, slug, score: row.score, grade: row.grade });
    }
  }

  return {
    total,
    refreshedAt: refreshed_at,
    gradeDistribution,
    layerMeans,
    layerFailRates,
    topByScore,
    bottomByScore,
    bottomHidden,
  };
}
