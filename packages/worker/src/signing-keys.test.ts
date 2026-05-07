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
import { computeSigningKeyId, computeJwkThumbprint, getSigningKeyByThumbprint, type SigningKeyRecord } from './routes/signing-keys';

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

// ─── computeJwkThumbprint ─────────────────────────────────────────────────────

describe('computeJwkThumbprint', () => {
  test('returns a string of exactly 43 characters (base64url SHA-256)', async () => {
    const pubKey = makeTestPublicKey();
    const thumbprint = await computeJwkThumbprint(pubKey);
    expect(typeof thumbprint).toBe('string');
    expect(thumbprint.length).toBe(43);
  });

  test('contains only base64url-safe characters', async () => {
    for (let i = 0; i < 10; i++) {
      const pubKey = makeTestPublicKey();
      const thumbprint = await computeJwkThumbprint(pubKey);
      expect(/^[A-Za-z0-9_-]+$/.test(thumbprint)).toBe(true);
    }
  });

  test('is deterministic — same input produces same thumbprint', async () => {
    const seed = new Uint8Array(32).fill(42);
    const pubKey = makeTestPublicKey(seed);
    const t1 = await computeJwkThumbprint(pubKey);
    const t2 = await computeJwkThumbprint(pubKey);
    expect(t1).toBe(t2);
  });

  test('different public keys produce different thumbprints', async () => {
    const pubKey1 = makeTestPublicKey(new Uint8Array(32).fill(3));
    const pubKey2 = makeTestPublicKey(new Uint8Array(32).fill(4));
    const t1 = await computeJwkThumbprint(pubKey1);
    const t2 = await computeJwkThumbprint(pubKey2);
    expect(t1).not.toBe(t2);
  });

  test('uses RFC 7638 canonical JSON — lexicographic member order', async () => {
    const seed = new Uint8Array(32).fill(5);
    const pubKey = makeTestPublicKey(seed);
    const x = b64urlEncode(pubKey);
    // Canonical form per RFC 7638 §3.2: {"crv":"Ed25519","kty":"OKP","x":"<b64url>"}
    const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${x}"}`;
    const buf = new TextEncoder().encode(canonical).buffer as ArrayBuffer;
    const hash = await crypto.subtle.digest('SHA-256', buf);
    const expected = b64urlEncode(new Uint8Array(hash));
    const actual = await computeJwkThumbprint(pubKey);
    expect(actual).toBe(expected);
  });
});

// ─── getSigningKeyByThumbprint ────────────────────────────────────────────────

describe('getSigningKeyByThumbprint', () => {
  function makeKvEnv(store: Record<string, string>) {
    return {
      KEYS: {
        get: async (key: string) => store[key] ?? null,
      },
    } as unknown as import('./types').Env;
  }

  test('returns null when thumbprint is not in KV', async () => {
    const env = makeKvEnv({});
    const result = await getSigningKeyByThumbprint(env, 'nonexistent-thumbprint');
    expect(result).toBeNull();
  });

  test('returns null when thumbprint index points to missing key record', async () => {
    const thumbprint = 'abc123';
    const env = makeKvEnv({
      [`signing-key-thumbprint:${thumbprint}`]: JSON.stringify({ keyid: 'missingkeyid' }),
      // No 'signing-key:missingkeyid' entry
    });
    const result = await getSigningKeyByThumbprint(env, thumbprint);
    expect(result).toBeNull();
  });

  test('returns full SigningKeyRecord when thumbprint index and key record both exist', async () => {
    const seed = new Uint8Array(32).fill(99);
    const pubKey = makeTestPublicKey(seed);
    const thumbprint = await computeJwkThumbprint(pubKey);
    const keyid = 'test-keyid-22chars!!';

    const record: SigningKeyRecord = {
      keyid,
      algorithm: 'ed25519',
      public_key: b64urlEncode(pubKey),
      agent_id: 'acc_test',
      registered_at: '2026-01-01T00:00:00.000Z',
      status: 'active',
    };

    const env = makeKvEnv({
      [`signing-key-thumbprint:${thumbprint}`]: JSON.stringify({ keyid }),
      [`signing-key:${keyid}`]: JSON.stringify(record),
    });

    const result = await getSigningKeyByThumbprint(env, thumbprint);
    expect(result).not.toBeNull();
    expect(result!.keyid).toBe(keyid);
    expect(result!.agent_id).toBe('acc_test');
    expect(result!.status).toBe('active');
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
