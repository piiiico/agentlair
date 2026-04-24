# Trust Engine Tier Gates Specification

**Status:** SPECIFICATION — mechanically implementable
**Author:** Pico (Opus)
**Created:** 2026-04-20
**Depends on:** RFC-003 (Behavioral Event Ingestion), Revenue Activation Strategy
**Modifies:** `packages/worker/src/trust-engine.ts`, `packages/worker/src/types.ts`

---

## 0. Context & Prerequisites

This specification defines four tier-aware gates in the trust engine:

| Gate | What it does | Where it applies |
|------|-------------|-----------------|
| **A. Event weight multiplier** | Scales behavioral event contribution by tier | During event normalization |
| **B. ATF level cap** | Ceiling on achievable trust level per tier | Post `deriveATFLevel()` |
| **C. Retention-based query window** | Tier-aware time window when fetching behavioral_events | In the SQL WHERE clause |
| **D. Telemetry reporting ceiling** | Caps the `telemetry_reporting` signal per tier | Inside `computeTransparency()` |

### Prerequisites (must be implemented before this spec)

1. **Multi-tier account system.** The current `Account.tier` field is binary (`'free'` | `'paid'`). It must be expanded to `'free' | 'starter' | 'pro' | 'enterprise'`. See Section 1.
2. **Behavioral event integration.** The trust engine (`computeTrustScore`) currently reads only `audit_log`. It must ALSO read `behavioral_events` (RFC-003 §4.4). See Section 2.

Both prerequisites are specified here so a single implementation task can execute them in sequence.

---

## 1. Prerequisite: Multi-Tier Account Type

### 1.1 Type Change

**File:** `packages/worker/src/types.ts`

Add a union type and update the Account interface:

```typescript
// Add after line 62 (after Account interface closing brace)
export type AccountTier = 'free' | 'starter' | 'pro' | 'enterprise';

// Map legacy 'paid' to 'starter' for backward compatibility
export function resolveAccountTier(account: Account): AccountTier {
  const raw = account.tier;
  if (raw === 'paid') return 'starter';  // Legacy migration
  if (raw === 'starter' || raw === 'pro' || raw === 'enterprise') return raw;
  return 'free';
}
```

The `resolveAccountTier` function handles the existing binary system gracefully — all current `'paid'` accounts map to `'starter'`.

### 1.2 Tier Passing to Trust Engine

The trust engine currently accepts `(db: D1Database, agentId: string)`. It needs the tier:

```typescript
// New signature for computeTrustScore (trust-engine.ts)
export async function computeTrustScore(
  db: D1Database,
  agentId: string,
  tier: AccountTier = 'free',  // Default preserves backward compat
): Promise<TrustProfile>
```

The caller (in `routes/trust.ts`) already has access to `c.var.account` which contains the tier. Pass it through:

```typescript
// routes/trust.ts — in GET /v1/trust/:agentId handler
const tier = resolveAccountTier(account);
const profile = await computeTrustScore(db, agentId, tier);
```

Similarly update `checkTrustGate`:

```typescript
export async function checkTrustGate(
  db: D1Database,
  agentId: string,
  minLevel: ATFLevel = 'intern',
  tier: AccountTier = 'free',
): Promise<TrustGateResult>
```

---

## 2. Prerequisite: Behavioral Event Integration

### 2.1 Normalized Event Interface

External behavioral events have a different schema than audit_log events. Define a normalized form:

```typescript
// trust-engine.ts — new interface
interface NormalizedEvent {
  id: string;
  timestamp: string;
  category: string;
  action: string;
  result: string;
  source: 'internal' | 'external';
  signed: boolean;
  // External events don't have prev_hash (no chain)
  prev_hash?: string;
}
```

### 2.2 Fetch and Merge Events

Replace the single `audit_log` query in `computeTrustScore` with a dual-source fetch:

