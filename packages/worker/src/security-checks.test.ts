/**
 * Unit Tests — CVE-2026-33579 Security Code Paths
 *
 * Tests three new code paths added in pl-cve-scope-hard-5972574:
 *   1. tokens.ts    validateScopeCeiling()         — scope ceiling enforcement
 *   2. credentials.ts shouldBlockCredentialApproval() — restricted-account gate
 *   3. auth.ts      stripEphemeral()               — ephemeral field stripping
 *
 * All helpers are pure functions (no I/O, no KV, no HTTP context) — fast unit tests.
 */

import { describe, test, expect } from 'bun:test';
import { validateScopeCeiling } from './routes/tokens';
import { shouldBlockCredentialApproval } from './routes/credentials';
import { stripEphemeral } from './routes/auth';
import type { Account } from './types';

// ─── 1. validateScopeCeiling ─────────────────────────────────────────────────
// tokens.ts scope ceiling check

describe('validateScopeCeiling', () => {
  test('requested scope in allowed_scopes → passes (returns null)', () => {
    const result = validateScopeCeiling(
      ['mcp:tools:read'],
      ['mcp:tools:read', 'mcp:tools:execute'],
    );
    expect(result).toBeNull();
  });

  test('all requested scopes in allowed_scopes → passes (returns null)', () => {
    const result = validateScopeCeiling(
      ['mcp:tools:read', 'mcp:tools:execute'],
      ['mcp:tools:read', 'mcp:tools:execute', 'mcp:resources:read'],
    );
    expect(result).toBeNull();
  });

  test('scope NOT in allowed_scopes → returns disallowed scopes array', () => {
    const result = validateScopeCeiling(
      ['mcp:admin'],
      ['mcp:tools:read'],
    );
    expect(result).toEqual(['mcp:admin']);
  });

  test('mixed request: some allowed, some not → returns only disallowed scopes', () => {
    const result = validateScopeCeiling(
      ['mcp:tools:read', 'mcp:admin', 'mcp:billing'],
      ['mcp:tools:read', 'mcp:tools:execute'],
    );
    expect(result).toEqual(['mcp:admin', 'mcp:billing']);
  });

  test('allowed_scopes empty array → check skipped (returns null, backward compat)', () => {
    const result = validateScopeCeiling(['mcp:tools:read'], []);
    expect(result).toBeNull();
  });

  test('allowed_scopes undefined → check skipped (returns null, backward compat)', () => {
    const result = validateScopeCeiling(['mcp:tools:read'], undefined);
    expect(result).toBeNull();
  });

  test('allowed_scopes null → check skipped (returns null)', () => {
    const result = validateScopeCeiling(['mcp:tools:read'], null);
    expect(result).toBeNull();
  });

  test('allowed_scopes non-array string → check skipped (returns null)', () => {
    const result = validateScopeCeiling(['mcp:tools:read'], 'mcp:tools:read');
    expect(result).toBeNull();
  });
});

// ─── 2. shouldBlockCredentialApproval ────────────────────────────────────────
// credentials.ts restricted-account gate

describe('shouldBlockCredentialApproval', () => {
  test('approval attempt for restricted account → blocked (returns true)', () => {
    const result = shouldBlockCredentialApproval(false, { status: 'restricted' });
    expect(result).toBe(true);
  });

  test('denial attempt for restricted account → allowed (returns false)', () => {
    // Denials are always allowed — operators must be able to close stale requests
    // even for restricted accounts.
    const result = shouldBlockCredentialApproval(true, { status: 'restricted' });
    expect(result).toBe(false);
  });

  test('approval attempt for non-restricted account → allowed (returns false)', () => {
    const result = shouldBlockCredentialApproval(false, { status: 'verified' });
    expect(result).toBe(false);
  });

  test('approval attempt for unverified account → allowed (returns false)', () => {
    const result = shouldBlockCredentialApproval(false, { status: 'unverified' });
    expect(result).toBe(false);
  });

  test('approval attempt for account with no status field → allowed (returns false)', () => {
    // fail-open: accounts without a status field are not treated as restricted.
    const result = shouldBlockCredentialApproval(false, {});
    expect(result).toBe(false);
  });

  test('denial attempt for non-restricted account → allowed (returns false)', () => {
    const result = shouldBlockCredentialApproval(true, { status: 'verified' });
    expect(result).toBe(false);
  });
});

// ─── 3. stripEphemeral ────────────────────────────────────────────────────────
// auth.ts ephemeral field stripping before KV write

describe('stripEphemeral', () => {
  test('_session field removed from returned copy', () => {
    const account: Account = {
      id: 'acc_test',
      _session: 'sess_abc123',
    };
    const result = stripEphemeral(account);
    expect(result._session).toBeUndefined();
  });

  test('returns shallow copy — original object not mutated', () => {
    const account: Account = {
      id: 'acc_test',
      _session: 'sess_abc123',
    };
    stripEphemeral(account);
    // Original must still have _session intact
    expect(account._session).toBe('sess_abc123');
  });

  test('other fields preserved in returned copy', () => {
    const account: Account = {
      id: 'acc_test',
      key_prefix: 'al_live_',
      recovery_email: 'agent@example.com',
      operator_email: 'operator@example.com',
      plan: 'pro',
      tier: '2',
      status: 'verified',
      allowed_scopes: ['mcp:tools:read'],
      _session: 'sess_abc123',
    };
    const result = stripEphemeral(account);
    expect(result.id).toBe('acc_test');
    expect(result.key_prefix).toBe('al_live_');
    expect(result.recovery_email).toBe('agent@example.com');
    expect(result.operator_email).toBe('operator@example.com');
    expect(result.plan).toBe('pro');
    expect(result.tier).toBe('2');
    expect(result.status).toBe('verified');
    expect(result.allowed_scopes).toEqual(['mcp:tools:read']);
    expect(result._session).toBeUndefined();
  });

  test('account without _session → returned copy unchanged', () => {
    const account: Account = {
      id: 'acc_no_session',
      plan: 'free',
    };
    const result = stripEphemeral(account);
    expect(result.id).toBe('acc_no_session');
    expect(result.plan).toBe('free');
    expect(result._session).toBeUndefined();
  });

  test('returned copy is a new object (not the same reference)', () => {
    const account: Account = { id: 'acc_test' };
    const result = stripEphemeral(account);
    expect(result).not.toBe(account);
  });
});
