/**
 * @agentlair/vault-crypto
 *
 * Client-side encryption helper for AgentLair Vault.
 * Zero-knowledge: the server never sees plaintext.
 *
 * Crypto primitives (Web Crypto API — no dependencies):
 *   Key derivation from seed:       HKDF-SHA-256
 *   Key derivation from passphrase: PBKDF2-SHA-256, 600,000 iterations
 *   Encryption:                     AES-256-GCM (12-byte IV, 16-byte auth tag)
 *   Ciphertext format:              base64url(IV[12] || ciphertext+tag[N])
 */

// ─── Helpers ──────────────────────────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  // Use btoa-based approach (works in Node, Bun, Deno, browser)
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Core crypto ─────────────────────────────────────────────────────────

/**
 * Derive a 32-byte key from seed + label via HKDF-SHA-256.
 * Deterministic: same seed + label always yields the same key.
 */
async function hkdfDeriveKey(
  seed: Uint8Array,
  label: string,
): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength) as ArrayBuffer,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // zero salt (deterministic)
      info: new TextEncoder().encode(label),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derive a 32-byte seed from passphrase via PBKDF2-SHA-256.
 * 600,000 iterations per OWASP 2023 recommendation.
 */
async function pbkdf2Derive(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const passBytes = new TextEncoder().encode(passphrase);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passBytes.buffer.slice(passBytes.byteOffset, passBytes.byteOffset + passBytes.byteLength) as ArrayBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: 600_000,
    },
    keyMaterial,
    256, // 32 bytes
  );
  return new Uint8Array(bits);
}

// ─── VaultCrypto ─────────────────────────────────────────────────────────

/**
 * VaultCrypto — client-side encryption for AgentLair Vault.
 *
 * @example
 * // From a 32-byte random seed (agents, programmatic use)
 * const seed = crypto.getRandomValues(new Uint8Array(32));
 * const vc = VaultCrypto.fromSeed(seed);
 *
 * @example
 * // From a passphrase (human operators, recovery)
 * const vc = await VaultCrypto.fromPassphrase('correct-horse-battery-staple');
 */
export class VaultCrypto {
  /** The 32-byte master seed — root of all derived keys. */
  readonly masterSeed: Uint8Array;

  private constructor(masterSeed: Uint8Array) {
    if (masterSeed.length !== 32) {
      throw new Error(`masterSeed must be 32 bytes, got ${masterSeed.length}`);
    }
    this.masterSeed = masterSeed;
  }

  // ─── Factory methods ───────────────────────────────────────────────────

  /**
   * Create a VaultCrypto instance from a 32-byte master seed.
   *
   * @param masterSeed  32-byte Uint8Array or hex-encoded string
   *
   * @example
   * // Generate a fresh seed (do this once; back it up with fromPassphrase)
   * const seed = VaultCrypto.generateSeed();
   * const vc = VaultCrypto.fromSeed(seed);
   *
   * @example
   * // Restore from stored hex seed
   * const vc = VaultCrypto.fromSeed('a3f1...64 hex chars...');
   */
  static fromSeed(masterSeed: Uint8Array | string): VaultCrypto {
    if (typeof masterSeed === 'string') {
      return new VaultCrypto(hexToBytes(masterSeed));
    }
    return new VaultCrypto(new Uint8Array(masterSeed));
  }

  /**
   * Derive a VaultCrypto instance from a human-memorable passphrase.
   *
   * Uses PBKDF2-SHA-256 with 600,000 iterations and a fixed domain salt.
   * The same passphrase always produces the same master seed — this is
   * intentional: it enables recovery without storing the seed.
   *
   * For maximum security, generate a random seed with `generateSeed()` and
   * use `fromPassphrase` only to encrypt that seed as a backup.
   *
   * @param passphrase  Human-memorable passphrase
   * @param salt        Optional custom salt (default: 'agentlair-vault-v1')
   *
   * @example
   * const vc = await VaultCrypto.fromPassphrase('correct-horse-battery-staple');
   */
  static async fromPassphrase(passphrase: string, salt?: Uint8Array | string): Promise<VaultCrypto> {
    const defaultSalt = new TextEncoder().encode('agentlair-vault-v1');
    let effectiveSalt: Uint8Array;
    if (!salt) {
      effectiveSalt = defaultSalt;
    } else if (typeof salt === 'string') {
      effectiveSalt = new TextEncoder().encode(salt);
    } else {
      effectiveSalt = salt;
    }
    const seed = await pbkdf2Derive(passphrase, effectiveSalt);
    return new VaultCrypto(seed);
  }

