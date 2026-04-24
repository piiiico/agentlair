/**
 * AgentLair Trust Engine — Phase 2b Tests
 *
 * Tests for behavioral event integration:
 * - computeTelemetryReporting (live signal)
 * - computeEffectiveObservations (weighted observations)
 * - applyLevelCaps (tier + ratio gates)
 * - detectSelectiveReporting (manipulation resistance)
 * - computeTransparency with telemetry signal
 * - Combined event path integration
 */

import { describe, test, expect } from 'bun:test';
import { createHash } from 'crypto';
import type { AuditEvent, EventMixMetrics, TrustTier } from './trust-engine';
import {
  computeTelemetryReporting,
  computeEffectiveObservations,
  applyLevelCaps,
  detectSelectiveReporting,
  computeTransparency,
  EVENT_WEIGHTS,
  TIER_WEIGHT_MULTIPLIER,
  TIER_LEVEL_CAP,
  TIER_TELEMETRY_CEILING,
  LEVEL_REQUIREMENTS,
} from './trust-engine';

/** Sync SHA-256 for test helpers (Bun/Node only) */
function sha256hexSync(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Canonical entry representation for hash chain computation.
 * Must match the key order used by audit middleware and verifyChainIntegrity.
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

let eventCounter = 0;

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `evt-p2b-${++eventCounter}`,
    timestamp: new Date().toISOString(),
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
    prev_hash: '',
    signature: '',
    _source: 'internal',
    ...overrides,
  };
}

function makeInternalEvents(count: number, days: number): AuditEvent[] {
  const now = Date.now();
  const windowMs = days * 86_400_000;
  const events: AuditEvent[] = [];
  for (let i = 0; i < count; i++) {
    const id = `internal-${++eventCounter}`;
    const offsetMs = (i / Math.max(count - 1, 1)) * windowMs;
    const ts = new Date(now - windowMs + offsetMs).toISOString();
    // Compute proper SHA-256 prev_hash (same as audit middleware)
    const prev_hash = i === 0 ? '0'.repeat(64) : canonicalHash(events[i - 1]);
    events.push({
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
      _source: 'internal',
    });
  }
  return events;
}

function makeExternalEvents(
  count: number,
  days: number,
  options: { signed?: boolean; category?: string; result?: string } = {},
): AuditEvent[] {
  const now = Date.now();
  const windowMs = days * 86_400_000;
  return Array.from({ length: count }, (_, i) => {
    const offsetMs = (i / Math.max(count - 1, 1)) * windowMs;
    const ts = new Date(now - windowMs + offsetMs).toISOString();
    return makeEvent({
      timestamp: ts,
      category: options.category ?? 'tool',
      action: 'tool.invoke',
      result: options.result ?? 'success',
      prev_hash: '',
      signature: '',
      _source: options.signed !== false ? 'external_signed' : 'external_unsigned',
    });
  });
}

function makeMetrics(overrides: Partial<EventMixMetrics> = {}): EventMixMetrics {
  return {
    internalCount: 20,
    externalCount: 50,
    externalSignedCount: 40,
    externalUnsignedCount: 10,
    externalUniqueDays: 14,
    externalCategories: new Set(['tool', 'resource']),
    totalActiveDays: 30,
    ...overrides,
  };
}

// ─── EVENT_WEIGHTS constants ─────────────────────────────────────────────────��──

describe('EVENT_WEIGHTS constants', () => {
  test('internal weight is 1.0', () => {
    expect(EVENT_WEIGHTS.internal).toBe(1.0);
  });

  test('external_signed weight is 0.85', () => {
    expect(EVENT_WEIGHTS.external_signed).toBe(0.85);
  });

  test('external_unsigned weight is 0.7', () => {
    expect(EVENT_WEIGHTS.external_unsigned).toBe(0.7);
  });

  test('internal > signed > unsigned (trust hierarchy)', () => {
    expect(EVENT_WEIGHTS.internal).toBeGreaterThan(EVENT_WEIGHTS.external_signed);
    expect(EVENT_WEIGHTS.external_signed).toBeGreaterThan(EVENT_WEIGHTS.external_unsigned);
  });
});

// ─── TIER_WEIGHT_MULTIPLIER constants ────────────────────────────────────────────

