// lib/trust-engine-epistemic.test.ts — Unit tests for Phase 2.5 Component 6
// All fixtures are pure in-memory. No D1, no Workers env, no mocks.
// Spec: agentlair-trust-scoring-algorithm.md §1.2 Dimension 6.

import { describe, it, expect } from 'bun:test';
import type { AuditEvent } from '../trust-engine.js';
import type { AttestationWorkflow, ReviewBandwidth } from './operator-profile.js';
import {
  pearsonCorrelation,
  extractOutputSessions,
  extractVerificationEvents,
  computeVerificationCoverage,
  computeReviewabilityRatio,
  isUnfalsifiableAtScale,
  hasEpistemicEvidence,
  epistemicColdStart,
  computeEpistemicIntegrity,
  VERIFICATION_TIER_WEIGHT,
  EPISTEMIC_PRIOR,
  MIN_FEEDBACK_FOR_RATE,
  MIN_FEEDBACK_FOR_CALIBRATION,
  DEFAULT_MAX_TOLERABLE_REVIEW_MULTIPLIER,
  type ClaimFeedback,
} from './trust-engine-epistemic.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let _eventCounter = 0;

function makeEvent(overrides: Partial<AuditEvent> & { category: string }): AuditEvent {
  _eventCounter++;
  return {
    id: `evt-test-${String(_eventCounter).padStart(3, '0')}`,
    timestamp: '2026-05-15T10:00:00.000Z',
    account_id: 'acc-test',
    actor_id: 'agent-test',
    category: overrides.category,
    action: 'test',
    result: 'success',
    prev_hash: 'abc',
    signature: 'sig',
    details: null,
    ...overrides,
  };
}

function makeOutputEvent(opts: {
  sessionId?: string | null;
  outputVolume: number;
  timestamp?: string;
  actorId?: string;
}): AuditEvent {
  const details: Record<string, unknown> = {
    subcategory: 'output_volume',
    output_volume: opts.outputVolume,
    unit_type: 'lines',
  };
  if (opts.sessionId !== null && opts.sessionId !== undefined) {
    details.session_id = opts.sessionId;
  }
  return makeEvent({
    category: 'action_stream',
    timestamp: opts.timestamp ?? '2026-05-15T10:00:00.000Z',
    actor_id: opts.actorId ?? 'agent-test',
    details: JSON.stringify(details),
  });
}

function makeVerifEvent(opts: {
  tool: string;
  tier: string;
  sessionId?: string;
  timestamp?: string;
  exitCode?: number;
}): AuditEvent {
  const details: Record<string, unknown> = {
    tool: opts.tool,
    tier: opts.tier,
    exit_code: opts.exitCode ?? 0,
  };
  if (opts.sessionId !== undefined) {
    details.session_id = opts.sessionId;
  }
  return makeEvent({
    category: 'verification',
    timestamp: opts.timestamp ?? '2026-05-15T10:05:00.000Z',
    details: JSON.stringify(details),
  });
}

function makeFeedback(opts: {
  outcomeCorrect: boolean | null;
  confidenceStated?: number;
  claimId?: string;
}): ClaimFeedback {
  return {
    agentId: 'agent-test',
    claimId: opts.claimId ?? `claim-${Math.random().toString(36).slice(2)}`,
    outcomeCorrect: opts.outcomeCorrect,
    confidenceStated: opts.confidenceStated,
    submittedAt: '2026-05-15T10:00:00.000Z',
  };
}

const FORMAL_WORKFLOW: AttestationWorkflow = {
  declaredTier: 'formal_verification',
  declaredTools: ['coq', 'isabelle'],
  coverageEstimate: 0.9,
  priorCoverage: 0.4,
};

const AUTOMATED_WORKFLOW: AttestationWorkflow = {
  declaredTier: 'automated_tooling',
  declaredTools: ['cargo-test', 'miri'],
  coverageEstimate: 0.6,
  priorCoverage: 0.4,
};

const ANNOTATION_WORKFLOW: AttestationWorkflow = {
  declaredTier: 'agent_self_annotation',
  declaredTools: ['self-checker'],
  coverageEstimate: 0.1,
  priorCoverage: 0.4,
};

const DEFAULT_BANDWIDTH: ReviewBandwidth = {
  reviewersCount: 1,
  unitsPerHour: 200,
  timeToNextApprovalHours: 8,
  unitType: 'lines',
};

