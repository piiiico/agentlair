/**
 * Trust Engine — Tier Gates Unit Tests
 *
 * Tests for the four tier-based gates introduced in trust-engine-tier-gates-spec.md:
 *
 *   Gate A — TIER_WEIGHT_MULTIPLIER:   scales effective observation count
 *   Gate B — TIER_ATF_CAP / capTrustLevel: ceiling on achievable ATF level
 *   Gate C — TIER_EVENT_WINDOW_DAYS:   tier-aware behavioral_events query window
 *   Gate D — TIER_TELEMETRY_CEILING:   caps telemetry_reporting signal
 *
 * Also tests:
 *   - AccountTier type export
 *   - resolveAccountTier() legacy migration
 *   - enterprise tier support across all constants
 *   - tierCap field in TrustProfile (simulated via capTrustLevel)
 *   - telemetry_reporting_raw in computeTransparency signals
 */

import { describe, test, expect } from 'bun:test';
import { createHash } from 'crypto';
import type { AuditEvent, EventMixMetrics } from './trust-engine';
import {
  // Types
  TIER_WEIGHT_MULTIPLIER,
  TIER_LEVEL_CAP,
  TIER_TELEMETRY_CEILING,
  TIER_EVENT_WINDOW_DAYS,
  // Gate B
  capTrustLevel,
  // Gate A
  computeEffectiveObservations,
  // Gate D
  computeTelemetryReporting,
  // Transparency
  computeTransparency,
} from './trust-engine';
import { resolveAccountTier } from './types';
import type { Account } from './types';

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

