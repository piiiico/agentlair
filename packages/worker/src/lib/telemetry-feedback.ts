// Spec source: memory/knowledge/agentlair-trust-scoring-algorithm.md line 1734.
//
// FeedbackEvent is the validated, in-memory shape of a row in telemetry_feedback.
// It is NOT the wire-payload — that has `outcome_correct: boolean`; the row
// has `outcome_correct: 0 | 1` because D1 lacks native booleans.

import { nanoid } from '../utils.js';
import type { Env } from '../types.js';

export type FeedbackEvidenceType =
  | 'integration_test'
  | 'manual_verification'
  | 'production_outcome'
  | 'user_report'
  | 'automated_check'
  | 'other';

export const FEEDBACK_EVIDENCE_TYPES: readonly FeedbackEvidenceType[] = [
  'integration_test',
  'manual_verification',
  'production_outcome',
  'user_report',
  'automated_check',
  'other',
] as const;

export interface FeedbackPayload {
  claim_id: string;
  outcome_correct: boolean;
  evidence_type: FeedbackEvidenceType;
  confidence_stated?: number; // optional, [0.0, 1.0]
}

export interface FeedbackRow {
  id: string;
  account_id: string;
  claim_id: string;
  outcome_correct: 0 | 1;
  evidence_type: FeedbackEvidenceType;
  confidence_stated: number | null;
  created_at: number; // unix epoch ms
}

export type ValidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; message: string; hint?: string };

// Inline copy of the identifier regex from middleware/audit.ts to avoid circular imports.
const IDENTIFIER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

const KNOWN_FIELDS = new Set(['claim_id', 'outcome_correct', 'evidence_type', 'confidence_stated']);

export function validateFeedbackPayload(input: unknown): ValidateResult<FeedbackPayload> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'invalid_body', message: 'Request body must be a JSON object.' };
  }
  const body = input as Record<string, unknown>;

  // Strict mode: reject extra fields
  for (const key of Object.keys(body)) {
    if (!KNOWN_FIELDS.has(key)) {
      return { ok: false, error: 'unexpected_field', message: `Unexpected field: ${key}.` };
    }
  }

  // claim_id
  const claim_id = body['claim_id'];
  if (typeof claim_id !== 'string' || !IDENTIFIER_RE.test(claim_id)) {
    return {
      ok: false,
      error: 'invalid_claim_id',
      message: 'claim_id must be 1–128 chars, matching ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$.',
    };
  }

  // outcome_correct
  const outcome_correct = body['outcome_correct'];
  if (typeof outcome_correct !== 'boolean') {
    return {
      ok: false,
      error: 'invalid_outcome_correct',
      message: 'outcome_correct must be a boolean (true or false).',
    };
  }

  // evidence_type
  const evidence_type = body['evidence_type'];
  if (
    typeof evidence_type !== 'string' ||
    !(FEEDBACK_EVIDENCE_TYPES as readonly string[]).includes(evidence_type)
  ) {
    return {
      ok: false,
      error: 'invalid_evidence_type',
      message: 'Invalid evidence_type.',
      hint: `Allowed values: ${FEEDBACK_EVIDENCE_TYPES.join(', ')}`,
    };
  }

  // confidence_stated (optional)
  let confidence_stated: number | undefined;
  if ('confidence_stated' in body) {
    const cs = body['confidence_stated'];
    if (typeof cs !== 'number' || !isFinite(cs) || cs < 0 || cs > 1) {
      return {
        ok: false,
        error: 'invalid_confidence_stated',
        message: 'confidence_stated must be a finite number in [0.0, 1.0].',
      };
    }
    confidence_stated = cs;
  }

  return {
    ok: true,
    value: {
      claim_id,
      outcome_correct,
      evidence_type: evidence_type as FeedbackEvidenceType,
      ...(confidence_stated !== undefined ? { confidence_stated } : {}),
    },
  };
}

export async function insertFeedback(
  env: Env,
  accountId: string,
  payload: FeedbackPayload,
): Promise<{ ok: true; row: FeedbackRow } | { ok: false; error: 'duplicate_claim_feedback' }> {
  const id = nanoid(12);
  const now = Date.now();
  const outcome_correct: 0 | 1 = payload.outcome_correct ? 1 : 0;
  const confidence_stated = payload.confidence_stated ?? null;

  try {
    await env.AUDIT!.prepare(
      `INSERT INTO telemetry_feedback (id, account_id, claim_id, outcome_correct, evidence_type, confidence_stated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, accountId, payload.claim_id, outcome_correct, payload.evidence_type, confidence_stated, now)
      .run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint failed')) {
      return { ok: false, error: 'duplicate_claim_feedback' };
    }
    throw e;
  }

  return {
    ok: true,
    row: {
      id,
      account_id: accountId,
      claim_id: payload.claim_id,
      outcome_correct,
      evidence_type: payload.evidence_type,
      confidence_stated,
      created_at: now,
    },
  };
}
