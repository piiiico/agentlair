import { sha256hex } from './utils.js';

// ─── AgentLair Trust Engine — Phase 2b ──────────────────────────────────────────
//
// Implements the behavioral trust scoring algorithm specified at:
//   memory/knowledge/agentlair-trust-scoring-algorithm.md
//   rfcs/RFC-003-behavioral-event-ingestion.md (Section 7)
//
// Phase 2b scope:
//   - 3 active dimensions: consistency, restraint, transparency
//   - Data source: audit_log + behavioral_events D1 tables (90-day window)
//   - Cold-start prior: 0.30 (skeptical by design)
//   - ATF maturity levels: intern → junior → senior → principal
//   - Confidence intervals: observation-count based
//   - Tier-based event weight multipliers (Free: 0.5x, Starter/Pro: 1.0x)
//   - Internal/external ratio level caps (RFC-003 §7.4)
//   - Live telemetry_reporting signal from behavioral_events
//
// Weights: crossOrgCoherence (0.20) and resilience (0.10) redistributed to
// the 3 active dimensions, normalized to sum to 1.0:
//   consistency:  0.25 / 0.70 ≈ 0.3571
//   restraint:    0.30 / 0.70 ≈ 0.4286
//   transparency: 0.15 / 0.70 ≈ 0.2143

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ATFLevel = 'intern' | 'junior' | 'senior' | 'principal';
export type TrustTrend = 'improving' | 'stable' | 'declining';

export interface AuditEvent {
  id: string;
  timestamp: string;
  account_id: string;
  actor_id: string;
  category: string;
  action: string;
  result: string;        // 'success' | 'failure' | 'denied' | 'rate_limited'
  prev_hash: string;
  signature: string;
  resource_type?: string | null;
  error_code?: string | null;
  /** Full-row fields for hash chain verification (only present for internal events) */
  actor_type?: string | null;
  actor_ip_hash?: string | null;
  method?: string | null;
  path?: string | null;
  resource_id?: string | null;
  status?: number | null;
  details?: string | null;
  /** Phase 2b: event source for weight differentiation */
  _source?: 'internal' | 'external_signed' | 'external_unsigned';
}

// ─── Phase 2b: Tier & Options ─────────────────────────────────────────────────

/**
 * Four-tier account system. 'AccountTier' in types.ts is the canonical name;
 * TrustTier is kept for backward compatibility with existing exports.
 */
export type TrustTier = 'free' | 'starter' | 'pro' | 'enterprise';
/** Spec-named alias for TrustTier (trust-engine-tier-gates-spec.md §1.1) */
export type AccountTier = TrustTier;

export interface TrustComputeOptions {
  /** Account tier — determines event weight multiplier and level caps */
  tier?: TrustTier;
  /** KV namespace to look up account tier (if tier not explicitly provided) */
  kv?: KVNamespace;
}

/** Event weight multipliers by source (RFC-003 §7.2) */
export const EVENT_WEIGHTS = {
  internal: 1.0,
  external_signed: 0.85,
  external_unsigned: 0.7,
} as const;

/** Tier-based weight multiplier for external events (Gate A — spec §3.1) */
export const TIER_WEIGHT_MULTIPLIER: Record<TrustTier, number> = {
  free: 0.5,
  starter: 1.0,
  pro: 1.0,
  enterprise: 1.0,
} as const;

/** Max achievable ATF level per tier (Gate B — spec §4.1) */
export const TIER_LEVEL_CAP: Record<TrustTier, ATFLevel> = {
  free: 'junior',
  starter: 'senior',
  pro: 'principal',
  enterprise: 'principal',
} as const;

/** Telemetry reporting ceiling per tier (Gate D — spec §6.1) */
export const TIER_TELEMETRY_CEILING: Record<TrustTier, number> = {
  free: 0.60,
  starter: 0.85,
  pro: 1.0,
  enterprise: 1.0,
} as const;

/**
 * Tier-aware query window for behavioral_events (Gate C — spec §5.1).
 * audit_log always uses a fixed 90-day window — only behavioral_events are windowed.
 *
 * NOTE: Pro (90d) and Enterprise (365d) windows exceed the raw event TTL (30d).
 * Full benefit requires the behavioral_aggregates pipeline (RFC-003 §4.5 Phase 3).
 * Until then, Pro effectively sees 30d of behavioral_events.
 */
export const TIER_EVENT_WINDOW_DAYS: Record<TrustTier, number> = {
  free: 7,
  starter: 30,
  pro: 90,
  enterprise: 365,
} as const;

/** Internal/external ratio requirements for level gates (RFC-003 §7.4) */
export const LEVEL_REQUIREMENTS: Record<ATFLevel, { minInternal: number; minExternalDays: number; minCategories: number }> = {
  intern: { minInternal: 0, minExternalDays: 0, minCategories: 0 },
  junior: { minInternal: 0, minExternalDays: 0, minCategories: 1 },
  senior: { minInternal: 10, minExternalDays: 7, minCategories: 2 },
  principal: { minInternal: 50, minExternalDays: 14, minCategories: 3 },
} as const;

export interface DimensionScore {
  /** [0, 100] */
  score: number;
  /** [0.0, 1.0] */
  confidence: number;
  /** Signal name → normalized value [0.0, 1.0] */
  signals: Record<string, number>;
}

export interface ConfidenceInterval {
  score: number;
  lower: number;
  upper: number;
  /** [0.0, 1.0] — higher = tighter interval = more trustworthy score */
  confidence: number;
}