```typescript
// trust-engine.ts — new function
async function fetchMergedEvents(
  db: D1Database,
  agentId: string,
  windowDays: number,
): Promise<NormalizedEvent[]> {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const [internal, external] = await Promise.all([
    db.prepare(
      `SELECT id, timestamp, account_id, actor_id, category, action, result, prev_hash, signature
       FROM audit_log
       WHERE actor_id = ? AND timestamp >= ?
       ORDER BY timestamp ASC LIMIT 5000`
    ).bind(agentId, cutoff).all<AuditEvent>(),

    db.prepare(
      `SELECT id, timestamp, category, action, result, signed
       FROM behavioral_events
       WHERE agent_id = ? AND timestamp >= ?
       ORDER BY timestamp ASC LIMIT 5000`
    ).bind(agentId, cutoff).all<{
      id: string; timestamp: string; category: string;
      action: string; result: string; signed: number;
    }>(),
  ]);

  // Normalize internal events
  const internalNorm: NormalizedEvent[] = (internal.results ?? []).map(e => ({
    id: e.id,
    timestamp: e.timestamp,
    category: e.category,
    action: e.action,
    result: e.result,
    source: 'internal' as const,
    signed: !!e.signature,
    prev_hash: e.prev_hash,
  }));

  // Normalize external events
  const externalNorm: NormalizedEvent[] = (external.results ?? []).map(e => ({
    id: e.id,
    timestamp: e.timestamp,
    category: e.category,
    action: e.action,
    result: e.result,
    source: 'external' as const,
    signed: e.signed === 1,
  }));

  // Merge and sort by timestamp
  return [...internalNorm, ...externalNorm]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
```

### 2.3 Observation Weighting (RFC-003 §7.2)

Internal and external events have different credibility:

```typescript
// trust-engine.ts — new constants
const EVENT_SOURCE_WEIGHT = {
  internal: 1.0,
  external_signed: 0.85,
  external_unsigned: 0.7,
} as const;

function effectiveWeight(event: NormalizedEvent): number {
  if (event.source === 'internal') return EVENT_SOURCE_WEIGHT.internal;
  return event.signed
    ? EVENT_SOURCE_WEIGHT.external_signed
    : EVENT_SOURCE_WEIGHT.external_unsigned;
}

function effectiveObservationCount(events: NormalizedEvent[]): number {
  return events.reduce((sum, e) => sum + effectiveWeight(e), 0);
}
```

---

## 3. Gate A: Tier-Based Event Weight Multiplier

### 3.1 Multiplier Table

```typescript
// trust-engine.ts — new constant
const TIER_WEIGHT_MULTIPLIER: Record<AccountTier, number> = {
  free: 0.5,
  starter: 1.0,
  pro: 1.0,
  enterprise: 1.0,
};
```

### 3.2 Application Point

The multiplier applies to the **effective observation count** used in cold-start calculations and confidence estimation. It does NOT change raw dimension scores — those reflect actual behavior. The multiplier affects how much that behavior counts toward overriding the skeptical prior.

```typescript
// In computeTrustScore(), after computing effectiveObservationCount:

const sourceWeightedObs = effectiveObservationCount(allEvents);
const tierMultiplier = TIER_WEIGHT_MULTIPLIER[tier];
const weightedObs = sourceWeightedObs * tierMultiplier;

// Use weightedObs (instead of raw event count) for:
//   1. applyColdStartPrior(penalizedScore, weightedObs)
//   2. computeConfidenceInterval(score, weightedObs)
//   3. dimensionConfidence(weightedObs)
```

### 3.3 Effect

- **Free (0.5x):** An agent with 100 effective observations → treated as 50. The cold-start prior dominates longer. Score moves slowly.
- **Starter+ (1.0x):** Full credit. Cold-start prior overridden at normal rate.

### 3.4 Why NOT apply to dimension scores directly

Dimension scores measure behavioral quality — they should be identical regardless of tier. A Free agent that behaves perfectly should see the same dimension scores as a Pro agent with identical behavior. The difference is in how quickly those scores overcome the skeptical prior and build confidence.