// ─── 1. pearsonCorrelation ────────────────────────────────────────────────────

describe('pearsonCorrelation', () => {
  it('T1: perfectly positive correlation', () => {
    const r = pearsonCorrelation([1, 2, 3], [2, 4, 6]);
    expect(Math.abs(r - 1.0)).toBeLessThan(1e-9);
  });

  it('T2: perfectly negative correlation', () => {
    const r = pearsonCorrelation([1, 2, 3], [3, 2, 1]);
    expect(Math.abs(r - (-1.0))).toBeLessThan(1e-9);
  });

  it('T3: approximately zero correlation', () => {
    // [1,2,3,4] × [1,2,1,2] — no monotone trend
    const r = pearsonCorrelation([1, 2, 3, 4], [1, 2, 1, 2]);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  it('T4: single point returns 0', () => {
    expect(pearsonCorrelation([1], [2])).toBe(0);
  });

  it('T5: empty inputs return 0', () => {
    expect(pearsonCorrelation([], [])).toBe(0);
  });

  it('T6: zero-variance x returns 0 (variance guard)', () => {
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBe(0);
  });
});

// ─── 2. extractOutputSessions ─────────────────────────────────────────────────

describe('extractOutputSessions', () => {
  it('T7: empty events returns empty array', () => {
    expect(extractOutputSessions([])).toEqual([]);
  });

  it('T8: two events with same session_id → one bucket, summed volume', () => {
    const events = [
      makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 }),
      makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 150 }),
    ];
    const sessions = extractOutputSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('sess-abc12345');
    expect(sessions[0].totalOutputVolume).toBe(250);
    expect(sessions[0].events).toHaveLength(2);
  });

  it('T9: malformed details JSON → skipped, no throw', () => {
    const events = [
      makeEvent({ category: 'action_stream', details: 'not-json{{{' }),
      makeEvent({ category: 'action_stream', details: null }),
    ];
    expect(() => extractOutputSessions(events)).not.toThrow();
    expect(extractOutputSessions(events)).toHaveLength(0);
  });

  it('T10: action_stream events without session_id → bucketed under null', () => {
    const events = [
      makeOutputEvent({ sessionId: null, outputVolume: 75 }),
      makeOutputEvent({ sessionId: null, outputVolume: 25 }),
    ];
    const sessions = extractOutputSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBeNull();
    expect(sessions[0].totalOutputVolume).toBe(100);
  });

  it('T11: rejects negative output_volume and non-integer volume', () => {
    const events = [
      makeEvent({
        category: 'action_stream',
        details: JSON.stringify({ subcategory: 'output_volume', output_volume: -5, unit_type: 'lines', session_id: 'sess-abc12345' }),
      }),
      makeEvent({
        category: 'action_stream',
        details: JSON.stringify({ subcategory: 'output_volume', output_volume: 1.5, unit_type: 'lines', session_id: 'sess-def67890' }),
      }),
    ];
    const sessions = extractOutputSessions(events);
    expect(sessions).toHaveLength(0);
  });
});

// ─── 3. extractVerificationEvents ────────────────────────────────────────────

describe('extractVerificationEvents', () => {
  it('T12: happy path with valid tier and tool', () => {
    const events = [
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', sessionId: 'sess-abc12345' }),
    ];
    const result = extractVerificationEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe('cargo-test');
    expect(result[0].tier).toBe('automated_tooling');
    expect(result[0].exitCode).toBe(0);
    expect(result[0].sessionId).toBe('sess-abc12345');
  });

  it('T13: invalid tier → skipped', () => {
    const events = [
      makeVerifEvent({ tool: 'gut-check', tier: 'gut_feel' }),
    ];
    expect(extractVerificationEvents(events)).toHaveLength(0);
  });

  it('T14: events returned sorted by timestamp ASC', () => {
    const events = [
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', timestamp: '2026-05-15T10:30:00.000Z' }),
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', timestamp: '2026-05-15T09:00:00.000Z' }),
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', timestamp: '2026-05-15T11:00:00.000Z' }),
    ];
    const result = extractVerificationEvents(events);
    expect(result[0].timestamp).toBe('2026-05-15T09:00:00.000Z');
    expect(result[1].timestamp).toBe('2026-05-15T10:30:00.000Z');
    expect(result[2].timestamp).toBe('2026-05-15T11:00:00.000Z');
  });
});

