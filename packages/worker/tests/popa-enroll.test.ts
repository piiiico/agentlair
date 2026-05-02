/**
 * PoPA Enroll — DID validation unit tests.
 *
 * Pure-function coverage for the validator used by POST /v1/popa/enroll.
 * Endpoint-level behavior (auth, UPSERT, idempotency) is verified via
 * production smoke tests with real D1 round-trip.
 *
 * Run: bun test tests/popa-enroll.test.ts
 */

import { describe, test, expect } from 'bun:test';
import { isValidEnrollableDid } from '../src/routes/popa';

describe('isValidEnrollableDid', () => {
  test('accepts did:web with hostname', () => {
    expect(isValidEnrollableDid('did:web:agentlair.dev')).toBe(true);
  });

  test('accepts did:web with path segments (PicoClaw style)', () => {
    expect(isValidEnrollableDid('did:web:agentlair.dev:picoclaw:my-bot')).toBe(true);
  });

  test('accepts did:key', () => {
    expect(
      isValidEnrollableDid('did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH'),
    ).toBe(true);
  });

  test('rejects empty string', () => {
    expect(isValidEnrollableDid('')).toBe(false);
  });

  test('rejects bare prefix with no body', () => {
    expect(isValidEnrollableDid('did:web:')).toBe(false);
    expect(isValidEnrollableDid('did:key:')).toBe(false);
  });

  test('rejects unsupported DID methods', () => {
    expect(isValidEnrollableDid('did:ethr:0xabc')).toBe(false);
    expect(isValidEnrollableDid('did:ion:abc')).toBe(false);
    expect(isValidEnrollableDid('did:peer:abc')).toBe(false);
  });

  test('rejects non-DID strings', () => {
    expect(isValidEnrollableDid('agentlair.dev')).toBe(false);
    expect(isValidEnrollableDid('https://agentlair.dev')).toBe(false);
    expect(isValidEnrollableDid('not-a-did')).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(isValidEnrollableDid(undefined)).toBe(false);
    expect(isValidEnrollableDid(null)).toBe(false);
    expect(isValidEnrollableDid(42)).toBe(false);
    expect(isValidEnrollableDid({})).toBe(false);
    expect(isValidEnrollableDid([])).toBe(false);
    expect(isValidEnrollableDid(true)).toBe(false);
  });

  test('rejects DIDs over 512 chars (defensive cap)', () => {
    const huge = 'did:web:' + 'a'.repeat(600);
    expect(isValidEnrollableDid(huge)).toBe(false);
  });

  test('accepts DIDs at the 512-char boundary', () => {
    const tail = 'a'.repeat(512 - 'did:web:'.length);
    const did = 'did:web:' + tail;
    expect(did.length).toBe(512);
    expect(isValidEnrollableDid(did)).toBe(true);
  });

  test('case-sensitive prefix — rejects mixed case', () => {
    // DID method names are lowercase per spec; we reject unconventional casing.
    expect(isValidEnrollableDid('DID:WEB:agentlair.dev')).toBe(false);
    expect(isValidEnrollableDid('Did:Web:agentlair.dev')).toBe(false);
  });
});