describe('TIER_WEIGHT_MULTIPLIER constants', () => {
  test('free tier gets 0.5x weight', () => {
    expect(TIER_WEIGHT_MULTIPLIER.free).toBe(0.5);
  });

  test('starter tier gets 1.0x weight', () => {
    expect(TIER_WEIGHT_MULTIPLIER.starter).toBe(1.0);
  });

  test('pro tier gets 1.0x weight', () => {
    expect(TIER_WEIGHT_MULTIPLIER.pro).toBe(1.0);
  });
});

// ─── TIER_LEVEL_CAP constants ────────────────────────────────────────────────────

describe('TIER_LEVEL_CAP constants', () => {
  test('free tier capped at junior', () => {
    expect(TIER_LEVEL_CAP.free).toBe('junior');
  });

  test('starter tier capped at senior', () => {
    expect(TIER_LEVEL_CAP.starter).toBe('senior');
  });

  test('pro tier can reach principal', () => {
    expect(TIER_LEVEL_CAP.pro).toBe('principal');
  });
});

// ─── TIER_TELEMETRY_CEILING constants ────────────────────────────────────────────

describe('TIER_TELEMETRY_CEILING constants', () => {
  test('free tier ceiling is 0.60', () => {
    expect(TIER_TELEMETRY_CEILING.free).toBe(0.60);
  });

  test('starter tier ceiling is 0.85', () => {
    expect(TIER_TELEMETRY_CEILING.starter).toBe(0.85);
  });

  test('pro tier ceiling is 1.0', () => {
    expect(TIER_TELEMETRY_CEILING.pro).toBe(1.0);
  });
});

// ─── computeTelemetryReporting ───────────────────────────────────────────────────

describe('computeTelemetryReporting', () => {
  test('no external events → neutral 0.5 (backward compatible)', () => {
    const metrics = makeMetrics({ externalCount: 0, externalUniqueDays: 0 });
    expect(computeTelemetryReporting(metrics, 'free')).toBe(0.5);
    expect(computeTelemetryReporting(metrics, 'pro')).toBe(0.5);
  });

  test('external events present → signal above 0.5 (positive contribution)', () => {
    const metrics = makeMetrics({ externalCount: 100, externalUniqueDays: 10, totalActiveDays: 30 });
    const signal = computeTelemetryReporting(metrics, 'pro');
    // 0.5 + (10/30) * (1.0 - 0.5) = 0.5 + 0.167 = 0.667
    expect(signal).toBeGreaterThan(0.5);
    expect(signal).toBeCloseTo(0.667, 1);
  });

  test('daily reporting for full window → signal reaches ceiling', () => {
    const metrics = makeMetrics({ externalCount: 2700, externalUniqueDays: 90, totalActiveDays: 90 });
    const signal = computeTelemetryReporting(metrics, 'pro');
    // pro ceiling = 1.0; 0.5 + 1.0 * (1.0 - 0.5) = 1.0
    expect(signal).toBeCloseTo(1.0, 1);
  });

  test('free tier: full reporting reaches free ceiling (0.60)', () => {
    const metrics = makeMetrics({ externalCount: 2700, externalUniqueDays: 90, totalActiveDays: 90 });
    const signal = computeTelemetryReporting(metrics, 'free');
    // free ceiling = 0.60; 0.5 + 1.0 * (0.60 - 0.5) = 0.60
    expect(signal).toBeCloseTo(0.60, 2);
  });

  test('starter tier: full reporting reaches starter ceiling (0.85)', () => {
    const metrics = makeMetrics({ externalCount: 2700, externalUniqueDays: 90, totalActiveDays: 90 });
    const signal = computeTelemetryReporting(metrics, 'starter');
    // starter ceiling = 0.85; 0.5 + 1.0 * (0.85 - 0.5) = 0.85
    expect(signal).toBeCloseTo(0.85, 2);
  });

  test('signal never goes below 0.5 (backward compatible, RFC-003 §9.3)', () => {
    const metrics = makeMetrics({ externalCount: 1, externalUniqueDays: 1, totalActiveDays: 90 });
    const signal = computeTelemetryReporting(metrics, 'free');
    expect(signal).toBeGreaterThanOrEqual(0.5);
  });

  test('sparse reporting → proportionally between 0.5 and ceiling', () => {
    // Only 3 days of reporting over 30 active days on pro tier
    const metrics = makeMetrics({ externalCount: 30, externalUniqueDays: 3, totalActiveDays: 30 });
    const signal = computeTelemetryReporting(metrics, 'pro');
    // 0.5 + (3/30) * (1.0 - 0.5) = 0.5 + 0.05 = 0.55
    expect(signal).toBeCloseTo(0.55, 2);
  });
});

