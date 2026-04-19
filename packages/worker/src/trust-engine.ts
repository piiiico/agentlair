// ─── AgentLair Trust Engine — Phase 1 ───────────────────────────────────────────
//
// Implements the behavioral trust scoring algorithm specified at:
//   memory/knowledge/agentlair-trust-scoring-algorithm.md
//
// Phase 1 scope:
//   - 3 active dimensions: consistency, restraint, transparency
//   - Data source: audit_log D1 table (90-day window)
//   - Cold-start prior: 0.30 (skeptical by design)
//   - ATF maturity levels: intern → junior → senior → principal
//   - Confidence intervals: observation-count based
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
}

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
//   audit_coverage      — volume-based coverage approximation
//   chain_integrity     — presence of prev_hash on all events
//   auth_hygiene        — auth failure rate + auth event presence
//   telemetry_reporting — neutral (0.5) until Phase 2 telemetry ingestion

export function computeTransparency(events: AuditEvent[]): { score: number; signals: Record<string, number> } {
  const e90d = windowEvents(events, 90);

  // Chain integrity: events without prev_hash are broken links
  const sorted = [...e90d].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const brokenLinks = sorted.filter(e => !e.prev_hash).length;
  const chainIntegrity = sorted.length > 0
    ? clamp(1 - brokenLinks / sorted.length, 0, 1)
    : 1.0; // No events = no broken chain

  // If chain is broken, return 0 immediately (spec says it's catastrophic)
  if (chainIntegrity === 0) {
    return {
      score: 0,
      signals: { audit_coverage: 0, chain_integrity: 0, auth_hygiene: 0.5, telemetry_reporting: 0.5 },
    };
  }

  // Audit trail coverage: approximated by event density
  // More events over 90 days = better coverage signal
  let coverage: number;
  if (e90d.length === 0) coverage = 0.3;
  else if (e90d.length < 5) coverage = 0.5;
  else coverage = Math.min(1.0, 0.5 + Math.log10(e90d.length) * 0.25);

  // Auth hygiene: auth failure rate + presence of auth events
  const authEvents = e90d.filter(e => e.category === 'auth');
  const authFailures = authEvents.filter(e => e.result === 'failure' || e.result === 'denied').length;
  const authFailureRate = authEvents.length > 0 ? authFailures / authEvents.length : 0;
  const failurePenalty = clamp(1 - authFailureRate * 3, 0, 1);
  const hasAuth = authEvents.length > 0 ? 1.0 : 0.5;
  const authHygiene = weightedMean([[failurePenalty, 0.6], [hasAuth, 0.4]] as const);

  // Telemetry: neutral until Phase 2
  const telemetryReporting = 0.5;

  const score = weightedMean([
    [coverage, 0.35],
    [chainIntegrity, 0.30],
    [authHygiene, 0.20],
    [telemetryReporting, 0.15],
  ] as const);

  return {
    score,
    signals: { audit_coverage: coverage, chain_integrity: chainIntegrity, auth_hygiene: authHygiene, telemetry_reporting: telemetryReporting },
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

// ─── Main: Compute Trust Score ────────────────────────────────────────────────────

export async function computeTrustScore(
  db: D1Database,
  agentId: string,
): Promise<TrustProfile> {
  // Fetch 90 days of audit events for this agent
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { results: events } = await db
    .prepare(
      `SELECT id, timestamp, account_id, actor_id, category, action, result, prev_hash, signature, resource_type, error_code
       FROM audit_log
       WHERE actor_id = ?
         AND timestamp >= ?
       ORDER BY timestamp ASC
       LIMIT 5000`,
    )
    .bind(agentId, cutoff)
    .all<AuditEvent>();

  const evtList = events ?? [];

  // Compute dimension scores
  const consistencyResult  = computeConsistency(evtList);
  const restraintResult    = computeRestraint(evtList);
  const transparencyResult = computeTransparency(evtList);

  // Weighted raw score [0.0, 1.0]
  const rawScore =
    consistencyResult.score  * PHASE1_WEIGHTS.consistency +
    restraintResult.score    * PHASE1_WEIGHTS.restraint +
    transparencyResult.score * PHASE1_WEIGHTS.transparency;

  // Apply cold-start prior
  const { score: adjustedScore, confidence } = applyColdStartPrior(rawScore, evtList.length);

  // Scale to 0-100
  const score = Math.round(adjustedScore * 100);

  // Derive ATF level and confidence interval
  const atfLevel = deriveATFLevel(score, confidence);
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
  } catch {
    // Cache miss or table not yet created — fall through to full computation
  }

  // Full computation fallback
  const profile = await computeTrustScore(db, agentId);
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
