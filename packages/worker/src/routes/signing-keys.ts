/**
 * AgentLair Signing Key Routes — RFC 9421 per-agent Ed25519 key registration
 *
 * POST /v1/agents/signing-keys — register agent's Ed25519 public signing key
 * GET  /v1/agents/signing-keys — get current agent's signing key info
 * DELETE /v1/agents/signing-keys — revoke current agent's signing key
 *
 * Public endpoints (in index.ts):
 *   GET /.well-known/agent-keys/{keyid}         — key lookup by any verifier
 *   GET /.well-known/agent-keys/{keyid}/jwks.json — JWK format
 *
 * Design:
 * - One active signing key per agent (rotation replaces the previous)
 * - Key ID: base64url(SHA-256(public_key_bytes)).slice(0, 22)
 * - Registration is idempotent (same public key → same keyid)
 * - Public key directory is unauthenticated (keys are public)
 * - KV: signing-key:{keyid} → full key record
 * - KV: signing-key-by-account:{account_id} → keyid (single active key)
 */

import { Hono } from 'hono';
import { json, err } from '../utils.js';
import type { HonoEnv, Env } from '../types.js';
import { b64urlEncode, b64urlDecode } from '../jwt.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SigningKeyRecord {
  keyid: string;
  algorithm: 'ed25519';
  public_key: string;           // base64url 32-byte Ed25519 public key
  agent_id: string;             // acc_xxx
  agent_name?: string;
  agent_email?: string;
  registered_at: string;        // ISO 8601
  label?: string;               // human-readable, optional
  status: 'active' | 'revoked';
}

// ─── Key ID computation ───────────────────────────────────────────────────────

/**
 * Compute key ID: base64url(SHA-256(public_key_bytes)).slice(0, 22)
 * This is the AgentLair standard, matching the Visa TAP key ID format.
 */