// ─── computeEffectiveObservations ────────────────────────────────────────────────

describe('computeEffectiveObservations', () => {
  test('all internal events → full count (up to burst cap)', () => {
    const events = makeInternalEvents(100, 30);
    const effective = computeEffectiveObservations(events, 'pro');
    // 100 events, but burst cap = unique_days * 15
    const uniqueDays = new Set(events.map(e => e.timestamp.slice(0, 10))).size;
    expect(effective).toBeLessThanOrEqual(uniqueDays * 15);
    expect(effective).toBeGreaterThan(0);
  });

  test('external signed events on pro tier → 0.85x weight', () => {
    const events = makeExternalEvents(100, 30, { signed: true });
    const effective = computeEffectiveObservations(events, 'pro');
    // Expected: 100 * 0.85 * 1.0 = 85 (but capped by unique_days * 15)
    const uniqueDays = new Set(events.map(e => e.timestamp.slice(0, 10))).size;
    const expectedRaw = 100 * 0.85 * 1.0;
    expect(effective).toBeLessThanOrEqual(uniqueDays * 15);
    expect(effective).toBeLessThanOrEqual(expectedRaw);
  });

  test('external unsigned events on free tier → 0.7 * 0.5 = 0.35x weight', () => {
    const events = makeExternalEvents(100, 30, { signed: false });
    const effective = computeEffectiveObservations(events, 'free');
    // 100 * 0.7 * 0.5 = 35, subject to burst cap
    const uniqueDays = new Set(events.map(e => e.timestamp.slice(0, 10))).size;
    const maxExpected = Math.min(100 * 0.7 * 0.5, uniqueDays * 15);
    expect(effective).toBeLessThanOrEqual(maxExpected + 1); // +1 for rounding
  });

  test('free tier external events worth less than starter/pro', () => {
    const events = makeExternalEvents(50, 30, { signed: true });
    const freeTier = computeEffectiveObservations(events, 'free');
    const proTier = computeEffectiveObservations(events, 'pro');
    expect(freeTier).toBeLessThan(proTier);
  });

  test('mixed internal + external events compute correct weighted sum', () => {
    const internal = makeInternalEvents(10, 30);
    const external = makeExternalEvents(10, 30, { signed: true });
    const combined = [...internal, ...external];
    const effective = computeEffectiveObservations(combined, 'pro');
    // 10*1.0 + 10*0.85*1.0 = 18.5, subject to burst cap
    expect(effective).toBeGreaterThan(0);
    expect(effective).toBeLessThanOrEqual(18.5);
  });

  test('all events on same day → burst capped to 15', () => {
    // 100 events all on the same timestamp (same day)
    const now = new Date().toISOString();
    const events = Array.from({ length: 100 }, () =>
      makeEvent({ timestamp: now, _source: 'internal' }),
    );
    const effective = computeEffectiveObservations(events, 'pro');
    expect(effective).toBeLessThanOrEqual(15);
  });
});

// ─── applyLevelCaps ──────────────────────────────────────────────────────────────