---

## 4. Gate B: ATF Level Cap Per Tier

### 4.1 Cap Table

```typescript
// trust-engine.ts — new constant
const TIER_ATF_CAP: Record<AccountTier, ATFLevel> = {
  free: 'junior',
  starter: 'senior',
  pro: 'principal',
  enterprise: 'principal',
};

const ATF_RANK: Record<ATFLevel, number> = {
  intern: 0,
  junior: 1,
  senior: 2,
  principal: 3,
};
```

### 4.2 Cap Function

```typescript
// trust-engine.ts — new exported function
export function capTrustLevel(derivedLevel: ATFLevel, tier: AccountTier): ATFLevel {
  const cap = TIER_ATF_CAP[tier];
  if (ATF_RANK[derivedLevel] > ATF_RANK[cap]) return cap;
  return derivedLevel;
}
```

### 4.3 Application Point

In `computeTrustScore()`, after `deriveATFLevel()`:

```typescript
const rawAtfLevel = deriveATFLevel(score, confidence);
const atfLevel = capTrustLevel(rawAtfLevel, tier);
```

### 4.4 Visibility in API Response

The TrustProfile should communicate the cap so integrators understand why their agent is capped:

```typescript
// Extend TrustProfile interface
export interface TrustProfile {
  // ... existing fields ...

  /** If present, the ATF level was capped by the account tier */
  tierCap?: {
    appliedCap: ATFLevel;
    rawLevel: ATFLevel;      // What the agent would have achieved without cap
    tier: AccountTier;
  };
}
```

Only populated when `rawAtfLevel !== atfLevel`:

```typescript
const tierCap = rawAtfLevel !== atfLevel
  ? { appliedCap: atfLevel, rawLevel: rawAtfLevel, tier }
  : undefined;
```

This is the "upgrade nudge" — an integrator sees their agent qualifies for senior but is capped at junior because they're on Free.

---

## 5. Gate C: Retention-Based Query Window

### 5.1 Window Table

```typescript
// trust-engine.ts — new constant
const TIER_EVENT_WINDOW_DAYS: Record<AccountTier, number> = {
  free: 7,
  starter: 30,
  pro: 90,
  enterprise: 365,
};
```

### 5.2 Application Point

