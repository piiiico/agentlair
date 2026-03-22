/**
 * AgentLair Crypto Module
 *
 * Key derivation:  HKDF-SHA-256 (Web Crypto)
 * ECDH:            X25519 via @noble/curves (works in CF Workers + Bun)
 * Encryption:      AES-256-GCM (Web Crypto)
 *
 * Note: Bun 1.3.9 (JavaScriptCore) does not support X25519 deriveBits in Web Crypto.
 * @noble/curves fills that gap and is production-safe in CF Workers as well.
 */

import { x25519 } from '@noble/curves/ed25519.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface KeyPair {
  publicKeyBytes: Uint8Array;  // raw 32-byte X25519 public key (for encrypt / storage)
  privateKeyBytes: Uint8Array; // raw 32-byte X25519 private key (for decrypt / storage)
}

export interface EncryptedData {
  ephemeralPublicKey: Uint8Array; // 32-byte X25519 ephemeral public key
  iv: Uint8Array;                 // 12-byte AES-GCM nonce
  ciphertext: Uint8Array;         // encrypted bytes (includes AES-GCM auth tag)
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Convert Uint8Array to ArrayBuffer for Web Crypto compatibility.
 * CF Workers types require ArrayBuffer (not ArrayBufferLike) for BufferSource params.
 * Uses ArrayBuffer.prototype.slice to guarantee an ArrayBuffer return type.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return ArrayBuffer.prototype.slice.call(bytes.buffer, bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(b64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Derive 32 bytes from seed + label via HKDF-SHA-256.
 * Pure Web Crypto — works everywhere.
 */
async function hkdfDerive(seed: Uint8Array, info: string): Promise<Uint8Array> {
  const hkdfKey = await crypto.subtle.importKey('raw', toArrayBuffer(seed), { name: 'HKDF' }, false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new ArrayBuffer(32), // zero salt (deterministic)
      info: toArrayBuffer(new TextEncoder().encode(info)),
    },
    hkdfKey,
    256, // 32 bytes
  );
  return new Uint8Array(bits);
}

/**
 * Derive an AES-256-GCM CryptoKey from a shared secret via HKDF.
 */
async function deriveAesKey(
  sharedSecret: Uint8Array,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey('raw', toArrayBuffer(sharedSecret), { name: 'HKDF' }, false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new ArrayBuffer(32),
      info: toArrayBuffer(new TextEncoder().encode('agentlair:aes-256-gcm:v1')),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 32-byte master seed.
 * Store this securely — it's the root of all derived key pairs.
 */
export function generateMasterSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Derive a deterministic X25519 key pair from a master seed and an index.
 * Same seed + index always produces the same key pair (deterministic derivation).
 *
 * @param seed   32-byte master seed (from generateMasterSeed)
 * @param index  Key index (0, 1, 2, ...) — different indexes → different keys
 */
export async function deriveKeyPair(seed: Uint8Array, index: number): Promise<KeyPair> {
  // HKDF: seed → 32-byte raw private key scalar (index encoded in info)
  const privateKeyBytes = await hkdfDerive(seed, `agentlair:x25519-keypair:${index}`);

  // X25519 base-point multiplication: private scalar → public key
  const publicKeyBytes = x25519.getPublicKey(privateKeyBytes);

  return { publicKeyBytes, privateKeyBytes };
}

/**
 * Encrypt plaintext to a recipient's X25519 public key.
 * Uses ephemeral X25519 ECDH + HKDF-SHA-256 + AES-256-GCM.
 *
 * @param recipientPublicKey  Raw 32-byte X25519 public key
 * @param plaintext           Bytes to encrypt
 */
export async function encrypt(
  recipientPublicKey: Uint8Array,
  plaintext: Uint8Array,
): Promise<EncryptedData> {
  // 1. Generate ephemeral X25519 key pair
  const ephemeralPrivate = crypto.getRandomValues(new Uint8Array(32));
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivate);

  // 2. X25519 ECDH: ephemeral private × recipient public → shared secret
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, recipientPublicKey);

  // 3. HKDF → AES-256-GCM key
  const aesKey = await deriveAesKey(sharedSecret, 'encrypt');

  // 4. AES-256-GCM encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, toArrayBuffer(plaintext)),
  );

  return { ephemeralPublicKey, iv, ciphertext };
}

/**
 * Decrypt ciphertext using the recipient's X25519 private key.
 *
 * @param recipientPrivateKey  Raw 32-byte X25519 private key (from deriveKeyPair)
 * @param data                 EncryptedData from encrypt()
 */
export async function decrypt(
  recipientPrivateKey: Uint8Array,
  data: EncryptedData,
): Promise<Uint8Array> {
  // 1. X25519 ECDH: recipient private × ephemeral public → shared secret
  const sharedSecret = x25519.getSharedSecret(recipientPrivateKey, data.ephemeralPublicKey);

  // 2. HKDF → AES-256-GCM key
  const aesKey = await deriveAesKey(sharedSecret, 'decrypt');

  // 3. AES-256-GCM decrypt (throws on auth tag mismatch)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(data.iv) },
    aesKey,
    toArrayBuffer(data.ciphertext),
  );

  return new Uint8Array(plaintext);
}

// ─── Serialization helpers ─────────────────────────────────────────────────

/**
 * Serialize EncryptedData to a single compact base64url string for transport.
 * Layout: [32 bytes ephemeralPublicKey][12 bytes iv][N bytes ciphertext]
 */
export function serializeEncrypted(data: EncryptedData): string {
  const total = 32 + 12 + data.ciphertext.length;
  const buf = new Uint8Array(total);
  buf.set(data.ephemeralPublicKey, 0);
  buf.set(data.iv, 32);
  buf.set(data.ciphertext, 44);
  return b64urlEncode(buf);
}

/**
 * Deserialize a base64url string back to EncryptedData.
 */
export function deserializeEncrypted(encoded: string): EncryptedData {
  const buf = b64urlDecode(encoded);
  if (buf.length < 44) throw new Error('Invalid encrypted data: too short');
  return {
    ephemeralPublicKey: buf.slice(0, 32),
    iv: buf.slice(32, 44),
    ciphertext: buf.slice(44),
  };
}
