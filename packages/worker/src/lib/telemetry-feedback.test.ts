/**
 * Tests for telemetry-feedback lib: validators + insert round-trip.
 * Phase 2.5 Component 4 — spec: agentlair-trust-telemetry-feedback-20260515
 */

import { describe, test, expect } from 'bun:test';
import {
  validateFeedbackPayload,
  insertFeedback,
  FEEDBACK_EVIDENCE_TYPES,
} from './telemetry-feedback.js';
import type { Env } from '../types.js';

// ─── Mock D1 for lib tests ────────────────────────────────────────────────────

function makeMockD1ForLib() {
  const store: Map<string, Record<string, unknown>> = new Map();

  const makeStmt = (sql: string) => {
    let bindings: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async run(): Promise<{ success: boolean; meta: object }> {
        const q = sql.trim().toLowerCase();
        if (q.includes('insert into telemetry_feedback')) {
          const [id, account_id, claim_id] = bindings as string[];
          const key = `${account_id}::${claim_id}`;
          if (store.has(key)) {
            throw new Error('UNIQUE constraint failed: telemetry_feedback.account_id, telemetry_feedback.claim_id');
          }
          store.set(key, { id, account_id, claim_id, bindings });
          return { success: true, meta: {} };
        }
        return { success: true, meta: {} };
      },
      async first<T>(): Promise<T | null> {
        return null as T | null;
      },
      async all<T>(): Promise<{ results: T[]; success: boolean; meta: object }> {
        return { results: [], success: true, meta: {} };
      },
    };
    return stmt;
  };

  return {
    prepare: makeStmt,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    store,
  } as unknown as D1Database;
}

function makeEnv(db: D1Database | null): Env {
  return { AUDIT: db } as unknown as Env;
}

// ─── Validator tests ──────────────────────────────────────────────────────────

describe('validateFeedbackPayload', () => {
  test('happy path — full payload', () => {
    const result = validateFeedbackPayload({
      claim_id: 'claim_abc_001',
      outcome_correct: true,
      evidence_type: 'integration_test',
      confidence_stated: 0.9,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claim_id).toBe('claim_abc_001');
      expect(result.value.outcome_correct).toBe(true);
      expect(result.value.evidence_type).toBe('integration_test');
      expect(result.value.confidence_stated).toBe(0.9);
    }
  });

  test('missing claim_id → invalid_claim_id', () => {
    const result = validateFeedbackPayload({
      outcome_correct: true,
      evidence_type: 'integration_test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_claim_id');
  });

  test('non-boolean outcome_correct → invalid_outcome_correct', () => {
    const result = validateFeedbackPayload({
      claim_id: 'claim_abc_001',
      outcome_correct: 'true',
      evidence_type: 'integration_test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_outcome_correct');
  });

  test('bad evidence_type → invalid_evidence_type with hint', () => {
    const result = validateFeedbackPayload({
      claim_id: 'claim_abc_001',
      outcome_correct: false,
      evidence_type: 'gut_feeling',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_evidence_type');
      expect(result.hint).toContain('integration_test');
    }
  });

  test('confidence_stated optional — omit → ok with undefined', () => {
    const result = validateFeedbackPayload({
      claim_id: 'claim_abc_001',
      outcome_correct: true,
      evidence_type: 'manual_verification',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.confidence_stated).toBeUndefined();
  });

  test('extra field rejected → unexpected_field names the key', () => {
    const result = validateFeedbackPayload({
      claim_id: 'claim_abc_001',
      outcome_correct: true,
      evidence_type: 'integration_test',
      claim_correct: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('unexpected_field');
      expect(result.message).toContain('claim_correct');
    }
  });
});

// ─── insertFeedback round-trip ────────────────────────────────────────────────

describe('insertFeedback', () => {
  test('first insert returns ok:true with id; second same claim_id returns duplicate_claim_feedback', async () => {
    const db = makeMockD1ForLib();
    const env = makeEnv(db);
    const payload = { claim_id: 'claim_xyz', outcome_correct: true, evidence_type: 'integration_test' as const };

    const r1 = await insertFeedback(env, 'acc_test', payload);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.row.id).toBeTruthy();

    const r2 = await insertFeedback(env, 'acc_test', payload);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('duplicate_claim_feedback');
  });
});