  /**
   * Generate a cryptographically random 32-byte master seed.
   *
   * @example
   * const seed = VaultCrypto.generateSeed();
   * const vc = VaultCrypto.fromSeed(seed);
   * console.log('Backup this seed:', vc.seedHex());
   */
  static generateSeed(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  // ─── Encrypt / Decrypt ────────────────────────────────────────────────

  /**
   * Encrypt a plaintext string for a named vault key.
   *
   * Uses HKDF to derive a unique AES-256-GCM key per vault key name.
   * Each call produces a different ciphertext (random IV).
   *
   * @param plaintext  The secret value to encrypt
   * @param keyName    Vault key name used for per-key derivation (default: 'default')
   * @returns          base64url-encoded ciphertext (IV[12] || encrypted+tag[N])
   *
   * @example
   * const ciphertext = await vc.encrypt('sk-openai-...', 'openai-key');
   * // store ciphertext in vault: PUT /v1/vault/openai-key
   */
  async encrypt(plaintext: string, keyName = 'default'): Promise<string> {
    const aesKey = await hkdfDeriveKey(
      this.masterSeed,
      `agentlair:vault:v1:${keyName}`,
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        new TextEncoder().encode(plaintext),
      ),
    );
    // Combine: IV[12] || ciphertext+tag[N]
    const combined = new Uint8Array(12 + encrypted.length);
    combined.set(iv, 0);
    combined.set(encrypted, 12);
    return b64urlEncode(combined);
  }

  /**
   * Decrypt a ciphertext string for a named vault key.
   *
   * @param ciphertext  base64url-encoded string from `encrypt()`
   * @param keyName     Vault key name (must match the name used during encrypt)
   * @returns           The original plaintext string
   *
   * @example
   * // retrieve ciphertext from vault: GET /v1/vault/openai-key
   * const plaintext = await vc.decrypt(ciphertext, 'openai-key');
   */
  async decrypt(ciphertext: string, keyName = 'default'): Promise<string> {
    const aesKey = await hkdfDeriveKey(
      this.masterSeed,
      `agentlair:vault:v1:${keyName}`,
    );
    const combined = b64urlDecode(ciphertext);
    if (combined.length < 12 + 16) {
      throw new Error('Invalid ciphertext: too short');
    }
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      encrypted,
    );
    return new TextDecoder().decode(decrypted);
  }

  // ─── Seed access ──────────────────────────────────────────────────────

  /**
   * Get the master seed as a hex string (for storage/backup).
   *
   * @example
   * // Back up the seed
   * const hexSeed = vc.seedHex();
   * // Restore later:
   * const vc2 = VaultCrypto.fromSeed(hexSeed);
   */
  seedHex(): string {
    return bytesToHex(this.masterSeed);
  }

  // ─── Backup / Recovery ────────────────────────────────────────────────

  /**
   * Encrypt the master seed with a passphrase for backup in Vault.
   *
   * Store the result under the reserved key `_master_seed_backup`.
   * Recovery: passphrase → decryptSeedBackup → fromSeed → access all secrets.
   *
   * @param passphrase  Human-memorable passphrase
   * @returns           base64url-encoded encrypted seed backup
   *
   * @example
   * const backup = await vc.encryptSeedBackup('correct-horse-battery-staple');
   * // PUT /v1/vault/_master_seed_backup with ciphertext = backup
   */
  async encryptSeedBackup(passphrase: string): Promise<string> {
    const wrapper = await VaultCrypto.fromPassphrase(passphrase);
    return wrapper.encrypt(this.seedHex(), '_master_seed_backup');
  }

  /**
   * Decrypt a seed backup to restore a VaultCrypto instance.
   *
   * @param encryptedBackup  The ciphertext from `encryptSeedBackup()`
   * @param passphrase       The passphrase used during backup
   * @returns                Restored VaultCrypto instance
   *
   * @example
   * // After recovery: retrieve _master_seed_backup from vault
   * const vc = await VaultCrypto.decryptSeedBackup(backup, 'correct-horse-battery-staple');
   */
  static async decryptSeedBackup(encryptedBackup: string, passphrase: string): Promise<VaultCrypto> {
    const wrapper = await VaultCrypto.fromPassphrase(passphrase);
    const hexSeed = await wrapper.decrypt(encryptedBackup, '_master_seed_backup');
    return VaultCrypto.fromSeed(hexSeed);
  }
}
