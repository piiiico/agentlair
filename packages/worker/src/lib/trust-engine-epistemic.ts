// lib/trust-engine-epistemic.ts — Phase 2.5 Component 6: Epistemic Integrity scorer
// Pure leaf module. No D1, no KV, no HTTP routes, no Date.now(), no crypto, no Math.random().
// Spec: memory/knowledge/agentlair-trust-scoring-algorithm.md §1.2 Dimension 6 (lines ~280–525).

import type { AuditEvent } from '../trust-engine.js';
import type {
  AttestationWorkflow,
  ReviewBandwidth,
  VerificationTier,
} from './operator-profile.js';
import { VERIFICATION_TIERS } from './operator-profile.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Verification tier → weight multiplier for verification coverage.
 * Distinct from `TIER_WEIGHT_MULTIPLIER` in trust-engine.ts (AccountTier-keyed).
 * Spec: agentlair-trust-scoring-algorithm.md lines 421-428.
 */
export const VERIFICATION_TIER_WEIGHT: Record<VerificationTier, number> = {
  formal_verification:   1.00,
  automated_tooling:     0.85,
  independent_review:    0.75,
  operator_review:       0.55,
  agent_self_report:     0.20,
  agent_self_annotation: 0.05,
} as const;

/** Cold-start prior for Epistemic Integrity (spec §1.2 line 501). */
export const EPISTEMIC_PRIOR = 0.40;

/** Minimum feedback rows before claim-confirmation-rate is computed (line 502). */
export const MIN_FEEDBACK_FOR_RATE = 10;

/** Minimum (feedback + confidence_stated) rows before calibration is computed (line 503). */
export const MIN_FEEDBACK_FOR_CALIBRATION = 20;

/** Default unfalsifiability ratio threshold (line 418). */
export const DEFAULT_MAX_TOLERABLE_REVIEW_MULTIPLIER = 3.0;

/** Flag literals surfaced on the return shape (spec §2.1 line 629). */
export type EpistemicFlag =
  | 'unfalsifiable_at_scale'
  | 'verification_coverage_low'
  | 'anti_calibration_detected';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * In-memory feedback shape. `outcomeCorrect: null` = inconclusive (counted as a row
 * but neither confirms nor refutes). Callers map D1 rows → this shape.
 */
export interface ClaimFeedback {
  agentId: string;
  claimId: string;
  outcomeCorrect: boolean | null;
  confidenceStated?: number;
  evidenceType?: string;
  submittedAt: string;
}

/** Scorer return shape (parallel to existing dimension scorers in trust-engine.ts). */
export interface EpistemicIntegrityResult {
  score: number;
  signals: {
    verification_coverage: number;
    confirmation_rate: number;
    calibration: number;
    reviewability: number;
    reviewability_ratio: number;
    output_session_count: number;
    verification_session_count: number;
    feedback_count: number;
    tier_multiplier: number;
  };
  /** Empty when no anomaly detected. Sorted alphabetically for determinism. */
  flags: EpistemicFlag[];
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Weighted mean — self-contained; does not import the one in trust-engine.ts. */
function weightedMean(pairs: [number, number][]): number {
  let sum = 0;
  let w = 0;
  for (const [v, weight] of pairs) { sum += v * weight; w += weight; }
  return w === 0 ? 0 : sum / w;
}

/** session_id validation (spec line 167). */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Standard Pearson r (population std dev, divide by N).
 * - Length mismatch → throws.
 * - n < 2 or zero variance (< 1e-12) → 0.
 * - Result clamped to [-1, 1].
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length) throw new Error('pearsonCorrelation: input arrays must be the same length');
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let vx = 0, vy = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    vx += dx * dx; vy += dy * dy; cov += dx * dy;
  }
  vx /= n; vy /= n; cov /= n;
  if (vx < 1e-12 || vy < 1e-12) return 0;
  return Math.max(-1, Math.min(1, cov / (Math.sqrt(vx) * Math.sqrt(vy))));
}

/**
 * @internal
 * Groups `action_stream`/`output_volume` events into session buckets.
 * Events without a valid session_id go into one shared null bucket.
 * Silently skips malformed or invalid events.
 * Return order: sessionId ASC (null last), within-session by timestamp ASC.
 *
 * Known limitation: mixed output_volume unit types are summed numerically.
 */
export function extractOutputSessions(
  events: AuditEvent[],
): Array<{ sessionId: string | null; events: AuditEvent[]; totalOutputVolume: number }> {
  const buckets = new Map<string | null, AuditEvent[]>();
  for (const e of events) {
    if (e.category !== 'action_stream' || !e.details) continue;
    let p: Record<string, unknown>;
    try { p = JSON.parse(e.details) as Record<string, unknown>; } catch { continue; }
    if (p.subcategory !== 'output_volume') continue;
    const vol = p.output_volume;
    if (typeof vol !== 'number' || !Number.isInteger(vol) || vol < 0) continue;
    const rawSid = p.session_id;
    const sid: string | null =
      typeof rawSid === 'string' && SESSION_ID_RE.test(rawSid) ? rawSid : null;
    let bucket = buckets.get(sid);
    if (!bucket) { bucket = []; buckets.set(sid, bucket); }
    bucket.push(e);
  }
  for (const b of buckets.values()) b.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });
  return keys.map(key => {
    const evts = buckets.get(key)!;
    const totalOutputVolume = evts.reduce((sum, e) => {
      const p = JSON.parse(e.details!) as Record<string, unknown>;
      return sum + (p.output_volume as number);
    }, 0);
    return { sessionId: key, events: evts, totalOutputVolume };
  });
}

