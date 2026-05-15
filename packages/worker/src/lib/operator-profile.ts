// ─── OperatorProfile — types, validators, and D1 storage helpers ─────────────
// Phase 2.5 Components 2 + 3: operator-declared attestation workflow + review bandwidth.
// Spec: memory/knowledge/agentlair-trust-scoring-algorithm.md lines 430-479.
//
// D1 table: operator_profiles (AUDIT binding).
// One row per account. Storage helpers are async; callers wrap in try/catch.

import type { VerificationTier } from '../middleware/audit.js';
import { VERIFICATION_TIERS } from '../middleware/audit.js';
import type { Env } from '../types.js';

// Re-export so consumers can import the whole type surface from one place.
export type { VerificationTier };
export { VERIFICATION_TIERS };

// ─── Types ────────────────────────────────────────────────────────────────────

// Spec source: memory/knowledge/agentlair-trust-scoring-algorithm.md lines 437-453.
export interface AttestationWorkflow {
  declaredTier: VerificationTier;
  declaredTools: string[];     // length 0..32; each matches the tool identifier rule.
  coverageEstimate: number;    // [0.0, 1.0]
  priorCoverage: number;       // [0.0, 1.0], default 0.4 if absent in PUT body.
}

// Spec source: lines 455-466.
export type ReviewUnitType = 'lines' | 'decisions' | 'claims' | 'commits';
export const REVIEW_UNIT_TYPES: readonly ReviewUnitType[] =
  ['lines', 'decisions', 'claims', 'commits'] as const;

export interface ReviewBandwidth {
  reviewersCount: number;           // integer >= 0
  unitsPerHour: number;             // integer > 0
  timeToNextApprovalHours: number;  // number >= 0 (fractional hours allowed)
  unitType: ReviewUnitType;
}

export interface OperatorProfile {
  accountId: string;
  attestationWorkflow: AttestationWorkflow;
  reviewBandwidth: ReviewBandwidth;
  createdAt: string;   // ISO-8601 from D1 default
  updatedAt: string;   // ISO-8601 from D1 default
}

// Validator return shape mirrors validateVerificationPayload in middleware/audit.ts.
export type ValidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; message: string; hint?: string };

// ─── Validation ───────────────────────────────────────────────────────────────

// Tool identifier regex — copied from Component 1 (middleware/audit.ts validateVerificationPayload).
// Not imported to avoid circular dependency between lib/ and middleware/.
const TOOL_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function validateAttestationWorkflow(input: unknown): ValidateResult<AttestationWorkflow> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid_attestation_workflow', message: 'attestationWorkflow must be a non-null object.' };
  }
  const obj = input as Record<string, unknown>;

  // declaredTier
  const { declaredTier, declaredTools, coverageEstimate, priorCoverage } = obj;
  if (typeof declaredTier !== 'string' || !(VERIFICATION_TIERS as readonly string[]).includes(declaredTier)) {
    return {
      ok: false,
      error: 'invalid_declared_tier',
      message: 'declaredTier must be one of the allowed VerificationTier values.',
      hint: `Allowed values: ${VERIFICATION_TIERS.join(', ')}`,
    };
  }

  // declaredTools
  if (!Array.isArray(declaredTools)) {
    return { ok: false, error: 'invalid_declared_tools', message: 'declaredTools must be an array of strings.' };
  }
  if (declaredTools.length > 32) {
    return { ok: false, error: 'invalid_declared_tools', message: 'declaredTools may contain at most 32 elements.' };
  }
  for (const t of declaredTools) {
    if (typeof t !== 'string' || !TOOL_ID_REGEX.test(t)) {
      return { ok: false, error: 'invalid_declared_tools', message: 'Each element of declaredTools must match the tool identifier pattern.' };
    }
  }

  // coverageEstimate
  if (typeof coverageEstimate !== 'number' || !Number.isFinite(coverageEstimate) || coverageEstimate < 0 || coverageEstimate > 1) {
    return { ok: false, error: 'invalid_coverage_estimate', message: 'coverageEstimate must be a finite number in [0.0, 1.0].' };
  }

  // priorCoverage — optional, defaults to 0.4
  let resolvedPriorCoverage = 0.4;
  if (priorCoverage !== undefined) {
    if (typeof priorCoverage !== 'number' || !Number.isFinite(priorCoverage) || priorCoverage < 0 || priorCoverage > 1) {
      return { ok: false, error: 'invalid_prior_coverage', message: 'priorCoverage must be a finite number in [0.0, 1.0].' };
    }
    resolvedPriorCoverage = priorCoverage;
  }

  return {
    ok: true,
    value: {
      declaredTier: declaredTier as VerificationTier,
      declaredTools: declaredTools as string[],
      coverageEstimate,
      priorCoverage: resolvedPriorCoverage,
    },
  };
}

