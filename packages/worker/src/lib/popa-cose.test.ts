/**
 * PoPA COSE Helpers — Tests
 *
 * Verifies:
 *   - canonicalJSON produces deterministic, sorted-key output
 *   - reconstructPopaSignedStatement produces a valid COSE_Sign1 envelope
 *   - The signature in that envelope verifies via Ed25519 against the public key
 *   - Re-running reconstruction with the same inputs produces byte-identical output
 *   - The decoded protected header carries the expected PoPA fields
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  canonicalJSON,
  reconstructPopaSignedStatement,
  buildSigStructure,
  AGENTLAIR_ROOT_DID,
  type PopaAttestationRow,
} from './popa-cose';
import { decodeCoseSign1, getHeaderInt, getHeaderText } from '../cbor-decode';

// Generate a deterministic test key (32 bytes of 0xab)
const TEST_PRIV = new Uint8Array(32).fill(0xab);
const TEST_PRIV_B64 = btoa(String.fromCharCode(...TEST_PRIV));
const TEST_PUB = ed25519.getPublicKey(TEST_PRIV);

const SAMPLE_ROW: PopaAttestationRow = {
  agent_did: 'did:web:agentlair.dev',
  entry_id: 'popa_test_zXXXXXXXXXXXX',
  sequence: 7,
  window_start: '2026-05-03T00:00:00.000Z',
  window_end: '2026-05-04T00:00:00.000Z',
  mcp_call_count: 42,
  issued_at: '2026-05-04T00:00:01.234Z',
  prev_attestation_id: 'scitt:popa_prev_test',
};

describe('canonicalJSON', () => {
  test('sorts object keys lexicographically', () => {
    expect(canonicalJSON({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  test('preserves array order', () => {
    expect(canonicalJSON([3, 1, 2])).toBe('[3,1,2]');
  });

  test('handles nested objects', () => {
    const out = canonicalJSON({ outer: { z: 1, a: 2 }, top: 'x' });
    expect(out).toBe('{"outer":{"a":2,"z":1},"top":"x"}');
  });

  test('handles primitives', () => {
    expect(canonicalJSON(null)).toBe('null');
    expect(canonicalJSON(true)).toBe('true');
    expect(canonicalJSON(42)).toBe('42');
    expect(canonicalJSON('hello')).toBe('"hello"');
  });
});

describe('reconstructPopaSignedStatement', () => {
  test('produces a parseable COSE_Sign1', async () => {
    const r = await reconstructPopaSignedStatement(SAMPLE_ROW, TEST_PRIV_B64);

    expect(r.coseBytes.length).toBeGreaterThan(0);
    expect(r.signatureBytes.length).toBe(64);   // Ed25519 signature size

    const decoded = decodeCoseSign1(r.coseBytes);
    expect(decoded.signature.length).toBe(64);
    expect(decoded.payload).not.toBeNull();
  });

  test('signature verifies against the public key', async () => {
    const r = await reconstructPopaSignedStatement(SAMPLE_ROW, TEST_PRIV_B64);
    const valid = ed25519.verify(r.signatureBytes, r.signingInputBytes, TEST_PUB);
    expect(valid).toBe(true);
  });

  test('signature still verifies after a round-trip through decode', async () => {
    const r = await reconstructPopaSignedStatement(SAMPLE_ROW, TEST_PRIV_B64);
    const decoded = decodeCoseSign1(r.coseBytes);

    const sigStructure = buildSigStructure(decoded.protected, decoded.payload!);
    const valid = ed25519.verify(decoded.signature, sigStructure, TEST_PUB);
    expect(valid).toBe(true);
  });

  test('protected header carries PoPA-specific fields', async () => {
    const r = await reconstructPopaSignedStatement(SAMPLE_ROW, TEST_PRIV_B64);
    const decoded = decodeCoseSign1(r.coseBytes);

    expect(getHeaderInt(decoded.protectedMap, 1)).toBe(-8);                            // alg: EdDSA
    expect(getHeaderInt(decoded.protectedMap, 3)).toBe('application/popa+json');       // content-type
    expect(getHeaderInt(decoded.protectedMap, 391)).toBe(AGENTLAIR_ROOT_DID);          // issuer
    expect(getHeaderText(decoded.protectedMap, 'PoPA-sequence')).toBe(SAMPLE_ROW.sequence);
  });

  test('payload is the canonical attestation core JSON', async () => {
    const r = await reconstructPopaSignedStatement(SAMPLE_ROW, TEST_PRIV_B64);
    const text = new TextDecoder().decode(r.payloadBytes);
    const parsed = JSON.parse(text);

    expect(parsed.agent_did).toBe(SAMPLE_ROW.agent_did);
    expect(parsed.sequence).toBe(SAMPLE_ROW.sequence);
    expect(parsed.window_start).toBe(SAMPLE_ROW.window_start);
    expect(parsed.window_end).toBe(SAMPLE_ROW.window_end);
    expect(parsed.timestamp).toBe(SAMPLE_ROW.issued_at);
    expect(parsed.activity_proof.type).toBe('mcp_call_count');
    expect(parsed.activity_proof.count).toBe(SAMPLE_ROW.mcp_call_count);
    expect(parsed.activity_proof.window_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parsed.prev_attestation_id).toBe(SAMPLE_ROW.prev_attestation_id);
  });

  test('reconstruction is deterministic — same inputs → same bytes', async () => {
    const a = await reconstructPopaSignedStatement(SAMPLE_ROW, TEST_PRIV_B64);
    const b = await reconstructPopaSignedStatement(SAMPLE_ROW, TEST_PRIV_B64);
    expect(Array.from(a.coseBytes)).toEqual(Array.from(b.coseBytes));
  });

  test('changing any field changes the bytes', async () => {
    const a = await reconstructPopaSignedStatement(SAMPLE_ROW, TEST_PRIV_B64);
    const b = await reconstructPopaSignedStatement(
      { ...SAMPLE_ROW, mcp_call_count: SAMPLE_ROW.mcp_call_count + 1 },
      TEST_PRIV_B64,
    );
    expect(Array.from(a.coseBytes)).not.toEqual(Array.from(b.coseBytes));
  });

  test('tampered payload fails verification', async () => {
    const r = await reconstructPopaSignedStatement(SAMPLE_ROW, TEST_PRIV_B64);

    // Build a different payload but use the original signature
    const tampered = new TextEncoder().encode('{"tampered":true}');
    const tamperedSigStructure = buildSigStructure(
      decodeCoseSign1(r.coseBytes).protected,
      tampered,
    );
    const valid = ed25519.verify(r.signatureBytes, tamperedSigStructure, TEST_PUB);
    expect(valid).toBe(false);
  });
});