export async function computeSigningKeyId(publicKeyBytes: Uint8Array): Promise<string> {
  const buf = ArrayBuffer.prototype.slice.call(
    publicKeyBytes.buffer,
    publicKeyBytes.byteOffset,
    publicKeyBytes.byteOffset + publicKeyBytes.byteLength,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hashBytes = new Uint8Array(hash);
  return b64urlEncode(hashBytes).slice(0, 22);
}

// ─── Public key directory helpers (used by index.ts) ─────────────────────────

/**
 * Look up a signing key by keyid from KV.
 * Returns null if not found.
 */
export async function getSigningKey(env: Env, keyid: string): Promise<SigningKeyRecord | null> {
  const raw = await env.KEYS.get('signing-key:' + keyid);
  if (!raw) return null;
  return JSON.parse(raw) as SigningKeyRecord;
}

/**
 * Compute RFC 8037 JWK Thumbprint for an Ed25519 public key.
 * Canonical JSON: {"crv":"Ed25519","kty":"OKP","x":"<base64url>"}  (members in lexicographic order)
 * Thumbprint = base64url(SHA-256(UTF-8(canonical_json))) — always 43 chars
 */
export async function computeJwkThumbprint(publicKeyBytes: Uint8Array): Promise<string> {
  const x = b64urlEncode(publicKeyBytes);
  // RFC 7638 §3.2: members in lexicographic order, no extra whitespace
  const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${x}"}`;
  const buf = ArrayBuffer.prototype.slice.call(
    new TextEncoder().encode(canonical).buffer,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return b64urlEncode(new Uint8Array(hash));
}

/**
 * Look up a signing key by its RFC 8037 JWK thumbprint.
 * Returns null if not found.
 */
export async function getSigningKeyByThumbprint(env: Env, thumbprint: string): Promise<SigningKeyRecord | null> {
  const raw = await env.KEYS.get('signing-key-thumbprint:' + thumbprint);
  if (!raw) return null;
  const { keyid } = JSON.parse(raw) as { keyid: string };
  return getSigningKey(env, keyid);
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export const signingKeyRoutes = new Hono<HonoEnv>();

/**
 * POST /v1/agents/signing-keys
 *
 * Register an Ed25519 public key for RFC 9421 HTTP message signing.
 * One key per agent — registering a new key replaces the previous one.
 *
 * Request body:
 * {
 *   "public_key": "<base64url-encoded 32-byte Ed25519 public key>",
 *   "label": "primary"   // optional
 * }
 *
 * Response (201):
 * {
 *   "keyid": "abc123def456ghij789012",
 *   "algorithm": "ed25519",
 *   "registered_at": "2026-03-29T12:00:00Z",
 *   "label": "primary",
 *   "status": "active"
 * }
 */
signingKeyRoutes.post('/signing-keys', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required', 401, 'unauthorized');

  // Parse body
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return err('Invalid JSON body', 400, 'invalid_body');
  }

  // Validate public_key
  const publicKeyB64 = body.public_key;
  if (!publicKeyB64 || typeof publicKeyB64 !== 'string') {
    return err('public_key is required (base64url-encoded 32-byte Ed25519 public key)', 400, 'missing_public_key');
  }

  // Decode and validate length
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = b64urlDecode(publicKeyB64);
  } catch {
    return err('public_key must be valid base64url', 400, 'invalid_public_key');
  }
  if (publicKeyBytes.length !== 32) {
    return err(`public_key must be exactly 32 bytes (Ed25519). Got ${publicKeyBytes.length} bytes.`, 400, 'invalid_public_key');
  }

  // Optional label (max 64 chars)
  const label = typeof body.label === 'string'
    ? body.label.trim().slice(0, 64)
    : undefined;

  // Compute keyid
  const keyid = await computeSigningKeyId(publicKeyBytes);

  // Compute RFC 8037 JWK thumbprint for Web Bot Auth key directory
  const thumbprint = await computeJwkThumbprint(publicKeyBytes);

  // Check if this key is already registered (idempotency)
  const existingRaw = await c.env.KEYS.get('signing-key:' + keyid);
  if (existingRaw) {
    const existing = JSON.parse(existingRaw) as SigningKeyRecord;
    // Only allow if it's this account's key
    if (existing.agent_id === account.id) {
      return json({
        keyid: existing.keyid,
        algorithm: existing.algorithm,
        registered_at: existing.registered_at,
        label: existing.label,
        status: existing.status,
      }, 200); // 200 = already registered
    }
    // Different account has this key — conflict (key IDs are global)
    return err('This public key is already registered by another agent.', 409, 'key_conflict');
  }

  // Revoke previous key if exists
  const prevKeyidRaw = await c.env.KEYS.get('signing-key-by-account:' + account.id);
  if (prevKeyidRaw) {
    const prevRecord = JSON.parse(prevKeyidRaw) as { keyid: string };
    if (prevRecord.keyid) {
      const prevKeyRaw = await c.env.KEYS.get('signing-key:' + prevRecord.keyid);
      if (prevKeyRaw) {
        const prevKey = JSON.parse(prevKeyRaw) as SigningKeyRecord;
        prevKey.status = 'revoked';
        try {
          await c.env.KEYS.put('signing-key:' + prevRecord.keyid, JSON.stringify(prevKey));
        } catch (kvErr: unknown) {
          const msg = kvErr instanceof Error ? kvErr.message : '';
          if (msg.includes('free usage limit') || msg.includes('KV') || msg.includes('quota')) {
            return err('Signing key registration temporarily unavailable — KV write quota exceeded. Try again later.', 503, 'kv_quota_exceeded');
          }
          throw kvErr;
        }
      }
    }
  }

  // Build the key record
  const now = new Date().toISOString();
  const agentName = typeof account.name === 'string' ? account.name : undefined;
  const agentEmail = typeof account.email === 'string' ? account.email : undefined;

  const record: SigningKeyRecord = {
    keyid,
    algorithm: 'ed25519',
    public_key: publicKeyB64,
    agent_id: account.id,
    ...(agentName !== undefined && { agent_name: agentName }),
    ...(agentEmail !== undefined && { agent_email: agentEmail }),
    registered_at: now,
    ...(label !== undefined && { label }),
    status: 'active',
  };

  // Store key record and account index
  try {
    await c.env.KEYS.put('signing-key:' + keyid, JSON.stringify(record));
    await c.env.KEYS.put(
      'signing-key-by-account:' + account.id,
      JSON.stringify({ keyid }),
    );
    await c.env.KEYS.put('signing-key-thumbprint:' + thumbprint, JSON.stringify({ keyid }));
  } catch (kvErr: unknown) {
    const msg = kvErr instanceof Error ? kvErr.message : '';
    if (msg.includes('free usage limit') || msg.includes('KV') || msg.includes('quota')) {
      return err('Signing key registration temporarily unavailable — KV write quota exceeded. Try again later.', 503, 'kv_quota_exceeded');
    }
    throw kvErr;
  }

  return json({
    keyid,
    thumbprint,
    algorithm: 'ed25519',
    registered_at: now,
    ...(label !== undefined && { label }),
    status: 'active',
    signature_agent_url: `https://agentlair.dev/agents/${thumbprint}`,
  }, 201);
});