export function validateReviewBandwidth(input: unknown): ValidateResult<ReviewBandwidth> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid_review_bandwidth', message: 'reviewBandwidth must be a non-null object.' };
  }
  const obj = input as Record<string, unknown>;
  const { reviewersCount, unitsPerHour, timeToNextApprovalHours, unitType } = obj;

  // reviewersCount
  if (typeof reviewersCount !== 'number' || !Number.isInteger(reviewersCount) || reviewersCount < 0) {
    return { ok: false, error: 'invalid_reviewers_count', message: 'reviewersCount must be a non-negative integer.' };
  }

  // unitsPerHour
  if (typeof unitsPerHour !== 'number' || !Number.isInteger(unitsPerHour) || unitsPerHour <= 0) {
    return { ok: false, error: 'invalid_units_per_hour', message: 'unitsPerHour must be a positive integer.' };
  }

  // timeToNextApprovalHours
  if (typeof timeToNextApprovalHours !== 'number' || !Number.isFinite(timeToNextApprovalHours) || timeToNextApprovalHours < 0) {
    return { ok: false, error: 'invalid_time_to_next_approval', message: 'timeToNextApprovalHours must be a finite number >= 0.' };
  }

  // unitType
  if (typeof unitType !== 'string' || !(REVIEW_UNIT_TYPES as readonly string[]).includes(unitType)) {
    return {
      ok: false,
      error: 'invalid_unit_type',
      message: 'unitType must be one of the allowed ReviewUnitType values.',
      hint: `Allowed values: ${REVIEW_UNIT_TYPES.join(', ')}`,
    };
  }

  return {
    ok: true,
    value: {
      reviewersCount,
      unitsPerHour,
      timeToNextApprovalHours,
      unitType: unitType as ReviewUnitType,
    },
  };
}

export function validatePutOperatorProfileBody(body: unknown): ValidateResult<{
  attestationWorkflow: AttestationWorkflow;
  reviewBandwidth: ReviewBandwidth;
}> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body', message: 'Request body must be a non-null JSON object.' };
  }
  const obj = body as Record<string, unknown>;

  const awResult = validateAttestationWorkflow(obj.attestationWorkflow);
  if (!awResult.ok) return awResult;

  const rbResult = validateReviewBandwidth(obj.reviewBandwidth);
  if (!rbResult.ok) return rbResult;

  return { ok: true, value: { attestationWorkflow: awResult.value, reviewBandwidth: rbResult.value } };
}

// ─── D1 row shape ─────────────────────────────────────────────────────────────

interface OperatorProfileRow {
  account_id: string;
  attestation_workflow_json: string;
  review_bandwidth_json: string;
  created_at: string;
  updated_at: string;
}

function rowToProfile(row: OperatorProfileRow): OperatorProfile | null {
  try {
    const attestationWorkflow = JSON.parse(row.attestation_workflow_json) as AttestationWorkflow;
    const reviewBandwidth = JSON.parse(row.review_bandwidth_json) as ReviewBandwidth;
    return {
      accountId: row.account_id,
      attestationWorkflow,
      reviewBandwidth,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

export async function getOperatorProfile(env: Env, accountId: string): Promise<OperatorProfile | null> {
  if (!env.AUDIT) throw new Error('AUDIT binding is required');

  const row = await env.AUDIT.prepare(
    'SELECT account_id, attestation_workflow_json, review_bandwidth_json, created_at, updated_at FROM operator_profiles WHERE account_id = ?'
  ).bind(accountId).first<OperatorProfileRow>();

  if (!row) return null;
  return rowToProfile(row);
}

export async function putOperatorProfile(
  env: Env,
  accountId: string,
  profile: { attestationWorkflow: AttestationWorkflow; reviewBandwidth: ReviewBandwidth }
): Promise<OperatorProfile> {
  if (!env.AUDIT) throw new Error('AUDIT binding is required');

  const attestationJson = JSON.stringify(profile.attestationWorkflow);
  const reviewJson = JSON.stringify(profile.reviewBandwidth);

  const row = await env.AUDIT.prepare(
    `INSERT INTO operator_profiles (account_id, attestation_workflow_json, review_bandwidth_json)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       attestation_workflow_json = excluded.attestation_workflow_json,
       review_bandwidth_json = excluded.review_bandwidth_json,
       updated_at = datetime('now')
     RETURNING *`
  ).bind(accountId, attestationJson, reviewJson).first<OperatorProfileRow>();

  if (!row) throw new Error('putOperatorProfile: RETURNING clause yielded no row');
  const result = rowToProfile(row);
  if (!result) throw new Error('putOperatorProfile: failed to parse returned row');
  return result;
}
