/**
 * AgentLair Crypto Module — Tests
 * Run with: bun test src/crypto.test.ts
 */

import { describe, test, expect } from 'bun:test';
import {
  generateMasterSeed,
  deriveKeyPair,
  encrypt,
  decrypt,
  serializeEncrypted,
  deserializeEncrypted,
} from './crypto';

// ─── Helper ────────────────────────────────────────────────────────────────

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── generateMasterSeed ────────────────────────────────────────────────────

describe('generateMasterSeed', () => {
  test('returns 32 bytes', () => {
    const seed = generateMasterSeed();
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(32);
  });

  test('two seeds are different (randomness check)', () => {
    const a = generateMasterSeed();
    const b = generateMasterSeed();
    expect(hexOf(a)).not.toBe(hexOf(b));
  });
});

// ─── deriveKeyPair ─────────────────────────────────────────────────────────

describe('deriveKeyPair', () => {
  test('returns 32-byte key pairs', async () => {
    const seed = generateMasterSeed();
    const kp = await deriveKeyPair(seed, 0);

    expect(kp.publicKeyBytes).toBeInstanceOf(Uint8Array);
    expect(kp.privateKeyBytes).toBeInstanceOf(Uint8Array);
    expect(kp.publicKeyBytes.length).toBe(32);
    expect(kp.privateKeyBytes.length).toBe(32);
  });

  test('same seed + index → same key pair (deterministic)', async () => {
    const seed = generateMasterSeed();
    const kp1 = await deriveKeyPair(seed, 0);
    const kp2 = await deriveKeyPair(seed, 0);

    expect(hexOf(kp1.publicKeyBytes)).toBe(hexOf(kp2.publicKeyBytes));
    expect(hexOf(kp1.privateKeyBytes)).toBe(hexOf(kp2.privateKeyBytes));
  });

  test('different indices → different key pairs', async () => {
    const seed = generateMasterSeed();
    const kp0 = await deriveKeyPair(seed, 0);
    const kp1 = await deriveKeyPair(seed, 1);
    const kp2 = await deriveKeyPair(seed, 2);

    expect(hexOf(kp0.publicKeyBytes)).not.toBe(hexOf(kp1.publicKeyBytes));
    expect(hexOf(kp1.publicKeyBytes)).not.toBe(hexOf(kp2.publicKeyBytes));
    expect(hexOf(kp0.publicKeyBytes)).not.toBe(hexOf(kp2.publicKeyBytes));
  });

  test('different seeds → different key pairs at same index', async () => {
    const seed1 = generateMasterSeed();
    const seed2 = generateMasterSeed();
    const kp1 = await deriveKeyPair(seed1, 0);
    const kp2 = await deriveKeyPair(seed2, 0);

    expect(hexOf(kp1.publicKeyBytes)).not.toBe(hexOf(kp2.publicKeyBytes));
  });

  test('all key pairs can be regenerated from same seed', async () => {
    const seed = generateMasterSeed();

    // Derive indices 0–9 twice — must match
    const pairs1 = await Promise.all(Array.from({ length: 10 }, (_, i) => deriveKeyPair(seed, i)));
    const pairs2 = await Promise.all(Array.from({ length: 10 }, (_, i) => deriveKeyPair(seed, i)));

    for (let i = 0; i < 10; i++) {
      expect(hexOf(pairs1[i].publicKeyBytes)).toBe(hexOf(pairs2[i].publicKeyBytes));
      expect(hexOf(pairs1[i].privateKeyBytes)).toBe(hexOf(pairs2[i].privateKeyBytes));
    }
  });
});

// ─── encrypt / decrypt roundtrip ───────────────────────────────────────────

