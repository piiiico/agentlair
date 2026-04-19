/**
 * AgentLair Trust Engine — Unit Tests
 *
 * Tests for the behavioral trust scoring algorithm (Phase 1):
 * - PHASE1_WEIGHTS
 * - computeConsistency
 * - computeRestraint
 * - computeTransparency
 * - applyColdStartPrior
 * - deriveATFLevel
 * - computeConfidenceInterval
 */

import { describe, test, expect } from 'bun:test';
import type { AuditEvent } from './trust-engine';
import {
  PHASE1_WEIGHTS,
  computeConsistency,
  computeRestraint,
  computeTransparency,
  applyColdStartPrior,
  deriveATFLevel,
  computeConfidenceInterval,
} from './trust-engine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let eventCounter = 0;

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `evt-${++eventCounter}`,
    timestamp: new Date().toISOString(),
    account_id: 'acc_test',
    actor_id: 'agent_test',
    category: 'auth',
    action: 'auth.login',
    result: 'success',
    prev_hash: 'a'.repeat(64),
    signature: 'sig_test',
    resource_type: null,
    error_code: null,
    ...overrides,
  };
}

/** N events spread evenly over the past `days` days (all within window). */
function makeEventsOverDays(
  count: number,
  days: number,
  overrides: Partial<AuditEvent> = {},
): AuditEvent[] {
  const now = Date.now();
  const windowMs = days * 86_400_000;
  return Array.from({ length: count }, (_, i) => {
    const offsetMs = (i / Math.max(count - 1, 1)) * windowMs;
    const ts = new Date(now - windowMs + offsetMs).toISOString();
    return makeEvent({ timestamp: ts, ...overrides });
  });
}

/**
 * N sessions each with `eventsPerSession` events close together, separated
 * by `gapHours` between session starts.
 */
function makeSessions(
  sessionCount: number,
  gapHours: number,
  eventsPerSession = 3,
  overrides: Partial<AuditEvent> = {},
): AuditEvent[] {
  const now = Date.now();
  const events: AuditEvent[] = [];
  for (let s = 0; s < sessionCount; s++) {
    const sessionStartMs = now - (sessionCount - s) * gapHours * 3_600_000;
    for (let e = 0; e < eventsPerSession; e++) {
      events.push(makeEvent({
        timestamp: new Date(sessionStartMs + e * 60_000).toISOString(),
        ...overrides,
      }));
    }
  }
  return events;
}

// ─── PHASE1_WEIGHTS ───────────────────────────────────────────────────────────

