/**
 * RFC 9421 Signing Keys — Unit Tests
 *
 * Tests for:
 * - computeSigningKeyId: key ID computation (base64url SHA-256 prefix)
 * - Key ID format: exactly 22 chars, base64url chars only
 * - Key ID determinism: same input → same keyid
 * - Key ID uniqueness: different inputs → different keyids
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { b64urlEncode, b64urlDecode } from './jwt';
import { computeSigningKeyId } from './routes/signing-keys';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a deterministic Ed25519 keypair for testing. */
function makeTestPublicKey(seed?: Uint8Array): Uint8Array {
  const privateKey = seed ?? crypto.getRandomValues(new Uint8Array(32));
  return ed25519.getPublicKey(privateKey);
}

// ─── computeSigningKeyId ──────────────────────────────────────────────────────

describe('computeSigningKeyId', () => {
  test('returns a string of exactly 22 characters', async () => {
    const pubKey = makeTestPublicKey();
    const keyid = await computeSigningKeyId(pubKey);
    expect(typeof keyid).toBe('string');
    expect(keyid.length).toBe(22);
  });

  test('contains only base64url-safe characters', async () => {
    // Run multiple times to catch edge cases
    for (let i = 0; i < 10; i++) {
      const pubKey = makeTestPublicKey();
      const keyid = await computeSigningKeyId(pubKey);
      expect(/^[A-Za-z0-9_-]+$/.test(keyid)).toBe(true);
    }
  });

  test('is deterministic — same input produces same keyid', async () => {
    const seed = new Uint8Array(32).fill(42); // deterministic seed
    const pubKey = makeTestPublicKey(seed);
    const keyid1 = await computeSigningKeyId(pubKey);
    const keyid2 = await computeSigningKeyId(pubKey);
    expect(keyid1).toBe(keyid2);
  });

  test('different public keys produce different keyids', async () => {
    const pubKey1 = makeTestPublicKey(new Uint8Array(32).fill(1));
    const pubKey2 = makeTestPublicKey(new Uint8Array(32).fill(2));
    const keyid1 = await computeSigningKeyId(pubKey1);
    const keyid2 = await computeSigningKeyId(pubKey2);
    expect(keyid1).not.toBe(keyid2);
  });

  test('is a prefix of base64url(SHA-256(pubkey))', async () => {
    const seed = new Uint8Array(32).fill(7);
    const pubKey = makeTestPublicKey(seed);

    // Compute expected value manually
    const buf = pubKey.buffer.slice(pubKey.byteOffset, pubKey.byteOffset + pubKey.byteLength);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    const hashBytes = new Uint8Array(hash);
    const expectedFull = b64urlEncode(hashBytes);
    const expected22 = expectedFull.slice(0, 22);

    const keyid = await computeSigningKeyId(pubKey);
    expect(keyid).toBe(expected22);
  });
});

// ─── b64urlEncode / b64urlDecode round-trip (used in signing key logic) ───────

describe('base64url round-trip (for signing key public keys)', () => {
  test('32-byte Ed25519 public key encodes and decodes correctly', () => {
    const pubKey = makeTestPublicKey();
    const encoded = b64urlEncode(pubKey);
    const decoded = b64urlDecode(encoded);
    expect(decoded.length).toBe(32);
    expect(decoded).toEqual(pubKey);
  });

  test('encoded public key contains no standard base64 padding', () => {
    // base64url should never have = padding
    const pubKey = makeTestPublicKey();
    const encoded = b64urlEncode(pubKey);
    expect(encoded).not.toContain('=');
  });

  test('encoded public key uses - not + and _ not /', () => {
    // Check against standard base64 chars that base64url replaces
    const pubKey = makeTestPublicKey();
    const encoded = b64urlEncode(pubKey);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });
});
