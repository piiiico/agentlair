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
  verifyChainIntegrity,
  applyEntropyPenalty,
} from './trust-engine';
import { createHash } from 'crypto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Sync SHA-256 for test helpers (Bun/Node only — production uses WebCrypto) */
function sha256hexSync(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Canonical entry representation for hash chain computation.
 * Must match the key order used by audit middleware and verifyChainIntegrity.
 * Excludes _source (added post-fetch, not in DB or hash chain).
 */
function canonicalHash(evt: AuditEvent): string {
  const canonical = {
    id: evt.id,
    timestamp: evt.timestamp,
    account_id: evt.account_id,
    actor_type: evt.actor_type ?? 'account',
    actor_id: evt.actor_id,
    actor_ip_hash: evt.actor_ip_hash ?? null,
    category: evt.category,
    action: evt.action,
    method: evt.method ?? 'POST',
    path: evt.path ?? '/v1/auth/login',
    resource_type: evt.resource_type ?? null,
    resource_id: evt.resource_id ?? null,
    status: evt.status ?? 200,
    result: evt.result,
    error_code: evt.error_code ?? null,
    details: evt.details !== null && evt.details !== undefined ? JSON.parse(evt.details as string) : null,
    prev_hash: evt.prev_hash,
    signature: evt.signature,
  };
  return sha256hexSync(JSON.stringify(canonical));
}

let eventCounter = 0;

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `evt-${++eventCounter}`,
    timestamp: new Date().toISOString(),
    account_id: 'acc_test',
    actor_id: 'agent_test',
    actor_type: 'account',
    actor_ip_hash: null,
    category: 'auth',
    action: 'auth.login',
    method: 'POST',
    path: '/v1/auth/login',
    resource_type: null,
    resource_id: null,
    status: 200,
    result: 'success',
    error_code: null,
    details: null,
    prev_hash: 'a'.repeat(64),
    signature: 'sig_test',
    ...overrides,
  };
}

/**
 * N events spread evenly over the past `days` days, with proper SHA-256
 * hash chain (prev_hash = sha256(JSON.stringify(previousEntry))).
 * Use this in tests that need non-zero chain_integrity.
 */
