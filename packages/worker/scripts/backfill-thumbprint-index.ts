#!/usr/bin/env bun
/**
 * backfill-thumbprint-index.ts — One-shot backfill for thumbprint→keyid KV index.
 *
 * Background: POST /v1/agents/signing-keys started writing 'signing-key-thumbprint:<tp>'
 * indexes only after web-bot-auth-idempotency-20260507. Keys registered before that
 * pipeline lack the secondary index and cannot be resolved via /agents/:thumbprint.
 *
 * This script scans all signing-key records via CF REST API, computes each key's
 * JWK thumbprint, and puts 'signing-key-thumbprint:<tp>: {"keyid":"<id>"}' if absent.
 *
 * Idempotent — safe to run multiple times. Skips entries where the index already exists.
 *
 * Usage:
 *   source /workspace/.secrets/cloudflare.env && export CLOUDFLARE_EMAIL CLOUDFLARE_GLOBAL_API_KEY CLOUDFLARE_ACCOUNT_ID
 *   KV_NAMESPACE_ID=<id> bun packages/worker/scripts/backfill-thumbprint-index.ts
 *
 * Or with explicit env:
 *   CLOUDFLARE_EMAIL=... CLOUDFLARE_GLOBAL_API_KEY=... CLOUDFLARE_ACCOUNT_ID=... KV_NAMESPACE_ID=... bun ...
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const CF_EMAIL = process.env.CLOUDFLARE_EMAIL;
const CF_API_KEY = process.env.CLOUDFLARE_GLOBAL_API_KEY;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const KV_NS_ID = process.env.KV_NAMESPACE_ID;

if (!CF_EMAIL || !CF_API_KEY || !CF_ACCOUNT_ID || !KV_NS_ID) {
  console.error('Missing required env vars: CLOUDFLARE_EMAIL, CLOUDFLARE_GLOBAL_API_KEY, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID');
  process.exit(1);
}

const BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS_ID}`;
const HEADERS = {
  'X-Auth-Email': CF_EMAIL,
  'X-Auth-Key': CF_API_KEY,
  'Content-Type': 'application/json',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  const binary = atob(base64);
  return new Uint8Array(binary.split('').map(c => c.charCodeAt(0)));
}

async function computeJwkThumbprint(publicKeyBytes: Uint8Array): Promise<string> {
  const x = b64urlEncode(publicKeyBytes);
  const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${x}"}`;
  const buf = new TextEncoder().encode(canonical).buffer as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return b64urlEncode(new Uint8Array(hash));
}

async function kvGet(key: string): Promise<string | null> {
  const url = `${BASE}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV GET ${key} failed: ${res.status} ${await res.text()}`);
  return res.text();
}

async function kvPut(key: string, value: string): Promise<void> {
  const url = `${BASE}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...HEADERS, 'Content-Type': 'text/plain' },
    body: value,
  });
  if (!res.ok) throw new Error(`KV PUT ${key} failed: ${res.status} ${await res.text()}`);
}

/** List all KV keys with a given prefix (paginated). */
async function kvListAll(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ prefix, limit: '1000' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${BASE}/keys?${params}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`KV LIST failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      result: Array<{ name: string }>;
      result_info: { cursor?: string; count: number };
      success: boolean;
    };
    if (!body.success) throw new Error(`KV LIST error: ${JSON.stringify(body)}`);
    for (const { name } of body.result) keys.push(name);
    cursor = body.result_info.cursor;
  } while (cursor);
  return keys;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

// signing-key: prefix is shared by:
//   signing-key:{keyid}            — the primary record (22-char base64url keyid)
//   signing-key-by-account:{id}    — account→keyid index (excluded by pattern)
//   signing-key-thumbprint:{tp}    — thumbprint→keyid index (excluded by pattern)
// We want only the primary records: 'signing-key:' + exactly 22 base64url chars.
const KEY_ID_PATTERN = /^signing-key:[A-Za-z0-9_-]{22}$/;

async function main() {
  console.log('Listing all KV keys with prefix signing-key: ...');
  const allKeys = await kvListAll('signing-key:');
  const primaryKeys = allKeys.filter(k => KEY_ID_PATTERN.test(k));
  console.log(`Found ${allKeys.length} total keys, ${primaryKeys.length} primary signing-key records.`);

  let skipped = 0;
  let backfilled = 0;
  let errors = 0;

  for (const kvKey of primaryKeys) {
    const keyid = kvKey.slice('signing-key:'.length);
    try {
      const raw = await kvGet(kvKey);
      if (!raw) {
        console.warn(`  SKIP ${keyid}: record disappeared during scan`);
        skipped++;
        continue;
      }

      const record = JSON.parse(raw) as { public_key: string; keyid?: string };
      const publicKeyBytes = b64urlDecode(record.public_key);
      const thumbprint = await computeJwkThumbprint(publicKeyBytes);
      const thumbprintKey = `signing-key-thumbprint:${thumbprint}`;

      const existing = await kvGet(thumbprintKey);
      if (existing) {
        skipped++;
        continue;
      }

      await kvPut(thumbprintKey, JSON.stringify({ keyid }));
      console.log(`  BACKFILLED ${keyid} → thumbprint ${thumbprint}`);
      backfilled++;
    } catch (err) {
      console.error(`  ERROR processing ${keyid}:`, err);
      errors++;
    }
  }

  console.log(`\nDone. backfilled=${backfilled} skipped=${skipped} errors=${errors}`);
  if (errors > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