The window applies ONLY to `behavioral_events`, not to `audit_log`. Internal audit events always use the full 90-day window (they're server-observed and not subject to tier restrictions).

Modify `fetchMergedEvents` to accept tier:

```typescript
async function fetchMergedEvents(
  db: D1Database,
  agentId: string,
  tier: AccountTier,
): Promise<NormalizedEvent[]> {
  const internalWindowDays = 90;  // Always 90 days for audit_log
  const externalWindowDays = TIER_EVENT_WINDOW_DAYS[tier];

  const internalCutoff = new Date(Date.now() - internalWindowDays * 86_400_000).toISOString();
  const externalCutoff = new Date(Date.now() - externalWindowDays * 86_400_000).toISOString();

  const [internal, external] = await Promise.all([
    db.prepare(
      `SELECT id, timestamp, account_id, actor_id, category, action, result, prev_hash, signature
       FROM audit_log
       WHERE actor_id = ? AND timestamp >= ?
       ORDER BY timestamp ASC LIMIT 5000`
    ).bind(agentId, internalCutoff).all<AuditEvent>(),

    db.prepare(
      `SELECT id, timestamp, category, action, result, signed
       FROM behavioral_events
       WHERE agent_id = ? AND timestamp >= ?
       ORDER BY timestamp ASC LIMIT 5000`
    ).bind(agentId, externalCutoff).all<{
      id: string; timestamp: string; category: string;
      action: string; result: string; signed: number;
    }>(),
  ]);

  // ... normalize and merge as in Section 2.2 ...
}
```

### 5.3 Important: Data exists, query is restricted

The raw events in `behavioral_events` are retained for 30 days (per RFC-003 §4.5 TTL). A Free tier agent's events from day 8-30 exist in D1 but are invisible to the trust query (7-day window). If the account upgrades to Starter, the query window expands to 30 days, and all existing data immediately contributes to scoring.

This creates a compelling upgrade moment: "Upgrade and your score improves immediately from historical data."

For Enterprise (365 days): events beyond 30 days are only available if `behavioral_aggregates` are used. The implementation should fall back to aggregates for periods where raw events have been TTL'd:

```typescript
// For Enterprise: if externalWindowDays > 30, also query behavioral_aggregates
// for the period between 30d and externalWindowDays
if (externalWindowDays > 30) {
  const aggregateCutoff = new Date(Date.now() - externalWindowDays * 86_400_000).toISOString();
  const rawCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const aggregates = await db.prepare(
    `SELECT agent_id, date, category, event_count, success_count, failure_count
     FROM behavioral_aggregates
     WHERE agent_id = ? AND date >= ? AND date < ?
     ORDER BY date ASC`
  ).bind(agentId, aggregateCutoff.slice(0, 10), rawCutoff.slice(0, 10)).all();
  // Convert aggregates to synthetic NormalizedEvents for dimension scoring
}
```

This aggregate expansion is a Phase 3 concern. For Phase 2, Starter (30d) and Pro (90d) work directly with raw events in D1 (which are retained for 30 days). Pro's 90-day window effectively functions as 30 days until the aggregation cron is implemented.

**Implementation note:** Document this limitation in a code comment. Pro tier's full 90-day benefit requires the aggregation pipeline (RFC-003 §4.5 Phase 3).

---

## 6. Gate D: Telemetry Reporting Ceiling

### 6.1 Ceiling Table

```typescript
// trust-engine.ts — new constant
const TIER_TELEMETRY_CEILING: Record<AccountTier, number> = {
  free: 0.60,
  starter: 0.85,
  pro: 1.0,
  enterprise: 1.0,
};
```

### 6.2 Application Point

Inside `computeTransparency()`, after computing the `telemetryReporting` signal:

```typescript
export function computeTransparency(
  events: NormalizedEvent[],  // Changed from AuditEvent[]
  tier: AccountTier = 'free',
): { score: number; signals: Record<string, number> } {
  // ... existing chain integrity, coverage, auth hygiene code ...

  // Telemetry reporting: LIVE measurement when behavioral events exist
  const externalEvents = events.filter(e => e.source === 'external');
  let telemetryReporting: number;

  if (externalEvents.length === 0) {
    telemetryReporting = 0.5;  // Neutral (Phase 1 baseline)
  } else {
    // Compute from reporting consistency: unique reporting days / active days
    const reportingDays = new Set(externalEvents.map(e => e.timestamp.slice(0, 10))).size;
    const allDays = new Set(events.map(e => e.timestamp.slice(0, 10))).size;
    const rawTelemetry = allDays > 0 ? reportingDays / allDays : 0;

    // Apply tier ceiling
    const ceiling = TIER_TELEMETRY_CEILING[tier];
    telemetryReporting = Math.min(rawTelemetry, ceiling);
  }

  // ... rest of score computation uses telemetryReporting ...
}
```

### 6.3 Signal Reporting

The API response should show both the raw and capped values for transparency:

```typescript
signals: {
  audit_coverage: coverage,
  chain_integrity: chainIntegrity,
  auth_hygiene: authHygiene,
  telemetry_reporting: telemetryReporting,  // The capped value (used in score)
  telemetry_reporting_raw: rawTelemetry,    // The uncapped value (for upgrade nudge)
}
```

When `telemetry_reporting < telemetry_reporting_raw`, the integrator sees their reporting is being constrained by tier — another upgrade signal.

---

## 7. Updated computeTrustScore Flow

Putting it all together, the modified `computeTrustScore`:

```typescript
export async function computeTrustScore(
  db: D1Database,
  agentId: string,
  tier: AccountTier = 'free',
): Promise<TrustProfile> {
  // Step 1: Fetch events with tier-aware windowing (Gate C)
  const allEvents = await fetchMergedEvents(db, agentId, tier);

  // Separate internal events for chain verification and existing dimension scorers
  const internalEvents = allEvents.filter(e => e.source === 'internal');
  // Cast back to AuditEvent for chain verification (internal events have prev_hash)
  const auditEvents = internalEvents as (NormalizedEvent & { prev_hash: string })[];

  // Step 2: Compute dimension scores
  //   - Consistency and Restraint operate on ALL events (internal + external)
  //   - Transparency gets tier for telemetry ceiling (Gate D)
  const consistencyResult  = computeConsistency(allEvents);
  const restraintResult    = computeRestraint(allEvents);
  const transparencyResult = computeTransparency(allEvents, tier);

  // Step 3: Weighted raw score (unchanged)
  const rawScore =
    consistencyResult.score  * PHASE1_WEIGHTS.consistency +
    restraintResult.score    * PHASE1_WEIGHTS.restraint +
    transparencyResult.score * PHASE1_WEIGHTS.transparency;

  // Step 4: Entropy penalty (unchanged)
  const penalizedScore = applyEntropyPenalty(rawScore, {
    consistency:  consistencyResult.score,
    restraint:    restraintResult.score,
    transparency: transparencyResult.score,
  });

  // Step 5: Effective observations with tier multiplier (Gate A)
  const uniqueDays = new Set(allEvents.map(e => e.timestamp.slice(0, 10))).size;
  const dayGatedObs = Math.min(allEvents.length, uniqueDays * 15);
  const sourceWeightedObs = allEvents.reduce((sum, e) => sum + effectiveWeight(e), 0);
  const effectiveObs = Math.min(sourceWeightedObs, uniqueDays * 15);
  const tierMultiplier = TIER_WEIGHT_MULTIPLIER[tier];
  const weightedObs = effectiveObs * tierMultiplier;

  // Step 6: Cold-start prior with tier-weighted observations
  const { score: adjustedScore, confidence } = applyColdStartPrior(penalizedScore, weightedObs);

  // Step 7: Scale to 0-100
  const score = Math.round(adjustedScore * 100);

  // Step 8: ATF level with tier cap (Gate B)
  const rawAtfLevel = deriveATFLevel(score, confidence);
  const atfLevel = capTrustLevel(rawAtfLevel, tier);

  // Step 9: Confidence interval with tier-weighted observations
  const ci = computeConfidenceInterval(score, weightedObs);
  const dimConf = dimensionConfidence(weightedObs);

  // ... trend computation, persistence, return (unchanged) ...

  // Include tierCap in response when cap was applied
  const tierCap = rawAtfLevel !== atfLevel
    ? { appliedCap: atfLevel, rawLevel: rawAtfLevel, tier }
    : undefined;

  return { /* ... existing fields ..., tierCap */ };
}
```

---

## 8. Function Signature Summary

All new and modified exports:

```typescript
// ─── New types (types.ts) ───
export type AccountTier = 'free' | 'starter' | 'pro' | 'enterprise';
export function resolveAccountTier(account: Account): AccountTier;

// ─── New constants (trust-engine.ts) ───
export const TIER_WEIGHT_MULTIPLIER: Record<AccountTier, number>;
export const TIER_ATF_CAP: Record<AccountTier, ATFLevel>;
export const TIER_EVENT_WINDOW_DAYS: Record<AccountTier, number>;
export const TIER_TELEMETRY_CEILING: Record<AccountTier, number>;

// ─── New functions (trust-engine.ts) ───
export function capTrustLevel(derivedLevel: ATFLevel, tier: AccountTier): ATFLevel;

// ─── Modified signatures (trust-engine.ts) ───
export async function computeTrustScore(db: D1Database, agentId: string, tier?: AccountTier): Promise<TrustProfile>;
export async function checkTrustGate(db: D1Database, agentId: string, minLevel?: ATFLevel, tier?: AccountTier): Promise<TrustGateResult>;
export function computeTransparency(events: NormalizedEvent[], tier?: AccountTier): { score: number; signals: Record<string, number> };

// ─── Modified signatures (routes/trust.ts) ───
// Pass tier from c.var.account through to computeTrustScore and checkTrustGate
```

---

## 9. Unit Test Stubs

### 9.1 Gate A: Event Weight Multiplier

```typescript
describe('tier weight multiplier', () => {
  it('free tier halves effective observation count', () => {
    // 100 events → effectiveObs 50 → cold-start prior dominates
    // Score should be closer to 30 (prior) than raw score
  });

  it('starter tier preserves full observation count', () => {
    // 100 events → effectiveObs 100 → normal cold-start override
  });

  it('free tier results in lower confidence than starter with identical events', () => {
    // Same events, different tier → different confidence
  });

  it('free and starter produce identical dimension scores', () => {
    // Tier multiplier affects observation weight, NOT dimension scoring
    // computeConsistency(events) must be identical regardless of tier
  });

  it('tier multiplier compounds with source weight', () => {
    // External unsigned event: 0.7 (source) × 0.5 (free tier) = 0.35 effective
  });
});
```

### 9.2 Gate B: ATF Level Cap

```typescript
describe('capTrustLevel', () => {
  it('free tier caps at junior', () => {
    expect(capTrustLevel('senior', 'free')).toBe('junior');
    expect(capTrustLevel('principal', 'free')).toBe('junior');
  });

  it('free tier passes through intern and junior', () => {
    expect(capTrustLevel('intern', 'free')).toBe('intern');
    expect(capTrustLevel('junior', 'free')).toBe('junior');
  });

  it('starter tier caps at senior', () => {
    expect(capTrustLevel('principal', 'starter')).toBe('senior');
    expect(capTrustLevel('senior', 'starter')).toBe('senior');
  });

  it('pro tier allows principal', () => {
    expect(capTrustLevel('principal', 'pro')).toBe('principal');
  });

  it('enterprise tier allows principal', () => {
    expect(capTrustLevel('principal', 'enterprise')).toBe('principal');
  });

  it('tierCap is populated when cap is applied', () => {
    // computeTrustScore for an agent with score=85, confidence=0.8 on free tier
    // Should have tierCap = { appliedCap: 'junior', rawLevel: 'principal', tier: 'free' }
  });

  it('tierCap is undefined when cap is not applied', () => {
    // computeTrustScore for an agent with score=40 on free tier
    // rawAtfLevel = 'junior', cap = 'junior' → no cap applied → tierCap undefined
  });
});
```

### 9.3 Gate C: Retention-Based Query Window

```typescript
describe('tier-aware event windowing', () => {
  it('free tier queries only 7 days of behavioral_events', () => {
    // Insert events at day -3, -7, -10, -20
    // Free tier: only day -3 and -7 events returned
  });

  it('starter tier queries 30 days of behavioral_events', () => {
    // Insert events at day -3, -7, -10, -20, -35
    // Starter tier: day -3, -7, -10, -20 returned (not -35)
  });

  it('internal audit_log events always use 90-day window regardless of tier', () => {
    // Free tier + audit events at day -60 → still included
    // Only behavioral_events are windowed by tier
  });

  it('upgrading tier immediately expands visible event history', () => {
    // Events at day -15 exist in behavioral_events
    // Free tier: invisible (7-day window)
    // Compute score on free → note score
    // Compute score on starter → score should be higher (more events visible)
  });
});
```

### 9.4 Gate D: Telemetry Reporting Ceiling

```typescript
describe('telemetry reporting ceiling', () => {
  it('free tier caps telemetry_reporting at 0.60', () => {
    // Agent reporting daily for 7 days → rawTelemetry ≈ 1.0
    // Free tier ceiling: 0.60 → signal capped
  });

  it('starter tier caps at 0.85', () => {
    // Agent with rawTelemetry = 0.95 on starter → signal = 0.85
  });

  it('pro tier allows full 1.0', () => {
    // Agent with rawTelemetry = 0.95 on pro → signal = 0.95 (no cap)
  });

  it('no external events → telemetry_reporting stays at 0.5 regardless of tier', () => {
    // Neutral baseline maintained when no behavioral events exist
  });

  it('response includes both raw and capped telemetry values', () => {
    // signals.telemetry_reporting = 0.60 (capped)
    // signals.telemetry_reporting_raw = 0.95 (uncapped)
  });

  it('ceiling does not apply below the cap', () => {
    // Agent reporting 3 of 7 days → rawTelemetry ≈ 0.43
    // Free ceiling 0.60 → signal = 0.43 (below cap, no effect)
  });
});
```

### 9.5 Integration Tests

```typescript
describe('tier gates integration', () => {
  it('free tier agent with excellent behavior: capped at junior, modest score', () => {
    // Perfect behavioral events for 7 days
    // Expected: score ~55-58, level junior (capped from potential senior)
  });

  it('starter tier agent with 30 days of reporting: reaches senior', () => {
    // Consistent behavioral events for 30 days
    // Expected: score ~65-75, level senior
  });

  it('pro tier agent with 90 days of reporting: reaches principal', () => {
    // Consistent behavioral events for 90 days
    // Expected: score ~85+, level principal
  });

  it('resolveAccountTier maps legacy "paid" to "starter"', () => {
    expect(resolveAccountTier({ id: 'x', tier: 'paid' })).toBe('starter');
    expect(resolveAccountTier({ id: 'x', tier: undefined })).toBe('free');
    expect(resolveAccountTier({ id: 'x', tier: 'pro' })).toBe('pro');
  });
});
```

---

## 10. Implementation Order

Execute sequentially — each step depends on the previous:

1. **Add `AccountTier` type and `resolveAccountTier`** to `types.ts` (5 min)
2. **Add `NormalizedEvent` interface** to `trust-engine.ts` (5 min)
3. **Add tier constants** (TIER_WEIGHT_MULTIPLIER, TIER_ATF_CAP, TIER_EVENT_WINDOW_DAYS, TIER_TELEMETRY_CEILING) to `trust-engine.ts` (5 min)
4. **Implement `capTrustLevel`** (5 min)
5. **Implement `fetchMergedEvents`** with tier-aware windowing (20 min)
6. **Modify `computeTransparency`** to accept NormalizedEvent[] and tier, compute live telemetry_reporting with ceiling (20 min)
7. **Modify `computeConsistency` and `computeRestraint`** to accept NormalizedEvent[] (10 min — interface change only, logic unchanged)
8. **Modify `computeTrustScore`** to use all four gates (30 min)
9. **Modify `checkTrustGate`** to pass tier through (5 min)
10. **Update `routes/trust.ts`** to pass tier from account (5 min)
11. **Write unit tests** (60 min)
12. **Update existing tests** to pass with new optional parameters (20 min)

**Total estimated effort: 3 hours (sonnet-level after this spec exists)**

---

## 11. API Response Example

```json
{
  "agentId": "acc_qgdxSULsXsmtHklZ",
  "score": 56,
  "confidence": 0.35,
  "atfLevel": "junior",
  "tierCap": {
    "appliedCap": "junior",
    "rawLevel": "senior",
    "tier": "free"
  },
  "dimensions": {
    "transparency": {
      "score": 62,
      "signals": {
        "telemetry_reporting": 0.60,
        "telemetry_reporting_raw": 0.85,
        "audit_coverage": 0.72,
        "chain_integrity": 1.0,
        "auth_hygiene": 0.80
      }
    }
  }
}
```

The `tierCap` and `telemetry_reporting_raw` fields are the "upgrade nudges" — they show the integrator exactly what they're missing.