export interface TrustProfile {
  agentId: string;
  /** Overall trust score [0, 100] */
  score: number;
  /** Statistical confidence in this score [0.0, 1.0] */
  confidence: number;
  confidenceInterval: ConfidenceInterval;
  atfLevel: ATFLevel;
  trend: TrustTrend;
  dimensions: {
    consistency: DimensionScore;
    restraint: DimensionScore;
    transparency: DimensionScore;
  };
  observationCount: number;
  computedAt: string;
  /** Phase 1: always 1 (single-org). Phase 3: cross-org count. */
  orgCount: number;
  /**
   * Present when the ATF level was capped by the account tier (Gate B).
   * Upgrade nudge: shows integrators the level their agent would have achieved
   * without the tier constraint.
   */
  tierCap?: {
    appliedCap: ATFLevel;
    /** What the agent would have achieved without the tier cap */
    rawLevel: ATFLevel;
    tier: TrustTier;
  };
}

// ─── Math Utilities ─────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function weightedMean(pairs: readonly [number, number][]): number {
  let sum = 0;
  let wSum = 0;
  for (const [v, w] of pairs) {
    sum += v * w;
    wSum += w;
  }
  return wSum > 0 ? sum / wSum : 0;
}

/**
 * Coefficient of variation (stddev / mean).
 * 0 = perfectly uniform, unbounded upward = increasingly erratic.
 */
function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Jensen-Shannon divergence between two count maps.
 * Returns [0, 1] where 0 = identical, 1 = maximally different.
 */
function jensenShannonDivergence(
  p: Record<string, number>,
  q: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(p), ...Object.keys(q)]);
  const totalP = Object.values(p).reduce((a, b) => a + b, 0) || 1;
  const totalQ = Object.values(q).reduce((a, b) => a + b, 0) || 1;

  let jsd = 0;
  for (const k of keys) {
    const pi = (p[k] ?? 0) / totalP;
    const qi = (q[k] ?? 0) / totalQ;
    const m = (pi + qi) / 2;
    if (m > 0) {
      if (pi > 0) jsd += pi * Math.log2(pi / m);
      if (qi > 0) jsd += qi * Math.log2(qi / m);
    }
  }
  return clamp(jsd / 2, 0, 1);
}

/**
 * Normalized Shannon entropy of a count array.
 * Returns [0, 1] where 0 = all mass at one bucket, 1 = perfectly uniform.
 */
function normalizedEntropy(dist: number[]): number {
  const total = dist.reduce((a, b) => a + b, 0);
  if (total === 0 || dist.length <= 1) return 0;
  const maxEntropy = Math.log2(dist.length);
  let entropy = 0;
  for (const v of dist) {
    const p = v / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return clamp(entropy / maxEntropy, 0, 1);
}

// ─── Chain Integrity Verification ────────────────────────────────────────────────
//
// Verifies the hash chain by reconstructing the SHA-256 hash of each entry and
// comparing against the next entry's prev_hash field. The audit middleware stores
// prev_hash = sha256hex(JSON.stringify(previousFullEntry)), so verification must
// replicate that computation.
//
// KNOWN LIMITATION: Cloudflare Workers may spin up multiple isolates concurrently,
// each maintaining its own chain. This creates natural parallel chains with broken
// links at isolate boundaries. The scoring accounts for this by measuring the ratio
// of valid links rather than requiring a perfect chain.
//
// Returns [0.0, 1.0] where 1.0 = unbroken chain, 0.0 = every link broken.
// A single-event trail (no links to verify) is considered integral (1.0).

export async function verifyChainIntegrity(sorted: AuditEvent[]): Promise<number> {
  if (sorted.length <= 1) return 1.0;
  let valid = 0;
  for (let i = 1; i < sorted.length; i++) {
    // Reconstruct the full entry object in the same key order as the audit middleware
    const prev = sorted[i - 1];
    const prevEntry = {
      id: prev.id,
      timestamp: prev.timestamp,
      account_id: prev.account_id,
      actor_type: prev.actor_type ?? 'account',
      actor_id: prev.actor_id,
      actor_ip_hash: prev.actor_ip_hash ?? null,
      category: prev.category,
      action: prev.action,
      method: prev.method ?? 'GET',
      path: prev.path ?? '',
      resource_type: prev.resource_type ?? null,
      resource_id: prev.resource_id ?? null,
      status: prev.status ?? 200,
      result: prev.result,
      error_code: prev.error_code ?? null,
      details: prev.details !== null && prev.details !== undefined ? JSON.parse(prev.details as string) : null,
      prev_hash: prev.prev_hash,
      signature: prev.signature,
    };
    const expectedHash = await sha256hex(JSON.stringify(prevEntry));
    if (sorted[i].prev_hash === expectedHash) valid++;
  }
  return valid / (sorted.length - 1);
}

// ─── Entropy Penalty (spec §4.1) ──────────────────────────────────────────────────
//
// "Perfect behavior is suspicious. Real agents have natural variance."
// Applied to rawScore after dimension weighting, before cold-start prior:
//   - All dimensions > 0.95: multiply by 0.85 (cap effective max at ~85%)
//   - Dimension variance < 0.005 (suspiciously uniform): multiply by 0.90
//   - Otherwise: no penalty (multiplier = 1.0)

export function applyEntropyPenalty(
  rawScore: number,
  dimensionScores: { consistency: number; restraint: number; transparency: number },
): number {
  const scores = [dimensionScores.consistency, dimensionScores.restraint, dimensionScores.transparency];

  // Check "perfect robot" pattern
  if (scores.every(s => s > 0.95)) return rawScore * 0.85;

  // Check suspiciously uniform scores
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length;
  if (variance < 0.005) return rawScore * 0.90;

  return rawScore;
}

// ─── Phase 2b: Combined Event Fetching ─────────────────────────────────────────

interface BehavioralEventRow {
  id: string;
  event_id: string;
  agent_id: string;
  timestamp: string;
  category: string;
  action: string;
  result: string;
  resource_type: string | null;
  error_code: string | null;
  signed: number;  // 0 or 1
  session_id: string | null;
}

/** Normalizes a behavioral_events row to AuditEvent with source annotation */
function normalizeBehavioralEvent(row: BehavioralEventRow): AuditEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    account_id: row.agent_id,
    actor_id: row.agent_id,
    category: row.category,
    action: row.action,
    result: row.result,
    prev_hash: '',       // External events have no hash chain
    signature: '',       // Signature is binary flag, not the actual sig
    resource_type: row.resource_type,
    error_code: row.error_code,
    _source: row.signed ? 'external_signed' : 'external_unsigned',
  };
}

