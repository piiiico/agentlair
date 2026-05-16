/**
 * GET /v1/agents/by-nid/:al_nid — Inverse AAT-NID bridge
 *
 * Resolves a Radicle Node ID (did:key:z6Mk...) to the AgentLair account that
 * registered it as their active Ed25519 signing key.
 *
 * Free public read — no API key, no x402, no auth required.
 * Mounted BEFORE the /v1/* auth middleware in index.ts.
 */

import { Hono } from 'hono';
import { json, err } from '../utils.js';
import type { HonoEnv } from '../types.js';
import { pubkeyToRadicleNid, b64urlDecode } from '../jwt.js';
import { computeTrustScore } from '../trust-engine.js';
import type { SigningKeyRecord } from './signing-keys.js';

export const agentsByNidRoutes = new Hono<HonoEnv>();

// ─── Base58btc alphabet ───────────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((c, i) => [c, i]),
);

/**
 * Decode a base58btc string to bytes.
 * Returns null if any character is not in the alphabet.
 */
function base58btcDecode(str: string): Uint8Array | null {
  // Count leading '1's (zero bytes)
  let leadingZeros = 0;
  for (const c of str) {
    if (c !== '1') break;
    leadingZeros++;
  }

  // Convert base58 to big integer
  let num = BigInt(0);
  for (const c of str) {
    const val = BASE58_MAP.get(c);
    if (val === undefined) return null; // invalid character
    num = num * BigInt(58) + BigInt(val);
  }

  // Convert big integer to bytes
  const result: number[] = [];
  while (num > 0n) {
    result.unshift(Number(num & 0xffn));
    num >>= 8n;
  }

  // Prepend leading zero bytes
  const bytes = new Uint8Array(leadingZeros + result.length);
  bytes.set(result, leadingZeros);
  return bytes;
}

// ─── NID validation ───────────────────────────────────────────────────────────

const MAX_NID_LENGTH = 128;
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

interface ParseOk {
  ok: true;
  pubkeyBytes: Uint8Array;
}
interface ParseErr {
  ok: false;
  error: string;
}
type ParseResult = ParseOk | ParseErr;

/**
 * Validate and decode a did:key Ed25519 NID.
 * Returns the raw 32-byte public key on success, or an error message on failure.
 */
function parseNidOrError(nid: string): ParseResult {
  // Length cap
  if (nid.length > MAX_NID_LENGTH) {
    return { ok: false, error: `NID exceeds maximum length of ${MAX_NID_LENGTH} chars. Got: ${nid.slice(0, 20)}…` };
  }

  // Must start with did:key:z6Mk (Ed25519 multicodec prefix in base58btc)
  if (!nid.startsWith('did:key:z6Mk')) {
    return { ok: false, error: `al_nid must be a did:key Ed25519 (did:key:z6Mk...). Got: ${nid}.` };
  }

  // Decode base58btc portion (after 'did:key:z')
  const b58Part = nid.slice('did:key:z'.length);
  const decoded = base58btcDecode(b58Part);
  if (!decoded) {
    return { ok: false, error: `al_nid must be a did:key Ed25519 (did:key:z6Mk...). Invalid base58btc encoding. Got: ${nid}.` };
  }

  // Verify multicodec prefix: 0xed 0x01 followed by exactly 32 key bytes
  if (
    decoded.length !== ED25519_MULTICODEC_PREFIX.length + 32 ||
    decoded[0] !== 0xed ||
    decoded[1] !== 0x01
  ) {
    return { ok: false, error: `al_nid must be a did:key Ed25519 (did:key:z6Mk...). Wrong multicodec prefix or key length. Got: ${nid}.` };
  }

  const pubkeyBytes = decoded.slice(ED25519_MULTICODEC_PREFIX.length);
  return { ok: true, pubkeyBytes };
}

// ─── GET /v1/agents/by-nid/:al_nid ───────────────────────────────────────────

agentsByNidRoutes.get('/by-nid/:al_nid', async (c) => {
  const al_nid = c.req.param('al_nid');

  // 1. Validate NID shape
  const parsed = parseNidOrError(al_nid);
  if (!parsed.ok) {
    return err(
      'al_nid must be a did:key Ed25519 (did:key:z6Mk...).',
      400,
      'invalid_nid',
      `Expected ~52-char string: 'did:key:z' + 44-46 base58btc chars. Got: ${al_nid}.`,
    );
  }

  const { pubkeyBytes } = parsed;

  // 2. Look up inverse index: nid:<did> → { account_id, keyid }
  const indexRaw = await c.env.KEYS.get('nid:' + al_nid);
  if (!indexRaw) {
    return err(
      'NID is well-formed but not registered to any AgentLair account with an active signing key.',
      404,
      'nid_not_registered',
      'The agent may have revoked their key, or this NID was never registered. Try GET /v1/agents/lookup if you have an account_id, handle, or email.',
    );
  }

  const { account_id, keyid } = JSON.parse(indexRaw) as { account_id: string; keyid: string };

  // 3. Fetch the signing key record
  const keyRaw = await c.env.KEYS.get('signing-key:' + keyid);
  if (!keyRaw) {
    // Index exists but record is gone — treat as not found
    return err(
      'NID is well-formed but not registered to any AgentLair account with an active signing key.',
      404,
      'nid_not_registered',
      'The agent may have revoked their key, or this NID was never registered. Try GET /v1/agents/lookup if you have an account_id, handle, or email.',
    );
  }

  const record = JSON.parse(keyRaw) as SigningKeyRecord;

  // 4. Treat revoked keys as not-registered (per spec)
  if (record.status === 'revoked') {
    return err(
      'NID is well-formed but not registered to any AgentLair account with an active signing key.',
      404,
      'nid_not_registered',
      'The agent may have revoked their key, or this NID was never registered. Try GET /v1/agents/lookup if you have an account_id, handle, or email.',
    );
  }

  // 5. Compute fingerprint (SHA-256 of pubkey bytes, colon-separated hex)
  let fingerprint: string | undefined;
  try {
    const buf = pubkeyBytes.buffer.slice(pubkeyBytes.byteOffset, pubkeyBytes.byteOffset + pubkeyBytes.byteLength) as ArrayBuffer;
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    const hashBytes = new Uint8Array(hashBuf);
    fingerprint = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join(':');
  } catch {
    // omit on error per spec
  }

  // 6. Compute trust score (only if observations >= 10)
  let trust_score: number | undefined;
  const db = c.env.AUDIT;
  if (db) {
    try {
      const profile = await computeTrustScore(db, account_id);
      if (profile.observationCount >= 10) {
        // Score is [0, 100]; convert to [0, 1]
        trust_score = Math.round((profile.score / 100) * 1000) / 1000;
      }
    } catch {
      // omit on error per spec
    }
  }

  // 7. Look up account record for name
  let account_name: string | undefined;
  try {
    const accountRaw = await c.env.KEYS.get('account:' + account_id);
    if (accountRaw) {
      const account = JSON.parse(accountRaw) as { name?: string };
      if (account.name && typeof account.name === 'string' && account.name.length > 0) {
        account_name = account.name;
      }
    }
  } catch {
    // omit on error
  }

  // 8. Build response
  const response: Record<string, unknown> = {
    account_id,
    ...(account_name !== undefined && { account_name }),
    al_nid,
    did_web: `did:web:agentlair.dev:agents:${account_id}`,
    ...(fingerprint !== undefined && { fingerprint }),
    ...(trust_score !== undefined && { trust_score }),
    latest_signing_key_registered_at: record.registered_at,
  };

  return json(response);
});