/**
 * GET /v1/agents/signing-keys
 *
 * Returns the current agent's active signing key info.
 */
signingKeyRoutes.get('/signing-keys', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required', 401, 'unauthorized');

  const indexRaw = await c.env.KEYS.get('signing-key-by-account:' + account.id);
  if (!indexRaw) {
    return err('No signing key registered. Use POST /v1/agents/signing-keys to register one.', 404, 'no_signing_key');
  }

  const { keyid } = JSON.parse(indexRaw) as { keyid: string };
  const keyRaw = await c.env.KEYS.get('signing-key:' + keyid);
  if (!keyRaw) {
    return err('Signing key record not found. It may have been deleted.', 404, 'signing_key_not_found');
  }

  const record = JSON.parse(keyRaw) as SigningKeyRecord;
  return json({
    keyid: record.keyid,
    algorithm: record.algorithm,
    public_key: record.public_key,
    registered_at: record.registered_at,
    label: record.label,
    status: record.status,
    lookup_url: `https://agentlair.dev/.well-known/agent-keys/${record.keyid}`,
    jwks_url: `https://agentlair.dev/.well-known/agent-keys/${record.keyid}/jwks.json`,
    // Computed on the fly for existing keys that may not have thumbprint stored
    signature_agent_url: `https://agentlair.dev/agents/${await computeJwkThumbprint(b64urlDecode(record.public_key))}`,
  });
});

/**
 * DELETE /v1/agents/signing-keys
 *
 * Revokes the current agent's signing key.
 * The key record is kept (status: "revoked") so verifiers can detect revocation.
 */
signingKeyRoutes.delete('/signing-keys', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required', 401, 'unauthorized');

  const indexRaw = await c.env.KEYS.get('signing-key-by-account:' + account.id);
  if (!indexRaw) {
    return err('No signing key registered.', 404, 'no_signing_key');
  }

  const { keyid } = JSON.parse(indexRaw) as { keyid: string };
  const keyRaw = await c.env.KEYS.get('signing-key:' + keyid);
  if (!keyRaw) {
    return err('Signing key record not found.', 404, 'signing_key_not_found');
  }

  const record = JSON.parse(keyRaw) as SigningKeyRecord;
  if (record.status === 'revoked') {
    return json({ keyid, revoked: true, message: 'Key was already revoked.' });
  }

  // Mark as revoked (keep for verifier lookup)
  record.status = 'revoked';
  try {
    await c.env.KEYS.put('signing-key:' + keyid, JSON.stringify(record));
  } catch (kvErr: unknown) {
    const msg = kvErr instanceof Error ? kvErr.message : '';
    if (msg.includes('free usage limit') || msg.includes('KV') || msg.includes('quota')) {
      return err('Signing key revocation temporarily unavailable — KV write quota exceeded. Try again later.', 503, 'kv_quota_exceeded');
    }
    throw kvErr;
  }
  // Remove account index (no active key)
  try {
    await c.env.KEYS.delete('signing-key-by-account:' + account.id);
  } catch (kvErr: unknown) {
    const msg = kvErr instanceof Error ? kvErr.message : '';
    if (msg.includes('free usage limit') || msg.includes('KV') || msg.includes('quota')) {
      return err('Signing key revocation temporarily unavailable — KV write quota exceeded. Try again later.', 503, 'kv_quota_exceeded');
    }
    throw kvErr;
  }

  return json({ keyid, revoked: true, status: 'revoked' });
});