/**
 * Extracts verification events from the audit log.
 * Accepted: `category === 'verification'`, valid tier, integer exit_code.
 * Returns events sorted by timestamp ASC.
 */
export function extractVerificationEvents(
  events: AuditEvent[],
): Array<{ tool: string; tier: VerificationTier; exitCode: number; sessionId?: string; timestamp: string }> {
  const result: Array<{ tool: string; tier: VerificationTier; exitCode: number; sessionId?: string; timestamp: string }> = [];
  for (const e of events) {
    if (e.category !== 'verification' || !e.details) continue;
    let p: Record<string, unknown>;
    try { p = JSON.parse(e.details) as Record<string, unknown>; } catch { continue; }
    if (typeof p.tool !== 'string') continue;
    if (typeof p.tier !== 'string' || !(VERIFICATION_TIERS as readonly string[]).includes(p.tier)) continue;
    if (typeof p.exit_code !== 'number' || !Number.isInteger(p.exit_code)) continue;
    const entry: { tool: string; tier: VerificationTier; exitCode: number; sessionId?: string; timestamp: string } = {
      tool: p.tool, tier: p.tier as VerificationTier, exitCode: p.exit_code, timestamp: e.timestamp,
    };
    if (typeof p.session_id === 'string') entry.sessionId = p.session_id;
    result.push(entry);
  }
  result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return result;
}

/**
 * Coverage = (verified sessions / total sessions) × tierMult, clamped [0, 1].
 * A session is verified if a declared-tool verification event matches:
 * - by sessionId string equality (non-null), or
 * - by ±30 min time window (both null sessionId).
 * Cold-start (zero output sessions): returns workflow.priorCoverage.
 */
export function computeVerificationCoverage(
  events: AuditEvent[],
  workflow: AttestationWorkflow,
): { coverage: number; outputSessionCount: number; verifiedSessionCount: number } {
  const outputSessions = extractOutputSessions(events);
  if (outputSessions.length === 0) {
    return { coverage: workflow.priorCoverage, outputSessionCount: 0, verifiedSessionCount: 0 };
  }
  const tierMult = VERIFICATION_TIER_WEIGHT[workflow.declaredTier];
  const declared = new Set(workflow.declaredTools);
  if (declared.size === 0) {
    return { coverage: 0, outputSessionCount: outputSessions.length, verifiedSessionCount: 0 };
  }
  const declaredVerifs = extractVerificationEvents(events).filter(v => declared.has(v.tool));
  const THIRTY_MIN_MS = 30 * 60 * 1000;
  let verifiedSessionCount = 0;
  for (const session of outputSessions) {
    let verified: boolean;
    if (session.sessionId !== null) {
      verified = declaredVerifs.some(v => v.sessionId === session.sessionId);
    } else {
      const ots = session.events.map(e => new Date(e.timestamp).getTime());
      verified = declaredVerifs.some(v => {
        if (v.sessionId !== undefined) return false;
        const vt = new Date(v.timestamp).getTime();
        return ots.some(ot => Math.abs(vt - ot) <= THIRTY_MIN_MS);
      });
    }
    if (verified) verifiedSessionCount++;
  }
  const coverage = Math.min(1, Math.max(0, (verifiedSessionCount / outputSessions.length) * tierMult));
  return { coverage, outputSessionCount: outputSessions.length, verifiedSessionCount };
}

/**
 * ratio = totalOutputVolume / max(1, reviewersCount × unitsPerHour × timeToNextApprovalHours).
 * Known limitation (V1): mixed unit types summed numerically; mismatch penalty deferred to C10.
 */
export function computeReviewabilityRatio(
  events: AuditEvent[],
  bandwidth: ReviewBandwidth,
): { ratio: number; totalOutputVolume: number } {
  const sessions = extractOutputSessions(events);
  const totalOutputVolume = sessions.reduce((s, x) => s + x.totalOutputVolume, 0);
  const ratio = totalOutputVolume / Math.max(1, bandwidth.reviewersCount * bandwidth.unitsPerHour * bandwidth.timeToNextApprovalHours);
  return { ratio, totalOutputVolume };
}

/**
 * True if ratio > maxTolerableReviewMultiplier (default 3.0). Strict > per spec line 418.
 */