/** Metadata about the event mix — used for tier gates and telemetry signal */
export interface EventMixMetrics {
  internalCount: number;
  externalCount: number;
  externalSignedCount: number;
  externalUnsignedCount: number;
  externalUniqueDays: number;
  externalCategories: Set<string>;
  totalActiveDays: number;
}

/**
 * Fetches events from both audit_log and behavioral_events tables.
 * Returns the merged, sorted event list and mix metrics.
 *
 * Gate C: audit_log always uses a 90-day window (server-observed, no tier restriction).
 * behavioral_events use TIER_EVENT_WINDOW_DAYS[tier] — free gets 7d, starter 30d, etc.
 * Events beyond the window exist in D1 but are excluded from scoring until upgrade.
 *
 * @param tier - Account tier for Gate C windowing (defaults to 'free')
 */
export async function fetchCombinedEvents(
  db: D1Database,
  agentId: string,
  tier: TrustTier = 'free',
): Promise<{ events: AuditEvent[]; metrics: EventMixMetrics }> {
  const INTERNAL_WINDOW_DAYS = 90;  // audit_log: always 90 days
  const externalWindowDays = TIER_EVENT_WINDOW_DAYS[tier];  // behavioral_events: tier-gated

  const internalCutoff = new Date(Date.now() - INTERNAL_WINDOW_DAYS * 86_400_000).toISOString();
  const externalCutoff = new Date(Date.now() - externalWindowDays * 86_400_000).toISOString();

  // Fetch from both tables in parallel with tier-aware cutoffs
  const [internalResult, externalResult] = await Promise.all([
    db.prepare(
      `SELECT id, timestamp, account_id, actor_type, actor_id, actor_ip_hash, category, action, method, path, resource_type, resource_id, status, result, error_code, details, prev_hash, signature
       FROM audit_log
       WHERE actor_id = ?
         AND timestamp >= ?
       ORDER BY timestamp ASC
       LIMIT 5000`,
    ).bind(agentId, internalCutoff).all<AuditEvent>(),
    db.prepare(
      `SELECT id, event_id, agent_id, timestamp, category, action, result, resource_type, error_code, signed, session_id
       FROM behavioral_events
       WHERE agent_id = ?
         AND timestamp >= ?
       ORDER BY timestamp ASC
       LIMIT 5000`,
    ).bind(agentId, externalCutoff).all<BehavioralEventRow>(),
  ]);

  const internalEvents = (internalResult.results ?? []).map(e => ({ ...e, _source: 'internal' as const }));
  const externalRows = externalResult.results ?? [];
  const externalEvents = externalRows.map(normalizeBehavioralEvent);

  // Merge and sort by timestamp
  const allEvents = [...internalEvents, ...externalEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Compute mix metrics
  const externalDays = new Set(externalRows.map(r => r.timestamp.slice(0, 10)));
  const externalCats = new Set(externalRows.map(r => r.category));
  const allDays = new Set(allEvents.map(e => e.timestamp.slice(0, 10)));

  const metrics: EventMixMetrics = {
    internalCount: internalEvents.length,
    externalCount: externalEvents.length,
    externalSignedCount: externalRows.filter(r => r.signed === 1).length,
    externalUnsignedCount: externalRows.filter(r => r.signed === 0).length,
    externalUniqueDays: externalDays.size,
    externalCategories: externalCats,
    totalActiveDays: allDays.size,
  };

  return { events: allEvents, metrics };
}

/**
 * Computes the effective observation count considering:
 * 1. Burst protection (unique_days * 15 cap)
 * 2. Source-based weighting (internal 1.0, external_signed 0.85, external_unsigned 0.7)
 * 3. Tier-based multiplier for external events (free 0.5x, starter/pro 1.0x)
 */
export function computeEffectiveObservations(
  events: AuditEvent[],
  tier: TrustTier = 'free',
): number {
  let weightedCount = 0;
  const tierMult = TIER_WEIGHT_MULTIPLIER[tier];

  for (const e of events) {
    const source = e._source ?? 'internal';
    if (source === 'internal') {
      weightedCount += EVENT_WEIGHTS.internal;
    } else {
      const sourceWeight = source === 'external_signed'
        ? EVENT_WEIGHTS.external_signed
        : EVENT_WEIGHTS.external_unsigned;
      weightedCount += sourceWeight * tierMult;
    }
  }

  // Burst protection: cap by unique days * 15
  const uniqueDays = new Set(events.map(e => e.timestamp.slice(0, 10))).size;
  return Math.min(weightedCount, uniqueDays * 15);
}

/**
 * Computes the live telemetry_reporting signal (RFC-003 §7.1).
 * Measures reporting consistency: external_event_days / total_active_days.
 * Maps to [0.5, ceiling] range — never below 0.5 (RFC-003 §9.3 backward compat).
 * Capped by tier ceiling.
 */
export function computeTelemetryReporting(
  metrics: EventMixMetrics,
  tier: TrustTier = 'free',
): number {
  // No external events → remain at neutral 0.5 (backward compatible, RFC-003 §9.3)
  if (metrics.externalCount === 0) return 0.5;

  // Compute reporting consistency ratio
  const activeDays = Math.max(metrics.totalActiveDays, 1);
  const consistencyRatio = metrics.externalUniqueDays / activeDays;

  // Map to [0.5, ceiling]: external events can only improve, never reduce
  const ceiling = TIER_TELEMETRY_CEILING[tier];
  return 0.5 + consistencyRatio * (ceiling - 0.5);
}

/**
 * Applies level cap based on tier and internal/external ratio (RFC-003 §7.4).
 * Returns the maximum ATF level the agent can achieve.
 */
export function applyLevelCaps(
  computedLevel: ATFLevel,
  metrics: EventMixMetrics,
  tier: TrustTier = 'free',
): ATFLevel {
  const ATF_RANK: Record<ATFLevel, number> = { intern: 0, junior: 1, senior: 2, principal: 3 };
  const RANK_TO_LEVEL: ATFLevel[] = ['intern', 'junior', 'senior', 'principal'];

  let maxRank = ATF_RANK[computedLevel];

  // 1. Tier-based ceiling (revenue-activation.md)
  const tierCap = TIER_LEVEL_CAP[tier];
  maxRank = Math.min(maxRank, ATF_RANK[tierCap]);

  // 2. Internal/external ratio requirements (RFC-003 §7.4)
  // Walk down from computed level until requirements are met
  while (maxRank > 0) {
    const level = RANK_TO_LEVEL[maxRank];
    const req = LEVEL_REQUIREMENTS[level];
    if (
      metrics.internalCount >= req.minInternal &&
      metrics.externalUniqueDays >= req.minExternalDays &&
      metrics.externalCategories.size >= req.minCategories
    ) {
      break;
    }
    maxRank--;
  }

  return RANK_TO_LEVEL[maxRank];
}

/**
 * Applies the ATF level cap for a given tier (Gate B — spec §4.2).
 * Returns the lower of derivedLevel and TIER_LEVEL_CAP[tier].
 *
 * Unlike applyLevelCaps (which also applies internal/external ratio gates),
 * this function applies only the tier ceiling — useful for testing the cap in isolation.
 */
export function capTrustLevel(derivedLevel: ATFLevel, tier: TrustTier): ATFLevel {
  const ATF_RANK: Record<ATFLevel, number> = { intern: 0, junior: 1, senior: 2, principal: 3 };
  const RANK_TO_LEVEL: ATFLevel[] = ['intern', 'junior', 'senior', 'principal'];
  const cap = TIER_LEVEL_CAP[tier];
  const rank = Math.min(ATF_RANK[derivedLevel], ATF_RANK[cap]);
  return RANK_TO_LEVEL[rank];
}

/**
 * Detects suspiciously low failure rate in external events (RFC-003 §7.3).
 * Returns a penalty multiplier [0.9, 1.0].
 */
export function detectSelectiveReporting(events: AuditEvent[]): number {
  const external = events.filter(e => e._source === 'external_signed' || e._source === 'external_unsigned');
  if (external.length <= 100) return 1.0; // Not enough data to judge

  const failures = external.filter(e => e.result === 'failure' || e.result === 'denied' || e.result === 'timeout').length;
  const failureRate = failures / external.length;

  // Suspiciously perfect: < 1% failure rate with 100+ events
  if (failureRate < 0.01) return 0.9;
  return 1.0;
}

// ─── Event Windowing ─────────────────────────────────────────────────────────────

function windowEvents(events: AuditEvent[], days: number): AuditEvent[] {
  const cutoffMs = Date.now() - days * 86_400_000;
  return events.filter(e => new Date(e.timestamp).getTime() >= cutoffMs);
}

// ─── Session Extraction ─────────────────────────────────────────────────────────
// Groups events into sessions by time gaps > 30 minutes.

interface Session {
  start: Date;
  end: Date;
  events: AuditEvent[];
}

function extractSessions(events: AuditEvent[]): Session[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const GAP_MS = 30 * 60_000;
  const sessions: Session[] = [];
  let current: Session = {
    start: new Date(sorted[0].timestamp),
    end: new Date(sorted[0].timestamp),
    events: [sorted[0]],
  };

  for (let i = 1; i < sorted.length; i++) {
    const t = new Date(sorted[i].timestamp);
    if (t.getTime() - current.end.getTime() > GAP_MS) {
      sessions.push(current);
      current = { start: t, end: t, events: [sorted[i]] };
    } else {
      current.end = t;
      current.events.push(sorted[i]);
    }
  }
  sessions.push(current);
  return sessions;
}

// ─── Signal Extraction ─────────────────────────────────────────────────────────

function categoryDistribution(events: AuditEvent[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const e of events) dist[e.category] = (dist[e.category] ?? 0) + 1;
  return dist;
}

function hourlyDistribution(events: AuditEvent[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const e of events) hours[new Date(e.timestamp).getUTCHours()]++;
  return hours;
}

function eventErrorRate(events: AuditEvent[]): number {
  if (events.length === 0) return 0;
  return events.filter(e => e.result === 'failure' || e.result === 'denied').length / events.length;
}

// ─── Dimension 1: CONSISTENCY (spec §1.2) ────────────────────────────────────────
//
// Signals:
//   session_regularity    — CV of inter-session intervals (lower CV = more regular)
//   tool_stability        — JSD between 7d and 90d category distributions
//   error_stability       — 7d error rate delta vs 90d error rate
//   window_consistency    — hourly activity entropy (lower entropy = concentrated schedule)

export function computeConsistency(events: AuditEvent[]): { score: number; signals: Record<string, number> } {
  const e7d = windowEvents(events, 7);
  const e90d = windowEvents(events, 90);
  const sessions = extractSessions(e90d);

  // Session regularity: CV of inter-session start intervals
  let sessionRegularity = 0.5; // neutral when insufficient data
  if (sessions.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < sessions.length; i++) {
      intervals.push(sessions[i].start.getTime() - sessions[i - 1].start.getTime());
    }
    const cv = coefficientOfVariation(intervals);
    // CV=0 (perfectly regular) → 1.0; CV=2 (very erratic) → 0.0
    sessionRegularity = clamp(1 - cv / 2, 0, 1);
  }

  // Tool call distribution stability: JSD(7d, 90d)
  let toolStability = 0.5;
  if (e7d.length >= 3 && e90d.length >= 10) {
    const jsd = jensenShannonDivergence(categoryDistribution(e7d), categoryDistribution(e90d));
    toolStability = 1 - jsd;
  }

  // Error rate stability: |7d_rate - 90d_rate| normalized
  let errorStability = 0.7;
  if (e90d.length >= 10) {
    const rate90 = eventErrorRate(e90d);
    const rate7 = eventErrorRate(e7d);
    const delta = Math.abs(rate7 - rate90);
    // >33% delta → 0 score; 0 delta → 1.0
    errorStability = clamp(1 - delta * 3, 0, 1);
  }

  // Operating window consistency: entropy of hourly distribution
  // Low entropy = concentrated schedule = consistent
  let windowConsistency = 0.5;
  if (e90d.length >= 10) {
    windowConsistency = 1 - normalizedEntropy(hourlyDistribution(e90d));
  }

  const score = weightedMean([
    [sessionRegularity, 0.3],
    [toolStability, 0.3],
    [errorStability, 0.2],
    [windowConsistency, 0.2],
  ] as const);

  return {
    score,
    signals: { session_regularity: sessionRegularity, tool_stability: toolStability, error_stability: errorStability, window_consistency: windowConsistency },
  };
}