describe('applyLevelCaps', () => {
  test('free tier caps computed principal to junior', () => {
    const metrics = makeMetrics({ internalCount: 100, externalUniqueDays: 30 });
    const capped = applyLevelCaps('principal', metrics, 'free');
    expect(capped).toBe('junior');
  });

  test('free tier caps computed senior to junior', () => {
    const metrics = makeMetrics({ internalCount: 50, externalUniqueDays: 14 });
    const capped = applyLevelCaps('senior', metrics, 'free');
    expect(capped).toBe('junior');
  });

  test('starter tier caps computed principal to senior', () => {
    const metrics = makeMetrics({ internalCount: 100, externalUniqueDays: 30 });
    const capped = applyLevelCaps('principal', metrics, 'starter');
    expect(capped).toBe('senior');
  });

  test('pro tier allows principal', () => {
    const metrics = makeMetrics({
      internalCount: 50,
      externalUniqueDays: 14,
      externalCategories: new Set(['tool', 'resource', 'session']),
    });
    const capped = applyLevelCaps('principal', metrics, 'pro');
    expect(capped).toBe('principal');
  });

  test('insufficient internal events caps senior to junior', () => {
    // senior requires 10 internal, but only have 5
    const metrics = makeMetrics({
      internalCount: 5,
      externalUniqueDays: 14,
      externalCategories: new Set(['tool', 'resource']),
    });
    const capped = applyLevelCaps('senior', metrics, 'pro');
    expect(capped).toBe('junior');
  });

  test('insufficient external days caps principal to senior', () => {
    // principal requires 14 external days, but only have 10
    const metrics = makeMetrics({
      internalCount: 50,
      externalUniqueDays: 10,
      externalCategories: new Set(['tool', 'resource', 'session']),
    });
    const capped = applyLevelCaps('principal', metrics, 'pro');
    expect(capped).toBe('senior');
  });

  test('insufficient categories caps senior to junior', () => {
    // senior requires 2 categories, but only have 1
    const metrics = makeMetrics({
      internalCount: 20,
      externalUniqueDays: 14,
      externalCategories: new Set(['tool']),
    });
    const capped = applyLevelCaps('senior', metrics, 'pro');
    expect(capped).toBe('junior');
  });

  test('intern always passes (no requirements)', () => {
    const metrics = makeMetrics({
      internalCount: 0,
      externalCount: 0,
      externalUniqueDays: 0,
      externalCategories: new Set(),
    });
    const capped = applyLevelCaps('intern', metrics, 'free');
    expect(capped).toBe('intern');
  });

  test('junior with 0 internal and 0 external days → passes (no ratio req for junior)', () => {
    const metrics = makeMetrics({
      internalCount: 0,
      externalUniqueDays: 0,
      externalCategories: new Set(['tool']),
    });
    const capped = applyLevelCaps('junior', metrics, 'pro');
    expect(capped).toBe('junior');
  });

  test('principal requires all three conditions met', () => {
    // Missing one condition at a time
    const basePrincipal = {
      internalCount: 50,
      externalUniqueDays: 14,
      externalCategories: new Set(['tool', 'resource', 'session']),
    };

    // All met → principal
    expect(applyLevelCaps('principal', makeMetrics(basePrincipal), 'pro')).toBe('principal');

    // Missing internal → drops
    expect(applyLevelCaps('principal', makeMetrics({ ...basePrincipal, internalCount: 40 }), 'pro')).not.toBe('principal');

    // Missing days → drops
    expect(applyLevelCaps('principal', makeMetrics({ ...basePrincipal, externalUniqueDays: 13 }), 'pro')).not.toBe('principal');

    // Missing categories → drops
    expect(applyLevelCaps('principal', makeMetrics({ ...basePrincipal, externalCategories: new Set(['tool', 'resource']) }), 'pro')).not.toBe('principal');
  });
});

// ─── detectSelectiveReporting ────────────────────────────────────────────────────

describe('detectSelectiveReporting', () => {
  test('no external events → no penalty (1.0)', () => {
    const events = makeInternalEvents(200, 30);
    expect(detectSelectiveReporting(events)).toBe(1.0);
  });

  test('< 100 external events → no penalty (insufficient data)', () => {
    const events = makeExternalEvents(90, 30, { signed: true });
    expect(detectSelectiveReporting(events)).toBe(1.0);
  });

  test('normal failure rate (5%) → no penalty', () => {
    const successes = makeExternalEvents(95, 30, { signed: true, result: 'success' });
    const failures = makeExternalEvents(5, 30, { signed: true, result: 'failure' });
    const all = [...successes, ...failures];
    expect(detectSelectiveReporting(all)).toBe(1.0);
  });

  test('suspiciously low failure rate (< 1% with 200+ events) → 0.9 penalty', () => {
    const successes = makeExternalEvents(200, 30, { signed: true, result: 'success' });
    // No failures at all
    expect(detectSelectiveReporting(successes)).toBe(0.9);
  });

  test('exactly 1% failure rate → no penalty (boundary)', () => {
    const successes = makeExternalEvents(99, 30, { signed: true, result: 'success' });
    const failures = makeExternalEvents(2, 30, { signed: true, result: 'failure' });
    const all = [...successes, ...failures]; // 101 events, 2 failures = ~2% > 1%
    expect(detectSelectiveReporting(all)).toBe(1.0);
  });
});