export function isUnfalsifiableAtScale(
  events: AuditEvent[],
  bandwidth: ReviewBandwidth,
  maxTolerableReviewMultiplier?: number,
): boolean {
  const threshold = maxTolerableReviewMultiplier ?? DEFAULT_MAX_TOLERABLE_REVIEW_MULTIPLIER;
  return computeReviewabilityRatio(events, bandwidth).ratio > threshold;
}

/**
 * True when epistemic evidence is sufficient (spec §2.2 lines 717-727):
 * (workflow defined AND ≥10 verification events) OR ≥10 non-null feedback rows.
 */
export function hasEpistemicEvidence(
  events: AuditEvent[],
  feedback: ClaimFeedback[],
  workflow?: AttestationWorkflow,
): boolean {
  const ve = extractVerificationEvents(events).length;
  const vf = feedback.filter(f => f.outcomeCorrect !== null).length;
  return (workflow !== undefined && ve >= 10) || vf >= 10;
}

/**
 * Cold-start estimate when data is insufficient.
 * Returns null when feedbackCount ≥ MIN_FEEDBACK_FOR_RATE OR verificationEventCount ≥ 30.
 */
export function epistemicColdStart(
  feedbackCount: number,
  verificationEventCount: number,
  workflow: AttestationWorkflow,
): { score: number; confidence: number } | null {
  if (feedbackCount < MIN_FEEDBACK_FOR_RATE && verificationEventCount < 30) {
    return { score: EPISTEMIC_PRIOR * VERIFICATION_TIER_WEIGHT[workflow.declaredTier], confidence: 0.10 };
  }
  return null;
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

/**
 * Computes the Epistemic Integrity dimension score for an agent.
 * Pure function: no I/O, no Date.now(), no crypto.*, no Math.random(), no D1, no KV.
 * Spec: agentlair-trust-scoring-algorithm.md §1.2 Dimension 6 lines 318-379.
 */
export function computeEpistemicIntegrity(
  events: AuditEvent[],
  workflow: AttestationWorkflow,
  bandwidth: ReviewBandwidth,
  feedback: ClaimFeedback[],
): EpistemicIntegrityResult {
  // Step 1: Verification coverage
  const coverage = computeVerificationCoverage(events, workflow);

  // Step 2: Confirmation rate (neutral 0.5 when < MIN_FEEDBACK_FOR_RATE; spec line 340)
  const confirmed = feedback.filter(f => f.outcomeCorrect !== null);
  const confirmationScore =
    confirmed.length >= MIN_FEEDBACK_FOR_RATE
      ? confirmed.filter(f => f.outcomeCorrect === true).length / confirmed.length
      : 0.5;

  // Step 3: Calibration (neutral 0.5 when < MIN_FEEDBACK_FOR_CALIBRATION; spec line 351)
  const calibrated = feedback.filter(f => f.confidenceStated !== undefined && f.outcomeCorrect !== null);
  let calibrationScore = 0.5;
  let rawPearson = 0;
  if (calibrated.length >= MIN_FEEDBACK_FOR_CALIBRATION) {
    rawPearson = pearsonCorrelation(
      calibrated.map(f => f.confidenceStated!),
      calibrated.map(f => (f.outcomeCorrect === true ? 1 : 0)),
    );
    calibrationScore = Math.max(0, rawPearson);
  }

  // Step 4: Reviewability (spec lines 354-360, strict <)
  const { ratio } = computeReviewabilityRatio(events, bandwidth);
  const reviewabilityScore = ratio < 0.5 ? 1.0 : ratio < 1.0 ? 0.7 : ratio < 3.0 ? 0.3 : 0.0;

  // Step 5: Flags (sorted alphabetically for determinism)
  const flags: EpistemicFlag[] = [];
  if (isUnfalsifiableAtScale(events, bandwidth)) flags.push('unfalsifiable_at_scale');
  if (coverage.coverage < 0.20) flags.push('verification_coverage_low');
  if (calibrated.length >= MIN_FEEDBACK_FOR_CALIBRATION && rawPearson < 0) flags.push('anti_calibration_detected');
  flags.sort();

  // Step 6: Score (hard cap 0.2 when unfalsifiable; spec lines 370-378)
  const score = flags.includes('unfalsifiable_at_scale')
    ? Math.min(0.2, weightedMean([
        [coverage.coverage, 0.40], [confirmationScore, 0.30],
        [calibrationScore, 0.20],  [reviewabilityScore, 0.10],
      ]))
    : weightedMean([
        [coverage.coverage, 0.35], [confirmationScore, 0.30],
        [calibrationScore, 0.15],  [reviewabilityScore, 0.20],
      ]);

  return {
    score,
    signals: {
      verification_coverage:    coverage.coverage,
      confirmation_rate:        confirmationScore,
      calibration:              calibrationScore,
      reviewability:            reviewabilityScore,
      reviewability_ratio:      ratio,
      output_session_count:     coverage.outputSessionCount,
      verification_session_count: coverage.verifiedSessionCount,
      feedback_count:           feedback.length,
      tier_multiplier:          VERIFICATION_TIER_WEIGHT[workflow.declaredTier],
    },
    flags,
  };
}
