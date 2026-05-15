/**
 * OperatorProfile lib tests — validators and D1 storage round-trip.
 *
 * All tests are hermetic: no network access, no live AUDIT secret.
 * D1 mock uses a Map-backed in-memory store.
 */

import { describe, test, expect } from 'bun:test';
import {
  validateAttestationWorkflow,
  validateReviewBandwidth,
  validatePutOperatorProfileBody,
  getOperatorProfile,
  putOperatorProfile,
} from './operator-profile.js';
import type { Env } from '../types.js';

// ─── Minimal D1 mock for operator_profiles ────────────────────────────────────

interface MockD1 extends D1Database {
  store: Map<string, Record<string, unknown>>;
}

function makeMockD1(): MockD1 {
  const store: Map<string, Record<string, unknown>> = new Map();

  const makeStmt = (sql: string) => {
    let bindings: unknown[] = [];

    const stmt = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        const q = sql.trim().toLowerCase();

        // SELECT from operator_profiles
        if (q.includes('from operator_profiles') && q.includes('where account_id')) {
          const accountId = bindings[0] as string;
          const row = store.get(accountId);
          return (row ?? null) as T | null;
        }

        // INSERT ... ON CONFLICT ... RETURNING *
        if (q.includes('insert into operator_profiles') && q.includes('returning')) {
          const [accountId, attestationWorkflowJson, reviewBandwidthJson] = bindings as string[];
          const now = new Date().toISOString();
          const existing = store.get(accountId!);
          const row: Record<string, unknown> = {
            account_id: accountId,
            attestation_workflow_json: attestationWorkflowJson,
            review_bandwidth_json: reviewBandwidthJson,
            created_at: existing ? (existing['created_at'] as string) : now,
            updated_at: now,
          };
          store.set(accountId!, row);
          return row as T;
        }

        return null as T | null;
      },
      async all<T>(): Promise<D1Result<T>> {
        return { results: [] as T[], success: true, meta: {} as D1ResultInfo };
      },
      async run(): Promise<D1Result<Record<string, unknown>>> {
        return { results: [], success: true, meta: {} as D1ResultInfo };
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
  } as unknown as MockD1;
}

function makeEnv(db: MockD1): Env {
  return { AUDIT: db } as unknown as Env;
}

// ─── validateAttestationWorkflow ──────────────────────────────────────────────

describe('validateAttestationWorkflow', () => {
  test('happy path — valid tier, tools, coverage; absent priorCoverage defaults to 0.4', () => {
    const result = validateAttestationWorkflow({
      declaredTier: 'automated_tooling',
      declaredTools: ['cargo-test', 'clippy', 'miri'],
      coverageEstimate: 0.7,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.priorCoverage).toBe(0.4);
      expect(result.value.declaredTier).toBe('automated_tooling');
      expect(result.value.declaredTools).toEqual(['cargo-test', 'clippy', 'miri']);
      expect(result.value.coverageEstimate).toBe(0.7);
    }
  });

  test('bad tier — returns invalid_declared_tier with hint containing agent_self_annotation', () => {
    const result = validateAttestationWorkflow({
      declaredTier: 'manual_glance',
      declaredTools: [],
      coverageEstimate: 0.5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_declared_tier');
      expect(result.hint).toContain('agent_self_annotation');
    }
  });

  test('tools length cap — 33 elements yields invalid_declared_tools', () => {
    const result = validateAttestationWorkflow({
      declaredTier: 'automated_tooling',
      declaredTools: Array.from({ length: 33 }, (_, i) => `tool${i}`),
      coverageEstimate: 0.5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_declared_tools');
    }
  });
});

// ─── validateReviewBandwidth ──────────────────────────────────────────────────

describe('validateReviewBandwidth', () => {
  test('happy path — 2 reviewers, 200 units/hr, 8 hours, lines', () => {
    const result = validateReviewBandwidth({
      reviewersCount: 2,
      unitsPerHour: 200,
      timeToNextApprovalHours: 8,
      unitType: 'lines',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reviewersCount).toBe(2);
      expect(result.value.unitsPerHour).toBe(200);
      expect(result.value.timeToNextApprovalHours).toBe(8);
      expect(result.value.unitType).toBe('lines');
    }
  });

  test('bad unitType — paragraphs yields invalid_unit_type with hint containing lines', () => {
    const result = validateReviewBandwidth({
      reviewersCount: 1,
      unitsPerHour: 100,
      timeToNextApprovalHours: 4,
      unitType: 'paragraphs',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_unit_type');
      expect(result.hint).toContain('lines');
    }
  });
});

// ─── putOperatorProfile + getOperatorProfile round-trip ───────────────────────

describe('putOperatorProfile + getOperatorProfile', () => {
  test('round-trip: PUT then GET returns identical nested fields', async () => {
    const db = makeMockD1();
    const env = makeEnv(db);
    const accountId = 'acc_test_roundtrip';

    const input = {
      attestationWorkflow: {
        declaredTier: 'automated_tooling' as const,
        declaredTools: ['cargo-test', 'clippy', 'miri'],
        coverageEstimate: 0.85,
        priorCoverage: 0.4,
      },
      reviewBandwidth: {
        reviewersCount: 2,
        unitsPerHour: 200,
        timeToNextApprovalHours: 8,
        unitType: 'lines' as const,
      },
    };

    const stored = await putOperatorProfile(env, accountId, input);
    expect(stored.accountId).toBe(accountId);
    expect(stored.attestationWorkflow).toEqual(input.attestationWorkflow);
    expect(stored.reviewBandwidth).toEqual(input.reviewBandwidth);
    expect(typeof stored.createdAt).toBe('string');
    expect(stored.createdAt.length).toBeGreaterThan(0);
    expect(typeof stored.updatedAt).toBe('string');
    expect(stored.updatedAt.length).toBeGreaterThan(0);

    const fetched = await getOperatorProfile(env, accountId);
    expect(fetched).not.toBeNull();
    if (fetched) {
      expect(fetched.accountId).toBe(accountId);
      expect(fetched.attestationWorkflow).toEqual(input.attestationWorkflow);
      expect(fetched.reviewBandwidth).toEqual(input.reviewBandwidth);
    }
  });

  test('getOperatorProfile returns null for unknown account', async () => {
    const db = makeMockD1();
    const env = makeEnv(db);
    const result = await getOperatorProfile(env, 'acc_does_not_exist');
    expect(result).toBeNull();
  });
});
