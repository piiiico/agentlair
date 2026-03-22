/**
 * @agentlair/vault-crypto — Tests
 */
import { expect, test, describe } from 'bun:test';
import { VaultCrypto } from './index';

describe('VaultCrypto.fromSeed', () => {
  test('creates instance from Uint8Array', () => {
    const seed = VaultCrypto.generateSeed();
    const vc = VaultCrypto.fromSeed(seed);
    expect(vc.masterSeed).toEqual(seed);
  });

  test('creates instance from hex string', () => {
    const seed = VaultCrypto.generateSeed();
    const vc = VaultCrypto.fromSeed(seed);
    const vc2 = VaultCrypto.fromSeed(vc.seedHex());
    expect(vc2.masterSeed).toEqual(seed);
  });

  test('rejects seed that is not 32 bytes', () => {
    expect(() => VaultCrypto.fromSeed(new Uint8Array(16))).toThrow();
  });
});

describe('VaultCrypto.fromPassphrase', () => {
  test('is deterministic', async () => {
    const vc1 = await VaultCrypto.fromPassphrase('correct-horse-battery-staple');
    const vc2 = await VaultCrypto.fromPassphrase('correct-horse-battery-staple');
    expect(vc1.masterSeed).toEqual(vc2.masterSeed);
  });

  test('different passphrases produce different seeds', async () => {
    const vc1 = await VaultCrypto.fromPassphrase('passphrase-one');
    const vc2 = await VaultCrypto.fromPassphrase('passphrase-two');
    expect(vc1.masterSeed).not.toEqual(vc2.masterSeed);
  });

  test('custom salt changes seed', async () => {
    const vc1 = await VaultCrypto.fromPassphrase('same-passphrase');
    const vc2 = await VaultCrypto.fromPassphrase('same-passphrase', 'custom-salt');
    expect(vc1.masterSeed).not.toEqual(vc2.masterSeed);
  });
});

describe('VaultCrypto encrypt/decrypt', () => {
  test('round-trip: default key name', async () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const plaintext = 'sk-openai-abc123';
    const ciphertext = await vc.encrypt(plaintext);
    const decrypted = await vc.decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  test('round-trip: named key', async () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const ciphertext = await vc.encrypt('my-secret', 'openai-key');
    const decrypted = await vc.decrypt(ciphertext, 'openai-key');
    expect(decrypted).toBe('my-secret');
  });

  test('different key names produce different ciphertexts (via decryption failure)', async () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const ciphertext = await vc.encrypt('secret', 'key-a');
    await expect(vc.decrypt(ciphertext, 'key-b')).rejects.toThrow();
  });

  test('encrypt is non-deterministic (random IV)', async () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const c1 = await vc.encrypt('same-value', 'key');
    const c2 = await vc.encrypt('same-value', 'key');
    expect(c1).not.toBe(c2); // different IVs
  });

  test('decryption fails with wrong seed', async () => {
    const vc1 = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const vc2 = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const ciphertext = await vc1.encrypt('secret', 'key');
    await expect(vc2.decrypt(ciphertext, 'key')).rejects.toThrow();
  });

  test('rejects tampered ciphertext', async () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const ciphertext = await vc.encrypt('secret', 'key');
    // Flip a byte in the middle of the ciphertext
    const bytes = Array.from(ciphertext);
    const mid = Math.floor(bytes.length / 2);
    bytes[mid] = bytes[mid] === 'a' ? 'b' : 'a';
    const tampered = bytes.join('');
    await expect(vc.decrypt(tampered, 'key')).rejects.toThrow();
  });

  test('encrypts unicode / long values', async () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const longSecret = '\u{1f510} ' + 'A'.repeat(10_000);
    const ciphertext = await vc.encrypt(longSecret, 'big-key');
    const decrypted = await vc.decrypt(ciphertext, 'big-key');
    expect(decrypted).toBe(longSecret);
  });
});

describe('VaultCrypto seed backup / recovery', () => {
  test('encryptSeedBackup + decryptSeedBackup round-trip', async () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const backup = await vc.encryptSeedBackup('my-recovery-passphrase');
    const restored = await VaultCrypto.decryptSeedBackup(backup, 'my-recovery-passphrase');
    expect(restored.masterSeed).toEqual(vc.masterSeed);
  });

  test('wrong passphrase fails to recover', async () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const backup = await vc.encryptSeedBackup('correct-passphrase');
    await expect(VaultCrypto.decryptSeedBackup(backup, 'wrong-passphrase')).rejects.toThrow();
  });

  test('full recovery flow: generate → backup → restore → decrypt secrets', async () => {
    // Step 1: agent generates a seed
    const seed = VaultCrypto.generateSeed();
    const vc = VaultCrypto.fromSeed(seed);

    // Step 2: agent encrypts its secrets
    const apiKeyCiphertext = await vc.encrypt('sk-live-abc123', 'openai-key');
    const dbUrlCiphertext = await vc.encrypt('postgres://...', 'db-url');

    // Step 3: agent backs up its seed with a passphrase
    const seedBackup = await vc.encryptSeedBackup('operator-passphrase');

    // Step 4: container dies — simulate by creating a new instance from backup
    const restored = await VaultCrypto.decryptSeedBackup(seedBackup, 'operator-passphrase');

    // Step 5: recover all secrets
    expect(await restored.decrypt(apiKeyCiphertext, 'openai-key')).toBe('sk-live-abc123');
    expect(await restored.decrypt(dbUrlCiphertext, 'db-url')).toBe('postgres://...');
  });
});

describe('VaultCrypto.seedHex', () => {
  test('seedHex produces 64 char hex string', () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const hex = vc.seedHex();
    expect(hex).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
  });

  test('roundtrip: seedHex → fromSeed', () => {
    const vc = VaultCrypto.fromSeed(VaultCrypto.generateSeed());
    const vc2 = VaultCrypto.fromSeed(vc.seedHex());
    expect(vc2.masterSeed).toEqual(vc.masterSeed);
  });
});
