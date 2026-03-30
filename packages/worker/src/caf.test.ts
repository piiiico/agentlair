/**
 * CAF (Commitment Attestation Format) — Tests
 *
 * Tests for:
 * - canonicalize(): key sorting, id/sig exclusion, null values preserved, nested sorted
 * - computeId(): deterministic, prefixed with 'sha256:'
 * - signAttestation(): produces valid Ed25519 signature verifiable with public key
 * - auditEntryToCAF(): correct field mapping per spec section 9
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  canonicalize,
  computeId,
  signAttestation,
  auditEntryToCAF,
} from './caf';
import type { CommitmentAttestation } from './caf';
import type { AuditEntry } from './middleware/audit';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateTestKeypair(): { privateKeyB64: string; publicKeyBytes: Uint8Array } {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));
  return { privateKeyB64, publicKeyBytes };
}

function makeMinimalAttestation(overrides: Partial<CommitmentAttestation> = {}): CommitmentAttestation {
  return {
    id: 'sha256:test',
    schema: 'caf:v0.1',
    attester: { type: 'agent', id: 'acc_test' },
    subject: { type: 'agent', id: 'acc_test' },
    timestamp: '2026-03-29T10:00:00.000Z',
    created_at: '2026-03-29T10:00:00.000Z',
    expires_at: null,
    revoked_at: null,
    source: 'agentlair',
    commitment_type: 'agent.action',
    body: { action: 'email.send', method: 'POST', path: '/v1/email/send', result: 'success', status: 200, approval_required: false, approval_granted: null, prev_hash: '0'.repeat(64), details: null },
    cost_signal: { type: 'credential', description: 'Test', magnitude: null, unit: null },
    evidence: [],
    ref: [],
    sig: { alg: 'EdDSA', kid: 'deadbeef', value: 'testvalue' },
    ...overrides,
  };
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'entry123',
    timestamp: '2026-03-29T14:32:15.123Z',
    account_id: 'acc_xyz789',
    actor_type: 'account',
    actor_id: 'acc_xyz789',
    actor_ip_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    category: 'email',
    action: 'email.send',
    method: 'POST',
    path: '/v1/email/send',
    resource_type: 'email',
    resource_id: 'msg_001',
    status: 200,
    result: 'success',
    error_code: null,
    details: { to_count: 3, has_body: true, idempotent_replay: false },
    prev_hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    signature: 'BU5EjPO+E9aS3testbases64signature==',
    ...overrides,
  };
}

// ─── canonicalize() ───────────────────────────────────────────────────────────

describe('canonicalize', () => {
  test('excludes id and sig fields', () => {
    const attestation = makeMinimalAttestation();
    const result = canonicalize(attestation);
    const parsed = JSON.parse(result);

    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('sig');
  });

  test('includes all other fields', () => {
    const attestation = makeMinimalAttestation();
    const result = canonicalize(attestation);
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty('schema');
    expect(parsed).toHaveProperty('attester');
    expect(parsed).toHaveProperty('subject');
    expect(parsed).toHaveProperty('timestamp');
    expect(parsed).toHaveProperty('commitment_type');
    expect(parsed).toHaveProperty('body');
    expect(parsed).toHaveProperty('cost_signal');
    expect(parsed).toHaveProperty('evidence');
    expect(parsed).toHaveProperty('ref');
  });

  test('sorts top-level keys alphabetically', () => {
    const attestation = makeMinimalAttestation();
    const result = canonicalize(attestation);
    const parsed = JSON.parse(result);
    const keys = Object.keys(parsed);
    const sortedKeys = [...keys].sort();

    expect(keys).toEqual(sortedKeys);
  });

  test('sorts nested object keys alphabetically', () => {
    const attestation = makeMinimalAttestation({
      body: { z_field: 'last', a_field: 'first', m_field: 'middle' },
    });
    const result = canonicalize(attestation);
    const parsed = JSON.parse(result);
    const bodyKeys = Object.keys(parsed.body);
    const sortedBodyKeys = [...bodyKeys].sort();

    expect(bodyKeys).toEqual(sortedBodyKeys);
  });

  test('preserves null values (does not strip them)', () => {
    const attestation = makeMinimalAttestation({
      expires_at: null,
      revoked_at: null,
    });
    const result = canonicalize(attestation);
    const parsed = JSON.parse(result);

    expect(parsed.expires_at).toBeNull();
    expect(parsed.revoked_at).toBeNull();
  });

  test('produces compact JSON (no whitespace)', () => {
    const attestation = makeMinimalAttestation();
    const result = canonicalize(attestation);

    // Compact JSON has no spaces after colons or commas
    expect(result).not.toMatch(/:\s/);
    expect(result).not.toMatch(/,\s/);
  });

  test('same attestation always produces same canonical form', () => {
    const attestation = makeMinimalAttestation();
    const result1 = canonicalize(attestation);
    const result2 = canonicalize(attestation);

    expect(result1).toBe(result2);
  });

  test('different attestations produce different canonical forms', () => {
    const att1 = makeMinimalAttestation({ timestamp: '2026-01-01T00:00:00Z' });
    const att2 = makeMinimalAttestation({ timestamp: '2026-01-02T00:00:00Z' });

    expect(canonicalize(att1)).not.toBe(canonicalize(att2));
  });

  test('deeply nested objects are also sorted', () => {
    const attestation = makeMinimalAttestation({
      body: {
        nested: { z_nested: 'z', a_nested: 'a' },
        action: 'test',
      },
    });
    const result = canonicalize(attestation);
    const parsed = JSON.parse(result);
    const nestedKeys = Object.keys(parsed.body.nested);

    expect(nestedKeys).toEqual([...nestedKeys].sort());
  });
});

// ─── computeId() ─────────────────────────────────────────────────────────────

describe('computeId', () => {
  test('returns string prefixed with "sha256:"', async () => {
    const attestation = makeMinimalAttestation();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;
    const id = await computeId(withoutIdAndSig);

    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('is deterministic for same input', async () => {
    const attestation = makeMinimalAttestation();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;

    const id1 = await computeId(withoutIdAndSig);
    const id2 = await computeId(withoutIdAndSig);

    expect(id1).toBe(id2);
  });

  test('different content produces different IDs', async () => {
    const att1 = makeMinimalAttestation({ timestamp: '2026-01-01T00:00:00Z' });
    const att2 = makeMinimalAttestation({ timestamp: '2026-01-02T00:00:00Z' });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _i1, sig: _s1, ...rest1 } = att1;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _i2, sig: _s2, ...rest2 } = att2;

    const id1 = await computeId(rest1);
    const id2 = await computeId(rest2);

    expect(id1).not.toBe(id2);
  });

  test('hex part is exactly 64 characters (sha256)', async () => {
    const attestation = makeMinimalAttestation();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;
    const id = await computeId(withoutIdAndSig);
    const hexPart = id.replace('sha256:', '');

    expect(hexPart.length).toBe(64);
    expect(hexPart).toMatch(/^[0-9a-f]+$/);
  });
});

// ─── signAttestation() ───────────────────────────────────────────────────────

describe('signAttestation', () => {
  test('returns AttestationSignature with correct shape', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const attestation = makeMinimalAttestation();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;

    const sig = await signAttestation(withoutIdAndSig, privateKeyB64);

    expect(sig.alg).toBe('EdDSA');
    expect(typeof sig.kid).toBe('string');
    expect(sig.kid.length).toBe(8);
    expect(sig.kid).toMatch(/^[0-9a-f]{8}$/);
    expect(typeof sig.value).toBe('string');
    expect(sig.value.length).toBeGreaterThan(0);
  });

  test('signature is 64 bytes (Ed25519)', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const attestation = makeMinimalAttestation();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;

    const sig = await signAttestation(withoutIdAndSig, privateKeyB64);
    const signatureBytes = Uint8Array.from(atob(sig.value), c => c.charCodeAt(0));

    expect(signatureBytes.length).toBe(64);
  });

  test('signature verifies with Ed25519.verify', async () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const attestation = makeMinimalAttestation();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;

    const sig = await signAttestation(withoutIdAndSig, privateKeyB64);

    // Reconstruct what was signed: canonical JSON of attestation without id/sig
    const canonical = canonicalize(attestation as CommitmentAttestation);
    const messageBytes = new TextEncoder().encode(canonical);
    const signatureBytes = Uint8Array.from(atob(sig.value), c => c.charCodeAt(0));

    const valid = ed25519.verify(signatureBytes, messageBytes, publicKeyBytes);
    expect(valid).toBe(true);
  });

  test('signature is deterministic (same key + content = same sig)', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const attestation = makeMinimalAttestation();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;

    const sig1 = await signAttestation(withoutIdAndSig, privateKeyB64);
    const sig2 = await signAttestation(withoutIdAndSig, privateKeyB64);

    expect(sig1.value).toBe(sig2.value);
  });

  test('different keys produce different signatures', async () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();
    const attestation = makeMinimalAttestation();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;

    const sig1 = await signAttestation(withoutIdAndSig, kp1.privateKeyB64);
    const sig2 = await signAttestation(withoutIdAndSig, kp2.privateKeyB64);

    expect(sig1.value).not.toBe(sig2.value);
    expect(sig1.kid).not.toBe(sig2.kid);
  });

  test('wrong public key fails to verify signature', async () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();
    const attestation = makeMinimalAttestation();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;

    const sig = await signAttestation(withoutIdAndSig, kp1.privateKeyB64);
    const canonical = canonicalize(attestation as CommitmentAttestation);
    const messageBytes = new TextEncoder().encode(canonical);
    const signatureBytes = Uint8Array.from(atob(sig.value), c => c.charCodeAt(0));

    const valid = ed25519.verify(signatureBytes, messageBytes, kp2.publicKeyBytes);
    expect(valid).toBe(false);
  });
});

// ─── auditEntryToCAF() ───────────────────────────────────────────────────────

describe('auditEntryToCAF', () => {
  test('returns a complete CommitmentAttestation with all required fields', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry();
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.id).toBeDefined();
    expect(attestation.schema).toBe('caf:v0.1');
    expect(attestation.attester).toBeDefined();
    expect(attestation.subject).toBeDefined();
    expect(attestation.timestamp).toBeDefined();
    expect(attestation.created_at).toBeDefined();
    expect(attestation.source).toBe('agentlair');
    expect(attestation.commitment_type).toBe('agent.action');
    expect(attestation.body).toBeDefined();
    expect(attestation.cost_signal).toBeDefined();
    expect(attestation.evidence).toBeDefined();
    expect(attestation.ref).toBeDefined();
    expect(attestation.sig).toBeDefined();
  });

  test('maps attester and subject to account_id', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry({ account_id: 'acc_xyz789' });
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.attester.type).toBe('agent');
    expect(attestation.attester.id).toBe('acc_xyz789');
    expect(attestation.subject.type).toBe('agent');
    expect(attestation.subject.id).toBe('acc_xyz789');
  });

  test('maps timestamp from AuditEntry', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry({ timestamp: '2026-03-29T14:32:15.123Z' });
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.timestamp).toBe('2026-03-29T14:32:15.123Z');
    expect(attestation.created_at).toBe('2026-03-29T14:32:15.123Z');
  });

  test('sets expires_at and revoked_at to null', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry();
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.expires_at).toBeNull();
    expect(attestation.revoked_at).toBeNull();
  });

  test('body contains correct action fields from AuditEntry', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry({
      action: 'email.send',
      method: 'POST',
      path: '/v1/email/send',
      result: 'success',
      status: 200,
      prev_hash: 'a1b2c3d4'.repeat(8),
      details: { to_count: 3 },
    });
    const attestation = await auditEntryToCAF(entry, privateKeyB64);
    const body = attestation.body as Record<string, unknown>;

    expect(body.action).toBe('email.send');
    expect(body.method).toBe('POST');
    expect(body.path).toBe('/v1/email/send');
    expect(body.result).toBe('success');
    expect(body.status).toBe(200);
    expect(body.approval_required).toBe(false);
    expect(body.approval_granted).toBeNull();
    expect(body.prev_hash).toBe('a1b2c3d4'.repeat(8));
    expect((body.details as Record<string, unknown>).to_count).toBe(3);
  });

  test('cost_signal is credential type with account_id in description', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry({ account_id: 'acc_test123' });
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.cost_signal.type).toBe('credential');
    expect(attestation.cost_signal.description).toContain('acc_test123');
    expect(attestation.cost_signal.magnitude).toBeNull();
    expect(attestation.cost_signal.unit).toBeNull();
  });

  test('evidence contains original signature as hash and audit trail as url', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry({
      signature: 'testSignatureValue==',
      account_id: 'acc_evidencetest',
    });
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.evidence.length).toBe(2);
    const hashEvidence = attestation.evidence.find(e => e.type === 'hash');
    const urlEvidence = attestation.evidence.find(e => e.type === 'url');

    expect(hashEvidence).toBeDefined();
    expect(hashEvidence!.label).toBe('Original audit entry signature');
    expect(hashEvidence!.value).toContain('testSignatureValue==');

    expect(urlEvidence).toBeDefined();
    expect(urlEvidence!.label).toBe('AgentLair audit trail');
    expect(urlEvidence!.value as string).toContain('acc_evidencetest');
  });

  test('ref is empty array', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry();
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.ref).toEqual([]);
  });

  test('id is prefixed with sha256:', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry();
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('id is content-addressable (same entry + same key = same id)', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry();

    const att1 = await auditEntryToCAF(entry, privateKeyB64);
    const att2 = await auditEntryToCAF(entry, privateKeyB64);

    expect(att1.id).toBe(att2.id);
  });

  test('different entries produce different ids', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry1 = makeAuditEntry({ timestamp: '2026-01-01T00:00:00Z' });
    const entry2 = makeAuditEntry({ timestamp: '2026-01-02T00:00:00Z' });

    const att1 = await auditEntryToCAF(entry1, privateKeyB64);
    const att2 = await auditEntryToCAF(entry2, privateKeyB64);

    expect(att1.id).not.toBe(att2.id);
  });

  test('sig is valid Ed25519 signature verifiable with public key', async () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const entry = makeAuditEntry();
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    // Reconstruct what was signed
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, sig: _sig, ...withoutIdAndSig } = attestation;
    const canonical = canonicalize(attestation);
    const messageBytes = new TextEncoder().encode(canonical);
    const signatureBytes = Uint8Array.from(atob(attestation.sig.value), c => c.charCodeAt(0));

    const valid = ed25519.verify(signatureBytes, messageBytes, publicKeyBytes);
    expect(valid).toBe(true);
  });

  test('sig.alg is EdDSA', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry();
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.sig.alg).toBe('EdDSA');
  });

  test('sig.kid is 8-char hex', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeAuditEntry();
    const attestation = await auditEntryToCAF(entry, privateKeyB64);

    expect(attestation.sig.kid).toMatch(/^[0-9a-f]{8}$/);
  });
});