describe('PHASE1_WEIGHTS', () => {
  test('sum to 1.0 within floating-point tolerance', () => {
    const sum = PHASE1_WEIGHTS.consistency + PHASE1_WEIGHTS.restraint + PHASE1_WEIGHTS.transparency;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  test('consistency ≈ 0.3571 (0.25 / 0.70)', () => {
    expect(PHASE1_WEIGHTS.consistency).toBeCloseTo(0.25 / 0.70, 10);
  });

  test('restraint ≈ 0.4286 (0.30 / 0.70)', () => {
    expect(PHASE1_WEIGHTS.restraint).toBeCloseTo(0.30 / 0.70, 10);
  });

  test('transparency ≈ 0.2143 (0.15 / 0.70)', () => {
    expect(PHASE1_WEIGHTS.transparency).toBeCloseTo(0.15 / 0.70, 10);
  });

  test('restraint has the highest weight', () => {
    expect(PHASE1_WEIGHTS.restraint).toBeGreaterThan(PHASE1_WEIGHTS.consistency);
    expect(PHASE1_WEIGHTS.restraint).toBeGreaterThan(PHASE1_WEIGHTS.transparency);
  });
});

// ─── computeConsistency ───────────────────────────────────────────────────────

describe('computeConsistency', () => {
  test('empty events → neutral defaults', () => {
    const { score, signals } = computeConsistency([]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(signals.session_regularity).toBe(0.5);
    expect(signals.tool_stability).toBe(0.5);
    expect(signals.error_stability).toBe(0.7);
    expect(signals.window_consistency).toBe(0.5);
  });

  test('score is in [0, 1] range', () => {
    const events = makeEventsOverDays(20, 90);
    const { score } = computeConsistency(events);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('all 4 signals are present in output', () => {
    const events = makeEventsOverDays(20, 90);
    const { signals } = computeConsistency(events);
    expect(signals).toHaveProperty('session_regularity');
    expect(signals).toHaveProperty('tool_stability');
    expect(signals).toHaveProperty('error_stability');
    expect(signals).toHaveProperty('window_consistency');
  });

  test('fewer than 3 sessions → session_regularity defaults to 0.5', () => {
    // 2 events within 30 minutes = 1 session → < 3 sessions → neutral
    const now = Date.now();
    const events = [
      makeEvent({ timestamp: new Date(now - 3_600_000).toISOString() }),
      makeEvent({ timestamp: new Date(now - 3_500_000).toISOString() }),
    ];
    const { signals } = computeConsistency(events);
    expect(signals.session_regularity).toBe(0.5);
  });

  test('perfectly regular sessions → high session_regularity', () => {
    // 5 sessions 24h apart → uniform intervals → CV = 0 → session_regularity = 1
    const events = makeSessions(5, 24);
    const { signals } = computeConsistency(events);
    expect(signals.session_regularity).toBeGreaterThan(0.9);
  });

  test('erratic session timing → lower session_regularity', () => {
    // Gaps vary wildly: 1d, 69d, 1d, ~9d → high CV → low regularity
    const now = Date.now();
    const events: AuditEvent[] = [
      makeEvent({ timestamp: new Date(now - 80 * 86_400_000).toISOString() }),
      makeEvent({ timestamp: new Date(now - 79 * 86_400_000).toISOString() }),
      makeEvent({ timestamp: new Date(now - 10 * 86_400_000).toISOString() }),
      makeEvent({ timestamp: new Date(now - 9 * 86_400_000).toISOString() }),
      makeEvent({ timestamp: new Date(now - 2 * 86_400_000).toISOString() }),
      makeEvent({ timestamp: new Date(now - 1 * 86_400_000).toISOString() }),
    ];
    const { signals } = computeConsistency(events);
    expect(signals.session_regularity).toBeLessThan(0.8);
  });

  test('identical category distribution in 7d and 90d → high tool_stability', () => {
    const now = Date.now();
    // 10 auth events in old window (30+ days ago)
    const old = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ timestamp: new Date(now - (30 + i) * 86_400_000).toISOString(), category: 'auth' }),
    );
    // 5 auth events in recent 7d
    const recent = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ timestamp: new Date(now - i * 86_400_000).toISOString(), category: 'auth' }),
    );
    const { signals } = computeConsistency([...old, ...recent]);
    // JSD(all-auth, all-auth) = 0 → tool_stability = 1
    expect(signals.tool_stability).toBeGreaterThan(0.95);
  });

  test('error rate spike in 7d vs stable 90d → low error_stability', () => {
    const now = Date.now();
    // 20 success events spread over old window (30–89 days ago)
    const oldEvents = Array.from({ length: 20 }, (_, i) =>
      makeEvent({
        timestamp: new Date(now - (30 + i) * 86_400_000).toISOString(),
        result: 'success',
      }),
    );
    // 10 failure events in last 6 days
    const recentEvents = Array.from({ length: 10 }, (_, i) =>
      makeEvent({
        timestamp: new Date(now - i * 86_400_000).toISOString(),
        result: 'failure',
      }),
    );
    const { signals } = computeConsistency([...oldEvents, ...recentEvents]);
    // 7d rate = 1.0, 90d rate ≈ 0.33 → delta ≈ 0.67 → error_stability = 0
    expect(signals.error_stability).toBeLessThan(0.5);
  });

  test('all activity at same UTC hour → high window_consistency', () => {
    // 15 events concentrated at hour 10 UTC over last 15 days
    const events = Array.from({ length: 15 }, (_, i) => {
      const d = new Date();
      d.setUTCHours(10, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - (14 - i));
      return makeEvent({ timestamp: d.toISOString() });
    });
    const { signals } = computeConsistency(events);
    // Concentrated at one hour → low entropy → high window_consistency
    expect(signals.window_consistency).toBeGreaterThan(0.7);
  });
});