// ─── 4. computeVerificationCoverage ──────────────────────────────────────────

describe('computeVerificationCoverage', () => {
  it('T15: zero output sessions → returns priorCoverage, outputSessionCount: 0', () => {
    const result = computeVerificationCoverage([], AUTOMATED_WORKFLOW);
    expect(result.coverage).toBe(AUTOMATED_WORKFLOW.priorCoverage);
    expect(result.outputSessionCount).toBe(0);
    expect(result.verifiedSessionCount).toBe(0);
  });

  it('T16: one output session + one matching verification (formal_verification) → coverage 1.0', () => {
    const events = [
      makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 }),
      makeVerifEvent({ tool: 'coq', tier: 'formal_verification', sessionId: 'sess-abc12345' }),
    ];
    const result = computeVerificationCoverage(events, FORMAL_WORKFLOW);
    expect(result.coverage).toBeCloseTo(1.0 * VERIFICATION_TIER_WEIGHT.formal_verification, 6);
    expect(result.outputSessionCount).toBe(1);
    expect(result.verifiedSessionCount).toBe(1);
  });

  it('T17: same as T16 but agent_self_annotation tier → coverage 0.05', () => {
    const events = [
      makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 }),
      makeVerifEvent({ tool: 'self-checker', tier: 'agent_self_annotation', sessionId: 'sess-abc12345' }),
    ];
    const result = computeVerificationCoverage(events, ANNOTATION_WORKFLOW);
    expect(result.coverage).toBeCloseTo(0.05, 6);
  });

  it('T18: one output session + verification event with NON-declared tool → coverage 0', () => {
    const events = [
      makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 }),
      makeVerifEvent({ tool: 'undeclared-tool', tier: 'automated_tooling', sessionId: 'sess-abc12345' }),
    ];
    const result = computeVerificationCoverage(events, AUTOMATED_WORKFLOW);
    expect(result.coverage).toBe(0);
    expect(result.verifiedSessionCount).toBe(0);
  });

  it('T19: two output sessions, only one verified → coverage = 0.5 × tierMult', () => {
    const events = [
      makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 }),
      makeOutputEvent({ sessionId: 'sess-def67890', outputVolume: 100 }),
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', sessionId: 'sess-abc12345' }),
    ];
    const result = computeVerificationCoverage(events, AUTOMATED_WORKFLOW);
    expect(result.coverage).toBeCloseTo(0.5 * VERIFICATION_TIER_WEIGHT.automated_tooling, 6);
    expect(result.outputSessionCount).toBe(2);
    expect(result.verifiedSessionCount).toBe(1);
  });

  it('T20: null session_id matching via ±30-minute window (automated_tooling) → coverage 0.85', () => {
    // Output event at 10:00, verification at 10:20 — within 30 min → match
    const events = [
      makeOutputEvent({ sessionId: null, outputVolume: 100, timestamp: '2026-05-15T10:00:00.000Z' }),
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', timestamp: '2026-05-15T10:20:00.000Z' }),
      // No sessionId on the verification event (omitted from details)
    ];
    const result = computeVerificationCoverage(events, AUTOMATED_WORKFLOW);
    expect(result.coverage).toBeCloseTo(1.0 * VERIFICATION_TIER_WEIGHT.automated_tooling, 6);
    expect(result.verifiedSessionCount).toBe(1);
  });

  it('T21: null session_id with verification event >30 min away → unverified → 0', () => {
    const events = [
      makeOutputEvent({ sessionId: null, outputVolume: 100, timestamp: '2026-05-15T10:00:00.000Z' }),
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', timestamp: '2026-05-15T10:31:00.000Z' }),
    ];
    const result = computeVerificationCoverage(events, AUTOMATED_WORKFLOW);
    expect(result.coverage).toBe(0);
    expect(result.verifiedSessionCount).toBe(0);
  });
});

// ─── 5. computeReviewabilityRatio ────────────────────────────────────────────

