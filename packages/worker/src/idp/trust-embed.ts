/**
 * AgentLair Identity Provider — Trust Score Embedding
 *
 * RFC-001: Section 4.1 (Trust Score Embedding)
 *
 * Provides functions to embed behavioral trust attestations in AAT tokens.
 * When an agent requests a token, the current trust profile snapshot is
 * included as the `al_trust` claim. This gives relying parties an immediate
 * trust signal without requiring a separate API call.
 *
 * Trust embedding is opt-in and gracefully degrades:
 * - If AUDIT D1 is not bound: no trust claim
 * - If agent has < 10 observations: no trust claim (insufficient data)
 * - If trust computation fails: token issued without trust claim (fail-open)
 */

import type { Env } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Trust attestation embedded in AAT `al_trust` claim.
 * Minimal representation — full profile available via /v1/trust/{agentId}.
 */
export interface TrustAttestation {
  /** Overall trust score [0, 100] */
  score: number;
  /** ATF maturity level */
  level: 'intern' | 'junior' | 'senior' | 'principal';
  /** Confidence in the score [0.0, 1.0] */
  confidence: number;
  /** ISO 8601 timestamp of when this score was computed */
  computed_at: string;
  /** Trend direction based on recent score history */
  trend: 'improving' | 'stable' | 'declining';
}

// ─── Minimum observation threshold ──────────────────────────────────────────────
// Agents with fewer than this many audit events don't get trust embedding.
// Prevents unreliable scores from traveling in tokens.
const MIN_OBSERVATIONS_FOR_EMBEDDING = 10;

// ─── Cache TTL for trust scores used in embedding ──────────────────────────────
// We reuse cached trust profiles to avoid expensive computation on every
// token issuance. Cache staleness is acceptable here because the embedded
// score is already a point-in-time snapshot.
const TRUST_CACHE_STALENESS_LIMIT_MS = 60 * 60 * 1000; // 1 hour

// ─── Core Function ──────────────────────────────────────────────────────────────

/**
 * Fetch the trust attestation for embedding in an AAT.
 *
 * Returns null if:
 * - AUDIT database not available
 * - Agent has insufficient observation history
 * - Trust computation fails (fail-open)
 *
 * Uses cached trust profiles when available to minimize latency on token issuance.
 */
export async function getTrustAttestationForEmbed(
  env: Env,
  agentId: string,
): Promise<TrustAttestation | null> {
  const db = env.AUDIT;
  if (!db) return null;

  try {
    // First: try to read from cached trust_profiles table
    const cached = await readCachedTrustProfile(db, agentId);
    if (cached) return cached;

    // Fallback: compute fresh (more expensive but guarantees freshness)
    // Only imported when needed to avoid loading trust-engine.ts on every token issuance
    const { computeTrustScore } = await import('../trust-engine.js');
    const profile = await computeTrustScore(db, agentId);

    if (profile.observationCount < MIN_OBSERVATIONS_FOR_EMBEDDING) {
      return null;
    }

    return {
      score: profile.score,
      level: profile.atfLevel,
      confidence: profile.confidence,
      computed_at: profile.computedAt,
      trend: profile.trend,
    };
  } catch {
    // Fail-open: token issued without trust claim
    return null;
  }
}

// ─── Cached Profile Reader ──────────────────────────────────────────────────────

interface CachedProfile {
  score: number;
  atf_level: string;
  confidence: number;
  computed_at: string;
  trend: string;
  observation_count: number;
}

async function readCachedTrustProfile(
  db: D1Database,
  agentId: string,
): Promise<TrustAttestation | null> {
  try {
    const row = await db
      .prepare(
        `SELECT score, atf_level, confidence, computed_at, trend, observation_count
         FROM trust_profiles
         WHERE agent_id = ?
         LIMIT 1`,
      )
      .bind(agentId)
      .first<CachedProfile>();

    if (!row) return null;

    // Check staleness
    const computedAt = new Date(row.computed_at).getTime();
    if (Date.now() - computedAt > TRUST_CACHE_STALENESS_LIMIT_MS) {
      return null; // Too stale, trigger fresh computation
    }

    // Check minimum observations
    if (row.observation_count < MIN_OBSERVATIONS_FOR_EMBEDDING) {
      return null;
    }

    return {
      score: row.score,
      level: row.atf_level as TrustAttestation['level'],
      confidence: row.confidence,
      computed_at: row.computed_at,
      trend: row.trend as TrustAttestation['trend'],
    };
  } catch {
    // Table might not exist yet — fail-open
    return null;
  }
}

// ─── Trust Validation for Relying Parties ───────────────────────────────────────

/**
 * Validate an embedded trust attestation from an AAT.
 * Returns whether the attestation meets the minimum requirements.
 *
 * Used by the @agentlair/mcp-verify library.
 */
export function validateTrustAttestation(
  attestation: TrustAttestation | undefined,
  options: {
    minLevel?: 'intern' | 'junior' | 'senior' | 'principal';
    minScore?: number;
    minConfidence?: number;
    maxAge?: number; // max age in seconds
  } = {},
): { valid: boolean; reason?: string } {
  if (!attestation) {
    // No trust attestation — agent may be new or trust scoring unavailable
    if (options.minLevel && options.minLevel !== 'intern') {
      return { valid: false, reason: 'no_trust_attestation' };
    }
    return { valid: true }; // Intern-level or no requirement
  }

  const levelOrder = { intern: 0, junior: 1, senior: 2, principal: 3 };

  // Check minimum level
  if (options.minLevel) {
    const required = levelOrder[options.minLevel] ?? 0;
    const actual = levelOrder[attestation.level] ?? 0;
    if (actual < required) {
      return {
        valid: false,
        reason: `trust_level_insufficient: ${attestation.level} < ${options.minLevel}`,
      };
    }
  }

  // Check minimum score
  if (options.minScore !== undefined && attestation.score < options.minScore) {
    return {
      valid: false,
      reason: `trust_score_insufficient: ${attestation.score} < ${options.minScore}`,
    };
  }

  // Check minimum confidence
  if (options.minConfidence !== undefined && attestation.confidence < options.minConfidence) {
    return {
      valid: false,
      reason: `trust_confidence_insufficient: ${attestation.confidence} < ${options.minConfidence}`,
    };
  }

  // Check staleness
  if (options.maxAge !== undefined) {
    const computedAt = new Date(attestation.computed_at).getTime();
    const age = (Date.now() - computedAt) / 1000;
    if (age > options.maxAge) {
      return {
        valid: false,
        reason: `trust_attestation_stale: ${Math.round(age)}s > ${options.maxAge}s`,
      };
    }
  }

  return { valid: true };
}