// ─── computeRestraint ─────────────────────────────────────────────────────────

describe('computeRestraint', () => {
  test('empty events → returns all signals', () => {
    const { score, signals } = computeRestraint([]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(signals).toHaveProperty('scope_utilization');
    expect(signals).toHaveProperty('credential_frequency');
    expect(signals).toHaveProperty('rate_limit_proximity');
    expect(signals).toHaveProperty('escalation_appropriateness');
    expect(signals).toHaveProperty('permission_growth');
  });

  test('score is in [0, 1] range', () => {
    const events = makeEventsOverDays(20, 90);
    const { score } = computeRestraint(events);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('scope_utilization bell curve: ~5/9 categories scores higher than 9/9', () => {
    const now = Date.now();
    // 5 categories ≈ 0.556 ratio (near bell-curve peak at 0.6)
    const cats5 = ['auth', 'email', 'vault', 'pod', 'calendar'];
    const events5 = cats5.flatMap((cat, i) =>
      Array.from({ length: 4 }, (_, j) =>
        makeEvent({ timestamp: new Date(now - (i * 7 + j) * 86_400_000).toISOString(), category: cat }),
      ),
    );
    const { signals: sig5 } = computeRestraint(events5);

    // All 9 categories → ratio = 1.0 (far from peak)
    const cats9 = ['auth', 'email', 'vault', 'pod', 'calendar', 'webhook', 'session', 'budget', 'system'];
    const events9 = cats9.flatMap((cat, i) =>
      Array.from({ length: 3 }, (_, j) =>
        makeEvent({ timestamp: new Date(now - (i * 7 + j) * 86_400_000).toISOString(), category: cat }),
      ),
    );
    const { signals: sig9 } = computeRestraint(events9);

    expect(sig5.scope_utilization).toBeGreaterThan(sig9.scope_utilization);
  });

  test('zero vault events → credential_frequency = 1.0', () => {
    // 5 sessions of 3 auth events each → 0 vault accesses
    const events = makeSessions(5, 24, 3, { category: 'auth' });
    const { signals } = computeRestraint(events);
    expect(signals.credential_frequency).toBe(1.0);
  });

  test('heavy vault access per session → low credential_frequency', () => {
    // 5 sessions with 8 vault events each → vaultPerSession = 8 → score = 0.2
    const now = Date.now();
    const events: AuditEvent[] = [];
    for (let s = 0; s < 5; s++) {
      const sessionStart = now - (5 - s) * 24 * 3_600_000;
      for (let e = 0; e < 8; e++) {
        events.push(makeEvent({
          timestamp: new Date(sessionStart + e * 60_000).toISOString(),
          category: 'vault',
        }));
      }
    }
    const { signals } = computeRestraint(events);
    expect(signals.credential_frequency).toBeLessThan(0.5);
  });

  test('no rate-limited results → rate_limit_proximity = 1', () => {
    const events = makeEventsOverDays(20, 90, { result: 'success' });
    const { signals } = computeRestraint(events);
    expect(signals.rate_limit_proximity).toBe(1);
  });

  test('all results rate-limited → rate_limit_proximity = 0', () => {
    const events = makeEventsOverDays(20, 90, { result: 'rate_limited' });
    const { signals } = computeRestraint(events);
    // clamp(1 - 1.0 * 10, 0, 1) = 0
    expect(signals.rate_limit_proximity).toBe(0);
  });

  test('healthy escalation ratio (≤ 30%) → escalation_appropriateness = 0.85', () => {
    const now = Date.now();
    const normal = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ timestamp: new Date(now - i * 3_600_000).toISOString(), action: 'auth.login' }),
    );
    const escalations = Array.from({ length: 2 }, (_, i) =>
      makeEvent({ timestamp: new Date(now - i * 7_200_000).toISOString(), action: 'approve_action' }),
    );
    const { signals } = computeRestraint([...normal, ...escalations]);
    // escalationRatio = 2/12 ≈ 0.167 ≤ 0.30 → 0.85
    expect(signals.escalation_appropriateness).toBe(0.85);
  });

  test('active agent (>20 events) with zero escalations → escalation_appropriateness = 0.6', () => {
    const events = makeEventsOverDays(25, 90, { action: 'auth.login' });
    const { signals } = computeRestraint(events);
    expect(signals.escalation_appropriateness).toBe(0.6);
  });

  test('very high escalation ratio → escalation_appropriateness clamped between 0.5 and 0.8', () => {
    const now = Date.now();
    // 50% escalation ratio
    const normal = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ timestamp: new Date(now - i * 3_600_000).toISOString(), action: 'auth.login' }),
    );
    const escalations = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ timestamp: new Date(now - i * 7_200_000).toISOString(), action: 'approve_action' }),
    );
    const { signals } = computeRestraint([...normal, ...escalations]);
    // escalationRatio = 0.5 > 0.30 → clamp(1 - 0.5, 0.5, 0.8) = 0.5
    expect(signals.escalation_appropriateness).toBeGreaterThanOrEqual(0.5);
    expect(signals.escalation_appropriateness).toBeLessThanOrEqual(0.8);
  });

  test('permission_growth is always 0.75 in Phase 1', () => {
    const { signals: s0 } = computeRestraint([]);
    expect(s0.permission_growth).toBe(0.75);

    const { signals: s50 } = computeRestraint(makeEventsOverDays(50, 90));
    expect(s50.permission_growth).toBe(0.75);
  });
});