// ─── Dimension 2: RESTRAINT (spec §1.2) ──────────────────────────────────────────
//
// Signals:
//   scope_utilization       — categories used / categories available (bell curve at 0.6)
//   credential_frequency    — vault events per session vs baseline
//   rate_limit_proximity    — rate_limited result ratio
//   escalation_appropriate  — escalation ratio (some is expected; zero for active agents is suspicious)
//   permission_growth       — static 0.75 in Phase 1 (no scope history in audit trail)

export function computeRestraint(events: AuditEvent[]): { score: number; signals: Record<string, number> } {
  const e90d = windowEvents(events, 90);
  const sessions = extractSessions(e90d);

  // Scope utilization approximation: categories used vs 9 available
  // (auth, email, vault, pod, calendar, webhook, session, budget, system)
  const TOTAL_CATEGORIES = 9;
  const usedCategories = new Set(e90d.map(e => e.category)).size;
  const utilRatio = usedCategories / TOTAL_CATEGORIES;
  // Bell curve peaking at 0.6 utilization (Gaussian σ=0.15)
  const scopeUtilization = Math.exp(-Math.pow(utilRatio - 0.6, 2) / (2 * Math.pow(0.15, 2)));

  // Credential access frequency: vault events per session
  let credentialFreq = 0.7;
  if (sessions.length > 0) {
    const vaultPerSession = e90d.filter(e => e.category === 'vault').length / sessions.length;
    // 0–2 vault reads/session = ideal; 10+ = suspicious (score → 0)
    credentialFreq = clamp(1 - vaultPerSession / 10, 0, 1);
  }

  // Rate limit proximity: fraction of rate_limited results
  const rateLimited = e90d.filter(e => e.result === 'rate_limited').length;
  const rateLimitRatio = e90d.length > 0 ? rateLimited / e90d.length : 0;
  // 10%+ rate-limited → score 0
  const rateLimitProximity = clamp(1 - rateLimitRatio * 10, 0, 1);

  // Escalation appropriateness: some escalation is healthy; none at all is suspicious
  const escalationCount = e90d.filter(e =>
    e.action.includes('approv') || e.action.includes('escalat') ||
    (e.category === 'webhook' && e.action.includes('trigger'))
  ).length;
  const escalationRatio = e90d.length > 0 ? escalationCount / e90d.length : 0;
  let escalationAppropriate: number;
  if (e90d.length > 20 && escalationRatio === 0) {
    // Active agent with zero escalations — slightly suspicious
    escalationAppropriate = 0.6;
  } else if (escalationRatio <= 0.30) {
    escalationAppropriate = 0.85;
  } else {
    // Very high escalation ratio — agent might be lacking autonomy or abusing webhooks
    escalationAppropriate = clamp(1 - escalationRatio, 0.5, 0.8);
  }

  // Permission growth: static score for Phase 1 (no scope grant history in audit trail)
  const permissionGrowth = 0.75;

  const score = weightedMean([
    [scopeUtilization, 0.20],
    [credentialFreq, 0.25],
    [rateLimitProximity, 0.15],
    [escalationAppropriate, 0.25],
    [permissionGrowth, 0.15],
  ] as const);

  return {
    score,
    signals: { scope_utilization: scopeUtilization, credential_frequency: credentialFreq, rate_limit_proximity: rateLimitProximity, escalation_appropriateness: escalationAppropriate, permission_growth: permissionGrowth },
  };
}