// ─── computeTransparency with telemetry signal ──────────────────────────────────

describe('computeTransparency (Phase 2b telemetry integration)', () => {
  test('telemetrySignal passed → used instead of 0.5 default', async () => {
    const events = makeInternalEvents(20, 90);
    const { signals: defaultSignals } = await computeTransparency(events);
    const { signals: customSignals } = await computeTransparency(events, 0.8);

    expect(defaultSignals.telemetry_reporting).toBe(0.5);
    expect(customSignals.telemetry_reporting).toBe(0.8);
  });

  test('higher telemetry signal → higher transparency score', async () => {
    const events = makeInternalEvents(20, 90);
    const { score: lowTelemetry } = await computeTransparency(events, 0.3);
    const { score: highTelemetry } = await computeTransparency(events, 0.9);

    expect(highTelemetry).toBeGreaterThan(lowTelemetry);
  });

  test('external events improve audit_coverage via category diversity', async () => {
    const internal = makeInternalEvents(15, 90);
    const external = makeExternalEvents(15, 90, { category: 'tool', signed: true });
    const combined = [...internal, ...external];

    const { signals: internalOnly } = await computeTransparency(internal);
    const { signals: withExternal } = await computeTransparency(combined);

    // Combined has more events + more category diversity
    expect(withExternal.audit_coverage).toBeGreaterThanOrEqual(internalOnly.audit_coverage);
  });

  test('chain integrity only checks internal events (external have no chains)', async () => {
    // Internal events with proper SHA-256 chain
    const internal = makeInternalEvents(5, 90);
    // External events have empty prev_hash — should NOT break chain integrity
    const external = makeExternalEvents(5, 90, { signed: true });
    const combined = [...internal, ...external];

    const { signals } = await computeTransparency(combined);
    // Chain integrity should be based on internal events only
    expect(signals.chain_integrity).toBe(1.0);
  });

  test('broken internal chain still fails even with valid external events', async () => {
    // Internal events with all broken chain links
    const now = Date.now();
    const brokenInternal = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        id: `broken-${i}`,
        timestamp: new Date(now - (4 - i) * 86_400_000).toISOString(),
        prev_hash: 'WRONG',
        _source: 'internal',
      }),
    );
    const external = makeExternalEvents(10, 90, { signed: true });
    const combined = [...brokenInternal, ...external];

    const { signals } = await computeTransparency(combined);
    expect(signals.chain_integrity).toBe(0);
  });
});

// ─── LEVEL_REQUIREMENTS constants ─────────────────────────────────────────────────

describe('LEVEL_REQUIREMENTS', () => {
  test('intern has no requirements', () => {
    expect(LEVEL_REQUIREMENTS.intern.minInternal).toBe(0);
    expect(LEVEL_REQUIREMENTS.intern.minExternalDays).toBe(0);
    expect(LEVEL_REQUIREMENTS.intern.minCategories).toBe(0);
  });

  test('junior has minimal requirements', () => {
    expect(LEVEL_REQUIREMENTS.junior.minInternal).toBe(0);
    expect(LEVEL_REQUIREMENTS.junior.minExternalDays).toBe(0);
    expect(LEVEL_REQUIREMENTS.junior.minCategories).toBe(1);
  });

  test('senior requires meaningful engagement', () => {
    expect(LEVEL_REQUIREMENTS.senior.minInternal).toBe(10);
    expect(LEVEL_REQUIREMENTS.senior.minExternalDays).toBe(7);
    expect(LEVEL_REQUIREMENTS.senior.minCategories).toBe(2);
  });

  test('principal requires substantial history', () => {
    expect(LEVEL_REQUIREMENTS.principal.minInternal).toBe(50);
    expect(LEVEL_REQUIREMENTS.principal.minExternalDays).toBe(14);
    expect(LEVEL_REQUIREMENTS.principal.minCategories).toBe(3);
  });

  test('requirements are monotonically increasing', () => {
    const levels = ['intern', 'junior', 'senior', 'principal'] as const;
    for (let i = 1; i < levels.length; i++) {
      const prev = LEVEL_REQUIREMENTS[levels[i - 1]];
      const curr = LEVEL_REQUIREMENTS[levels[i]];
      expect(curr.minInternal).toBeGreaterThanOrEqual(prev.minInternal);
      expect(curr.minExternalDays).toBeGreaterThanOrEqual(prev.minExternalDays);
      expect(curr.minCategories).toBeGreaterThanOrEqual(prev.minCategories);
    }
  });
});