describe('computeReviewabilityRatio', () => {
  it('T22: no output events → ratio 0, totalOutputVolume 0', () => {
    const result = computeReviewabilityRatio([], DEFAULT_BANDWIDTH);
    expect(result.ratio).toBe(0);
    expect(result.totalOutputVolume).toBe(0);
  });

  it('T23: totalOutputVolume 1600, capacity 200, window 8h → ratio 1.0', () => {
    // 8 events × 200 volume each = 1600; capacity = 200*8 = 1600
    const events = Array.from({ length: 8 }, (_, i) =>
      makeOutputEvent({ sessionId: `sess-${String(i).padStart(8, '0')}`, outputVolume: 200 }),
    );
    const result = computeReviewabilityRatio(events, DEFAULT_BANDWIDTH);
    expect(result.totalOutputVolume).toBe(1600);
    expect(result.ratio).toBeCloseTo(1.0, 6);
  });

  it('T24: capacity 0 (reviewersCount 0) → uses Math.max(1,...) → ratio = totalOutputVolume / 1', () => {
    const bandwidth: ReviewBandwidth = { reviewersCount: 0, unitsPerHour: 100, timeToNextApprovalHours: 8, unitType: 'lines' };
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 500 })];
    const result = computeReviewabilityRatio(events, bandwidth);
    expect(result.totalOutputVolume).toBe(500);
    expect(result.ratio).toBeCloseTo(500 / 1, 6);
  });

  it('T25: totalOutputVolume 5000, capacity 200, window 8h → ratio 5000/1600 = 3.125', () => {
    // Single session with 5000 volume
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 5000 })];
    const result = computeReviewabilityRatio(events, DEFAULT_BANDWIDTH);
    expect(result.totalOutputVolume).toBe(5000);
    expect(result.ratio).toBeCloseTo(5000 / 1600, 6);
  });
});

// ─── 6. isUnfalsifiableAtScale ────────────────────────────────────────────────

describe('isUnfalsifiableAtScale', () => {
  it('T26: ratio 1.0 (below default 3.0) → false', () => {
    // 1600 output, capacity 200*8=1600 → ratio 1.0
    const events = Array.from({ length: 8 }, (_, i) =>
      makeOutputEvent({ sessionId: `sess-${String(i).padStart(8, '0')}`, outputVolume: 200 }),
    );
    expect(isUnfalsifiableAtScale(events, DEFAULT_BANDWIDTH)).toBe(false);
  });

  it('T27: ratio exactly 3.0 (strict >) → false', () => {
    // 4800 output, capacity 200*8=1600 → ratio 3.0
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 4800 })];
    expect(isUnfalsifiableAtScale(events, DEFAULT_BANDWIDTH)).toBe(false);
  });

  it('T28: ratio 3.125 → true', () => {
    // 5000 output, capacity 200*8=1600 → ratio 3.125
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 5000 })];
    expect(isUnfalsifiableAtScale(events, DEFAULT_BANDWIDTH)).toBe(true);
  });
});

// ─── 7. hasEpistemicEvidence ──────────────────────────────────────────────────

describe('hasEpistemicEvidence', () => {
  it('T29: sparse data (5 verification + 5 feedback with outcomeCorrect:true, with workflow) → false', () => {
    const events = Array.from({ length: 5 }, () =>
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling' }),
    );
    const feedback = Array.from({ length: 5 }, () => makeFeedback({ outcomeCorrect: true }));
    expect(hasEpistemicEvidence(events, feedback, AUTOMATED_WORKFLOW)).toBe(false);
  });

  it('T30: 10 verification events, 0 feedback, with workflow → true', () => {
    const events = Array.from({ length: 10 }, () =>
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling' }),
    );
    expect(hasEpistemicEvidence(events, [], AUTOMATED_WORKFLOW)).toBe(true);
  });

  it('T31: 0 verification events, 10 feedback with outcomeCorrect:true → true', () => {
    const feedback = Array.from({ length: 10 }, () => makeFeedback({ outcomeCorrect: true }));
    expect(hasEpistemicEvidence([], feedback)).toBe(true);
  });

  it('T32: workflow undefined, 100 verification events → false (workflow required)', () => {
    const events = Array.from({ length: 100 }, () =>
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling' }),
    );
    expect(hasEpistemicEvidence(events, [], undefined)).toBe(false);
  });
});

// ─── 8. epistemicColdStart ───────────────────────────────────────────────────