function makeChainedEventsOverDays(
  count: number,
  days: number,
  overrides: Partial<Omit<AuditEvent, 'id' | 'prev_hash'>> = {},
): AuditEvent[] {
  if (count === 0) return [];
  const now = Date.now();
  const windowMs = days * 86_400_000;
  const events: AuditEvent[] = [];
  for (let i = 0; i < count; i++) {
    const offsetMs = (i / Math.max(count - 1, 1)) * windowMs;
    const ts = new Date(now - windowMs + offsetMs).toISOString();
    const id = `chain-evt-${++eventCounter}`;
    // Compute prev_hash as SHA-256 of previous entry's canonical JSON (same as audit middleware)
    const prev_hash = i === 0 ? '0'.repeat(64) : canonicalHash(events[i - 1]);
    const event: AuditEvent = {
      id,
      timestamp: ts,
      account_id: 'acc_test',
      actor_type: 'account',
      actor_id: 'agent_test',
      actor_ip_hash: null,
      category: 'auth',
      action: 'auth.login',
      method: 'POST',
      path: '/v1/auth/login',
      resource_type: null,
      resource_id: null,
      status: 200,
      result: 'success',
      error_code: null,
      details: null,
      prev_hash,
      signature: 'sig_test',
      ...overrides,
    };
    events.push(event);
  }
  return events;
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
  test('empty events → coverage 0.3, chain_integrity 1, score > 0', async () => {
    const { score, signals } = await computeTransparency([]);
    expect(signals.audit_coverage).toBe(0.3);
    expect(signals.chain_integrity).toBe(1.0);
    expect(score).toBeGreaterThan(0);
  });

  test('score is in [0, 1] range', async () => {
    const events = makeChainedEventsOverDays(20, 90);
    const { score } = await computeTransparency(events);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('all 4 signals are present in output', async () => {
    const events = makeChainedEventsOverDays(10, 90);
    const { signals } = await computeTransparency(events);
    expect(signals).toHaveProperty('audit_coverage');
    expect(signals).toHaveProperty('chain_integrity');
    expect(signals).toHaveProperty('auth_hygiene');
    expect(signals).toHaveProperty('telemetry_reporting');
  });

  test('properly chained events → chain_integrity = 1', async () => {
    // Each event's prev_hash === sha256(JSON.stringify(previousEntry)) → unbroken chain
    const events = makeChainedEventsOverDays(10, 90);
    const { signals } = await computeTransparency(events);
    expect(signals.chain_integrity).toBe(1);
  });

  test('all events with wrong prev_hash → chain_integrity = 0', async () => {
    // No event's prev_hash matches sha256 of previous entry → every link is broken
    const events = makeEventsOverDays(10, 90, { prev_hash: '' });
    const { signals } = await computeTransparency(events);
    expect(signals.chain_integrity).toBe(0);
    // With ≤50 internal events, early-exit doesn't trigger — score uses chain_integrity=0 in weighted mean
    expect(signals.audit_coverage).toBeGreaterThan(0);
  });

  test('partial broken chain → proportionally reduced chain_integrity', async () => {
    // Build 10 events sorted oldest-first. First 6 form a proper SHA-256 chain;
    // last 4 have wrong prev_hash values — creating 4 broken links of 9 total.
    const now = Date.now();
    const evts: AuditEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `partial-chain-${++eventCounter}`;
      const ts = new Date(now - (9 - i) * 86_400_000).toISOString();
      let prev_hash: string;
      if (i === 0) {
        prev_hash = '0'.repeat(64); // genesis
      } else if (i < 6) {
        prev_hash = canonicalHash(evts[i - 1]); // proper SHA-256 link
      } else {
        prev_hash = 'wrong-hash-value'; // broken link
      }
      evts.push({ id, timestamp: ts, account_id: 'acc_test', actor_type: 'account',
                  actor_id: 'agent_test', actor_ip_hash: null,
                  category: 'auth', action: 'auth.login', method: 'POST', path: '/v1/auth/login',
                  resource_type: null, resource_id: null, status: 200, result: 'success',
                  error_code: null, details: null,
                  prev_hash, signature: 'sig_test' });
    }
    const { signals } = await computeTransparency(evts);
    // Links 0→1, 1→2, 2→3, 3→4, 4→5 are good (5). Links 5→6, 6→7, 7→8, 8→9 are broken (4).
    // chain_integrity = 5/9 ≈ 0.5556
    expect(signals.chain_integrity).toBeCloseTo(5 / 9, 5);
    expect(signals.chain_integrity).toBeGreaterThan(0); // not catastrophic
  });

  test('coverage scales with event count', async () => {
    // Use chained events so chain_integrity > 0 and the coverage signal is reachable
    const { signals: s0 } = await computeTransparency([]);
    const { signals: s3 } = await computeTransparency(makeChainedEventsOverDays(3, 90));
    const { signals: s100 } = await computeTransparency(makeChainedEventsOverDays(100, 90));

    expect(s0.audit_coverage).toBe(0.3);   // 0 events → 0.3
    expect(s3.audit_coverage).toBe(0.5);   // < 5 events → 0.5
    expect(s100.audit_coverage).toBeGreaterThan(s3.audit_coverage);
    expect(s100.audit_coverage).toBeLessThanOrEqual(1.0);
  });

  test('auth events with no failures → auth_hygiene = 1.0', async () => {
    // Chained events ensure chain_integrity > 0 so we reach auth_hygiene computation
    const events = makeChainedEventsOverDays(15, 90, { category: 'auth', result: 'success' });
    const { signals } = await computeTransparency(events);
    // failurePenalty=1, hasAuth=1 → authHygiene = 1.0
    expect(signals.auth_hygiene).toBe(1.0);
  });

  test('all auth events are failures → low auth_hygiene', async () => {
    const events = makeChainedEventsOverDays(15, 90, { category: 'auth', result: 'failure' });
    const { signals } = await computeTransparency(events);
    // failurePenalty = clamp(1 - 1.0*3, 0,1) = 0, hasAuth=1
    // authHygiene = weightedMean([[0, 0.6], [1, 0.4]]) = 0.4
    expect(signals.auth_hygiene).toBeCloseTo(0.4, 5);
  });

  test('no auth events → auth_hygiene = 0.8 (failurePenalty=1, hasAuth=0.5)', async () => {
    const events = makeChainedEventsOverDays(15, 90, { category: 'email', result: 'success' });
    const { signals } = await computeTransparency(events);
    // authEvents=0 → failurePenalty=1, hasAuth=0.5
    // authHygiene = weightedMean([[1, 0.6], [0.5, 0.4]]) = 0.6 + 0.2 = 0.8
    expect(signals.auth_hygiene).toBeCloseTo(0.8, 5);
  });

  test('telemetry_reporting is neutral 0.5 in Phase 1', async () => {
    const { signals } = await computeTransparency(makeChainedEventsOverDays(10, 90));
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

// ─── verifyChainIntegrity ─────────────────────────────────────────────────────

describe('verifyChainIntegrity', () => {
  test('empty array → 1.0 (no links to check)', async () => {
    expect(await verifyChainIntegrity([])).toBe(1.0);
  });

  test('single event → 1.0 (no predecessor link to verify)', async () => {
    const evt = makeEvent({ id: 'solo', prev_hash: '' });
    expect(await verifyChainIntegrity([evt])).toBe(1.0);
  });

  test('properly chained events (SHA-256) → 1.0', async () => {
    const a = makeEvent({ id: 'a', prev_hash: '0'.repeat(64) });
    const b = makeEvent({ id: 'b', prev_hash: canonicalHash(a) });
    const c = makeEvent({ id: 'c', prev_hash: canonicalHash(b) });
    expect(await verifyChainIntegrity([a, b, c])).toBe(1.0);
  });

  test('all links broken → 0.0', async () => {
    const a = makeEvent({ id: 'a', prev_hash: '0'.repeat(64) });
    const b = makeEvent({ id: 'b', prev_hash: 'WRONG' });
    const c = makeEvent({ id: 'c', prev_hash: 'WRONG' });
    // 0 valid of 2 links → 0.0
    expect(await verifyChainIntegrity([a, b, c])).toBe(0.0);
  });

  test('one valid link and one broken → 0.5', async () => {
    const a = makeEvent({ id: 'a', prev_hash: '0'.repeat(64) });
    const b = makeEvent({ id: 'b', prev_hash: canonicalHash(a) }); // OK
    const c = makeEvent({ id: 'c', prev_hash: 'WRONG' });  // broken
    // 1 valid of 2 links → 0.5
    expect(await verifyChainIntegrity([a, b, c])).toBe(0.5);
  });

  test('truthy-but-wrong prev_hash fails (fixes C1)', async () => {
    // The prev_hash must be the exact SHA-256 of the previous entry's JSON.
    const a = makeEvent({ id: 'evt-id-1', prev_hash: '0'.repeat(64) });
    const b = makeEvent({ id: 'evt-id-2', prev_hash: 'a'.repeat(64) }); // truthy but wrong hash
    // 0 valid of 1 link → 0.0
    expect(await verifyChainIntegrity([a, b])).toBe(0.0);
  });
});

// ─── applyEntropyPenalty ──────────────────────────────────────────────────────

describe('applyEntropyPenalty', () => {
  test('diverse scores → no penalty (multiplier = 1.0)', () => {
    const result = applyEntropyPenalty(0.70, { consistency: 0.80, restraint: 0.55, transparency: 0.65 });
    expect(result).toBeCloseTo(0.70, 10);
  });

  test('all dimensions > 0.95 → multiplied by 0.85 (C2 "perfect robot")', () => {
    const rawScore = 0.97;
    const result = applyEntropyPenalty(rawScore, { consistency: 0.96, restraint: 0.97, transparency: 0.98 });
    expect(result).toBeCloseTo(rawScore * 0.85, 10);
  });

  test('perfect score (1.0) with all dimensions > 0.95 → capped near 85%', () => {
    const result = applyEntropyPenalty(1.0, { consistency: 1.0, restraint: 1.0, transparency: 1.0 });
    expect(result).toBeCloseTo(0.85, 10);
  });

  test('suspiciously uniform (all equal, not all perfect) → multiplied by 0.90', () => {
    // All at 0.5 → mean=0.5, variance=0 < 0.005 → penalty
    const rawScore = 0.5;
    const result = applyEntropyPenalty(rawScore, { consistency: 0.5, restraint: 0.5, transparency: 0.5 });
    expect(result).toBeCloseTo(rawScore * 0.90, 10);
  });

  test('moderate variance → no penalty', () => {
    // {0.8, 0.5, 0.65} → mean=0.65, variance=((0.15²+0.15²+0²)/3)=0.015 > 0.005
    const result = applyEntropyPenalty(0.65, { consistency: 0.80, restraint: 0.50, transparency: 0.65 });
    expect(result).toBeCloseTo(0.65, 10);
  });

  test('allPerfect check takes priority over variance check', () => {
    // All at 0.96: allPerfect = true (checked first), variance = 0 (also low)
    const rawScore = 0.96;
    const result = applyEntropyPenalty(rawScore, { consistency: 0.96, restraint: 0.96, transparency: 0.96 });
    expect(result).toBeCloseTo(rawScore * 0.85, 10); // allPerfect penalty, not variance
  });

  test('penalty is proportional — smaller raw score → smaller absolute penalty', () => {
    const high = applyEntropyPenalty(0.98, { consistency: 0.97, restraint: 0.96, transparency: 0.98 });
    const low  = applyEntropyPenalty(0.60, { consistency: 0.60, restraint: 0.60, transparency: 0.60 });
    // high uses allPerfect penalty, low uses variance penalty
    expect(high).toBeLessThan(0.98);
    expect(low).toBeLessThan(0.60);
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