let counter = 0;

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `evt-tg-${++counter}`,
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
    const id = `int-${++counter}`;
    const offsetMs = (i / Math.max(count - 1, 1)) * windowMs;
    const ts = new Date(now - windowMs + offsetMs).toISOString();
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
  signed = true,
): AuditEvent[] {
  const now = Date.now();
  const windowMs = days * 86_400_000;
  return Array.from({ length: count }, (_, i) => {
    const offsetMs = count > 1 ? (i / (count - 1)) * windowMs : 0;
    const ts = new Date(now - windowMs + offsetMs).toISOString();
    return makeEvent({
      timestamp: ts,
      category: 'tool',
      action: 'tool.invoke',
      result: 'success',
      prev_hash: '',
      signature: '',
      _source: signed ? 'external_signed' : 'external_unsigned',
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

// ─── resolveAccountTier (types.ts) ───────────────────────────────────────────

describe('resolveAccountTier', () => {
  const base = { id: 'acc_test' } as Account;

  test('maps legacy "paid" to "starter"', () => {
    expect(resolveAccountTier({ ...base, tier: 'paid' })).toBe('starter');
  });

  test('maps undefined to "free"', () => {
    expect(resolveAccountTier({ ...base })).toBe('free');
  });

  test('maps plan "pro" to "pro"', () => {
    expect(resolveAccountTier({ ...base, plan: 'pro' })).toBe('pro');
  });

  test('maps tier "enterprise" to "enterprise"', () => {
    expect(resolveAccountTier({ ...base, tier: 'enterprise' })).toBe('enterprise');
  });

  test('maps tier "starter" to "starter"', () => {
    expect(resolveAccountTier({ ...base, tier: 'starter' })).toBe('starter');
  });

  test('tier field takes precedence over plan', () => {
    // tier is checked first in the resolveAccountTier logic
    expect(resolveAccountTier({ ...base, tier: 'pro', plan: 'starter' })).toBe('pro');
  });

  test('unknown tier string falls back to "free"', () => {
    expect(resolveAccountTier({ ...base, tier: 'unknown_plan' })).toBe('free');
  });
});

// ─── TIER_EVENT_WINDOW_DAYS (Gate C) ─────────────────────────────────────────

describe('TIER_EVENT_WINDOW_DAYS (Gate C)', () => {
  test('free tier gets 7-day window', () => {
    expect(TIER_EVENT_WINDOW_DAYS.free).toBe(7);
  });

  test('starter tier gets 30-day window', () => {
    expect(TIER_EVENT_WINDOW_DAYS.starter).toBe(30);
  });

  test('pro tier gets 90-day window', () => {
    expect(TIER_EVENT_WINDOW_DAYS.pro).toBe(90);
  });

  test('enterprise tier gets 365-day window', () => {
    expect(TIER_EVENT_WINDOW_DAYS.enterprise).toBe(365);
  });

  test('windows are monotonically increasing with tier', () => {
    expect(TIER_EVENT_WINDOW_DAYS.starter).toBeGreaterThan(TIER_EVENT_WINDOW_DAYS.free);
    expect(TIER_EVENT_WINDOW_DAYS.pro).toBeGreaterThan(TIER_EVENT_WINDOW_DAYS.starter);
    expect(TIER_EVENT_WINDOW_DAYS.enterprise).toBeGreaterThan(TIER_EVENT_WINDOW_DAYS.pro);
  });
});

// ─── enterprise tier in existing constants ────────────────────────────────────

describe('enterprise tier in tier constants', () => {
  test('TIER_WEIGHT_MULTIPLIER includes enterprise at 1.0', () => {
    expect(TIER_WEIGHT_MULTIPLIER.enterprise).toBe(1.0);
  });

  test('TIER_LEVEL_CAP includes enterprise at principal', () => {
    expect(TIER_LEVEL_CAP.enterprise).toBe('principal');
  });

  test('TIER_TELEMETRY_CEILING includes enterprise at 1.0', () => {
    expect(TIER_TELEMETRY_CEILING.enterprise).toBe(1.0);
  });

  test('enterprise tier same as pro for weight/cap/ceiling', () => {
    expect(TIER_WEIGHT_MULTIPLIER.enterprise).toBe(TIER_WEIGHT_MULTIPLIER.pro);
    expect(TIER_LEVEL_CAP.enterprise).toBe(TIER_LEVEL_CAP.pro);
    expect(TIER_TELEMETRY_CEILING.enterprise).toBe(TIER_TELEMETRY_CEILING.pro);
  });
});

// ─── Gate A: Tier Weight Multiplier ──────────────────────────────────────────

describe('Gate A: tier weight multiplier', () => {
  test('free tier halves effective observation count vs starter with identical events', () => {
    const events = makeExternalEvents(100, 30, true);
    const freeObs = computeEffectiveObservations(events, 'free');
    const starterObs = computeEffectiveObservations(events, 'starter');
    // Free: 0.5x → should be notably lower
    expect(freeObs).toBeLessThan(starterObs);
    // Ratio should be approximately 0.5 (before burst cap)
    expect(freeObs / starterObs).toBeCloseTo(0.5, 1);
  });

  test('starter, pro, enterprise produce identical observation counts', () => {
    const events = makeExternalEvents(50, 30, true);
    const starter = computeEffectiveObservations(events, 'starter');
    const pro = computeEffectiveObservations(events, 'pro');
    const enterprise = computeEffectiveObservations(events, 'enterprise');
    expect(starter).toBe(pro);
    expect(pro).toBe(enterprise);
  });

  test('internal events unaffected by tier multiplier', () => {
    const events = makeInternalEvents(50, 30);
    const freeObs = computeEffectiveObservations(events, 'free');
    const proObs = computeEffectiveObservations(events, 'pro');
    // Internal events always weight 1.0 — tier multiplier doesn't apply
    expect(freeObs).toBe(proObs);
  });

  test('free tier: external unsigned events get 0.7 * 0.5 = 0.35 effective weight', () => {
    // 2 unsigned external events on separate days (no burst cap concern)
    const now = Date.now();
    const events = [
      makeEvent({ timestamp: new Date(now - 86_400_000).toISOString(), _source: 'external_unsigned' }),
      makeEvent({ timestamp: new Date(now - 2 * 86_400_000).toISOString(), _source: 'external_unsigned' }),
    ];
    const effective = computeEffectiveObservations(events, 'free');
    // 2 events * 0.7 * 0.5 = 0.70, capped by 2 unique days * 15 = 30 → 0.70
    expect(effective).toBeCloseTo(0.70, 5);
  });

  test('free tier results in lower confidence via cold-start prior', () => {
    // Free tier with fewer effective observations means cold-start dominates longer.
    // Verify that effective obs are lower for free tier (confidence derived from effectiveObs)
    const events = makeExternalEvents(80, 30, true);
    const freeObs = computeEffectiveObservations(events, 'free');
    const proObs = computeEffectiveObservations(events, 'pro');
    expect(freeObs).toBeLessThan(proObs);
  });
});

// ─── Gate B: capTrustLevel ───────────────────────────────────────────────────

describe('Gate B: capTrustLevel', () => {
  test('free tier caps senior → junior', () => {
    expect(capTrustLevel('senior', 'free')).toBe('junior');
  });

  test('free tier caps principal → junior', () => {
    expect(capTrustLevel('principal', 'free')).toBe('junior');
  });

  test('free tier passes through intern', () => {
    expect(capTrustLevel('intern', 'free')).toBe('intern');
  });

  test('free tier passes through junior (at cap)', () => {
    expect(capTrustLevel('junior', 'free')).toBe('junior');
  });

  test('starter tier caps principal → senior', () => {
    expect(capTrustLevel('principal', 'starter')).toBe('senior');
  });

  test('starter tier passes through senior (at cap)', () => {
    expect(capTrustLevel('senior', 'starter')).toBe('senior');
  });

  test('starter tier passes through junior', () => {
    expect(capTrustLevel('junior', 'starter')).toBe('junior');
  });

  test('pro tier allows principal', () => {
    expect(capTrustLevel('principal', 'pro')).toBe('principal');
  });

  test('enterprise tier allows principal', () => {
    expect(capTrustLevel('principal', 'enterprise')).toBe('principal');
  });

  test('all levels pass through on pro and enterprise', () => {
    const levels = ['intern', 'junior', 'senior', 'principal'] as const;
    for (const level of levels) {
      expect(capTrustLevel(level, 'pro')).toBe(level);
      expect(capTrustLevel(level, 'enterprise')).toBe(level);
    }
  });

  test('capTrustLevel is idempotent when level is below cap', () => {
    // intern is below all caps
    expect(capTrustLevel('intern', 'free')).toBe('intern');
    expect(capTrustLevel('intern', 'starter')).toBe('intern');
  });
});

// ─── Gate D: Telemetry Reporting Ceiling ─────────────────────────────────────

describe('Gate D: TIER_TELEMETRY_CEILING via computeTelemetryReporting', () => {
  test('free tier caps telemetry_reporting at 0.60 with full reporting', () => {
    const metrics = makeMetrics({ externalUniqueDays: 90, totalActiveDays: 90 });
    const signal = computeTelemetryReporting(metrics, 'free');
    // Full reporting → raw=1.0, but free ceiling = 0.60
    expect(signal).toBeCloseTo(0.60, 2);
  });

  test('starter tier caps at 0.85 with full reporting', () => {
    const metrics = makeMetrics({ externalUniqueDays: 90, totalActiveDays: 90 });
    const signal = computeTelemetryReporting(metrics, 'starter');
    expect(signal).toBeCloseTo(0.85, 2);
  });

  test('pro tier allows full 1.0 with full reporting', () => {
    const metrics = makeMetrics({ externalUniqueDays: 90, totalActiveDays: 90 });
    const signal = computeTelemetryReporting(metrics, 'pro');
    expect(signal).toBeCloseTo(1.0, 2);
  });

  test('enterprise tier allows full 1.0 with full reporting', () => {
    const metrics = makeMetrics({ externalUniqueDays: 90, totalActiveDays: 90 });
    const signal = computeTelemetryReporting(metrics, 'enterprise');
    expect(signal).toBeCloseTo(1.0, 2);
  });

  test('no external events → neutral 0.5 regardless of tier', () => {
    const metrics = makeMetrics({ externalCount: 0, externalUniqueDays: 0 });
    expect(computeTelemetryReporting(metrics, 'free')).toBe(0.5);
    expect(computeTelemetryReporting(metrics, 'starter')).toBe(0.5);
    expect(computeTelemetryReporting(metrics, 'pro')).toBe(0.5);
    expect(computeTelemetryReporting(metrics, 'enterprise')).toBe(0.5);
  });

  test('sparse reporting on free tier stays between 0.5 and 0.60', () => {
    // computeTelemetryReporting uses range mapping: 0.5 + ratio*(ceiling - 0.5)
    // 3 of 30 days → ratio=0.1 → free: 0.5 + 0.1*0.10 = 0.51, pro: 0.5 + 0.1*0.50 = 0.55
    const metrics = makeMetrics({ externalUniqueDays: 3, totalActiveDays: 30 });
    const freeTier = computeTelemetryReporting(metrics, 'free');
    expect(freeTier).toBeGreaterThanOrEqual(0.5);
    expect(freeTier).toBeLessThanOrEqual(0.60);
    // Pro tier is higher for same events (larger range scale)
    const proTier = computeTelemetryReporting(metrics, 'pro');
    expect(proTier).toBeGreaterThan(freeTier);
  });
});

// ─── telemetry_reporting_raw in computeTransparency ──────────────────────────

describe('telemetry_reporting_raw signal in computeTransparency', () => {
  test('telemetry_reporting_raw absent when no cap applied (capped = raw)', async () => {
    // Pass same signal for both capped and raw — no diff → no raw field
    const events = makeInternalEvents(20, 90);
    const { signals } = await computeTransparency(events, 0.75, undefined);
    expect(signals.telemetry_reporting).toBe(0.75);
    expect(signals.telemetry_reporting_raw).toBeUndefined();
  });

  test('telemetry_reporting_raw present when cap reduces signal', async () => {
    const events = makeInternalEvents(20, 90);
    // Pass capped=0.60, raw=0.85 (simulating free tier with high reporting)
    const { signals } = await computeTransparency(events, 0.60, 0.85);
    expect(signals.telemetry_reporting).toBe(0.60);
    expect(signals.telemetry_reporting_raw).toBe(0.85);
  });

  test('telemetry_reporting_raw absent when capped equals raw', async () => {
    const events = makeInternalEvents(20, 90);
    const { signals } = await computeTransparency(events, 0.75, 0.75);
    expect(signals.telemetry_reporting).toBe(0.75);
    expect(signals.telemetry_reporting_raw).toBeUndefined();
  });

  test('score uses capped telemetry value (not raw) in weighted mean', async () => {
    const events = makeInternalEvents(20, 90);
    const { score: cappedScore } = await computeTransparency(events, 0.60, 0.85);  // uses 0.60
    const { score: uncappedScore } = await computeTransparency(events, 0.85, 0.85); // uses 0.85
    // Higher telemetry signal → higher score
    expect(uncappedScore).toBeGreaterThan(cappedScore);
  });
});

// ─── Integration: tierCap simulated via capTrustLevel ────────────────────────

describe('tierCap upgrade nudge simulation', () => {
  test('free tier agent with high behavioral score would show tierCap', () => {
    // Simulate what computeTrustScore does for Gate B
    const rawLevel = 'senior';  // agent would be senior without cap
    const cappedLevel = capTrustLevel(rawLevel, 'free');
    const tierCapWouldExist = rawLevel !== cappedLevel;

    expect(cappedLevel).toBe('junior');
    expect(tierCapWouldExist).toBe(true);
  });

  test('free tier agent already at junior → no tierCap needed', () => {
    const rawLevel = 'junior';  // agent scores at junior anyway
    const cappedLevel = capTrustLevel(rawLevel, 'free');
    const tierCapWouldExist = rawLevel !== cappedLevel;

    expect(cappedLevel).toBe('junior');
    expect(tierCapWouldExist).toBe(false);
  });

  test('pro tier agent at principal → no tierCap', () => {
    const rawLevel = 'principal';
    const cappedLevel = capTrustLevel(rawLevel, 'pro');
    expect(rawLevel !== cappedLevel).toBe(false);
  });

  test('starter tier agent at principal → tierCap applied (shows senior as cap)', () => {
    const rawLevel = 'principal';
    const cappedLevel = capTrustLevel(rawLevel, 'starter');
    const tierCapWouldExist = rawLevel !== cappedLevel;

    expect(cappedLevel).toBe('senior');
    expect(tierCapWouldExist).toBe(true);
  });
});

// ─── Integration: enterprise tier full-stack verification ────────────────────

describe('enterprise tier integration', () => {
  test('enterprise observations weighted same as pro (1.0x)', () => {
    const events = [...makeInternalEvents(10, 30), ...makeExternalEvents(30, 30, true)];
    const proObs = computeEffectiveObservations(events, 'pro');
    const entObs = computeEffectiveObservations(events, 'enterprise');
    expect(entObs).toBe(proObs);
  });

  test('enterprise telemetry reaches 1.0 ceiling', () => {
    const metrics = makeMetrics({ externalUniqueDays: 30, totalActiveDays: 30 });
    expect(computeTelemetryReporting(metrics, 'enterprise')).toBeCloseTo(1.0, 2);
  });

  test('enterprise capTrustLevel passes principal through', () => {
    expect(capTrustLevel('principal', 'enterprise')).toBe('principal');
    expect(capTrustLevel('senior', 'enterprise')).toBe('senior');
    expect(capTrustLevel('junior', 'enterprise')).toBe('junior');
    expect(capTrustLevel('intern', 'enterprise')).toBe('intern');
  });

  test('enterprise window is largest in TIER_EVENT_WINDOW_DAYS', () => {
    const windows = Object.values(TIER_EVENT_WINDOW_DAYS);
    expect(TIER_EVENT_WINDOW_DAYS.enterprise).toBe(Math.max(...windows));
  });
});