describe('epistemicColdStart', () => {
  it('T33: (5, 5, formal_verification) → { score: 0.40 * 1.00, confidence: 0.10 }', () => {
    const result = epistemicColdStart(5, 5, FORMAL_WORKFLOW);
    expect(result).not.toBeNull();
    expect(result!.score).toBeCloseTo(EPISTEMIC_PRIOR * VERIFICATION_TIER_WEIGHT.formal_verification, 6);
    expect(result!.confidence).toBe(0.10);
  });

  it('T34: (5, 5, agent_self_annotation) → { score: 0.40 * 0.05, confidence: 0.10 }', () => {
    const result = epistemicColdStart(5, 5, ANNOTATION_WORKFLOW);
    expect(result).not.toBeNull();
    expect(result!.score).toBeCloseTo(EPISTEMIC_PRIOR * VERIFICATION_TIER_WEIGHT.agent_self_annotation, 6);
    expect(result!.confidence).toBe(0.10);
  });

  it('T35: (20, 50, anyWorkflow) → null (caller must compute full score)', () => {
    const result = epistemicColdStart(20, 50, AUTOMATED_WORKFLOW);
    expect(result).toBeNull();
  });
});

// ─── 9. computeEpistemicIntegrity ────────────────────────────────────────────

describe('computeEpistemicIntegrity', () => {
  /**
   * T36: Happy path — spec smoke fixture.
   * Workflow: automated_tooling (mult=0.85), declaredTools: ['cargo-test','miri']
   * Bandwidth: 1 reviewer × 200 uph × 8h = 1600 capacity
   * 4 output sessions × 250 lines each = 1000 total; 3 verified
   * 15 feedback: 12 true, 3 false, none with confidenceStated
   * Expected:
   *   verification_coverage = (3/4) * 0.85 = 0.6375
   *   confirmation_rate     = 12/15 = 0.8
   *   calibration           = 0.5 (no calibrated feedback)
   *   ratio                 = 1000/1600 = 0.625 → reviewability = 0.7
   *   score = 0.35 * 0.6375 + 0.30 * 0.8 + 0.15 * 0.5 + 0.20 * 0.7
   */
  it('T36: happy path (smoke fixture) — score matches weighted formula', () => {
    const sessionIds = ['sess-aaaa1111', 'sess-bbbb2222', 'sess-cccc3333', 'sess-dddd4444'];
    const events: AuditEvent[] = [
      ...sessionIds.map(sid => makeOutputEvent({ sessionId: sid, outputVolume: 250 })),
      // 3 of 4 sessions verified with cargo-test
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', sessionId: 'sess-aaaa1111' }),
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', sessionId: 'sess-bbbb2222' }),
      makeVerifEvent({ tool: 'cargo-test', tier: 'automated_tooling', sessionId: 'sess-cccc3333' }),
    ];

    const feedback: ClaimFeedback[] = [
      ...Array.from({ length: 12 }, () => makeFeedback({ outcomeCorrect: true })),
      ...Array.from({ length: 3 }, () => makeFeedback({ outcomeCorrect: false })),
    ];

    const result = computeEpistemicIntegrity(events, AUTOMATED_WORKFLOW, DEFAULT_BANDWIDTH, feedback);

    // Compute expected via same formula
    const verif_coverage = (3 / 4) * 0.85; // 0.6375
    const confirm = 12 / 15;               // 0.8
    const calib = 0.5;                     // no calibrated data
    const review = 0.7;                    // ratio 0.625 → band [0.5, 1.0)
    const expectedScore = 0.35 * verif_coverage + 0.30 * confirm + 0.15 * calib + 0.20 * review;

    expect(result.score).toBeCloseTo(expectedScore, 6);
    expect(result.signals.verification_coverage).toBeCloseTo(verif_coverage, 6);
    expect(result.signals.confirmation_rate).toBeCloseTo(confirm, 6);
    expect(result.signals.calibration).toBe(0.5);
    expect(result.signals.reviewability).toBe(0.7);
    expect(result.signals.output_session_count).toBe(4);
    expect(result.signals.verification_session_count).toBe(3);
    expect(result.signals.feedback_count).toBe(15);
    expect(result.signals.tier_multiplier).toBe(0.85);
    expect(result.flags).toEqual([]);
  });

  it('T37: unfalsifiable_at_scale → score capped at ≤ 0.2, flag present', () => {
    // 5000 volume, capacity 1600 → ratio 3.125 > 3.0
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 5000 })];
    const feedback: ClaimFeedback[] = [];
    const result = computeEpistemicIntegrity(events, AUTOMATED_WORKFLOW, DEFAULT_BANDWIDTH, feedback);

    expect(result.flags).toContain('unfalsifiable_at_scale');
    expect(result.score).toBeLessThanOrEqual(0.2);
  });

  it('T38: sparse feedback (< 10 confirmed) → confirmation_rate signal is 0.5', () => {
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 })];
    const feedback = Array.from({ length: 5 }, () => makeFeedback({ outcomeCorrect: true }));
    const result = computeEpistemicIntegrity(events, AUTOMATED_WORKFLOW, DEFAULT_BANDWIDTH, feedback);
    expect(result.signals.confirmation_rate).toBe(0.5);
  });

  it('T39: sparse calibration (< 20 calibrated rows) → calibration signal 0.5, no anti_calibration flag', () => {
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 })];
    // 10 calibrated rows — below MIN_FEEDBACK_FOR_CALIBRATION (20)
    const feedback = Array.from({ length: 10 }, () =>
      makeFeedback({ outcomeCorrect: true, confidenceStated: 0.8 }),
    );
    const result = computeEpistemicIntegrity(events, AUTOMATED_WORKFLOW, DEFAULT_BANDWIDTH, feedback);
    expect(result.signals.calibration).toBe(0.5);
    expect(result.flags).not.toContain('anti_calibration_detected');
  });

  it('T40: perfectly anti-calibrated (25 rows, high confidence → wrong) → calibration 0, anti_calibration_detected flag', () => {
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 })];
    // Anti-calibration: high confidence always means wrong outcome
    const feedback = Array.from({ length: 25 }, (_, i) =>
      makeFeedback({
        outcomeCorrect: i < 12 ? false : true,     // 12 wrong, 13 right
        // confidenceStated is inverse of outcomeCorrect
        confidenceStated: i < 12 ? 0.9 : 0.1,     // high conf → wrong; low conf → right
      }),
    );
    const result = computeEpistemicIntegrity(events, AUTOMATED_WORKFLOW, DEFAULT_BANDWIDTH, feedback);
    expect(result.signals.calibration).toBe(0); // clamped from negative pearson
    expect(result.flags).toContain('anti_calibration_detected');
  });

  it('T41: verification_coverage_low flag when coverage < 0.20', () => {
    // One output session, no verification events → coverage = 0
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 })];
    const result = computeEpistemicIntegrity(events, AUTOMATED_WORKFLOW, DEFAULT_BANDWIDTH, []);
    expect(result.signals.verification_coverage).toBeLessThan(0.20);
    expect(result.flags).toContain('verification_coverage_low');
  });

  it('T42: all three flags present → sorted alphabetically', () => {
    // Trigger all three:
    // - anti_calibration_detected: 25 anti-calibrated feedback rows
    // - unfalsifiable_at_scale: ratio > 3.0
    // - verification_coverage_low: no verification events (coverage = 0)
    const events = [
      makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 5000 }), // ratio 3.125
    ];
    const feedback = Array.from({ length: 25 }, (_, i) =>
      makeFeedback({
        outcomeCorrect: i < 12 ? false : true,
        confidenceStated: i < 12 ? 0.9 : 0.1,
      }),
    );
    const result = computeEpistemicIntegrity(events, AUTOMATED_WORKFLOW, DEFAULT_BANDWIDTH, feedback);
    expect(result.flags).toEqual([
      'anti_calibration_detected',
      'unfalsifiable_at_scale',
      'verification_coverage_low',
    ]);
  });

  it('T43: feedback_count reflects raw feedback.length, not filtered count', () => {
    // 12 feedback rows: 7 with outcomeCorrect: true, 5 with outcomeCorrect: null
    const events = [makeOutputEvent({ sessionId: 'sess-abc12345', outputVolume: 100 })];
    const feedback: ClaimFeedback[] = [
      ...Array.from({ length: 7 }, () => makeFeedback({ outcomeCorrect: true })),
      ...Array.from({ length: 5 }, () => makeFeedback({ outcomeCorrect: null })),
    ];
    const result = computeEpistemicIntegrity(events, AUTOMATED_WORKFLOW, DEFAULT_BANDWIDTH, feedback);
    expect(result.signals.feedback_count).toBe(12);
  });
});