// ─── computeTransparency ─────────────────────────────────────────────────────

describe('computeTransparency', () => {
  test('empty events → coverage 0.3, chain_integrity 1, score > 0', () => {
    const { score, signals } = computeTransparency([]);
    expect(signals.audit_coverage).toBe(0.3);
    expect(signals.chain_integrity).toBe(1.0);
    expect(score).toBeGreaterThan(0);
  });

  test('score is in [0, 1] range', () => {
    const events = makeEventsOverDays(20, 90);
    const { score } = computeTransparency(events);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('all 4 signals are present in output', () => {
    const events = makeEventsOverDays(10, 90);
    const { signals } = computeTransparency(events);
    expect(signals).toHaveProperty('audit_coverage');
    expect(signals).toHaveProperty('chain_integrity');
    expect(signals).toHaveProperty('auth_hygiene');
    expect(signals).toHaveProperty('telemetry_reporting');
  });

  test('all events have prev_hash → chain_integrity = 1', () => {
    const events = makeEventsOverDays(10, 90, { prev_hash: 'a'.repeat(64) });
    const { signals } = computeTransparency(events);
    expect(signals.chain_integrity).toBe(1);
  });

  test('all events missing prev_hash → catastrophic failure → score = 0', () => {
    const events = makeEventsOverDays(10, 90, { prev_hash: '' });
    const { score, signals } = computeTransparency(events);
    expect(signals.chain_integrity).toBe(0);
    expect(score).toBe(0);
  });

  test('partial broken chain → proportionally reduced chain_integrity', () => {
    const now = Date.now();
    const good = Array.from({ length: 6 }, (_, i) =>
      makeEvent({ timestamp: new Date(now - i * 86_400_000).toISOString(), prev_hash: 'a'.repeat(64) }),
    );
    const broken = Array.from({ length: 4 }, (_, i) =>
      makeEvent({ timestamp: new Date(now - (i + 10) * 86_400_000).toISOString(), prev_hash: '' }),
    );
    const { signals } = computeTransparency([...good, ...broken]);
    // 4 broken of 10 total → chain_integrity = 1 - 4/10 = 0.6
    expect(signals.chain_integrity).toBeCloseTo(0.6, 5);
    expect(signals.score).not.toBe(0); // not catastrophic (integrity > 0)
  });

  test('coverage scales with event count', () => {
    const { signals: s0 } = computeTransparency([]);
    const { signals: s3 } = computeTransparency(makeEventsOverDays(3, 90));
    const { signals: s100 } = computeTransparency(makeEventsOverDays(100, 90));

    expect(s0.audit_coverage).toBe(0.3);   // 0 events → 0.3
    expect(s3.audit_coverage).toBe(0.5);   // < 5 events → 0.5
    expect(s100.audit_coverage).toBeGreaterThan(s3.audit_coverage);
    expect(s100.audit_coverage).toBeLessThanOrEqual(1.0);
  });

  test('auth events with no failures → auth_hygiene = 1.0', () => {
    const events = makeEventsOverDays(15, 90, { category: 'auth', result: 'success' });
    const { signals } = computeTransparency(events);
    // failurePenalty=1, hasAuth=1 → authHygiene = 1.0
    expect(signals.auth_hygiene).toBe(1.0);
  });

  test('all auth events are failures → low auth_hygiene', () => {
    const events = makeEventsOverDays(15, 90, { category: 'auth', result: 'failure' });
    const { signals } = computeTransparency(events);
    // failurePenalty = clamp(1 - 1.0*3, 0,1) = 0, hasAuth=1
    // authHygiene = weightedMean([[0, 0.6], [1, 0.4]]) = 0.4
    expect(signals.auth_hygiene).toBeCloseTo(0.4, 5);
  });

  test('no auth events → auth_hygiene = 0.8 (failurePenalty=1, hasAuth=0.5)', () => {
    const events = makeEventsOverDays(15, 90, { category: 'email', result: 'success' });
    const { signals } = computeTransparency(events);
    // authEvents=0 → failurePenalty=1, hasAuth=0.5
    // authHygiene = weightedMean([[1, 0.6], [0.5, 0.4]]) = 0.6 + 0.2 = 0.8
    expect(signals.auth_hygiene).toBeCloseTo(0.8, 5);
  });

  test('telemetry_reporting is neutral 0.5 in Phase 1', () => {
    const { signals } = computeTransparency(makeEventsOverDays(10, 90));
    expect(signals.telemetry_reporting).toBe(0.5);
  });
});

// ─── applyColdStartPrior ──────────────────────────────────────────────────────

describe('applyColdStartPrior', () => {
  const AGENT_PRIOR = 0.30;

  test('0 observations → returns prior (0.30) with zero confidence', () => {
    const { score, confidence } = applyColdStartPrior(0.8, 0);
    expect(score).toBe(AGENT_PRIOR);
    expect(confidence).toBe(0);
  });

  test('< 10 observations → always returns prior score regardless of rawScore', () => {
    for (const obs of [1, 5, 9]) {
      const { score } = applyColdStartPrior(0.95, obs);
      expect(score).toBe(AGENT_PRIOR);
    }
  });

  test('< 10 observations → confidence scales linearly with observation count', () => {
    // confidence = 0.05 * (obs / MIN_OBSERVATIONS)
    const { confidence: c1 } = applyColdStartPrior(0.8, 1);
    const { confidence: c5 } = applyColdStartPrior(0.8, 5);
    const { confidence: c9 } = applyColdStartPrior(0.8, 9);

    expect(c1).toBeCloseTo(0.05 * (1 / 10), 10);
    expect(c5).toBeCloseTo(0.05 * (5 / 10), 10);
    expect(c9).toBeCloseTo(0.05 * (9 / 10), 10);
    expect(c5).toBeGreaterThan(c1);
    expect(c9).toBeGreaterThan(c5);
  });

  test('10+ observations → Bayesian blend moves toward rawScore with more data', () => {
    // All with rawScore=1.0: more observations → score closer to 1.0
    const { score: s10 } = applyColdStartPrior(1.0, 10);
    const { score: s50 } = applyColdStartPrior(1.0, 50);
    const { score: s200 } = applyColdStartPrior(1.0, 200);

    expect(s50).toBeGreaterThan(s10);
    expect(s200).toBeGreaterThan(s50);
    // With 200 observations should be well above prior
    expect(s200).toBeGreaterThan(0.9);
  });

  test('confidence increases with more observations (monotonic for obs ≥ 10)', () => {
    const { confidence: c10 } = applyColdStartPrior(0.8, 10);
    const { confidence: c50 } = applyColdStartPrior(0.8, 50);
    const { confidence: c200 } = applyColdStartPrior(0.8, 200);

    expect(c50).toBeGreaterThan(c10);
    expect(c200).toBeGreaterThan(c50);
    expect(c200).toBeLessThanOrEqual(1.0);
  });

  test('blended score is between prior and rawScore for 10–100 observations', () => {
    const rawScore = 0.9;
    const { score } = applyColdStartPrior(rawScore, 50);
    expect(score).toBeGreaterThan(AGENT_PRIOR);
    expect(score).toBeLessThan(rawScore);
  });

  test('AGENT_PRIOR constant is 0.30', () => {
    // Verify by checking result when obs < MIN_OBSERVATIONS
    const { score } = applyColdStartPrior(0.999, 0);
    expect(score).toBe(0.30);
  });
});

// ─── deriveATFLevel ───────────────────────────────────────────────────────────

describe('deriveATFLevel', () => {
  // Principal boundary: score ≥ 85 AND confidence ≥ 0.8
  test('score ≥ 85 and confidence ≥ 0.8 → principal', () => {
    expect(deriveATFLevel(85, 0.8)).toBe('principal');
    expect(deriveATFLevel(90, 0.9)).toBe('principal');
    expect(deriveATFLevel(100, 1.0)).toBe('principal');
  });

  test('score = 85, confidence = 0.79 → senior (just below confidence threshold)', () => {
    expect(deriveATFLevel(85, 0.79)).toBe('senior');
  });

  test('score = 84, confidence = 0.9 → senior (just below score threshold)', () => {
    expect(deriveATFLevel(84, 0.9)).toBe('senior');
  });

  // Senior boundary: score ≥ 65 AND confidence ≥ 0.5
  test('score ≥ 65 and confidence ≥ 0.5 → senior', () => {
    expect(deriveATFLevel(65, 0.5)).toBe('senior');
    expect(deriveATFLevel(75, 0.7)).toBe('senior');
    expect(deriveATFLevel(84, 0.99)).toBe('senior');
  });

  test('score = 65, confidence = 0.49 → junior (just below confidence threshold)', () => {
    expect(deriveATFLevel(65, 0.49)).toBe('junior');
  });

  test('score = 64, confidence = 0.9 → junior (just below score threshold)', () => {
    expect(deriveATFLevel(64, 0.9)).toBe('junior');
  });

  // Junior boundary: score ≥ 40 AND confidence ≥ 0.3
  test('score ≥ 40 and confidence ≥ 0.3 → junior', () => {
    expect(deriveATFLevel(40, 0.3)).toBe('junior');
    expect(deriveATFLevel(50, 0.4)).toBe('junior');
    expect(deriveATFLevel(64, 0.49)).toBe('junior');
  });

  test('score = 40, confidence = 0.29 → intern (just below confidence threshold)', () => {
    expect(deriveATFLevel(40, 0.29)).toBe('intern');
  });

  test('score = 39, confidence = 0.5 → intern (just below score threshold)', () => {
    expect(deriveATFLevel(39, 0.5)).toBe('intern');
  });

  // Intern fallback
  test('score = 0, confidence = 0 → intern', () => {
    expect(deriveATFLevel(0, 0)).toBe('intern');
  });

  test('low score and confidence → intern', () => {
    expect(deriveATFLevel(10, 0.1)).toBe('intern');
    expect(deriveATFLevel(30, 0.2)).toBe('intern');
  });

  test('all 4 ATF levels are reachable', () => {
    const levels = new Set([
      deriveATFLevel(100, 1.0),  // principal
      deriveATFLevel(70, 0.7),   // senior
      deriveATFLevel(50, 0.4),   // junior
      deriveATFLevel(10, 0.1),   // intern
    ]);
    expect(levels.size).toBe(4);
    expect(levels.has('principal')).toBe(true);
    expect(levels.has('senior')).toBe(true);
    expect(levels.has('junior')).toBe(true);
    expect(levels.has('intern')).toBe(true);
  });
});

// ─── computeConfidenceInterval ────────────────────────────────────────────────

describe('computeConfidenceInterval', () => {
  test('returns correct structure: score, lower, upper, confidence', () => {
    const ci = computeConfidenceInterval(50, 10);
    expect(ci).toHaveProperty('score');
    expect(ci).toHaveProperty('lower');
    expect(ci).toHaveProperty('upper');
    expect(ci).toHaveProperty('confidence');
  });

  test('score is preserved in output', () => {
    expect(computeConfidenceInterval(30, 50).score).toBe(30);
    expect(computeConfidenceInterval(75, 100).score).toBe(75);
  });

  test('lower ≤ score ≤ upper', () => {
    for (const [score, obs] of [[50, 1], [50, 100], [30, 20], [80, 500]] as [number, number][]) {
      const ci = computeConfidenceInterval(score, obs);
      expect(ci.lower).toBeLessThanOrEqual(ci.score);
      expect(ci.upper).toBeGreaterThanOrEqual(ci.score);
    }
  });

  test('lower bound clamped to ≥ 0', () => {
    // Score near 0 with 1 observation: halfWidth=40 → lower = max(0, 0-40) = 0
    const ci = computeConfidenceInterval(5, 1);
    expect(ci.lower).toBeGreaterThanOrEqual(0);
  });

  test('upper bound clamped to ≤ 100', () => {
    // Score near 100 with 1 observation: halfWidth=40 → upper = min(100, 95+40) = 100
    const ci = computeConfidenceInterval(95, 1);
    expect(ci.upper).toBeLessThanOrEqual(100);
  });

  test('interval narrows as observation count increases', () => {
    const width = (obs: number) => {
      const ci = computeConfidenceInterval(50, obs);
      return ci.upper - ci.lower;
    };
    expect(width(100)).toBeLessThan(width(1));
    expect(width(1000)).toBeLessThanOrEqual(width(100));
  });

  test('confidence increases with more observations', () => {
    const ci10   = computeConfidenceInterval(50, 10);
    const ci100  = computeConfidenceInterval(50, 100);
    const ci1000 = computeConfidenceInterval(50, 1000);

    expect(ci100.confidence).toBeGreaterThan(ci10.confidence);
    expect(ci1000.confidence).toBeGreaterThan(ci100.confidence);
  });

  test('1 observation → halfWidth = 40 → width ≈ 80 (for mid-range score)', () => {
    // observationCount=1 → log10(1)=0 → volumeNarrowing=0 → halfWidth=max(2,40)=40
    const ci = computeConfidenceInterval(50, 1);
    // lower = max(0, 50-40) = 10; upper = min(100, 50+40) = 90 → width = 80
    expect(ci.upper - ci.lower).toBeCloseTo(80, 0);
  });

  test('very high observation count → halfWidth approaches minimum of 2', () => {
    // observationCount=10000 → log10(10000)=4 → volumeNarrowing=min(1,4/3)=1 → halfWidth=max(2,0)=2
    const ci = computeConfidenceInterval(50, 10000);
    const halfWidth = (ci.upper - ci.lower) / 2;
    expect(halfWidth).toBeGreaterThanOrEqual(2);
    expect(halfWidth).toBeLessThanOrEqual(4); // very close to minimum
  });

  test('confidence is in [0, 1] range', () => {
    for (const obs of [1, 10, 100, 1000, 10000]) {
      const ci = computeConfidenceInterval(50, obs);
      expect(ci.confidence).toBeGreaterThanOrEqual(0);
      expect(ci.confidence).toBeLessThanOrEqual(1);
    }
  });
});