describe('encrypt / decrypt', () => {
  test('roundtrip: encrypt then decrypt returns original plaintext', async () => {
    const seed = generateMasterSeed();
    const kp = await deriveKeyPair(seed, 0);

    const plaintext = new TextEncoder().encode('Hello, AgentLair!');
    const encrypted = await encrypt(kp.publicKeyBytes, plaintext);
    const decrypted = await decrypt(kp.privateKeyBytes, encrypted);

    expect(new TextDecoder().decode(decrypted)).toBe('Hello, AgentLair!');
  });

  test('roundtrip: works with empty plaintext', async () => {
    const seed = generateMasterSeed();
    const kp = await deriveKeyPair(seed, 0);

    const plaintext = new Uint8Array(0);
    const encrypted = await encrypt(kp.publicKeyBytes, plaintext);
    const decrypted = await decrypt(kp.privateKeyBytes, encrypted);

    expect(decrypted.length).toBe(0);
  });

  test('roundtrip: works with binary data', async () => {
    const seed = generateMasterSeed();
    const kp = await deriveKeyPair(seed, 0);

    const plaintext = crypto.getRandomValues(new Uint8Array(256));
    const encrypted = await encrypt(kp.publicKeyBytes, plaintext);
    const decrypted = await decrypt(kp.privateKeyBytes, encrypted);

    expect(hexOf(decrypted)).toBe(hexOf(plaintext));
  });

  test('encrypt produces different ciphertext each time (random ephemeral key + IV)', async () => {
    const seed = generateMasterSeed();
    const kp = await deriveKeyPair(seed, 0);
    const plaintext = new TextEncoder().encode('same message');

    const enc1 = await encrypt(kp.publicKeyBytes, plaintext);
    const enc2 = await encrypt(kp.publicKeyBytes, plaintext);

    expect(hexOf(enc1.iv)).not.toBe(hexOf(enc2.iv));
    expect(hexOf(enc1.ephemeralPublicKey)).not.toBe(hexOf(enc2.ephemeralPublicKey));
    expect(hexOf(enc1.ciphertext)).not.toBe(hexOf(enc2.ciphertext));
  });

  test('wrong private key cannot decrypt (AES-GCM auth tag fails)', async () => {
    const seed = generateMasterSeed();
    const kp0 = await deriveKeyPair(seed, 0);
    const kp1 = await deriveKeyPair(seed, 1);

    const plaintext = new TextEncoder().encode('secret');
    const encrypted = await encrypt(kp0.publicKeyBytes, plaintext);

    // Decrypting with the wrong key → wrong shared secret → wrong AES key → auth tag failure
    await expect(decrypt(kp1.privateKeyBytes, encrypted)).rejects.toThrow();
  });

  test('roundtrip across multiple derived keys', async () => {
    const seed = generateMasterSeed();

    for (let i = 0; i < 5; i++) {
      const kp = await deriveKeyPair(seed, i);
      const message = `message for key ${i}`;
      const plaintext = new TextEncoder().encode(message);
      const encrypted = await encrypt(kp.publicKeyBytes, plaintext);
      const decrypted = await decrypt(kp.privateKeyBytes, encrypted);
      expect(new TextDecoder().decode(decrypted)).toBe(message);
    }
  });
});

// ─── Serialization ─────────────────────────────────────────────────────────

describe('serializeEncrypted / deserializeEncrypted', () => {
  test('roundtrip via serialization produces a string and decrypts correctly', async () => {
    const seed = generateMasterSeed();
    const kp = await deriveKeyPair(seed, 0);

    const plaintext = new TextEncoder().encode('Serialized roundtrip');
    const encrypted = await encrypt(kp.publicKeyBytes, plaintext);

    const encoded = serializeEncrypted(encrypted);
    expect(typeof encoded).toBe('string');

    const decoded = deserializeEncrypted(encoded);
    const decrypted = await decrypt(kp.privateKeyBytes, decoded);

    expect(new TextDecoder().decode(decrypted)).toBe('Serialized roundtrip');
  });

  test('deserializeEncrypted throws on input that is too short', () => {
    expect(() => deserializeEncrypted('dG9vc2hvcnQ')).toThrow('too short');
  });
});
