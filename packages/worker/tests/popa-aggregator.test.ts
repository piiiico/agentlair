/**
 * PoPA Aggregator — unit tests for `computeMetrics`.
 *
 * Streak math edge cases. Pure function — no D1, no fetch, no env.
 *
 * Run: bun test tests/popa-aggregator.test.ts
 */

import { describe, test, expect } from 'bun:test';
import {
  computeMetrics,
  type AttestationRow,
} from '../src/lib/popa-aggregator';

const DID = 'did:web:agentlair.dev';

/**
 * Build a synthetic row.
 *  - `sequence` is required for ORDER BY semantics (tests pass DESC).
 *  - Most tests don't care about the exact ISO timestamps, but the
 *    aggregator does read window_start / window_end / entry_id.
 */
function row(opts: {
  sequence: number;
  gap_hours?: number;
  window_start?: string;
  window_end?: string;
  entry_id?: string;
}): AttestationRow {
  const seq = opts.sequence;
  const gap_hours = opts.gap_hours ?? 0;
  return {
    sequence: seq,
    gap_detected: gap_hours > 0 ? 1 : 0,
    gap_hours,
    window_start: opts.window_start ?? `2026-04-${String(seq).padStart(2, '0')}T00:00:00.000Z`,
    window_end: opts.window_end ?? `2026-04-${String(seq + 1).padStart(2, '0')}T00:00:00.000Z`,
    entry_id: opts.entry_id ?? `entry_${seq}`,
    created_at: '2026-04-30T00:00:00.000Z',
  };
}

describe('computeMetrics', () => {
  test('1: genesis only → streak=1, longest=1, gap_count=0', () => {
    const rows: AttestationRow[] = [row({ sequence: 1 })];
    const m = computeMetrics(DID, rows);
    expect(m.did).toBe(DID);
    expect(m.streak_days).toBe(1);
    expect(m.longest_streak).toBe(1);
    expect(m.gap_count).toBe(0);
    expect(m.total_attestations).toBe(1);
    expect(m.last_attestation_at).toBe(rows[0].window_end);
    expect(m.genesis_at).toBe(rows[0].window_start);
    expect(m.latest_scitt_entry).toBe('scitt:entry_1');
  });

  test('2: 5 consecutive days no gaps → streak=5, longest=5, gap_count=0', () => {
    // DESC: seq=5 (most recent) ... seq=1 (genesis)
    const rows: AttestationRow[] = [5, 4, 3, 2, 1].map((s) => row({ sequence: s }));
    const m = computeMetrics(DID, rows);
    expect(m.streak_days).toBe(5);
    expect(m.longest_streak).toBe(5);
    expect(m.gap_count).toBe(0);
    expect(m.total_attestations).toBe(5);
  });

  test('3: 5 days then a single ≤48h gap, then 3 more days → streak=3, longest=5, gap_count=1', () => {
    // Chronological: days 1-5 (no gaps), then a single 48h gap, then days 8,9,10.
    // DESC order: [10, 9, 8, 5, 4, 3, 2, 1]; gap_hours[8] = 48.
    const rows: AttestationRow[] = [
      row({ sequence: 10 }),                       // most recent
      row({ sequence: 9 }),
      row({ sequence: 8, gap_hours: 48 }),         // gap row (resumed after missed days)
      row({ sequence: 5 }),
      row({ sequence: 4 }),
      row({ sequence: 3 }),
      row({ sequence: 2 }),
      row({ sequence: 1 }),                        // genesis
    ];
    const m = computeMetrics(DID, rows);
    expect(m.streak_days).toBe(3);
    expect(m.longest_streak).toBe(5);
    expect(m.gap_count).toBe(1);
    expect(m.total_attestations).toBe(8);
  });

  test('4: 10 days then >48h gap then 2 days → streak=2, longest=10, gap_count=1', () => {
    // Chronological: days 1-10, then 72h gap (3 missed days), then days 14,15.
    // DESC: [15, 14, 10, 9, 8, ..., 1]; gap_hours[14] = 72.
    const rows: AttestationRow[] = [
      row({ sequence: 15 }),
      row({ sequence: 14, gap_hours: 72 }),        // post-gap row
      row({ sequence: 10 }),
      row({ sequence: 9 }),
      row({ sequence: 8 }),
      row({ sequence: 7 }),
      row({ sequence: 6 }),
      row({ sequence: 5 }),
      row({ sequence: 4 }),
      row({ sequence: 3 }),
      row({ sequence: 2 }),
      row({ sequence: 1 }),
    ];
    const m = computeMetrics(DID, rows);
    expect(m.streak_days).toBe(2);
    expect(m.longest_streak).toBe(10);
    expect(m.gap_count).toBe(1);
    expect(m.total_attestations).toBe(12);
  });

  test('5: multiple gaps → correct longest_streak across all segments', () => {
    // Chronologically: [day1..day3] (3-day genesis segment), gap, [day5,day6]
    // (2-day segment), gap, [day10..day16] (7-day segment).
    // DESC: [16, 15, 14, 13, 12, 11, 10, 6, 5, 3, 2, 1]
    // gap_hours: [0, 0, 0, 0, 0, 0, 96, 0, 48, 0, 0, 0]
    //                                ^         ^
    //                                |         post-gap row of 2-day segment
    //                                post-gap row of 7-day segment
    // Segments chronologically: 3, 2, 7. Longest = 7.
    // Current streak (DESC walk from index 0): 16,15,14,13,12,11,10 = 7 (stops at the gap row).
    const rows: AttestationRow[] = [
      row({ sequence: 16 }),
      row({ sequence: 15 }),
      row({ sequence: 14 }),
      row({ sequence: 13 }),
      row({ sequence: 12 }),
      row({ sequence: 11 }),
      row({ sequence: 10, gap_hours: 96 }),
      row({ sequence: 6 }),
      row({ sequence: 5, gap_hours: 48 }),
      row({ sequence: 3 }),
      row({ sequence: 2 }),
      row({ sequence: 1 }),
    ];
    const m = computeMetrics(DID, rows);
    expect(m.gap_count).toBe(2);
    expect(m.longest_streak).toBe(7);
    expect(m.streak_days).toBe(7);
    expect(m.total_attestations).toBe(12);
  });

  test('6: empty array → throws', () => {
    expect(() => computeMetrics(DID, [])).toThrow();
  });
});
