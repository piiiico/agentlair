// ─── Platform Encryption (AES-256-GCM at rest) ──────────────────────────────
// PLATFORM_ENCRYPTION_KEY: CF secret — base64-encoded 32-byte key
// Generate:  openssl rand -base64 32  → wrangler secret put PLATFORM_ENCRYPTION_KEY
// Stored messages: { ..., body: "<base64url iv+ciphertext>", body_encrypted: true, body_preview: "<120 chars>" }
// Backward compat: messages without body_encrypted flag are returned as-is.

import { x25519 } from '@noble/curves/ed25519.js';
import type { Env, KeyEntry } from './types.js';

/**
 * Convert Uint8Array to ArrayBuffer for Web Crypto compatibility.
 * CF Workers types require ArrayBuffer (not ArrayBufferLike) for BufferSource params.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return ArrayBuffer.prototype.slice.call(bytes.buffer, bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function _b64ToBytes(b64: string): Uint8Array {
  const pad = (4 - (b64.length % 4)) % 4;
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(s);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

export function _bytesToB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function _importPlatformKey(env: Env, usage: KeyUsage): Promise<CryptoKey | null> {
  if (!env.PLATFORM_ENCRYPTION_KEY) return null;
  try {
    const raw = _b64ToBytes(env.PLATFORM_ENCRYPTION_KEY);
    return await crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM', length: 256 }, false, [usage]);
  } catch { return null; }
}

// Returns { value: string, encrypted: boolean }
export async function encryptEmailField(env: Env, plaintext: string): Promise<{ value: string; encrypted: boolean }> {
  if (!plaintext || !env.PLATFORM_ENCRYPTION_KEY) return { value: plaintext, encrypted: false };
  const key = await _importPlatformKey(env, 'encrypt');
  if (!key) return { value: plaintext, encrypted: false };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(12 + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), 12);
  return { value: _bytesToB64url(combined), encrypted: true };
}

// Returns plaintext string (or placeholder if key unavailable)
export async function decryptEmailField(env: Env, storedValue: string, isEncrypted: boolean): Promise<string> {
  if (!isEncrypted || !storedValue) return storedValue;
  if (!env.PLATFORM_ENCRYPTION_KEY) return '[encrypted — key unavailable]';
  const key = await _importPlatformKey(env, 'decrypt');
  if (!key) return '[encrypted — key unavailable]';
  try {
    const buf = _b64ToBytes(storedValue);
    const iv = buf.slice(0, 12);
    const cipher = buf.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, toArrayBuffer(cipher));
    return new TextDecoder().decode(plainBuf);
  } catch {
    return '[decryption failed]';
  }
}

// ─── E2E Encryption (X25519 ECDH + AES-256-GCM) ────────────────────────────
// Used when an address has a registered public key (email-pubkey:{address}).
// The server encrypts to the recipient's X25519 public key so only the
// holder of the private key can decrypt. Platform never sees plaintext.

/**
 * Derive AES-256-GCM CryptoKey from X25519 shared secret via HKDF.
 * Must match src/crypto.ts deriveAesKey — same salt/info params.
 */
export async function _deriveAesKeyFromShared(sharedSecret: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey('raw', toArrayBuffer(sharedSecret), { name: 'HKDF' }, false, ['deriveKey']);
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

/**
 * Encrypt plaintext to a recipient's X25519 public key using ephemeral ECDH.
 * Returns { body, ephemeral_public_key } where both are base64url strings.
 * body = iv(12) || ciphertext(N)  (same layout as platform encryption for consistency)
 * ephemeral_public_key = 32-byte X25519 public key
 */
export async function encryptEmailE2E(recipientPubKeyB64url: string, plaintext: string): Promise<{ body: string; ephemeral_public_key: string }> {
  // Decode recipient public key from base64url
  const recipientPubKey = _b64ToBytes(recipientPubKeyB64url);
  if (recipientPubKey.length !== 32) throw new Error('Invalid X25519 public key length');

  // 1. Generate ephemeral X25519 key pair
  const ephemeralPrivate = crypto.getRandomValues(new Uint8Array(32));
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivate);

  // 2. X25519 ECDH: ephemeral private × recipient public → shared secret
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, recipientPubKey);

  // 3. HKDF → AES-256-GCM key
  const aesKey = await _deriveAesKeyFromShared(sharedSecret, 'encrypt');

  // 4. AES-256-GCM encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  // Combine iv + ciphertext (same layout as platform encryption)
  const combined = new Uint8Array(12 + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), 12);

  return {
    body: _bytesToB64url(combined),
    ephemeral_public_key: _bytesToB64url(ephemeralPublicKey),
  };
}

// ─── Multi-Key Helpers ───────────────────────────────────────────────────────
// Keys list stored at account:{id}:keys as JSON array of:
//   { hash, status: 'active'|'backup'|'revoked', prefix, created_at, label }
// Only 'active' keys have a key:{hash} → account entry in KV.
// Backup keys are stored in the list but cannot authenticate until activated.

export async function getKeysList(env: Env, accountId: string): Promise<KeyEntry[]> {
  const raw = await env.KEYS.get('account:' + accountId + ':keys');
  if (!raw) return [];
  try { return JSON.parse(raw) as KeyEntry[]; } catch { return []; }
}

export async function saveKeysList(env: Env, accountId: string, keys: KeyEntry[]): Promise<void> {
  await env.KEYS.put('account:' + accountId + ':keys', JSON.stringify(keys));
}

// Ensure the keys list exists and contains the current active key.
// Called lazily on first access for accounts created before multi-key support.
export async function ensureKeysList(env: Env, accountId: string): Promise<KeyEntry[]> {
  let keys = await getKeysList(env, accountId);
  if (keys.length > 0) return keys;

  // Bootstrap from existing account:{id} → keyHash mapping
  const keyHash = await env.KEYS.get('account:' + accountId);
  if (!keyHash) return [];

  const accountJson = await env.KEYS.get('key:' + keyHash);
  if (!accountJson) return [];
  const account = JSON.parse(accountJson) as Record<string, unknown>;

  keys = [{
    hash: keyHash,
    status: 'active',
    prefix: (account.key_prefix as string) || '(unknown)',
    created_at: (account.created_at as string) || new Date().toISOString(),
    label: 'primary',
  }];
  await saveKeysList(env, accountId, keys);
  return keys;
}