// ─── Integration: End-to-end scoring scenarios ──────────────────────────────────

describe('Phase 2b integration scenarios', () => {
  test('agent with only internal events behaves like Phase 1 (backward compatible)', () => {
    const events = makeInternalEvents(50, 90);
    const metrics: EventMixMetrics = {
      internalCount: 50,
      externalCount: 0,
      externalSignedCount: 0,
      externalUnsignedCount: 0,
      externalUniqueDays: 0,
      externalCategories: new Set(),
      totalActiveDays: new Set(events.map(e => e.timestamp.slice(0, 10))).size,
    };

    // Telemetry stays neutral
    expect(computeTelemetryReporting(metrics, 'pro')).toBe(0.5);

    // Effective observations = internal weight (1.0) * count, capped by days*15
    const effective = computeEffectiveObservations(events, 'pro');
    const uniqueDays = new Set(events.map(e => e.timestamp.slice(0, 10))).size;
    expect(effective).toBeLessThanOrEqual(uniqueDays * 15);

    // No selective reporting penalty
    expect(detectSelectiveReporting(events)).toBe(1.0);
  });

  test('free tier agent scenario: limited score impact', () => {
    const internal = makeInternalEvents(5, 30);
    const external = makeExternalEvents(200, 7, { signed: true });
    const combined = [...internal, ...external];
    const metrics: EventMixMetrics = {
      internalCount: 5,
      externalCount: 200,
      externalSignedCount: 200,
      externalUnsignedCount: 0,
      externalUniqueDays: 7,
      externalCategories: new Set(['tool']),
      totalActiveDays: 7,
    };

    // Free tier: telemetry capped at 0.60 (signal maps to [0.5, 0.6])
    const telemetry = computeTelemetryReporting(metrics, 'free');
    expect(telemetry).toBeGreaterThanOrEqual(0.5);
    expect(telemetry).toBeLessThanOrEqual(0.60);

    // Free tier: effective observations much lower
    const effective = computeEffectiveObservations(combined, 'free');
    const proEffective = computeEffectiveObservations(combined, 'pro');
    expect(effective).toBeLessThan(proEffective);

    // Free tier: level capped at junior
    const level = applyLevelCaps('senior', metrics, 'free');
    expect(level).toBe('junior');
  });

  test('pro tier agent with full reporting: can reach principal', () => {
    const metrics: EventMixMetrics = {
      internalCount: 60,
      externalCount: 5000,
      externalSignedCount: 4000,
      externalUnsignedCount: 1000,
      externalUniqueDays: 60,
      externalCategories: new Set(['tool', 'resource', 'session', 'error']),
      totalActiveDays: 90,
    };

    // Pro tier: telemetry signal high
    const telemetry = computeTelemetryReporting(metrics, 'pro');
    expect(telemetry).toBeGreaterThan(0.6);

    // Pro tier: principal achievable
    const level = applyLevelCaps('principal', metrics, 'pro');
    expect(level).toBe('principal');
  });

  test('manipulation: only external events caps at junior (RFC-003 Section 7.3)', () => {
    // Agent that only reports external events, no AgentLair API usage
    const metrics: EventMixMetrics = {
      internalCount: 0,
      externalCount: 10000,
      externalSignedCount: 10000,
      externalUnsignedCount: 0,
      externalUniqueDays: 90,
      externalCategories: new Set(['tool', 'resource', 'session', 'error']),
      totalActiveDays: 90,
    };

    // Even with perfect external reporting, can't exceed junior without internals
    const seniorAttempt = applyLevelCaps('senior', metrics, 'pro');
    expect(seniorAttempt).toBe('junior');
  });
});