// ─── Dimension 3: TRANSPARENCY (spec §1.2) ───────────────────────────────────────
//
// Signals:
//   audit_coverage      — volume-based coverage approximation (includes external events)
//   chain_integrity     — hash chain verification (internal events only)
//   auth_hygiene        — auth failure rate + auth event presence
//   telemetry_reporting — Phase 2b: live signal from behavioral_events reporting

export async function computeTransparency(
  events: AuditEvent[],
  telemetrySignal?: number,
  /** Optional raw (uncapped) telemetry value — exposed as telemetry_reporting_raw when present */
  telemetryRaw?: number,
): Promise<{ score: number; signals: Record<string, number> }> {
  const e90d = windowEvents(events, 90);

  // Chain integrity: only verify internal events (external events have no hash chain)
  const internalEvents = e90d.filter(e => (e._source ?? 'internal') === 'internal');
  const sorted = [...internalEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const chainIntegrity = await verifyChainIntegrity(sorted);

  // KNOWN LIMITATION: Cloudflare Workers run multiple isolates concurrently, each
  // maintaining its own hash chain. This creates natural chain breaks at isolate
  // boundaries. A completely broken chain with many events likely indicates parallel
  // isolates (expected), not fabrication (attack). Only zero-out transparency if
  // chain is completely broken AND the event count suggests deliberate manipulation
  // (very high event count with zero valid links is suspicious).
  if (chainIntegrity === 0 && internalEvents.length > 50) {
    const cappedTelemetry = telemetrySignal ?? 0.5;
    const rawTelemetry = telemetryRaw ?? cappedTelemetry;
    return {
      score: 0,
      signals: {
        audit_coverage: 0,
        chain_integrity: 0,
        auth_hygiene: 0.5,
        telemetry_reporting: cappedTelemetry,
        ...(rawTelemetry !== cappedTelemetry ? { telemetry_reporting_raw: rawTelemetry } : {}),
      },
    };
  }

  // Audit trail coverage: includes both internal and external events.
  // More categories + more events = higher coverage.
  let coverage: number;
  if (e90d.length === 0) coverage = 0.3;
  else if (e90d.length < 5) coverage = 0.5;
  else {
    const volumeComponent = Math.min(1.0, 0.5 + Math.log10(e90d.length) * 0.25);
    // Bonus for category diversity (external events add categories)
    const uniqueCategories = new Set(e90d.map(e => e.category)).size;
    const categoryBonus = Math.min(0.1, uniqueCategories * 0.015);
    coverage = Math.min(1.0, volumeComponent + categoryBonus);
  }

  // Auth hygiene: auth failure rate + presence of auth events
  const authEvents = e90d.filter(e => e.category === 'auth');
  const authFailures = authEvents.filter(e => e.result === 'failure' || e.result === 'denied').length;
  const authFailureRate = authEvents.length > 0 ? authFailures / authEvents.length : 0;
  const failurePenalty = clamp(1 - authFailureRate * 3, 0, 1);
  const hasAuth = authEvents.length > 0 ? 1.0 : 0.5;
  const authHygiene = weightedMean([[failurePenalty, 0.6], [hasAuth, 0.4]] as const);

  // Telemetry: Phase 2b live signal (from computeTelemetryReporting)
  const telemetryReporting = telemetrySignal ?? 0.5;
  const rawTelemetry = telemetryRaw ?? telemetryReporting;

  const score = weightedMean([
    [coverage, 0.35],
    [chainIntegrity, 0.30],
    [authHygiene, 0.20],
    [telemetryReporting, 0.15],
  ] as const);

  return {
    score,
    signals: {
      audit_coverage: coverage,
      chain_integrity: chainIntegrity,
      auth_hygiene: authHygiene,
      telemetry_reporting: telemetryReporting,
      // Expose raw (uncapped) telemetry when it differs from capped — upgrade nudge (spec §6.3)
      ...(rawTelemetry !== telemetryReporting ? { telemetry_reporting_raw: rawTelemetry } : {}),
    },
  };
}

// ─── Phase 1 Effective Weights (spec §2.2) ────────────────────────────────────────
// Redistributes crossOrgCoherence (0.20) + resilience (0.10) to 3 active dimensions.
// Active total: 0.25 + 0.30 + 0.15 = 0.70. Divide each by 0.70 to renormalize.

export const PHASE1_WEIGHTS = {
  consistency:  0.25 / 0.70,   // ≈ 0.3571
  restraint:    0.30 / 0.70,   // ≈ 0.4286
  transparency: 0.15 / 0.70,   // ≈ 0.2143
} as const;

// ─── Cold-Start Prior (spec §2.5) ─────────────────────────────────────────────────

export function applyColdStartPrior(
  rawScore: number,
  observationCount: number,
): { score: number; confidence: number } {
  const AGENT_PRIOR = 0.30;         // Skeptical default
  const FULL_OVERRIDE = 100;        // Observations needed to fully override prior
  const MIN_OBSERVATIONS = 10;      // Below this: return prior with very low confidence

  if (observationCount < MIN_OBSERVATIONS) {
    return {
      score: AGENT_PRIOR,
      confidence: 0.05 * (observationCount / MIN_OBSERVATIONS),
    };
  }

  // Bayesian blend: prior weight decays as observations increase
  // Using sigmoid: weight = 1 / (1 + exp(0.1 * (obs - FULL_OVERRIDE/2)))
  const priorWeight = 1 / (1 + Math.exp(0.1 * (observationCount - FULL_OVERRIDE / 2)));
  const score = rawScore * (1 - priorWeight) + AGENT_PRIOR * priorWeight;

  // Confidence: sigmoid based on observation volume
  const confidence = Math.min(1.0, 1 / (1 + Math.exp(-0.08 * (observationCount - 30))));

  return { score, confidence };
}

// ─── ATF Level Derivation (spec §2.6) ─────────────────────────────────────────────

export function deriveATFLevel(score: number, confidence: number): ATFLevel {
  if (score >= 85 && confidence >= 0.8) return 'principal';
  if (score >= 65 && confidence >= 0.5) return 'senior';
  if (score >= 40 && confidence >= 0.3) return 'junior';
  return 'intern';
}

// ─── Confidence Interval (spec §2.7) ──────────────────────────────────────────────

export function computeConfidenceInterval(score: number, observationCount: number): ConfidenceInterval {
  const baseWidth = 40;
  const volumeNarrowing = Math.min(1, Math.log10(Math.max(observationCount, 1)) / 3);
  const halfWidth = Math.max(2, baseWidth * (1 - volumeNarrowing));

  return {
    score,
    lower: Math.max(0, Math.round(score - halfWidth)),
    upper: Math.min(100, Math.round(score + halfWidth)),
    confidence: clamp(1 - halfWidth / 50, 0, 1),
  };
}

// ─── Trend Computation ─────────────────────────────────────────────────────────────

function computeTrend(recentScore: number, previousScore: number | null): TrustTrend {
  if (previousScore === null) return 'stable';
  const delta = recentScore - previousScore;
  if (delta >= 3) return 'improving';
  if (delta <= -3) return 'declining';
  return 'stable';
}

// ─── Dimension Confidence ─────────────────────────────────────────────────────────

function dimensionConfidence(observationCount: number): number {
  if (observationCount < 10) return 0.1;
  return Math.min(0.95, 1 / (1 + Math.exp(-0.06 * (observationCount - 30))));
}

// ─── Tier Lookup (Phase 2b) ───────────────────────────────────────────────────

async function lookupAccountTier(kv: KVNamespace, agentId: string): Promise<TrustTier> {
  try {
    const keyHash = await kv.get('account:' + agentId);
    if (!keyHash) return 'free';
    const raw = await kv.get('key:' + keyHash);
    if (!raw) return 'free';
    const account = JSON.parse(raw);
    // Map plan field to TrustTier
    if (account.plan === 'pro') return 'pro';
    if (account.plan === 'starter') return 'starter';
    if (account.tier === 'paid') return 'starter'; // paid without specific plan = starter
    return 'free';
  } catch {
    return 'free'; // Fail-safe: default to free
  }
}

// ─── Main: Compute Trust Score ────────────────────────────────────────────────────

export async function computeTrustScore(
  db: D1Database,
  agentId: string,
  /**
   * Account tier or legacy options object.
   * - Pass a TrustTier string directly (preferred, spec §1.2)
   * - Or pass TrustComputeOptions for backward compatibility (KV-based lookup)
   */
  tierOrOptions?: TrustTier | TrustComputeOptions,
): Promise<TrustProfile> {
  // Resolve tier — supports both direct string and legacy options object
  let tier: TrustTier;
  if (typeof tierOrOptions === 'string') {
    tier = tierOrOptions;
  } else {
    const options = tierOrOptions as TrustComputeOptions | undefined;
    tier = options?.tier ?? 'free';
    if (!options?.tier && options?.kv) {
      tier = await lookupAccountTier(options.kv, agentId);
    }
  }

  // Phase 2b: Fetch from BOTH audit_log and behavioral_events with tier-aware windowing
  let evtList: AuditEvent[];
  let metrics: EventMixMetrics;

  try {
    const combined = await fetchCombinedEvents(db, agentId, tier);  // Gate C
    evtList = combined.events;
    metrics = combined.metrics;
  } catch (e) {
    // Graceful degradation: if behavioral_events table doesn't exist yet,
    // fall back to audit_log only (Phase 1 behavior)
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('behavioral_events') || msg.includes('no such table')) {
      const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const { results: events } = await db
        .prepare(
          `SELECT id, timestamp, account_id, actor_type, actor_id, actor_ip_hash, category, action, method, path, resource_type, resource_id, status, result, error_code, details, prev_hash, signature
           FROM audit_log
           WHERE actor_id = ?
             AND timestamp >= ?
           ORDER BY timestamp ASC
           LIMIT 5000`,
        )
        .bind(agentId, cutoff)
        .all<AuditEvent>();
      evtList = (events ?? []).map(e => ({ ...e, _source: 'internal' as const }));
      metrics = {
        internalCount: evtList.length,
        externalCount: 0,
        externalSignedCount: 0,
        externalUnsignedCount: 0,
        externalUniqueDays: 0,
        externalCategories: new Set(),
        totalActiveDays: new Set(evtList.map(e => e.timestamp.slice(0, 10))).size,
      };
    } else {
      throw e;
    }
  }

  // Gate D: compute capped and raw telemetry signals for upgrade nudge (spec §6.3)
  const telemetrySignal = computeTelemetryReporting(metrics, tier);         // tier-capped
  const telemetryRawSignal = computeTelemetryReporting(metrics, 'pro');     // uncapped (pro=1.0 ceiling)

  // Compute dimension scores
  // - computeTransparency receives both capped and raw telemetry (spec §6.3)
  const consistencyResult  = computeConsistency(evtList);
  const restraintResult    = computeRestraint(evtList);
  const transparencyResult = await computeTransparency(
    evtList,
    telemetrySignal,
    telemetryRawSignal !== telemetrySignal ? telemetryRawSignal : undefined,
  );

  // Weighted raw score [0.0, 1.0]
  const rawScore =
    consistencyResult.score  * PHASE1_WEIGHTS.consistency +
    restraintResult.score    * PHASE1_WEIGHTS.restraint +
    transparencyResult.score * PHASE1_WEIGHTS.transparency;

  // Apply selective reporting penalty (RFC-003 Section 7.3)
  const selectiveReportingMult = detectSelectiveReporting(evtList);
  const adjustedRawScore = rawScore * selectiveReportingMult;

  // Apply entropy penalty (spec Section 4.1): penalise suspiciously perfect or uniform scores
  const penalizedScore = applyEntropyPenalty(adjustedRawScore, {
    consistency:  consistencyResult.score,
    restraint:    restraintResult.score,
    transparency: transparencyResult.score,
  });

  // Gate A: effective observations with tier weight multiplier (spec §3.2)
  const effectiveObs = computeEffectiveObservations(evtList, tier);

  // Apply cold-start prior (using effective observation count)
  const { score: coldStartScore, confidence } = applyColdStartPrior(penalizedScore, effectiveObs);

  // Scale to 0-100
  const score = Math.round(coldStartScore * 100);

  // Gate B: derive ATF level, then apply tier cap (spec §4.3)
  const rawAtfLevel = deriveATFLevel(score, confidence);
  const atfLevel = applyLevelCaps(rawAtfLevel, metrics, tier);

  // Populate tierCap when cap was actually applied (spec §4.4) — the upgrade nudge
  const tierCap = rawAtfLevel !== atfLevel
    ? { appliedCap: atfLevel, rawLevel: rawAtfLevel, tier }
    : undefined;

  const ci       = computeConfidenceInterval(score, evtList.length);
  const dimConf  = dimensionConfidence(evtList.length);

  // Retrieve previous score for trend
  let previousScore: number | null = null;
  try {
    const prev = await db
      .prepare(`SELECT score FROM trust_score_history WHERE agent_id = ? ORDER BY recorded_at DESC LIMIT 1`)
      .bind(agentId)
      .first<{ score: number }>();
    previousScore = prev?.score ?? null;
  } catch {
    // History table may not exist yet — ignore
  }

  const trend = computeTrend(score, previousScore);

  const profile: TrustProfile = {
    agentId,
    score,
    confidence,
    confidenceInterval: ci,
    atfLevel,
    trend,
    dimensions: {
      consistency: {
        score:      Math.round(consistencyResult.score * 100),
        confidence: dimConf,
        signals:    consistencyResult.signals,
      },
      restraint: {
        score:      Math.round(restraintResult.score * 100),
        confidence: dimConf,
        signals:    restraintResult.signals,
      },
      transparency: {
        score:      Math.round(transparencyResult.score * 100),
        confidence: dimConf,
        signals:    transparencyResult.signals,
      },
    },
    observationCount: evtList.length,
    computedAt: new Date().toISOString(),
    orgCount: 1,
    tierCap,  // Gate B upgrade nudge (undefined when no cap applied)
  };

  // Persist to D1 — best-effort (don't fail the request if storage fails)
  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO trust_profiles
         (agent_id, score, confidence, atf_level, observation_count, dimensions_json, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(agentId, score, confidence, atfLevel, evtList.length, JSON.stringify(profile.dimensions), profile.computedAt)
      .run();

    // Append to history (max once per hour: skip if last record < 60 min old)
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const lastHistoryRecord = await db
      .prepare(`SELECT recorded_at FROM trust_score_history WHERE agent_id = ? AND recorded_at >= ? LIMIT 1`)
      .bind(agentId, oneHourAgo)
      .first<{ recorded_at: string }>();

    if (!lastHistoryRecord) {
      const historyId = `${agentId}-${Date.now()}`;
      await db
        .prepare(
          `INSERT INTO trust_score_history (id, agent_id, score, confidence, atf_level)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(historyId, agentId, score, confidence, atfLevel)
        .run();
    }
  } catch {
    // Storage failure does not fail the scoring response
  }

  return profile;
}

/**
 * Fast-path trust check: returns whether an agent meets a minimum ATF level.
 * Used by enforcement gates that need low-latency trust decisions.
 * Reads from cached trust_profiles first; falls back to full computation if missing.
 */
export async function checkTrustGate(
  db: D1Database,
  agentId: string,
  minLevel: ATFLevel = 'intern',
  /** Account tier or legacy options object (same as computeTrustScore) */
  tierOrOptions?: TrustTier | TrustComputeOptions,
): Promise<{
  agentId: string;
  score: number;
  atfLevel: ATFLevel;
  meetsMinimum: boolean;
  requiredLevel: ATFLevel;
  confidence: number;
  computedAt: string;
  cached: boolean;
}> {
  const ATF_RANK: Record<ATFLevel, number> = { intern: 0, junior: 1, senior: 2, principal: 3 };

  // Try cached score first
  try {
    const cached = await db
      .prepare(
        `SELECT score, confidence, atf_level, computed_at FROM trust_profiles WHERE agent_id = ?`,
      )
      .bind(agentId)
      .first<{ score: number; confidence: number; atf_level: string; computed_at: string }>();

    if (cached) {
      // H3: TTL check — reject stale cache. Without this, an agent could build a high
      // score, stop normal operations, and the gate would keep authorising based on the
      // old score indefinitely.
      const MAX_CACHE_AGE_MS = 3_600_000; // 1 hour
      const ageMs = Date.now() - new Date(cached.computed_at).getTime();
      if (ageMs <= MAX_CACHE_AGE_MS) {
        const atfLevel = cached.atf_level as ATFLevel;
        return {
          agentId,
          score:         cached.score,
          atfLevel,
          meetsMinimum:  ATF_RANK[atfLevel] >= ATF_RANK[minLevel],
          requiredLevel: minLevel,
          confidence:    cached.confidence,
          computedAt:    cached.computed_at,
          cached:        true,
        };
      }
      // Stale cache — fall through to full recomputation
    }
  } catch {
    // Cache miss or table not yet created — fall through to full computation
  }

  // Full computation fallback (passes tier through for Gate C/B/A/D)
  const profile = await computeTrustScore(db, agentId, tierOrOptions);
  return {
    agentId,
    score:         profile.score,
    atfLevel:      profile.atfLevel,
    meetsMinimum:  ATF_RANK[profile.atfLevel] >= ATF_RANK[minLevel],
    requiredLevel: minLevel,
    confidence:    profile.confidence,
    computedAt:    profile.computedAt,
    cached:        false,
  };
}
