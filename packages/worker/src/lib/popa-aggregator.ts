/**
 * PoPA Aggregator — pure metric computation over attestation rows.
 *
 * Aggregation is read-only and stateless. The caller (route handler) fetches
 * rows from D1 ordered by `sequence DESC` (most recent first) and hands them
 * here. Used by the GET /v1/popa/:did endpoint and any future verifier.
 *
 * Streak semantics (v1):
 *   - A "segment" is a contiguous run of attestations with no intervening gap
 *     (i.e. consecutive UTC days). The row that resumes after a gap has
 *     `gap_hours > 0` — it's the chronologically-earliest row of the post-gap
 *     segment. In DESC walk it's the boundary between segments.
 *   - `streak_days` counts rows from the most recent (index 0) backward,
 *     INCLUDING the row that closes the segment chronologically (the row
 *     with `gap_hours > 0`). The walk stops after that row.
 *   - `longest_streak` is the maximum segment length across all segments.
 *   - `gap_count` is the number of rows with `gap_detected === 1`.
 *
 * The `> 48h` distinction in popa-spec-v1.md is reserved for future
 * grace-period semantics; v1 treats any non-zero gap as a segment boundary.
 */

export interface AttestationRow {
  sequence: number;
  gap_detected: number;
  gap_hours: number;
  window_start: string;
  window_end: string;
  entry_id: string;
  created_at: string;
}

export interface PoPAMetrics {
  did: string;
  streak_days: number;
  longest_streak: number;
  total_attestations: number;
  last_attestation_at: string;
  gap_count: number;
  genesis_at: string;
  latest_scitt_entry: string;
}

/**
 * Compute PoPA metrics from attestation rows ordered by `sequence DESC`.
 *
 * Precondition: `rowsDesc` is non-empty. Caller (route handler) returns 404
 * when the DB query yields zero rows; this function THROWS instead of
 * returning zeroed metrics so the empty-vs-genesis case can never be
 * silently confused.
 */
export function computeMetrics(did: string, rowsDesc: AttestationRow[]): PoPAMetrics {
  if (!rowsDesc || rowsDesc.length === 0) {
    throw new Error('computeMetrics: rowsDesc must be non-empty (caller handles 404)');
  }

  const total_attestations = rowsDesc.length;
  const last_attestation_at = rowsDesc[0].window_end;
  const latest_scitt_entry = 'scitt:' + rowsDesc[0].entry_id;
  const genesis_at = rowsDesc[rowsDesc.length - 1].window_start;

  let gap_count = 0;
  for (const r of rowsDesc) {
    if (r.gap_detected === 1) gap_count++;
  }

  // Current streak: walk DESC from index 0, always counting the current row.
  // Stop AFTER counting a row with gap_hours > 0 — that row is the
  // chronologically-earliest member of the most-recent segment.
  let streak_days = 0;
  for (const r of rowsDesc) {
    streak_days++;
    if (r.gap_hours > 0) break;
  }

  // Longest streak: walk all rows DESC. A row with gap_hours > 0 closes the
  // current segment (it IS the segment's chronologically-earliest row); the
  // next row starts a fresh segment. The genesis row (oldest) has gap_hours
  // = 0, so it's part of the oldest segment and the loop exits with that
  // segment still open.
  let longest_streak = 0;
  let current_segment = 0;
  for (const r of rowsDesc) {
    current_segment++;
    if (r.gap_hours > 0) {
      if (current_segment > longest_streak) longest_streak = current_segment;
      current_segment = 0;
    }
  }
  if (current_segment > longest_streak) longest_streak = current_segment;

  return {
    did,
    streak_days,
    longest_streak,
    total_attestations,
    last_attestation_at,
    gap_count,
    genesis_at,
    latest_scitt_entry,
  };
}
