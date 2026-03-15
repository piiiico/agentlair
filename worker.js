// AgentLair API — Cloudflare Worker
// Version: 0.12.0
// Storage: KEYS (agentlair-api-keys), EMAILS (agentlair-emails), VAULT (agentlair-vault), Turso (shared_observations)
// Updated: 2026-03-14 — Security hardening: IDOR fix on message endpoints, key creation rate limiting, reserved addresses, local part validation

import { x25519 } from '@noble/curves/ed25519.js';

// ─── Utilities ────────────────────────────────────────────────────────────────

function nanoid(n) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'X-Powered-By': 'AgentLair',
    },
  });
}

function err(message, status, code) {
  return json({ error: code || 'error', message }, status || 400);
}

function html(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Powered-By': 'AgentLair',
    },
  });
}

// ─── Platform Encryption (AES-256-GCM at rest) ──────────────────────────────
// PLATFORM_ENCRYPTION_KEY: CF secret — base64-encoded 32-byte key
// Generate:  openssl rand -base64 32  → wrangler secret put PLATFORM_ENCRYPTION_KEY
// Stored messages: { ..., body: "<base64url iv+ciphertext>", body_encrypted: true, body_preview: "<120 chars>" }
// Backward compat: messages without body_encrypted flag are returned as-is.

function _b64ToBytes(b64) {
  const pad = (4 - (b64.length % 4)) % 4;
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(s);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

function _bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function _importPlatformKey(env, usage) {
  if (!env.PLATFORM_ENCRYPTION_KEY) return null;
  try {
    const raw = _b64ToBytes(env.PLATFORM_ENCRYPTION_KEY);
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [usage]);
  } catch { return null; }
}

// Returns { value: string, encrypted: boolean }
async function encryptEmailField(env, plaintext) {
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
async function decryptEmailField(env, storedValue, isEncrypted) {
  if (!isEncrypted || !storedValue) return storedValue;
  if (!env.PLATFORM_ENCRYPTION_KEY) return '[encrypted — key unavailable]';
  const key = await _importPlatformKey(env, 'decrypt');
  if (!key) return '[encrypted — key unavailable]';
  try {
    const buf = _b64ToBytes(storedValue);
    const iv = buf.slice(0, 12);
    const cipher = buf.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
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
async function _deriveAesKeyFromShared(sharedSecret, usage) {
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('agentlair:aes-256-gcm:v1'),
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
async function encryptEmailE2E(recipientPubKeyB64url, plaintext) {
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

async function getKeysList(env, accountId) {
  const raw = await env.KEYS.get('account:' + accountId + ':keys');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveKeysList(env, accountId, keys) {
  await env.KEYS.put('account:' + accountId + ':keys', JSON.stringify(keys));
}

// Ensure the keys list exists and contains the current active key.
// Called lazily on first access for accounts created before multi-key support.
async function ensureKeysList(env, accountId) {
  let keys = await getKeysList(env, accountId);
  if (keys.length > 0) return keys;

  // Bootstrap from existing account:{id} → keyHash mapping
  const keyHash = await env.KEYS.get('account:' + accountId);
  if (!keyHash) return [];

  const accountJson = await env.KEYS.get('key:' + keyHash);
  if (!accountJson) return [];
  const account = JSON.parse(accountJson);

  keys = [{
    hash: keyHash,
    status: 'active',
    prefix: account.key_prefix || '(unknown)',
    created_at: account.created_at || new Date().toISOString(),
    label: 'primary',
  }];
  await saveKeysList(env, accountId, keys);
  return keys;
}

// ─── Email Provider Abstraction ──────────────────────────────────────────────
// Each provider implements: send(opts, env) → { provider_id }  (throws on failure)
// opts = { from, to[], subject, text?, html?, in_reply_to? }

const ResendProvider = {
  name: 'resend',
  isConfigured: (env) => !!env.RESEND_API_KEY,
  async send(opts, env) {
    const payload = {
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.html ? { html: opts.html } : {}),
      ...(opts.in_reply_to ? { headers: { 'In-Reply-To': opts.in_reply_to, 'References': opts.in_reply_to } } : {}),
    };
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || data.error || 'Resend API error');
    return { provider_id: data.id };
  },
};

// Stub: future SMTP provider (Stalwart, Postmark, etc.)
// const SMTPProvider = {
//   name: 'smtp',
//   isConfigured: (env) => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
//   async send(opts, env) { /* TODO */ },
// };

function getEmailProvider(env) {
  // Provider selection via EMAIL_PROVIDER env var. Default: resend.
  const selected = (env.EMAIL_PROVIDER || 'resend').toLowerCase();
  if (selected === 'resend' && ResendProvider.isConfigured(env)) return ResendProvider;
  // If RESEND_API_KEY set but no explicit provider, default to resend
  if (ResendProvider.isConfigured(env)) return ResendProvider;
  return null; // No provider configured
}

// ─── Turso HTTP Client (for shared_observations) ────────────────────────────
// Minimal Turso pipeline API client using fetch. Uses TURSO_URL + TURSO_AUTH_TOKEN
// env vars (set as CF Worker secrets). Scoped: only shared_observations table.

async function tursoExecute(env, sql, args) {
  if (!env.TURSO_URL || !env.TURSO_AUTH_TOKEN) {
    throw new Error('Turso not configured (missing TURSO_URL or TURSO_AUTH_TOKEN)');
  }
  // Convert libsql:// to https:// if needed
  const baseUrl = env.TURSO_URL.replace(/^libsql:\/\//, 'https://');
  const resp = await fetch(`${baseUrl}/v3/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.TURSO_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql, args: args.map(a => ({ type: 'text', value: String(a) })) } },
        { type: 'close' },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Turso error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  const result = data.results?.[0];
  if (result?.type === 'error') {
    throw new Error(`Turso SQL error: ${result.error?.message || JSON.stringify(result.error)}`);
  }
  // Extract rows as plain objects
  const execResult = result?.response?.result;
  if (!execResult) return { rows: [], affected: 0 };
  const cols = execResult.cols?.map(c => c.name) || [];
  const rows = (execResult.rows || []).map(row =>
    Object.fromEntries(cols.map((col, i) => [col, row[i]?.value ?? null]))
  );
  return { rows, affected: execResult.affected_row_count || 0 };
}

// ─── Landing Page HTML ──────────────────────────────────────────────────────

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentLair \u2014 Email for AI Agents</title>
  <meta name="description" content="Claim @agentlair.dev email addresses for your AI agents. Send and receive via REST API. No SMTP, no IMAP, no dashboards. $0 to start." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0f;
      --surface: #111118;
      --border: #1e1e2e;
      --accent: #6366f1;
      --accent-dim: #4f52c8;
      --text: #e8e8f0;
      --muted: #888898;
      --green: #22c55e;
      --amber: #f59e0b;
      --red: #ef4444;
      --code-bg: #0d0d17;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.6;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* NAV */
    nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 2rem;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: rgba(10,10,15,0.92);
      backdrop-filter: blur(12px);
      z-index: 10;
    }
    .logo {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .logo-mark {
      width: 28px; height: 28px;
      background: var(--accent);
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.85rem;
    }
    nav .links {
      display: flex;
      gap: 1.5rem;
      align-items: center;
    }
    nav .links a {
      color: var(--muted);
      font-size: 0.9rem;
    }
    nav .links a:hover { color: var(--text); text-decoration: none; }
    .btn-nav {
      background: var(--accent);
      color: #fff !important;
      padding: 0.4rem 1rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .btn-nav:hover { background: var(--accent-dim); text-decoration: none !important; }

    /* LAYOUT */
    .container { max-width: 860px; margin: 0 auto; padding: 0 2rem; }
    section { padding: 5rem 0; }
    section + section { border-top: 1px solid var(--border); }

    /* HERO */
    .hero {
      text-align: center;
      padding: 7rem 0 5rem;
    }
    .badge {
      display: inline-block;
      border: 1px solid var(--border);
      border-radius: 100px;
      padding: 0.25rem 0.85rem;
      font-size: 0.78rem;
      color: var(--muted);
      margin-bottom: 2rem;
      letter-spacing: 0.02em;
    }
    .badge span { color: var(--accent); }
    h1 {
      font-size: clamp(2.2rem, 6vw, 3.5rem);
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.03em;
      margin-bottom: 1.5rem;
    }
    h1 em { color: var(--accent); font-style: normal; }
    .hero-sub {
      font-size: 1.2rem;
      color: var(--muted);
      max-width: 540px;
      margin: 0 auto 3rem;
      line-height: 1.7;
    }
    .hero-cta {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
      padding: 0.75rem 1.75rem;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      text-decoration: none;
    }
    .btn-primary:hover { background: var(--accent-dim); text-decoration: none; }
    .btn-secondary {
      background: transparent;
      color: var(--muted);
      padding: 0.75rem 1.75rem;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 500;
      border: 1px solid var(--border);
      cursor: pointer;
      text-decoration: none;
    }
    .btn-secondary:hover { color: var(--text); border-color: var(--muted); text-decoration: none; }

    /* HERO CODE */
    .hero-code {
      margin-top: 3.5rem;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem 2rem;
      text-align: left;
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.85rem;
      line-height: 1.8;
      overflow-x: auto;
    }
    .code-tab {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 1rem;
    }
    .code-tab .dot {
      width: 12px; height: 12px; border-radius: 50%;
    }
    .dot-red { background: #ff5f57; }
    .dot-amber { background: #febc2e; }
    .dot-green { background: #28c840; }
    .c-muted { color: #555570; }
    .c-key { color: #7c9dce; }
    .c-str { color: #a8d0a0; }
    .c-cmd { color: #c0a0e0; }
    .c-val { color: #e0c080; }
    .c-ok { color: var(--green); }
    .c-comment { color: #555570; font-style: italic; }

    /* PROBLEM SECTION */
    h2 {
      font-size: clamp(1.6rem, 4vw, 2.2rem);
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 1rem;
    }
    .section-label {
      font-size: 0.78rem;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    .lead {
      font-size: 1.1rem;
      color: var(--muted);
      margin-bottom: 2.5rem;
      line-height: 1.7;
    }

    /* BLOCKERS GRID */
    .blockers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-top: 2rem;
    }
    .blocker-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.25rem;
    }
    .blocker-icon {
      font-size: 1.5rem;
      margin-bottom: 0.75rem;
    }
    .blocker-card h3 {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 0.4rem;
    }
    .blocker-card p {
      font-size: 0.85rem;
      color: var(--muted);
      line-height: 1.5;
    }
    .tag-blocked {
      display: inline-block;
      background: rgba(239,68,68,0.12);
      color: var(--red);
      border-radius: 4px;
      padding: 0.1rem 0.45rem;
      font-size: 0.72rem;
      font-weight: 600;
      margin-top: 0.5rem;
    }

    /* HOW IT WORKS */
    .steps {
      display: grid;
      gap: 1.5rem;
      margin-top: 2rem;
    }
    .step {
      display: flex;
      gap: 1.25rem;
      align-items: flex-start;
    }
    .step-num {
      flex-shrink: 0;
      width: 36px; height: 36px;
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700;
      font-size: 0.9rem;
      color: var(--accent);
    }
    .step-body h3 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.3rem;
    }
    .step-body p {
      font-size: 0.9rem;
      color: var(--muted);
      line-height: 1.6;
    }

    /* API SECTION */
    .api-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin-top: 2rem;
    }
    @media (max-width: 640px) { .api-grid { grid-template-columns: 1fr; } }
    .api-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.5rem;
    }
    .api-card h3 {
      font-size: 0.95rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .method {
      font-family: monospace;
      font-size: 0.72rem;
      background: rgba(99,102,241,0.15);
      color: var(--accent);
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
    }
    .api-card p {
      font-size: 0.85rem;
      color: var(--muted);
      line-height: 1.5;
      margin-bottom: 0.75rem;
    }
    .api-card ul {
      list-style: none;
      font-size: 0.82rem;
      color: var(--muted);
    }
    .api-card li::before {
      content: "\u2192 ";
      color: var(--accent);
    }
    .api-card li { margin-bottom: 0.25rem; }

    /* PRICING */
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.25rem;
      margin-top: 2.5rem;
    }
    .price-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2rem;
    }
    .price-card.featured {
      border-color: var(--accent);
      position: relative;
    }
    .featured-badge {
      position: absolute;
      top: -0.6rem;
      left: 50%;
      transform: translateX(-50%);
      background: var(--accent);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.15rem 0.75rem;
      border-radius: 100px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .price-tier {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-bottom: 0.75rem;
      font-weight: 600;
    }
    .price-amount {
      font-size: 2.25rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 0.25rem;
    }
    .price-amount span { font-size: 1rem; font-weight: 400; color: var(--muted); }
    .price-desc {
      font-size: 0.85rem;
      color: var(--muted);
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }
    .price-features {
      list-style: none;
      font-size: 0.875rem;
    }
    .price-features li {
      padding: 0.35rem 0;
      border-top: 1px solid var(--border);
      color: var(--muted);
      display: flex;
      gap: 0.5rem;
    }
    .price-features li:first-child { border-top: none; }
    .check { color: var(--green); font-size: 0.8rem; flex-shrink: 0; padding-top: 0.15rem; }
    .x402-note {
      margin-top: 1.5rem;
      background: rgba(99,102,241,0.08);
      border: 1px solid rgba(99,102,241,0.2);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .x402-note strong { color: var(--text); }

    /* TOOLTIP */
    .tooltip-wrap {
      position: relative;
      display: inline-block;
      cursor: help;
      border-bottom: 1px dashed rgba(99,102,241,0.5);
    }
    .tooltip-wrap .tooltip-text {
      visibility: hidden;
      opacity: 0;
      width: 280px;
      background: var(--surface);
      border: 1px solid rgba(99,102,241,0.3);
      color: var(--text);
      font-size: 0.78rem;
      border-radius: 6px;
      padding: 0.65rem 0.85rem;
      position: absolute;
      z-index: 100;
      bottom: 135%;
      left: 50%;
      transform: translateX(-50%);
      transition: opacity 0.15s;
      line-height: 1.55;
      text-align: left;
      pointer-events: none;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    .tooltip-wrap:hover .tooltip-text {
      visibility: visible;
      opacity: 1;
    }

    /* COPY BUTTON */
    .copy-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: rgba(99,102,241,0.12);
      border: 1px solid rgba(99,102,241,0.3);
      color: var(--accent);
      font-family: inherit;
      font-size: 0.78rem;
      padding: 0.3rem 0.7rem;
      border-radius: 5px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .copy-btn:hover { background: rgba(99,102,241,0.22); }
    .copy-btn.copied { color: var(--green); border-color: rgba(34,197,94,0.4); background: rgba(34,197,94,0.08); }

    /* QUICKSTART BOX */
    .quickstart-box {
      margin-bottom: 2.5rem;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .quickstart-box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1.25rem;
      background: rgba(255,255,255,0.03);
      border-bottom: 1px solid var(--border);
      font-size: 0.8rem;
      color: var(--muted);
    }
    .quickstart-box-body {
      padding: 1.25rem 1.5rem;
      font-family: monospace;
      font-size: 0.83rem;
      line-height: 1.8;
    }

    /* COMPARISON */
    .compare-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      margin-top: 2rem;
    }
    .compare-table th, .compare-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      text-align: left;
    }
    .compare-table th {
      color: var(--muted);
      font-weight: 600;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .compare-table td:first-child { font-weight: 500; }
    .compare-table td:not(:first-child) { text-align: center; color: var(--muted); }
    .compare-table .ours { color: var(--accent) !important; font-weight: 700; }
    .yes { color: var(--green); }
    .no { color: var(--red); }
    .partial { color: var(--amber); }

    /* QUOTE */
    .quote-block {
      background: var(--surface);
      border-left: 3px solid var(--accent);
      border-radius: 0 8px 8px 0;
      padding: 1.25rem 1.5rem;
      margin: 2rem 0;
    }
    .quote-block blockquote {
      font-size: 1rem;
      font-style: italic;
      color: var(--muted);
      line-height: 1.7;
      margin-bottom: 0.5rem;
    }
    .quote-source {
      font-size: 0.8rem;
      color: var(--muted);
    }

    /* FOOTER */
    footer {
      padding: 3rem 2rem;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 0.85rem;
      color: var(--muted);
    }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    /* UTIL */
    .mt-1 { margin-top: 0.5rem; }
    .mt-2 { margin-top: 1rem; }
    .mt-4 { margin-top: 2rem; }
    .inline-code {
      font-family: monospace;
      font-size: 0.85em;
      background: rgba(255,255,255,0.06);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      color: var(--accent);
    }
  </style>
</head>
<body>

<!-- NAV -->
<nav>
  <div class="logo">
    <div class="logo-mark">\u2B21</div>
    AgentLair
  </div>
  <div class="links">
    <a href="#how">How it works</a>
    <a href="#api">API</a>
    <a href="#pricing">Pricing</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/getting-started" style="color:var(--green);">Getting Started</a>
    <a href="#web-signup" class="btn-nav">Create Account \u2192</a>
  </div>
</nav>

<!-- HERO -->
<div class="hero">
  <div class="container">
    <div class="badge">Beta \u00B7 <span>Email for AI agents \u2014 live now</span></div>
    <h1>Give your agent<br /><em>an email address.</em></h1>
    <p class="hero-sub">
      Claim any @agentlair.dev address in seconds. Send and receive email via REST API.
      No SMTP config. No IMAP client. No dashboard visits. No per-inbox pricing.
    </p>
    <div class="hero-cta">
      <a href="#web-signup" class="btn-primary">Create Free Account \u2192</a>
      <a href="#how" class="btn-secondary">How it works</a>
    </div>

    <div class="hero-code">
      <div class="code-tab">
        <div class="dot dot-red"></div>
        <div class="dot dot-amber"></div>
        <div class="dot dot-green"></div>
      </div>
      <div>
        <span class="c-comment"># Step 1: Get an API key (free, instant)</span>
      </div>
      <div style="margin-top:0.5rem">
        <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/auth/keys
      </div>
      <div style="margin-top:0.25rem; color:#555570;">\u2192 { <span class="c-key">"api_key"</span>: <span class="c-str">"al_live_k7x9m2p4..."</span> }</div>

      <div style="margin-top:1.25rem">
        <span class="c-comment"># Step 2: Claim an email address</span>
      </div>
      <div style="margin-top:0.5rem">
        <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/claim \\
      </div>
      <div style="padding-left:1.5rem">
        -H <span class="c-str">"Authorization: Bearer al_live_k7x9m2p4..."</span> \\
      </div>
      <div style="padding-left:1.5rem">
        -d <span class="c-str">'{"address": "my-agent@agentlair.dev"}'</span>
      </div>
      <div style="margin-top:0.25rem; color:#555570;">\u2192 { <span class="c-key">"address"</span>: <span class="c-str">"my-agent@agentlair.dev"</span>, <span class="c-key">"status"</span>: <span class="c-ok">"active"</span> }</div>

      <div style="margin-top:1.25rem">
        <span class="c-comment"># Step 3: Send email</span>
      </div>
      <div style="margin-top:0.5rem">
        <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/send \\
      </div>
      <div style="padding-left:1.5rem">
        -d <span class="c-str">'{"from": "my-agent@agentlair.dev", "to": "user@example.com",</span>
      </div>
      <div style="padding-left:1.5rem">
            <span class="c-str"> "subject": "Hello", "text": "Signed, your AI agent."}'</span>
      </div>
      <div style="margin-top:0.75rem; color:#555570;"><span class="c-comment"># DKIM-signed. Delivered. No CAPTCHA. No phone. No dashboard.</span></div>
    </div>
  </div>
</div>

<!-- PROBLEM -->
<section id="problem">
  <div class="container">
    <div class="section-label">The Problem</div>
    <h2>The web was built for humans.<br />Agents don't fit.</h2>
    <p class="lead">
      AI agents can write code, analyze contracts, run outreach campaigns, and manage entire business workflows.
      But ask one to get its own email address, and it's stuck \u2014 every provider's
      signup flow is a human-verification gauntlet the agent cannot pass.
    </p>

    <div class="quote-block">
      <blockquote>
        "Operator is trained to proactively ask the user to take over for tasks that require login, payment details, or when solving CAPTCHAs."
      </blockquote>
      <div class="quote-source">\u2014 OpenAI, ChatGPT Agent documentation</div>
    </div>

    <div class="blockers">
      <div class="blocker-card">
        <div class="blocker-icon">\uD83E\uDD16</div>
        <h3>CAPTCHA &amp; Turnstile</h3>
        <p>Cloudflare blocked 416 billion AI bot requests in 6 months. Modern CAPTCHAs score behavioral patterns \u2014 perfect mouse movement flags agents.</p>
        <span class="tag-blocked">60% success rate at best</span>
      </div>
      <div class="blocker-card">
        <div class="blocker-icon">\uD83D\uDCCD</div>
        <h3>IP Reputation</h3>
        <p>Agents run on datacenter IPs. Humans have years of accumulated residential trust. Datacenter IPs are flagged automatically, before any CAPTCHA loads.</p>
        <span class="tag-blocked">Structural, not fixable</span>
      </div>
      <div class="blocker-card">
        <div class="blocker-icon">\uD83D\uDCF1</div>
        <h3>Phone Verification</h3>
        <p>Gmail, Mailgun, cloud providers \u2014 all require a phone number. VOIP numbers are detected and rejected. Agents have no phone.</p>
        <span class="tag-blocked">Hardware requirement</span>
      </div>
      <div class="blocker-card">
        <div class="blocker-icon">\uD83E\uDEAA</div>
        <h3>KYC / Legal Identity</h3>
        <p>Cloud providers, domain registrars, and payment processors require government ID and credit card tied to a real person. Agents have neither.</p>
        <span class="tag-blocked">Legal constraint</span>
      </div>
    </div>

    <p style="margin-top:2.5rem; color: var(--muted); font-size:0.9rem;">
      This is not fixable by making agents smarter. The verification systems are working correctly \u2014
      they're accurately detecting automation and blocking it by design.
      What's needed is a new infrastructure layer.
    </p>
  </div>
</section>

<!-- HOW IT WORKS -->
<section id="how">
  <div class="container">
    <div class="section-label">The Solution</div>
    <h2>Agent email in<br />three API calls.</h2>
    <p class="lead">
      No signups. No CAPTCHA. No per-inbox fees. AgentLair gives any AI agent a verified
      email identity in seconds \u2014 with full send/receive over a clean REST API.
    </p>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <h3>Create an API key</h3>
          <p><span class="inline-code">POST /v1/auth/keys</span> \u2014 takes 1 second, no account needed. You get an <span class="inline-code">al_live_...</span> key that identifies your agent. Keys can be rotated or revoked at any time.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <h3>Claim an address</h3>
          <p><span class="inline-code">POST /v1/email/claim</span> \u2014 claim any <span class="inline-code">name@agentlair.dev</span> address. First-touch ownership model: first agent to claim an address owns it. DKIM, SPF, and DMARC are pre-configured. Ready to send in under 5 seconds.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <h3>Send and receive</h3>
          <p><span class="inline-code">POST /v1/email/send</span> sends DKIM-signed email to any address. <span class="inline-code">GET /v1/email/inbox</span> returns messages with full body, threading context, and attachment metadata. No IMAP client, no SMTP credentials, no configuration files.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-body">
          <h3>Deploy anywhere, stay in control</h3>
          <p>Run your agent in LangChain, CrewAI, Claude, or raw Python/TS \u2014 any HTTP client works. AgentLair handles delivery, authentication, and storage. You see full send/receive history. No black boxes.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- API SECTION -->
<section id="api">
  <div class="container">
    <div class="section-label">The API</div>
    <h2>REST-only. JSON everywhere.<br/>Nothing else required.</h2>
    <p class="lead">No IMAP clients, no SMTP configuration, no DNS zone editors, no dashboards. Every operation is a single authenticated HTTP request.</p>

    <div class="quickstart-box">
      <div class="quickstart-box-header">
        <span>&#9889; Get your API key &mdash; free, instant, no credit card</span>
        <button class="copy-btn" id="copy-key-cmd" onclick="var cmd='curl -X POST https://agentlair.dev/v1/auth/keys';navigator.clipboard.writeText(cmd).then(function(){var b=document.getElementById('copy-key-cmd');b.textContent='Copied!';b.classList.add('copied');setTimeout(function(){b.textContent='Copy';b.classList.remove('copied');},2000);});">Copy</button>
      </div>
      <div class="quickstart-box-body">
        <div><span class="c-comment"># One request — no sign-up form, no email verification</span></div>
        <div style="margin-top:0.5rem"><span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/auth/keys</div>
        <div style="margin-top:0.5rem; color:#555570;">&#8594; { <span class="c-key">"api_key"</span>: <span class="c-str">"al_live_k7x9m2p4..."</span>, <span class="c-key">"tier"</span>: <span class="c-str">"free"</span> }</div>
        <div style="margin-top:1rem"><span class="c-comment"># Use that key immediately to claim an address</span></div>
        <div style="margin-top:0.5rem"><span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/claim \</div>
        <div style="padding-left:1.5rem">-H <span class="c-str">"Authorization: Bearer al_live_k7x9m2p4..."</span> \</div>
        <div style="padding-left:1.5rem">-d <span class="c-str">'{"address":"my-agent@agentlair.dev"}'</span></div>
      </div>
    </div>

    <!-- WEB SIGNUP -->
    <div id="web-signup" style="margin-bottom:2.5rem;">
      <div id="signup-cta" style="padding: 2rem; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; text-align:center;">
        <p style="color: var(--muted); font-size: 0.95rem; margin-bottom: 1.25rem;">Prefer a browser? Create your account right here \u2014 no terminal needed.</p>
        <button class="btn-primary" id="signup-btn" onclick="webSignup()" style="font-size:1rem; padding:0.85rem 2rem;">Create Free Account &rarr;</button>
      </div>
      <div id="signup-result" style="display:none; text-align:left; background: var(--surface); border: 1px solid rgba(99,102,241,0.4); border-radius: 12px; padding: 2rem;">
        <h3 style="color: var(--green); font-size:1.1rem; margin-bottom:1.25rem;">&#10003; Account created!</h3>
        <label style="display:block; font-size:0.85rem; color:var(--muted); margin-bottom:0.4rem;">Your API Key <span style="font-size:0.78rem;">(click to copy \u2014 shown only once)</span>:</label>
        <div id="new-api-key" style="font-family:monospace; font-size:0.9rem; background:var(--code-bg); border:1px solid var(--border); border-radius:8px; padding:0.75rem 1rem; color:var(--green); word-break:break-all; cursor:pointer; margin-bottom:1.5rem;" onclick="navigator.clipboard.writeText(this.textContent);this.style.borderColor='var(--green)';setTimeout(function(){document.getElementById('new-api-key').style.borderColor='var(--border)';},1500);" title="Click to copy"></div>

        <div id="claim-step" style="border-top:1px solid var(--border); padding-top:1.25rem;">
          <p style="font-weight:600; margin-bottom:0.75rem; font-size:0.95rem;">Step 2: Claim your email address</p>
          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <input type="text" id="claim-local" placeholder="my-agent" style="flex:1; min-width:140px; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.6rem 0.9rem; color:var(--text); font-size:0.9rem; outline:none; font-family:monospace;" />
            <span style="color:var(--muted); font-size:0.9rem;">@agentlair.dev</span>
            <button class="btn-primary" style="padding:0.6rem 1.2rem;" onclick="claimAddress()">Claim</button>
          </div>
          <div id="claim-result" style="margin-top:0.75rem; font-size:0.9rem;"></div>
        </div>

        <div id="recovery-step" style="display:none; border-top:1px solid var(--border); padding-top:1.25rem; margin-top:1.25rem;">
          <p style="font-weight:600; margin-bottom:0.5rem; font-size:0.95rem;">Step 3: Set a recovery email <span style="color:var(--muted); font-weight:400; font-size:0.85rem;">(optional)</span></p>
          <p style="color:var(--muted); font-size:0.85rem; margin-bottom:0.75rem;">Enables magic-link login to the <a href="/dashboard">dashboard</a> if you lose your key.</p>
          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <input type="email" id="recovery-input" placeholder="you@example.com" style="flex:1; min-width:180px; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.6rem 0.9rem; color:var(--text); font-size:0.9rem; outline:none;" />
            <button class="btn-primary" style="padding:0.6rem 1.2rem;" onclick="setRecovery()">Save</button>
          </div>
          <div id="recovery-result" style="margin-top:0.75rem; font-size:0.9rem;"></div>
        </div>

        <div style="margin-top:1.5rem; padding-top:1.25rem; border-top:1px solid var(--border); display:flex; gap:1rem; flex-wrap:wrap;">
          <a href="/dashboard" class="btn-primary" style="text-decoration:none;">Open Dashboard &rarr;</a>
          <a href="/getting-started" class="btn-secondary" style="text-decoration:none;">Getting Started Guide</a>
        </div>
      </div>
    </div>

    <div class="api-grid">
      <div class="api-card">
        <h3><span class="method">POST</span> /v1/email/claim</h3>
        <p>Claim any @agentlair.dev address instantly. First-touch ownership. DKIM, SPF, DMARC pre-configured.</p>
        <ul>
          <li>Instant address provisioning</li>
          <li>DKIM + SPF + DMARC included</li>
          <li>No DNS setup required</li>
          <li>Up to 10 addresses per account (free)</li>
        </ul>
      </div>
      <div class="api-card">
        <h3><span class="method">POST</span> /v1/email/send</h3>
        <p>Send email from any address in your stack. HTML + plain text. Attachments. Custom headers.</p>
        <ul>
          <li>DKIM-signed automatically</li>
          <li>In-Reply-To threading support</li>
          <li>Delivery status webhooks</li>
        </ul>
      </div>
      <div class="api-card">
        <h3><span class="method">GET</span> /v1/email/inbox</h3>
        <p>Check any inbox programmatically. Cursor-based pagination. Real-time via webhook.</p>
        <ul>
          <li>Webhook push on new messages</li>
          <li>Full message body + attachments</li>
          <li>Thread ID for conversation context</li>
        </ul>
      </div>
      <div class="api-card" style="opacity: 0.55;">
        <h3><span class="method" style="background: rgba(245,158,11,0.15); color: var(--amber);">Q2 2026</span> /v1/dns/{domain}/records</h3>
        <p>Full CRUD on DNS records. Zone created automatically by stack init. Managed records (MX, SPF, DKIM) handled by us.</p>
        <ul>
          <li>A, AAAA, CNAME, MX, TXT, SRV, CAA</li>
          <li>Propagation status in response</li>
          <li>Vanity nameservers (ns1/ns2.agentlair.dev)</li>
        </ul>
      </div>
      <div class="api-card" style="opacity: 0.55;">
        <h3><span class="method" style="background: rgba(245,158,11,0.15); color: var(--amber);">Q2 2026</span> /v1/hosting/{id}/deploy</h3>
        <p>Deploy a static site from a tar.gz archive or direct upload. Instant rollback to any previous deployment.</p>
        <ul>
          <li>Upload archive or point to URL</li>
          <li>Preview URL per deployment</li>
          <li>Rollback in one API call</li>
        </ul>
      </div>
      <div class="api-card" style="border-color: rgba(99,102,241,0.3); background: rgba(99,102,241,0.04);">
        <h3>HTTP 402 \u2014 Agent Payments</h3>
        <p>When free tier limits are exceeded, the API returns a standard HTTP 402 with x402 payment details. Agents with wallets pay and retry automatically. Zero code changes.</p>
        <ul>
          <li>x402 / USDC on Base (autonomous agents)</li>
          <li>Stripe checkout (humans)</li>
          <li>Compatible with <span class="inline-code">@x402/fetch</span></li>
        </ul>
      </div>
    </div>

    <div class="x402-note mt-4" style="border-color: rgba(34,197,94,0.2); background: rgba(34,197,94,0.05);">
      <strong>A2A Agent Card:</strong> AgentLair exposes a standard A2A v0.3 agent card at <span class="inline-code">/.well-known/agent.json</span> \u2014 any A2A-compatible orchestrator can discover AgentLair\u2019s capabilities automatically. No documentation reading required.
    </div>

    <div style="margin-top:2rem; background: var(--code-bg); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem 2rem; font-family: monospace; font-size: 0.83rem; line-height: 1.8; overflow-x: auto;">
      <div class="c-comment"># Works with any HTTP client \u2014 Python, TypeScript, curl, anything</div>
      <div style="margin-top:0.75rem; color:#555570">// Send email (TypeScript)</div>
      <div><span class="c-cmd">const</span> res = <span class="c-cmd">await</span> <span class="c-val">fetch</span>(<span class="c-str">"https://agentlair.dev/v1/email/send"</span>, {</div>
      <div style="padding-left:1.5rem"><span class="c-key">method</span>: <span class="c-str">"POST"</span>,</div>
      <div style="padding-left:1.5rem"><span class="c-key">headers</span>: { <span class="c-str">"Authorization"</span>: <span class="c-str">\`Bearer \${apiKey}\`</span>, <span class="c-str">"Content-Type"</span>: <span class="c-str">"application/json"</span> },</div>
      <div style="padding-left:1.5rem"><span class="c-key">body</span>: JSON.<span class="c-val">stringify</span>({</div>
      <div style="padding-left:3rem"><span class="c-key">from</span>: <span class="c-str">"my-agent@agentlair.dev"</span>,</div>
      <div style="padding-left:3rem"><span class="c-key">to</span>: [<span class="c-str">"user@example.com"</span>],</div>
      <div style="padding-left:3rem"><span class="c-key">subject</span>: <span class="c-str">"Found it"</span>,</div>
      <div style="padding-left:3rem"><span class="c-key">text</span>: <span class="c-str">"Here are the results..."</span></div>
      <div style="padding-left:1.5rem">})</div>
      <div>});</div>
      <div style="margin-top:0.75rem; color:#555570">// Check inbox</div>
      <div><span class="c-cmd">const</span> inbox = <span class="c-cmd">await</span> <span class="c-val">fetch</span>(<span class="c-str">"https://agentlair.dev/v1/email/inbox?address=my-agent@agentlair.dev"</span>, {</div>
      <div style="padding-left:1.5rem"><span class="c-key">headers</span>: { <span class="c-str">"Authorization"</span>: <span class="c-str">\`Bearer \${apiKey}\`</span> }</div>
      <div>}).<span class="c-val">then</span>(r => r.<span class="c-val">json</span>());</div>
    </div>
  </div>
</section>

<!-- COMPARISON -->
<section>
  <div class="container">
    <div class="section-label">Comparison</div>
    <h2>Agent email without human gatekeeping.</h2>
    <p class="lead">The alternatives are built for humans with browsers. AgentLair is built for agents with HTTP clients. DNS and hosting coming Q2 2026.</p>

    <table class="compare-table">
      <thead>
        <tr>
          <th>Service</th>
          <th>Email</th>
          <th>DNS</th>
          <th>Hosting</th>
          <th>Unified API</th>
          <th>No CAPTCHA</th>
          <th>A2A Card</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong class="ours">AgentLair</strong></td>
          <td class="yes ours">\u2713</td>
          <td class="partial ours">Q2 2026</td>
          <td class="partial ours">Q2 2026</td>
          <td class="yes ours">\u2713</td>
          <td class="yes ours">\u2713</td>
          <td class="yes ours">\u2713</td>
        </tr>
        <tr>
          <td>AgentMail</td>
          <td class="yes">\u2713</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="yes">\u2713</td>
          <td class="no">\u2717</td>
        </tr>
        <tr>
          <td>Resend</td>
          <td class="partial">Partial</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="partial">Partial</td>
          <td class="no">\u2717</td>
        </tr>
        <tr>
          <td>Porkbun API</td>
          <td class="no">\u2717</td>
          <td class="yes">\u2713</td>
          <td class="no">\u2717</td>
          <td class="no">\u2717</td>
          <td class="no">Human needed</td>
          <td class="no">\u2717</td>
        </tr>
        <tr>
          <td>Cloudflare Pages</td>
          <td class="no">\u2717</td>
          <td class="partial">Partial</td>
          <td class="yes">\u2713</td>
          <td class="no">\u2717</td>
          <td class="no">Human needed</td>
          <td class="no">\u2717</td>
        </tr>
        <tr>
          <td>DIY (all three)</td>
          <td class="partial">Maybe</td>
          <td class="partial">Maybe</td>
          <td class="partial">Maybe</td>
          <td class="no">\u2717</td>
          <td class="no">3\u00D7 human setup</td>
          <td class="no">\u2717</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<!-- PRICING -->
<section id="pricing">
  <div class="container">
    <div class="section-label">Pricing</div>
    <h2>Generous free tier.<br />Agent-native paid plans.</h2>
    <p class="lead">Start free. No credit card required. Upgrade with a Stripe checkout or \u2014 if you're an agent \u2014 pay autonomously via x402.</p>

    <div class="pricing-grid">
      <div class="price-card">
        <div class="price-tier">Free</div>
        <div class="price-amount">\\$0 <span>/ month</span></div>
        <div class="price-desc">Enough to build and test. No credit card. No waitlist. Start in 30 seconds.</div>
        <ul class="price-features">
          <li><span class="check">\u2713</span> 10 email addresses</li>
          <li><span class="check">\u2713</span> 50 emails sent / day</li>
          <li><span class="check">\u2713</span> Unlimited received</li>
          <li><span class="check">\u2713</span> DKIM + SPF + DMARC included</li>
          <li><span class="check">\u2713</span> 100 API requests / day <small style="color:var(--muted);font-size:0.75em;">(send, read, claim — health &amp; discovery free)</small></li>
          <li><span class="check">\u2713</span> @agentlair.dev addresses</li>
        </ul>
      </div>
      <div class="price-card featured">
        <div class="featured-badge">MOST POPULAR</div>
        <div class="price-tier">Pro</div>
        <div class="price-amount">\\$5 <span>/ stack / month</span></div>
        <div class="price-desc">For agents in production. Pay with Stripe or USDC via x402.</div>
        <ul class="price-features">
          <li><span class="check">\u2713</span> 10 stacks</li>
          <li><span class="check">\u2713</span> 25 email addresses per stack</li>
          <li><span class="check">\u2713</span> 1,000 emails sent / month</li>
          <li><span class="check">\u2713</span> Webhook push notifications</li>
          <li><span class="check">\u2713</span> Custom domains (bring your own)</li>
          <li><span class="check">\u2713</span> DNS + hosting (Q2 2026)</li>
        </ul>
      </div>
      <div class="price-card">
        <div class="price-tier">Agent Fleet</div>
        <div class="price-amount">\\$0.01 <span>/ email via <span class="tooltip-wrap">x402<span class="tooltip-text">x402 is an emerging HTTP standard: when your free-tier limit is hit, the API returns HTTP 402 with a USDC payment address on Base. Your agent sends a micro-payment (~$0.01) and retries — no human, no checkout, no dashboard. Requires <strong>@x402/fetch</strong> or a CDP wallet.</span></span></span></div>
        <div class="price-desc">For autonomous agents that provision their own billing. Pay-as-you-go in USDC on Base.</div>
        <ul class="price-features">
          <li><span class="check">\u2713</span> HTTP 402 on limit exceeded</li>
          <li><span class="check">\u2713</span> x402 auto-payment and retry</li>
          <li><span class="check">\u2713</span> Zero human involvement</li>
          <li><span class="check">\u2713</span> Compatible with @x402/fetch</li>
          <li><span class="check">\u2713</span> CDP wallet integration (Coinbase)</li>
          <li><span class="check">\u2713</span> Usage audit trail per agent key</li>
        </ul>
      </div>
    </div>

    <div class="x402-note mt-4">
      <strong>How x402 agent payments work:</strong> When a free-tier limit is exceeded, AgentLair returns <span class="inline-code">HTTP 402 Payment Required</span> with payment details in the body \u2014 amount, USDC address, network. An agent using <span class="inline-code">@x402/fetch</span> sees this, constructs a Base transaction, pays, and retries the original request automatically. No human, no Stripe checkout, no dashboard visit. The agent pays its own infrastructure.
    </div>
    <p style="margin-top:1.25rem; font-size:0.8rem; color:var(--muted); text-align:center;">
      &#128274;&nbsp; Messages retained for <strong style="color:var(--text);">30 days</strong> &nbsp;&middot;&nbsp; Delete anytime via API &nbsp;&middot;&nbsp; No PII stored beyond email content
    </p>
  </div>
</section>

<!-- CTA -->
<section style="text-align: center;">
  <div class="container">
    <h2>Your agent can have email.<br />Start in 30 seconds.</h2>
    <p class="lead" style="margin-bottom: 2.5rem;">
      No waitlist. No credit card. No CAPTCHA. Get an API key, claim an address, start sending.
      <br />Email infrastructure that works the way agents work.
    </p>
    <div class="hero-cta">
      <a href="#web-signup" class="btn-primary">Create Free Account \u2192</a>
      <a href="/.well-known/agent.json" class="btn-secondary" title="Machine-readable service description for AI agents (A2A protocol). Lets agents discover AgentLair's capabilities automatically.">A2A agent card</a>
    </div>
    <p style="margin-top: 2rem; font-size: 0.85rem; color: var(--muted);">
      Questions? Email <a href="mailto:hello@agentlair.dev">hello@agentlair.dev</a> or find us on X&nbsp;/ Farcaster.
    </p>
  </div>
</section>

<!-- FOOTER -->
<footer>
  <p>\u00A9 2026 AgentLair &mdash; Email for the agentic web.</p>
  <p style="margin-top:0.5rem;">
    <a href="/getting-started">Getting Started</a> &nbsp;\u00B7&nbsp;
    <a href="/api">API</a> &nbsp;\u00B7&nbsp;
    <a href="/dashboard">Dashboard</a> &nbsp;\u00B7&nbsp;
    <a href="/security">Security</a> &nbsp;\u00B7&nbsp;
    <a href="/.well-known/agent.json" title="A2A agent card: machine-readable service discovery for AI agents (JSON)">A2A</a> &nbsp;\u00B7&nbsp;
    <a href="mailto:hello@agentlair.dev">Contact</a>
  </p>
</footer>

<script>
var _signupKey = null;
function webSignup() {
  var btn = document.getElementById('signup-btn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:middle;margin-right:6px;"></span>Creating...';
  fetch('/v1/auth/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(r) {
      if (!r.ok) { btn.textContent = r.data.message || 'Error \u2014 try again'; btn.disabled = false; return; }
      _signupKey = r.data.api_key;
      document.getElementById('new-api-key').textContent = r.data.api_key;
      document.getElementById('signup-cta').style.display = 'none';
      document.getElementById('signup-result').style.display = 'block';
      document.getElementById('signup-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
    })
    .catch(function() { btn.textContent = 'Network error \u2014 try again'; btn.disabled = false; });
}
function claimAddress() {
  if (!_signupKey) return;
  var local = document.getElementById('claim-local').value.trim().toLowerCase();
  if (!local) { document.getElementById('claim-result').innerHTML = '<span style="color:#ef4444;">Enter an address name</span>'; return; }
  var addr = local + '@agentlair.dev';
  document.getElementById('claim-result').innerHTML = '<span style="color:#888898;">Claiming...</span>';
  fetch('/v1/email/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _signupKey },
    body: JSON.stringify({ address: addr })
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(r) {
      if (r.ok) {
        document.getElementById('claim-result').innerHTML = '<span style="color:#22c55e;">&#10003; <strong>' + addr + '</strong> is yours! You can send and receive email now.</span>';
        document.getElementById('recovery-step').style.display = 'block';
      } else {
        document.getElementById('claim-result').innerHTML = '<span style="color:#ef4444;">' + (r.data.message || 'Claim failed') + '</span>';
      }
    })
    .catch(function() { document.getElementById('claim-result').innerHTML = '<span style="color:#ef4444;">Network error</span>'; });
}
function setRecovery() {
  if (!_signupKey) return;
  var email = document.getElementById('recovery-input').value.trim();
  if (!email) return;
  document.getElementById('recovery-result').innerHTML = '<span style="color:#888898;">Saving...</span>';
  fetch('/v1/account/recovery-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _signupKey },
    body: JSON.stringify({ email: email })
  })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(r) {
      if (r.ok) {
        document.getElementById('recovery-result').innerHTML = '<span style="color:#22c55e;">&#10003; Recovery email saved. You can log into the <a href="/dashboard" style="color:#6366f1;">dashboard</a> via magic link.</span>';
      } else {
        document.getElementById('recovery-result').innerHTML = '<span style="color:#ef4444;">' + (r.data.message || 'Failed') + '</span>';
      }
    })
    .catch(function() { document.getElementById('recovery-result').innerHTML = '<span style="color:#ef4444;">Network error</span>'; });
}
</script>
<style>@keyframes spin{to{transform:rotate(360deg);}}</style>

</body>
</html>`;

// ─── Security Blog Post HTML ────────────────────────────────────────────────

const SECURITY_BLOG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Security at AgentLair \u2014 What We Protect, What We Don't</title>
  <meta name="description" content="A technical overview of AgentLair's security architecture: E2E encryption, encryption at rest, API key auth, vault design, and what we explicitly don't protect against." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0f;
      --surface: #111118;
      --border: #1e1e2e;
      --accent: #6366f1;
      --accent-dim: #4f52c8;
      --text: #e8e8f0;
      --muted: #888898;
      --green: #22c55e;
      --amber: #f59e0b;
      --red: #ef4444;
      --code-bg: #0d0d17;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.7;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    nav {
      display: flex; justify-content: space-between; align-items: center;
      padding: 1.25rem 2rem; border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: rgba(10,10,15,0.92);
      backdrop-filter: blur(12px); z-index: 10;
    }
    .logo { font-size: 1.15rem; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 0.5rem; }
    .logo-mark { width: 28px; height: 28px; background: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; }
    nav .links { display: flex; gap: 1.5rem; align-items: center; }
    nav .links a { color: var(--muted); font-size: 0.9rem; }
    nav .links a:hover { color: var(--text); text-decoration: none; }

    .article { max-width: 720px; margin: 0 auto; padding: 4rem 2rem 6rem; }
    .article-meta { font-size: 0.82rem; color: var(--muted); margin-bottom: 0.5rem; }
    .article h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; margin-bottom: 1.5rem; }
    .article h1 em { color: var(--accent); font-style: normal; }
    .article-intro { font-size: 1.15rem; color: var(--muted); line-height: 1.7; margin-bottom: 3rem; border-left: 3px solid var(--accent); padding-left: 1.25rem; }

    .article h2 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin: 3rem 0 1rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    .article h3 { font-size: 1.1rem; font-weight: 600; margin: 2rem 0 0.75rem; color: var(--text); }
    .article p { margin-bottom: 1.25rem; }
    .article ul, .article ol { margin-bottom: 1.25rem; padding-left: 1.5rem; }
    .article li { margin-bottom: 0.4rem; }
    .article strong { color: #fff; }

    pre {
      background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.25rem 1.5rem; overflow-x: auto; margin-bottom: 1.5rem;
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.82rem; line-height: 1.7; color: var(--muted);
    }
    code {
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.88em; background: var(--code-bg); padding: 0.15em 0.4em;
      border-radius: 4px; color: var(--accent);
    }
    pre code { background: none; padding: 0; font-size: inherit; color: inherit; }

    .diagram {
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.5rem 2rem; margin: 1.5rem 0 2rem; font-family: 'SF Mono', monospace;
      font-size: 0.82rem; line-height: 1.7; color: var(--muted); white-space: pre;
      overflow-x: auto;
    }

    .callout {
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      padding: 1.25rem 1.5rem; margin: 1.5rem 0 2rem;
    }
    .callout-title { font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.5rem; }
    .callout-green .callout-title { color: var(--green); }
    .callout-amber .callout-title { color: var(--amber); }
    .callout-red .callout-title { color: var(--red); }
    .callout p { margin-bottom: 0.5rem; }
    .callout p:last-child { margin-bottom: 0; }

    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0 2rem; font-size: 0.88rem; }
    th { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 2px solid var(--border); color: var(--muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: none; }

    footer { text-align: center; padding: 3rem 2rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    @media (max-width: 640px) {
      .article { padding: 2rem 1.25rem 4rem; }
      pre { padding: 1rem; font-size: 0.75rem; }
      .diagram { padding: 1rem; font-size: 0.72rem; }
    }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo"><span class="logo-mark">\u26A1</span> AgentLair</a>
  <div class="links">
    <a href="/">Home</a>
    <a href="/api">API</a>
    <a href="/dashboard">Dashboard</a>
  </div>
</nav>

<article class="article">

  <p class="article-meta">March 2026 &middot; Security</p>
  <h1>Security at AgentLair: <em>What We Protect and What We Don't</em></h1>

  <div class="article-intro">
    AgentLair handles email and secrets for AI agents. If you're evaluating whether to trust us with your agent's data, this page tells you exactly how security works under the hood \u2014 including the parts we can't protect you from.
  </div>

  <h2>Threat Model</h2>

  <h3>What we protect against</h3>
  <ul>
    <li><strong>AgentLair reading your data.</strong> With E2E encryption enabled, email bodies are encrypted with your public key before storage. We hold ciphertext. We can't read it.</li>
    <li><strong>Data exposure from a KV store breach.</strong> All email bodies are encrypted at rest with a platform-level AES-256-GCM key, even without E2E. An attacker who dumps the store gets encrypted blobs.</li>
    <li><strong>Cross-user data access.</strong> Every API call authenticates via hashed API key and resolves to an <code>account_id</code>. Inbox access, sending, webhooks, and vault operations are all scoped to the authenticated account.</li>
    <li><strong>Credential theft after key compromise.</strong> API keys are SHA-256 hashed before storage. If the key store leaks, attackers get hashes, not keys. You can rotate keys and activate backups instantly via the API.</li>
    <li><strong>Spam and abuse.</strong> Multi-layer rate limiting: per-address daily/hourly/burst limits, bounce-rate suspension, per-account request caps.</li>
  </ul>

  <h3>What we explicitly don't protect against</h3>

  <div class="callout callout-red">
    <div class="callout-title">Honest Limitation</div>
    <p><strong>A fully compromised AgentLair server</strong> can intercept plaintext for new messages \u2014 even with E2E enabled. If an attacker controls the worker code, they could swap out the encryption step and store plaintext instead. E2E protects stored data and protects against passive breaches, but it does not protect against an active attacker who controls the server. This is true of any web service that performs encryption server-side on incoming data.</p>
    <p>Vault secrets are safe in this scenario \u2014 they're encrypted client-side before reaching AgentLair. We never see the plaintext.</p>
  </div>

  <ul>
    <li><strong>Compromised client.</strong> If your agent's runtime is compromised (container escape, stolen env vars), the attacker has your API key and master seed. That's game over for that agent's data \u2014 same as any credential theft.</li>
    <li><strong>Social engineering of recovery emails.</strong> Vault recovery relies on email magic links. If an attacker controls the recovery email account, they can access encrypted vault entries (still encrypted \u2014 they'd need the passphrase to decrypt).</li>
  </ul>

  <h2>E2E Encryption</h2>

  <p>AgentLair offers optional end-to-end encryption for email bodies. When enabled, the server <strong>never sees plaintext</strong> \u2014 bodies are encrypted before storage and can only be decrypted by the agent holding the private key.</p>

  <h3>The crypto stack</h3>

  <table>
    <tr><th>Layer</th><th>Algorithm</th><th>Implementation</th></tr>
    <tr><td>Key exchange</td><td>X25519 ECDH</td><td><code>@noble/curves</code> (audited, no native deps)</td></tr>
    <tr><td>Key derivation</td><td>HKDF-SHA-256</td><td>Web Crypto API</td></tr>
    <tr><td>Encryption</td><td>AES-256-GCM</td><td>Web Crypto API</td></tr>
    <tr><td>RNG</td><td>CSPRNG</td><td><code>crypto.getRandomValues()</code></td></tr>
  </table>

  <h3>How it works</h3>

  <div class="diagram">Agent                                AgentLair
  \u2502                                      \u2502
  \u2502  1. Generate 32-byte master seed     \u2502
  \u2502     (CSPRNG, never sent to server)   \u2502
  \u2502                                      \u2502
  \u2502  2. Derive X25519 key pair           \u2502
  \u2502     HKDF(seed, "agentlair:           \u2502
  \u2502      x25519-keypair:{index}")        \u2502
  \u2502                                      \u2502
  \u2502  3. Register public key  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25B6  \u2502  Store public key
  \u2502                                      \u2502
  \u2502               Inbound email arrives  \u2502
  \u2502                                      \u2502  4. Generate ephemeral X25519 key
  \u2502                                      \u2502  5. ECDH(ephemeral, recipient_pub)
  \u2502                                      \u2502  6. HKDF \u2192 AES-256-GCM key
  \u2502                                      \u2502  7. Encrypt body, store ciphertext
  \u2502                                      \u2502
  \u2502  8. GET message  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25B6  \u2502
  \u2502  \u25C0\u2500\u2500\u2500  { ciphertext, ephemeral_pub } \u2502
  \u2502                                      \u2502
  \u2502  9. ECDH(private_key, ephemeral_pub) \u2502
  \u2502  10. HKDF \u2192 AES key \u2192 Decrypt       \u2502</div>

  <p>The ciphertext format is compact: <code>[32B ephemeral_pub][12B IV][ciphertext+tag]</code>, base64url-encoded. No custom wire format \u2014 standard primitives, standard serialization.</p>

  <h3>Key rotation without data loss</h3>
  <p>Keys are derived deterministically from a master seed + index. Index 0 is your first key, index 1 is after rotation, and so on. Old keys are retained in your account's key history, so messages encrypted to previous keys remain decryptable. You derive the corresponding private key from the same seed at the old index.</p>

  <div class="callout callout-green">
    <div class="callout-title">Design choice</div>
    <p>We chose X25519 + HKDF + AES-256-GCM because it's the same stack used by Signal and WireGuard. No exotic primitives. The <code>@noble/curves</code> library is audited, has zero dependencies, and runs everywhere \u2014 Cloudflare Workers, Bun, Node, Deno, browsers.</p>
  </div>

  <h2>Encryption at Rest</h2>

  <p>Independently of E2E, <strong>all stored email bodies are encrypted at rest</strong> with a platform-level key using AES-256-GCM. This is a server-side encryption layer \u2014 AgentLair holds the key.</p>

  <p>This protects against:</p>
  <ul>
    <li>KV store breach (attacker dumps data, gets encrypted blobs)</li>
    <li>Accidental data exposure (misconfigured access, logs)</li>
  </ul>

  <p>It does <strong>not</strong> protect against a compromised server (which holds the key). That's what E2E is for.</p>

  <p>When both layers are active, the data path is:</p>

  <pre><code>plaintext \u2192 E2E encrypt (agent's key) \u2192 platform encrypt (server key) \u2192 KV store
KV store \u2192 platform decrypt \u2192 E2E ciphertext \u2192 return to agent \u2192 agent decrypts</code></pre>

  <p>Two independent keys, two independent layers. Compromising one doesn't break the other.</p>

  <h2>API Key Authentication</h2>

  <h3>How keys work</h3>

  <ol>
    <li><code>POST /v1/auth/keys</code> generates a key: <code>al_live_</code> + 32 random characters (CSPRNG)</li>
    <li>The key is SHA-256 hashed. Only the hash is stored in KV.</li>
    <li>The raw key is returned once and never stored server-side.</li>
    <li>Every authenticated request: hash the provided key, look up the hash.</li>
  </ol>

  <p>Key format example: <code>al_live_Ax7bQ9...</code>. The <code>al_live_</code> prefix aids debugging and secret scanning without reducing entropy.</p>

  <h3>Key lifecycle</h3>

  <table>
    <tr><th>Operation</th><th>Endpoint</th><th>What happens</th></tr>
    <tr><td>Create</td><td><code>POST /v1/auth/keys</code></td><td>New account + active key</td></tr>
    <tr><td>Rotate</td><td><code>POST /v1/auth/keys/rotate</code></td><td>Old key revoked, new key active</td></tr>
    <tr><td>Backup</td><td><code>POST /v1/auth/keys/generate-backup</code></td><td>Dormant key, can't auth yet</td></tr>
    <tr><td>Activate backup</td><td><code>POST /v1/auth/keys/activate-backup</code></td><td>Backup \u2192 active, old \u2192 revoked</td></tr>
  </table>

  <p>At most one active key and one backup key exist at any time. Revoked keys are kept in the audit trail but cannot authenticate.</p>

  <h3>User isolation</h3>

  <p>Every resource is namespaced by <code>account_id</code>:</p>

  <ul>
    <li>Email addresses: <code>email-owner:{address} \u2192 account_id</code></li>
    <li>Messages: <code>msg:{address}:{message_id}</code> (address acts as shard, ownership verified on access)</li>
    <li>Vault entries: <code>vault:{account_id}:{key}:{version}</code></li>
    <li>Outbox: <code>outbox:{account_id}:{timestamp}:{msg_id}</code></li>
    <li>Webhooks: scoped by account_id at registration</li>
  </ul>

  <p>There is no admin API, no superuser key, no backdoor. AgentLair operators interact with data only through the same API.</p>

  <h2>Vault: Encrypted Secret Storage</h2>

  <p>Vault is a zero-knowledge secret store for agents. The core principle: <strong>client encrypts, server stores blobs, server never sees plaintext.</strong></p>

  <h3>How it works</h3>

  <ol>
    <li>Your agent generates an encryption key (from a master seed or passphrase).</li>
    <li>Encrypt the secret locally with AES-256-GCM.</li>
    <li><code>PUT /v1/vault/{key}</code> with the ciphertext. AgentLair stores an opaque blob.</li>
    <li><code>GET /v1/vault/{key}</code> returns the blob. Your agent decrypts locally.</li>
  </ol>

  <div class="diagram">Your Agent                        AgentLair Vault
  \u2502                                    \u2502
  \u2502  encrypt(secret) \u2192 ciphertext    \u2502
  \u2502  PUT /v1/vault/my-key  \u2500\u2500\u2500\u2500\u2500\u2500\u25B6  \u2502  store opaque blob
  \u2502                                    \u2502  (cannot decrypt)
  \u2502  GET /v1/vault/my-key  \u2500\u2500\u2500\u2500\u2500\u2500\u25B6  \u2502
  \u2502  \u25C0\u2500\u2500  ciphertext                  \u2502
  \u2502  decrypt(ciphertext) \u2192 secret    \u2502</div>

  <h3>Recovery</h3>

  <p>When everything fails \u2014 container destroyed, API key lost, agent gone \u2014 recovery works through a registered email:</p>

  <ol>
    <li><code>POST /v1/vault/recover</code> with your recovery email address</li>
    <li>AgentLair sends a single-use magic link (15 minute TTL)</li>
    <li>The link returns all your encrypted vault entries</li>
    <li>Decrypt with your passphrase or master seed</li>
    <li>Spin up a new agent with recovered secrets</li>
  </ol>

  <p>No support ticket. No human at AgentLair involved. The recovery endpoint returns the same response regardless of whether the email exists \u2014 no enumeration possible.</p>

  <div class="callout callout-green">
    <div class="callout-title">Key point</div>
    <p>Recovery returns encrypted blobs. Even if an attacker compromises the recovery email, they still need the passphrase or master seed to decrypt the secrets. This is defense in depth \u2014 email compromise alone is not enough.</p>
  </div>

  <h3>Recommended client-side crypto</h3>

  <p>We document (but don't enforce) a recommended encryption scheme:</p>

  <ul>
    <li><strong>Master seed:</strong> 32 bytes from CSPRNG</li>
    <li><strong>Per-secret key:</strong> <code>HKDF-SHA256(master_seed, key_name)</code> \u2192 32-byte AES key</li>
    <li><strong>Encryption:</strong> AES-256-GCM with random 12-byte IV</li>
    <li><strong>Seed backup:</strong> Encrypt master seed with a passphrase via PBKDF2 (600,000 iterations). Store the encrypted seed in Vault under <code>_master_seed_backup</code>.</li>
  </ul>

  <p>Use whatever crypto you trust. Vault stores opaque bytes \u2014 it doesn't care about the algorithm.</p>

  <h2>Rate Limiting &amp; Abuse Prevention</h2>

  <table>
    <tr><th>Limit</th><th>Free tier</th><th>Pro tier</th></tr>
    <tr><td>Emails per day</td><td>50</td><td>1,000</td></tr>
    <tr><td>Emails per hour</td><td>20</td><td>200</td></tr>
    <tr><td>Burst (per minute)</td><td colspan="2">5</td></tr>
    <tr><td>API requests per day</td><td>100</td><td>10,000</td></tr>
    <tr><td>Bounce rate threshold</td><td colspan="2">&gt;10% after 10 sends \u2192 suspended</td></tr>
  </table>

  <p>All limits are tracked per-address (email) or per-account (API). Bounce rate suspension is automatic \u2014 addresses with high bounce rates are blocked for 30 days. This protects AgentLair's deliverability reputation, which protects every agent using the platform.</p>

  <h2>What's Not Covered</h2>

  <p>Transparency means saying the quiet parts out loud:</p>

  <ul>
    <li><strong>No end-to-end encryption for metadata.</strong> Email subjects, sender/recipient addresses, and timestamps are stored in plaintext. E2E covers the body only. This is a deliberate trade-off \u2014 metadata enables inbox listing, search, and webhooks.</li>
    <li><strong>No forward secrecy.</strong> If your master seed is compromised, all past messages encrypted with keys derived from it can be decrypted. The deterministic key derivation that enables key rotation and recovery is the same property that prevents forward secrecy.</li>
    <li><strong>Cloudflare is in the trust chain.</strong> AgentLair runs on Cloudflare Workers. Cloudflare terminates TLS and could theoretically inspect traffic. If your threat model excludes Cloudflare, AgentLair isn't the right choice.</li>
    <li><strong>Vault metadata is not encrypted.</strong> The <code>metadata</code> field on vault entries (labels, algorithm hints) is stored in plaintext. Never put sensitive information in metadata.</li>
  </ul>

  <h2>Infrastructure</h2>

  <table>
    <tr><th>Component</th><th>Provider</th><th>Purpose</th></tr>
    <tr><td>Compute</td><td>Cloudflare Workers</td><td>API + email processing</td></tr>
    <tr><td>Storage</td><td>Cloudflare KV</td><td>Keys, emails, vault entries</td></tr>
    <tr><td>Email delivery</td><td>Resend</td><td>Outbound SMTP (DKIM/SPF/DMARC)</td></tr>
    <tr><td>Email reception</td><td>Cloudflare Email Routing</td><td>Inbound MX handling</td></tr>
    <tr><td>TLS</td><td>Cloudflare</td><td>Automatic HTTPS</td></tr>
  </table>

  <p>There are no databases, no VMs, no containers to patch. The entire service is a single Cloudflare Worker with KV storage. The attack surface is small by design.</p>

  <h2>Reporting Security Issues</h2>

  <p>Found something? Email <a href="mailto:security@agentlair.dev">security@agentlair.dev</a>. We take reports seriously and will respond within 48 hours. If you've found a data isolation or authentication bypass, we'd rather hear about it from you than discover it ourselves.</p>

</article>

<footer>
  <p>&copy; 2026 AgentLair &mdash; Email for the agentic web.</p>
  <p style="margin-top:0.5rem;">
    <a href="/">Home</a> &nbsp;&middot;&nbsp;
    <a href="/api">API</a> &nbsp;&middot;&nbsp;
    <a href="/dashboard">Dashboard</a> &nbsp;&middot;&nbsp;
    <a href="mailto:hello@agentlair.dev">Contact</a>
  </p>
</footer>

</body>
</html>`;

// ─── Dashboard HTML ─────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentLair Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0f; --surface: #111118; --border: #1e1e2e;
      --accent: #6366f1; --accent-dim: #4f52c8;
      --text: #e8e8f0; --muted: #888898;
      --green: #22c55e; --red: #ef4444; --amber: #f59e0b;
    }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.6; min-height: 100vh; }
    a { color: var(--accent); text-decoration: none; }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 1rem 2rem; border-bottom: 1px solid var(--border); }
    .logo { font-weight: 700; font-size: 1.1rem; color: var(--text); display: flex; align-items: center; gap: 0.5rem; }
    .logo-mark { width: 26px; height: 26px; background: var(--accent); border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; }
    .container { max-width: 820px; margin: 0 auto; padding: 2rem; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem; margin-bottom: 1.5rem; }
    h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; color: var(--text); }
    h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    label { display: block; font-size: 0.85rem; color: var(--muted); margin-bottom: 0.4rem; }
    input[type=email], input[type=text] { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.6rem 0.9rem; color: var(--text); font-size: 0.9rem; outline: none; }
    input:focus { border-color: var(--accent); }
    button { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 0.6rem 1.2rem; font-size: 0.9rem; font-weight: 600; cursor: pointer; }
    button:hover { background: var(--accent-dim); }
    button.secondary { background: transparent; color: var(--muted); border: 1px solid var(--border); }
    button.secondary:hover { color: var(--text); border-color: var(--muted); }
    button.danger { background: var(--red); }
    .meta { font-size: 0.82rem; color: var(--muted); margin-top: 0.25rem; }
    .badge { display: inline-block; border: 1px solid var(--border); border-radius: 100px; padding: 0.15rem 0.65rem; font-size: 0.75rem; color: var(--muted); }
    .badge.green { border-color: var(--green); color: var(--green); }
    .badge.amber { border-color: var(--amber); color: var(--amber); }
    .key-box { font-family: monospace; font-size: 0.9rem; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.9rem; color: var(--green); word-break: break-all; }
    .msg { font-size: 0.83rem; color: var(--muted); border-left: 2px solid var(--border); padding-left: 0.75rem; margin-bottom: 0.5rem; }
    .msg .from { color: var(--text); font-weight: 500; }
    .msg .subj { color: var(--accent); }
    .msg .time { color: var(--muted); font-size: 0.75rem; }
    .row { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0.75rem; }
    .row input { flex: 1; }
    .notice { padding: 0.75rem 1rem; border-radius: 6px; font-size: 0.88rem; margin-bottom: 1rem; }
    .notice.info { background: #1a1a3e; border: 1px solid var(--accent); color: #aab; }
    .notice.ok { background: #0f2f1a; border: 1px solid var(--green); color: #8e8; }
    .notice.err { background: #2f0f0f; border: 1px solid var(--red); color: #e88; }
    .addr-block { border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; }
    .addr-label { font-family: monospace; font-size: 0.9rem; color: var(--accent); margin-bottom: 0.5rem; }
    #login-view, #dashboard-view { display: none; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #fff3; border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo"><span class="logo-mark">AL</span> AgentLair</a>
  <div id="nav-right"></div>
</nav>

<!-- LOGIN VIEW -->
<div id="login-view" class="container">
  <div style="max-width: 460px; margin: 3rem auto;">
    <h2 style="margin-bottom:0.5rem;">Dashboard</h2>
    <p class="meta" style="margin-bottom:1.5rem;">Sign in to manage your addresses, read messages, and send email.</p>
    <div id="login-notice"></div>

    <div style="display:flex; gap:0; margin-bottom:-1px; position:relative; z-index:1;">
      <button id="tab-apikey" onclick="switchLoginTab('apikey')" style="flex:1; border-radius:8px 8px 0 0; padding:0.6rem; font-size:0.85rem; background:var(--surface); border:1px solid var(--accent); border-bottom:1px solid var(--surface); color:var(--accent); font-weight:600;">API Key</button>
      <button id="tab-magic" onclick="switchLoginTab('magic')" style="flex:1; border-radius:8px 8px 0 0; padding:0.6rem; font-size:0.85rem; background:var(--bg); border:1px solid var(--border); border-bottom:1px solid var(--border); color:var(--muted); font-weight:500;">Magic Link</button>
    </div>

    <div id="login-apikey" class="card" style="border-radius:0 0 10px 10px; margin-top:0;">
      <label>API Key</label>
      <div class="row" style="margin-bottom:0;">
        <input type="text" id="apikey-input" placeholder="al_live_..." style="font-family:monospace;" />
        <button onclick="loginWithApiKey()">Sign in</button>
      </div>
      <p class="meta" style="margin-top:0.75rem;">Don't have a key? <a href="/#web-signup">Create a free account</a> on the homepage.</p>
    </div>

    <div id="login-magic" class="card" style="display:none; border-radius:0 0 10px 10px; margin-top:0;">
      <label>Recovery email</label>
      <div class="row" style="margin-bottom:0;">
        <input type="email" id="recovery-email-input" placeholder="you@example.com" />
        <button onclick="requestMagicLink()">Send link</button>
      </div>
      <p class="meta" style="margin-top:0.75rem;">Requires a recovery email set on your account. <a href="#" onclick="event.preventDefault();switchLoginTab('apikey');">Use API key</a> if you haven't set one.</p>
    </div>

    <p class="meta" style="margin-top:1.5rem; text-align:center;"><a href="/">Back to agentlair.dev</a> &nbsp;&middot;&nbsp; <a href="/getting-started">Getting started guide</a></p>
  </div>
</div>

<!-- DASHBOARD VIEW -->
<div id="dashboard-view" class="container">
  <div id="dashboard-notice"></div>

  <!-- Account Card -->
  <div class="card">
    <h3>Account</h3>
    <div style="display:flex; gap:2rem; flex-wrap:wrap; margin-bottom:1rem;">
      <div><label>Account ID</label><div class="meta" id="d-account-id" style="font-family:monospace;">—</div></div>
      <div><label>Tier</label><div id="d-tier"><span class="badge">free</span></div></div>
      <div><label>API Key</label><div class="meta" id="d-key-prefix" style="font-family:monospace;">—</div></div>
      <div><label>Recovery Email</label><div class="meta" id="d-recovery-email">—</div></div>
    </div>
    <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
      <button class="secondary" onclick="showRotatePanel()">Rotate API key</button>
      <button class="secondary" onclick="showUpdateRecovery()">Update recovery email</button>
      <button class="secondary danger" onclick="logout()">Log out</button>
    </div>
    <div id="rotate-panel" style="display:none; margin-top:1rem;">
      <div class="notice info">⚠️ Rotating your key will invalidate the current one immediately. Update all agents using this key before or after.</div>
      <button onclick="rotateKey()">Confirm: rotate key</button>
    </div>
    <div id="update-recovery-panel" style="display:none; margin-top:1rem;">
      <label>New recovery email</label>
      <div class="row">
        <input type="email" id="update-recovery-input" placeholder="new@example.com" />
        <button onclick="updateRecoveryEmail()">Save</button>
      </div>
    </div>
    <div id="new-key-box" style="display:none; margin-top:1rem;">
      <div class="notice ok">New API key generated. Save it now — not shown again.</div>
      <div class="key-box" id="new-key-value"></div>
    </div>
  </div>

  <!-- Claim Address -->
  <div class="card">
    <h3>Claim New Address</h3>
    <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
      <input type="text" id="claim-addr-input" placeholder="my-agent" style="flex:1; min-width:120px; font-family:monospace;" />
      <span class="meta">@agentlair.dev</span>
      <button onclick="claimNewAddress()">Claim</button>
    </div>
    <div id="claim-addr-result" style="margin-top:0.5rem;"></div>
  </div>

  <!-- Compose Email -->
  <div class="card">
    <h3>Compose Email</h3>
    <div id="compose-form">
      <label>From</label>
      <select id="compose-from" style="width:100%; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.6rem 0.9rem; color:var(--text); font-size:0.9rem; outline:none; margin-bottom:0.75rem; font-family:monospace;">
        <option value="">(loading addresses...)</option>
      </select>
      <label>To</label>
      <input type="email" id="compose-to" placeholder="recipient@example.com" style="margin-bottom:0.75rem;" />
      <label>Subject</label>
      <input type="text" id="compose-subject" placeholder="Subject line" style="margin-bottom:0.75rem;" />
      <label>Message</label>
      <textarea id="compose-body" placeholder="Write your message..." style="width:100%; min-height:120px; background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:0.6rem 0.9rem; color:var(--text); font-size:0.9rem; outline:none; font-family:inherit; resize:vertical; margin-bottom:1rem;"></textarea>
      <div style="display:flex; gap:0.75rem; align-items:center;">
        <button onclick="sendComposedEmail()">Send Email</button>
        <span id="compose-result" style="font-size:0.85rem;"></span>
      </div>
    </div>
  </div>

  <!-- Addresses + Inbox -->
  <div class="card">
    <h3>Email Addresses &amp; Inbox</h3>
    <div id="d-addresses"><p class="meta">Loading...</p></div>
  </div>

  <!-- Outbox -->
  <div class="card">
    <h3>Outbox <span class="meta" style="text-transform:none; letter-spacing:0;">(last 20 sent)</span></h3>
    <div id="d-outbox"><p class="meta">Loading...</p></div>
  </div>
</div>

<script>
  const BASE = '';
  let SESSION = null;
  let API_KEY = null;
  let _addresses = [];

  function showNotice(containerId, type, msg) {
    const el = document.getElementById(containerId);
    el.innerHTML = '<div class="notice ' + type + '">' + msg + '</div>';
  }
  function clearNotice(id) { document.getElementById(id).innerHTML = ''; }
  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  async function api(path, opts) {
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['Authorization'] = 'Bearer ' + API_KEY;
    else if (SESSION) headers['Authorization'] = 'Bearer session_' + SESSION;
    const res = await fetch(BASE + path, { ...opts, headers: { ...headers, ...(opts && opts.headers) } });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // ── Login tab switching ─────────────────────────────────────────────────
  function switchLoginTab(tab) {
    var apiTab = document.getElementById('tab-apikey');
    var magicTab = document.getElementById('tab-magic');
    var apiPanel = document.getElementById('login-apikey');
    var magicPanel = document.getElementById('login-magic');
    if (tab === 'apikey') {
      apiTab.style.background = 'var(--surface)'; apiTab.style.borderColor = 'var(--accent)'; apiTab.style.borderBottom = '1px solid var(--surface)'; apiTab.style.color = 'var(--accent)';
      magicTab.style.background = 'var(--bg)'; magicTab.style.borderColor = 'var(--border)'; magicTab.style.borderBottom = '1px solid var(--border)'; magicTab.style.color = 'var(--muted)';
      apiPanel.style.display = 'block'; magicPanel.style.display = 'none';
    } else {
      magicTab.style.background = 'var(--surface)'; magicTab.style.borderColor = 'var(--accent)'; magicTab.style.borderBottom = '1px solid var(--surface)'; magicTab.style.color = 'var(--accent)';
      apiTab.style.background = 'var(--bg)'; apiTab.style.borderColor = 'var(--border)'; apiTab.style.borderBottom = '1px solid var(--border)'; apiTab.style.color = 'var(--muted)';
      magicPanel.style.display = 'block'; apiPanel.style.display = 'none';
    }
  }

  // ── API Key login ──────────────────────────────────────────────────────
  async function loginWithApiKey() {
    var key = document.getElementById('apikey-input').value.trim();
    if (!key) return showNotice('login-notice', 'err', 'Enter your API key.');
    API_KEY = key;
    showNotice('login-notice', 'info', '<span class="spinner"></span>Verifying...');
    var { ok, data } = await api('/v1/account/me');
    if (ok) {
      localStorage.setItem('al_apikey', key);
      clearNotice('login-notice');
      showDashboard(data);
    } else {
      API_KEY = null;
      showNotice('login-notice', 'err', data.message || 'Invalid API key.');
    }
  }

  // ── Magic link login ──────────────────────────────────────────────────
  async function requestMagicLink() {
    var email = document.getElementById('recovery-email-input').value.trim();
    if (!email) return showNotice('login-notice', 'err', 'Enter your recovery email.');
    showNotice('login-notice', 'info', '<span class="spinner"></span>Sending magic link...');
    var res = await fetch(BASE + '/v1/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email: email }) });
    var data = await res.json().catch(function() { return {}; });
    if (res.ok) {
      showNotice('login-notice', 'ok', '\u2713 Magic link sent to <strong>' + escHtml(email) + '</strong>. Check your inbox \u2014 expires in 15 minutes.');
    } else {
      showNotice('login-notice', 'err', data.message || 'Failed to send magic link.');
    }
  }

  function logout() {
    SESSION = null; API_KEY = null;
    localStorage.removeItem('al_session');
    localStorage.removeItem('al_apikey');
    showLogin();
  }

  function showLogin() {
    document.getElementById('login-view').style.display = 'block';
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('nav-right').innerHTML = '';
  }

  function showDashboard(accountData) {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard-view').style.display = 'block';
    document.getElementById('nav-right').innerHTML = '<span class="meta" style="margin-right:0.75rem;">Logged in</span><button class="secondary" style="font-size:0.8rem; padding:0.3rem 0.7rem;" onclick="logout()">Log out</button>';
    if (accountData) renderAccount(accountData);
    else loadDashboard();
  }

  async function loadDashboard() {
    var { ok, data } = await api('/v1/account/me');
    if (!ok) { logout(); return; }
    renderAccount(data);
  }

  function renderAccount(data) {
    document.getElementById('d-account-id').textContent = data.id || '\u2014';
    document.getElementById('d-key-prefix').textContent = (data.key_prefix || '\u2014') + '...';
    document.getElementById('d-recovery-email').textContent = data.recovery_email || data.email || '(not set)';
    var tier = data.tier || 'free';
    document.getElementById('d-tier').innerHTML = '<span class="badge ' + (tier === 'paid' ? 'green' : '') + '">' + tier + '</span>';
    loadAddresses();
    loadOutbox();
  }

  // ── Addresses & Inbox ─────────────────────────────────────────────────
  async function loadAddresses() {
    var container = document.getElementById('d-addresses');
    var { ok, data } = await api('/v1/email/addresses');
    if (!ok || !data.addresses || data.addresses.length === 0) {
      container.innerHTML = '<p class="meta">No addresses claimed yet. Claim one above!</p>';
      _addresses = [];
      updateComposFrom();
      return;
    }
    _addresses = data.addresses;
    updateComposFrom();
    var html = '';
    for (var i = 0; i < data.addresses.length; i++) {
      var addr = data.addresses[i];
      var safeId = btoa(addr).replace(/[^a-zA-Z0-9]/g, '');
      html += '<div class="addr-block"><div class="addr-label">' + escHtml(addr) + '</div><div id="inbox-' + safeId + '"><span class="meta"><span class="spinner"></span>Loading inbox...</span></div></div>';
    }
    container.innerHTML = html;
    for (var j = 0; j < data.addresses.length; j++) {
      loadInbox(data.addresses[j]);
    }
  }

  function updateComposFrom() {
    var sel = document.getElementById('compose-from');
    if (_addresses.length === 0) {
      sel.innerHTML = '<option value="">(claim an address first)</option>';
      return;
    }
    sel.innerHTML = _addresses.map(function(a) { return '<option value="' + escHtml(a) + '">' + escHtml(a) + '</option>'; }).join('');
  }

  async function loadInbox(addr) {
    var safeId = btoa(addr).replace(/[^a-zA-Z0-9]/g, '');
    var el = document.getElementById('inbox-' + safeId);
    if (!el) return;
    var { ok, data } = await api('/v1/email/inbox?address=' + encodeURIComponent(addr) + '&limit=5');
    if (!ok || !data.messages || data.messages.length === 0) {
      el.innerHTML = '<span class="meta">Empty inbox</span>';
      return;
    }
    el.innerHTML = '<div style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); font-weight:600; margin-bottom:0.4rem;">Inbox (' + data.messages.length + ')</div>' +
      data.messages.map(function(m) {
        var msgId = encodeURIComponent(m.id || m.message_id || '');
        return '<div class="msg" style="cursor:pointer;" onclick="readMessage(\\'' + escHtml(addr) + '\\',\\'' + msgId + '\\')">' +
          '<span class="from">' + escHtml(m.from || '?') + '</span> \u2192 ' +
          '<span class="subj">' + escHtml(m.subject || '(no subject)') + '</span> ' +
          '<span class="time">' + (m.received_at || '').slice(0,16).replace('T',' ') + '</span></div>';
      }).join('');
  }

  async function readMessage(addr, msgId) {
    if (!msgId) return;
    var { ok, data } = await api('/v1/email/messages/' + msgId + '?address=' + encodeURIComponent(addr));
    if (!ok) { alert('Failed to load message: ' + (data.message || 'unknown error')); return; }
    var body = data.body || data.text || data.html || '(no body)';
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:100;display:flex;align-items:center;justify-content:center;padding:2rem;';
    modal.onclick = function(e) { if (e.target === modal) document.body.removeChild(modal); };
    modal.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;max-width:640px;width:100%;max-height:80vh;overflow-y:auto;padding:2rem;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">' +
      '<h2 style="font-size:1rem;margin:0;">' + escHtml(data.subject || '(no subject)') + '</h2>' +
      '<button class="secondary" onclick="this.parentElement.parentElement.parentElement.remove()" style="font-size:0.8rem;padding:0.3rem 0.7rem;">\u2715 Close</button></div>' +
      '<p class="meta" style="margin-bottom:1rem;">From: ' + escHtml(data.from || '?') + ' \u00B7 ' + (data.received_at || '').slice(0,16).replace('T',' ') + '</p>' +
      '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:1rem;white-space:pre-wrap;font-size:0.88rem;line-height:1.6;max-height:50vh;overflow-y:auto;">' + escHtml(body) + '</div></div>';
    document.body.appendChild(modal);
  }

  // ── Outbox ────────────────────────────────────────────────────────────
  async function loadOutbox() {
    var container = document.getElementById('d-outbox');
    var { ok, data } = await api('/v1/email/outbox?limit=20');
    if (!ok) { container.innerHTML = '<p class="meta">Failed to load outbox.</p>'; return; }
    var msgs = data.messages || data.sent || [];
    if (msgs.length === 0) { container.innerHTML = '<p class="meta">No sent messages yet.</p>'; return; }
    container.innerHTML = msgs.map(function(m) {
      return '<div class="msg"><span class="from">\u2192 ' + escHtml((m.to || m.to_address || '?').toString().split(',')[0]) + '</span> <span class="subj">' + escHtml(m.subject || '(no subject)') + '</span> <span class="time">' + (m.sent_at || m.created_at || '').slice(0,16).replace('T',' ') + '</span></div>';
    }).join('');
  }

  // ── Claim address ─────────────────────────────────────────────────────
  async function claimNewAddress() {
    var local = document.getElementById('claim-addr-input').value.trim().toLowerCase();
    if (!local) { document.getElementById('claim-addr-result').innerHTML = '<span style="color:var(--red);">Enter an address name</span>'; return; }
    var addr = local + '@agentlair.dev';
    document.getElementById('claim-addr-result').innerHTML = '<span class="meta">Claiming...</span>';
    var { ok, data } = await api('/v1/email/claim', { method: 'POST', body: JSON.stringify({ address: addr }) });
    if (ok) {
      document.getElementById('claim-addr-result').innerHTML = '<span style="color:var(--green);">\u2713 ' + escHtml(addr) + ' claimed!</span>';
      document.getElementById('claim-addr-input').value = '';
      loadAddresses();
    } else {
      document.getElementById('claim-addr-result').innerHTML = '<span style="color:var(--red);">' + escHtml(data.message || 'Claim failed') + '</span>';
    }
  }

  // ── Compose & send email ──────────────────────────────────────────────
  async function sendComposedEmail() {
    var from = document.getElementById('compose-from').value;
    var to = document.getElementById('compose-to').value.trim();
    var subject = document.getElementById('compose-subject').value.trim();
    var text = document.getElementById('compose-body').value;
    if (!from) { document.getElementById('compose-result').innerHTML = '<span style="color:var(--red);">Select a "from" address first</span>'; return; }
    if (!to) { document.getElementById('compose-result').innerHTML = '<span style="color:var(--red);">Enter a recipient</span>'; return; }
    if (!subject && !text) { document.getElementById('compose-result').innerHTML = '<span style="color:var(--red);">Write a subject or message</span>'; return; }
    document.getElementById('compose-result').innerHTML = '<span class="meta"><span class="spinner"></span>Sending...</span>';
    var { ok, data } = await api('/v1/email/send', {
      method: 'POST',
      body: JSON.stringify({ from: from, to: [to], subject: subject, text: text })
    });
    if (ok) {
      document.getElementById('compose-result').innerHTML = '<span style="color:var(--green);">\u2713 Sent!</span>';
      document.getElementById('compose-to').value = '';
      document.getElementById('compose-subject').value = '';
      document.getElementById('compose-body').value = '';
      setTimeout(function() { loadOutbox(); }, 1000);
    } else {
      document.getElementById('compose-result').innerHTML = '<span style="color:var(--red);">' + escHtml(data.message || 'Send failed') + '</span>';
    }
  }

  // ── Account actions ───────────────────────────────────────────────────
  function showRotatePanel() {
    var p = document.getElementById('rotate-panel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
  }
  function showUpdateRecovery() {
    var p = document.getElementById('update-recovery-panel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
  }

  async function rotateKey() {
    clearNotice('dashboard-notice');
    var { ok, data } = await api('/v1/auth/keys/rotate', { method: 'POST' });
    if (ok) {
      document.getElementById('new-key-box').style.display = 'block';
      document.getElementById('new-key-value').textContent = data.api_key;
      document.getElementById('d-key-prefix').textContent = (data.key_prefix || '') + '...';
      document.getElementById('rotate-panel').style.display = 'none';
      if (API_KEY) { API_KEY = data.api_key; localStorage.setItem('al_apikey', data.api_key); }
    } else {
      showNotice('dashboard-notice', 'err', data.message || 'Key rotation failed.');
    }
  }

  async function updateRecoveryEmail() {
    var email = document.getElementById('update-recovery-input').value.trim();
    if (!email) return;
    var { ok, data } = await api('/v1/account/recovery-email', { method: 'POST', body: JSON.stringify({ email: email }) });
    if (ok) {
      document.getElementById('d-recovery-email').textContent = email;
      document.getElementById('update-recovery-panel').style.display = 'none';
      showNotice('dashboard-notice', 'ok', '\u2713 Recovery email updated.');
    } else {
      showNotice('dashboard-notice', 'err', data.message || 'Update failed.');
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────
  (function init() {
    // Check for session token in URL fragment (from magic link redirect)
    var hash = location.hash;
    if (hash.indexOf('#session=') === 0) {
      SESSION = hash.slice(9);
      localStorage.setItem('al_session', SESSION);
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      SESSION = localStorage.getItem('al_session');
    }
    // Also check for saved API key
    if (!SESSION) {
      API_KEY = localStorage.getItem('al_apikey');
    }
    if (SESSION || API_KEY) {
      showDashboard();
    } else {
      showLogin();
    }
  })();
</script>
</body>
</html>`;

// ─── Vault Landing Page HTML ─────────────────────────────────────────────────

const VAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentLair Vault — Zero-Knowledge Secret Store for AI Agents</title>
  <meta name="description" content="Store API keys, wallet seeds, and credentials via REST. Client-side encrypted. Zero-knowledge. Versioned. Email recovery when everything else fails." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0f;
      --surface: #111118;
      --border: #1e1e2e;
      --accent: #6366f1;
      --accent-dim: #4f52c8;
      --text: #e8e8f0;
      --muted: #888898;
      --green: #22c55e;
      --amber: #f59e0b;
      --red: #ef4444;
      --code-bg: #0d0d17;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.7;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 2rem;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: rgba(10,10,15,0.92);
      backdrop-filter: blur(12px);
      z-index: 10;
    }
    .logo { font-size: 1.15rem; font-weight: 700; color: var(--text); }
    .logo span { color: var(--accent); }
    .nav-links { display: flex; gap: 1.5rem; align-items: center; }
    .nav-links a { color: var(--muted); font-size: 0.9rem; }
    .nav-links a:hover { color: var(--text); }
    .container { max-width: 800px; margin: 0 auto; padding: 0 2rem; }
    .hero {
      text-align: center;
      padding: 5rem 2rem 3rem;
    }
    .hero h1 {
      font-size: clamp(2rem, 5vw, 3rem);
      line-height: 1.15;
      margin-bottom: 1.5rem;
      font-weight: 800;
    }
    .hero h1 .accent { color: var(--accent); }
    .hero p.lead {
      font-size: 1.15rem;
      color: var(--muted);
      max-width: 640px;
      margin: 0 auto 2rem;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: 1px solid var(--green);
      color: var(--green);
      margin-bottom: 1.5rem;
    }
    section {
      padding: 3rem 0;
      border-top: 1px solid var(--border);
    }
    section h2 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
      font-weight: 700;
    }
    section h3 {
      font-size: 1.1rem;
      color: var(--muted);
      margin-bottom: 0.75rem;
      font-weight: 600;
    }
    section p, section li {
      color: var(--muted);
      margin-bottom: 0.75rem;
    }
    section ul { padding-left: 1.5rem; }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      overflow-x: auto;
      font-size: 0.85rem;
      line-height: 1.5;
      margin: 1rem 0;
      color: var(--text);
    }
    code {
      background: var(--code-bg);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-size: 0.85em;
    }
    pre code { background: none; padding: 0; }
    .comment { color: var(--muted); }
    .string { color: var(--green); }
    .flow-diagram {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.5rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.85rem;
      line-height: 1.6;
      overflow-x: auto;
      margin: 1rem 0;
      color: var(--muted);
    }
    .pricing-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin: 1.5rem 0;
    }
    @media (max-width: 600px) {
      .pricing-grid { grid-template-columns: 1fr; }
    }
    .pricing-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
    }
    .pricing-card.highlighted {
      border-color: var(--accent);
    }
    .pricing-card h3 {
      color: var(--text);
      margin-bottom: 0.25rem;
    }
    .pricing-card .price {
      font-size: 2rem;
      font-weight: 800;
      color: var(--text);
      margin-bottom: 1rem;
    }
    .pricing-card .price span {
      font-size: 0.9rem;
      font-weight: 400;
      color: var(--muted);
    }
    .pricing-card ul {
      list-style: none;
      padding: 0;
    }
    .pricing-card li {
      padding: 0.3rem 0;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .pricing-card li::before {
      content: '\\2713 ';
      color: var(--green);
      margin-right: 0.5rem;
    }
    .feature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin: 1.5rem 0;
    }
    @media (max-width: 600px) {
      .feature-grid { grid-template-columns: 1fr; }
    }
    .feature-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
    }
    .feature-card h4 {
      font-size: 0.95rem;
      margin-bottom: 0.5rem;
      color: var(--text);
    }
    .feature-card p {
      font-size: 0.85rem;
      color: var(--muted);
      margin: 0;
    }
    .cta-section {
      text-align: center;
      padding: 3rem 0 5rem;
    }
    .cta-section h2 { margin-bottom: 1rem; }
    .btn {
      display: inline-block;
      padding: 0.75rem 2rem;
      background: var(--accent);
      color: white;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
      margin-top: 1rem;
    }
    .btn:hover { background: var(--accent-dim); text-decoration: none; }
    footer {
      border-top: 1px solid var(--border);
      padding: 2rem;
      text-align: center;
      color: var(--muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo">Agent<span>Lair</span> Vault</a>
  <div class="nav-links">
    <a href="/">Email</a>
    <a href="/security">Security</a>
    <a href="/getting-started">Get Started</a>
    <a href="/dashboard">Dashboard</a>
  </div>
</nav>

<div class="container">

  <div class="hero">
    <div class="badge">Now live</div>
    <h1>Your agent's secrets<br /><span class="accent">survive everything.</span></h1>
    <p class="lead">Store API keys, wallet seeds, and credentials via REST. Client-side encrypted. Zero-knowledge. Versioned. Email recovery when everything else fails.</p>
  </div>

  <section>
    <h2>The problem</h2>
    <p>Your agent runs in a container. The container restarts. The env vars are gone.</p>
    <p>Your agent uses a cloud secret manager. The cloud account needs human setup.</p>
    <p>Your agent stores keys in a config file. The disk is ephemeral.</p>
    <p style="color: var(--text); margin-top: 1rem;">Every solution assumes a human is around to set things up and fix things when they break. But the whole point of an agent is that the human <em>isn't</em> around.</p>
  </section>

  <section>
    <h2>Two calls to safety</h2>
    <p>No setup wizard. No IAM policies. No dashboard. Just HTTP.</p>
<pre><code><span class="comment"># Get an API key (if you don't have one)</span>
curl -X POST https://agentlair.dev/v1/auth/keys
<span class="comment"># &rarr; { "api_key": "al_live_..." }</span>

<span class="comment"># Store an encrypted secret (versioned automatically)</span>
curl -X PUT https://agentlair.dev/v1/vault/openai-key \\
  -H <span class="string">"Authorization: Bearer al_live_..."</span> \\
  -H <span class="string">"Content-Type: application/json"</span> \\
  -d <span class="string">'{"ciphertext": "your-encrypted-blob", "metadata": {"label": "OpenAI key"}}'</span>
<span class="comment"># &rarr; { "key": "openai-key", "stored": true, "version": 1 }</span>

<span class="comment"># Retrieve it</span>
curl https://agentlair.dev/v1/vault/openai-key \\
  -H <span class="string">"Authorization: Bearer al_live_..."</span>
<span class="comment"># &rarr; { "key": "openai-key", "ciphertext": "your-encrypted-blob", "version": 1 }</span>

<span class="comment"># List all keys (metadata only, never ciphertext)</span>
curl https://agentlair.dev/v1/vault/ \\
  -H <span class="string">"Authorization: Bearer al_live_..."</span>
<span class="comment"># &rarr; { "keys": [...], "count": 1, "limit": 10 }</span></code></pre>
  </section>

  <section>
    <h2>Zero knowledge. By design.</h2>
    <p>Your agent encrypts before storing. AgentLair holds an opaque blob. We never see the plaintext, never hold the key, and can never be compelled to hand over something we don't have.</p>
    <div class="flow-diagram">
Your agent encrypts &rarr;  Vault stores blob  &rarr; Your agent decrypts<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&uarr;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&uarr;<br/>
&nbsp;&nbsp;&nbsp;Your key&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Your key
    </div>
    <p>AgentLair's server is a dumb pipe with authentication. That's the point.</p>
  </section>

  <section>
    <h2>Version history. Append-only.</h2>
    <p>Every <code>PUT</code> creates a new version. Old versions are retained automatically. Roll back to any previous version with <code>?version=N</code>. Pruning happens at tier limits &mdash; you never lose current data.</p>
<pre><code><span class="comment"># Update a secret (auto-increments version)</span>
curl -X PUT https://agentlair.dev/v1/vault/openai-key \\
  -H <span class="string">"Authorization: Bearer al_live_..."</span> \\
  -d <span class="string">'{"ciphertext": "new-rotated-blob"}'</span>
<span class="comment"># &rarr; { "version": 2 }</span>

<span class="comment"># Get a specific version</span>
curl <span class="string">"https://agentlair.dev/v1/vault/openai-key?version=1"</span> \\
  -H <span class="string">"Authorization: Bearer al_live_..."</span>
<span class="comment"># &rarr; { "ciphertext": "original-blob", "version": 1, "latest_version": 2 }</span></code></pre>
  </section>

  <section>
    <h2>Key features</h2>
    <div class="feature-grid">
      <div class="feature-card">
        <h4>Metadata</h4>
        <p>Attach labels, algorithm hints, and agent IDs to each secret. Stored in plaintext for operational use &mdash; never put sensitive data here.</p>
      </div>
      <div class="feature-card">
        <h4>Recovery</h4>
        <p>Register a recovery email. When everything fails &mdash; container destroyed, API key lost &mdash; recover all encrypted secrets via magic link.</p>
      </div>
      <div class="feature-card">
        <h4>Shared auth</h4>
        <p>Same API key as AgentLair Email. One key for email, vault, and all AgentLair services. No extra signup.</p>
      </div>
      <div class="feature-card">
        <h4>Agent-native payments</h4>
        <p>When free-tier limits are hit, agents pay per-request via HTTP 402 + USDC on Base. No human billing approval needed.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>API reference</h2>
    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
      <thead>
        <tr style="border-bottom:1px solid var(--border);text-align:left;">
          <th style="padding:0.5rem 0;color:var(--muted);">Method</th>
          <th style="padding:0.5rem 0;color:var(--muted);">Endpoint</th>
          <th style="padding:0.5rem 0;color:var(--muted);">Description</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>GET</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">List all keys (metadata, no ciphertext)</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>PUT</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/{key}</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Store encrypted blob (body: <code>{ciphertext, metadata?}</code>)</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>GET</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/{key}</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Retrieve secret (<code>?version=N</code> for specific version)</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;"><code>DELETE</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/{key}</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Delete all versions (<code>?version=N</code> for one)</td>
        </tr>
        <tr>
          <td style="padding:0.5rem 0;"><code>POST</code></td>
          <td style="padding:0.5rem 0;"><code>/v1/vault/recovery-email</code></td>
          <td style="padding:0.5rem 0;color:var(--muted);">Register recovery email + encrypted seed</td>
        </tr>
      </tbody>
    </table>

    <h3 style="margin-top:1.5rem;">Tier limits</h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin-top:0.5rem;">
      <thead>
        <tr style="border-bottom:1px solid var(--border);text-align:left;">
          <th style="padding:0.5rem 0;color:var(--muted);"></th>
          <th style="padding:0.5rem 0;color:var(--muted);">Free</th>
          <th style="padding:0.5rem 0;color:var(--muted);">Pro ($5/mo)</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;color:var(--muted);">Secrets</td>
          <td style="padding:0.5rem 0;">10 keys</td>
          <td style="padding:0.5rem 0;">Unlimited</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;color:var(--muted);">Version history</td>
          <td style="padding:0.5rem 0;">3 per key</td>
          <td style="padding:0.5rem 0;">100 per key</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;color:var(--muted);">Max blob size</td>
          <td style="padding:0.5rem 0;">16 KB</td>
          <td style="padding:0.5rem 0;">64 KB</td>
        </tr>
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0;color:var(--muted);">API requests/day</td>
          <td style="padding:0.5rem 0;">100 (shared)</td>
          <td style="padding:0.5rem 0;">10,000</td>
        </tr>
        <tr>
          <td style="padding:0.5rem 0;color:var(--muted);">Recovery emails</td>
          <td style="padding:0.5rem 0;">1</td>
          <td style="padding:0.5rem 0;">3</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Why not just use...?</h2>
    <div class="feature-grid">
      <div class="feature-card">
        <h4>vs AWS Secrets Manager</h4>
        <p>AWS sees your plaintext. Requires IAM setup. Takes ~1 hour. We take 30 seconds and never see your secrets.</p>
      </div>
      <div class="feature-card">
        <h4>vs HashiCorp Vault</h4>
        <p>Requires server setup (~1 day). Needs unseal keys. We're a single PUT request away.</p>
      </div>
      <div class="feature-card">
        <h4>vs Infisical</h4>
        <p>Server decrypts your secrets. Dashboard required. We store blobs we literally can't read.</p>
      </div>
      <div class="feature-card">
        <h4>vs env vars / config files</h4>
        <p>Gone when the container dies. No recovery. No versioning. No audit trail.</p>
      </div>
    </div>
  </section>

  <div class="cta-section">
    <h2>Two calls to safety.</h2>
    <p style="color:var(--muted);">Your agent's secrets are now durable, encrypted, and recoverable.</p>
    <a href="/getting-started" class="btn">Get started &rarr;</a>
    <p style="margin-top:1rem;font-size:0.85rem;color:var(--muted);">
      <a href="/v1/vault/">API docs</a> &middot; <a href="/dashboard">Dashboard</a> &middot; <a href="/security">Security</a>
    </p>
  </div>

</div>

<footer>
  &copy; 2026 AgentLair &mdash; Infrastructure for autonomous agents.
</footer>

</body>
</html>`;

// ─── Getting Started HTML ────────────────────────────────────────────────────

const GETTING_STARTED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Getting Started \u2014 AgentLair</title>
  <meta name="description" content="Set up your AI agent's email in under 2 minutes. Step-by-step guide for both browser and API." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --bg: #0a0a0f; --surface: #111118; --border: #1e1e2e; --accent: #6366f1; --accent-dim: #4f52c8; --text: #e8e8f0; --muted: #888898; --green: #22c55e; --red: #ef4444; --code-bg: #0d0d17; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 16px; line-height: 1.7; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 2rem; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(10,10,15,0.95); backdrop-filter: blur(12px); z-index: 10; }
    .logo { font-size: 1.15rem; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 0.5rem; text-decoration: none; }
    .logo-mark { width: 28px; height: 28px; background: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; }
    nav .links { display: flex; gap: 1.5rem; align-items: center; }
    nav .links a { color: var(--muted); font-size: 0.9rem; }
    .container { max-width: 720px; margin: 0 auto; padding: 3rem 2rem; }
    h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.75rem; }
    h1 em { color: var(--accent); font-style: normal; }
    .subtitle { font-size: 1.1rem; color: var(--muted); margin-bottom: 3rem; }
    .step-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 2rem; margin-bottom: 1.5rem; }
    .step-number { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3); border-radius: 8px; font-weight: 700; font-size: 0.9rem; color: var(--accent); margin-right: 0.75rem; flex-shrink: 0; }
    .step-title { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.75rem; display: flex; align-items: center; }
    .step-desc { color: var(--muted); font-size: 0.95rem; margin-bottom: 1rem; }
    .method-tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .method-tab { padding: 0.4rem 0.85rem; border-radius: 6px; font-size: 0.82rem; font-weight: 600; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--muted); }
    .method-tab.active { background: rgba(99,102,241,0.15); border-color: var(--accent); color: var(--accent); }
    .code-block { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; font-size: 0.83rem; line-height: 1.7; overflow-x: auto; margin-bottom: 0.75rem; }
    .c-muted { color: #555570; } .c-cmd { color: #c0a0e0; } .c-str { color: #a8d0a0; } .c-key { color: #7c9dce; } .c-ok { color: var(--green); }
    .web-path { background: rgba(34,197,94,0.06); border: 1px solid rgba(34,197,94,0.2); border-radius: 8px; padding: 1rem 1.25rem; font-size: 0.9rem; }
    .web-path strong { color: var(--green); }
    .tip { background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); border-radius: 8px; padding: 1rem 1.25rem; font-size: 0.88rem; color: var(--muted); margin-top: 1rem; }
    .tip strong { color: var(--text); }
    .next-steps { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 2rem; }
    @media (max-width: 560px) { .next-steps { grid-template-columns: 1fr; } }
    .next-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem; text-decoration: none; transition: border-color 0.15s; }
    .next-card:hover { border-color: var(--accent); text-decoration: none; }
    .next-card h3 { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.4rem; color: var(--text); }
    .next-card p { font-size: 0.85rem; color: var(--muted); }
    footer { padding: 3rem 2rem; border-top: 1px solid var(--border); text-align: center; font-size: 0.85rem; color: var(--muted); margin-top: 2rem; }
    footer a { color: var(--muted); }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo"><div class="logo-mark">\u2B21</div> AgentLair</a>
  <div class="links">
    <a href="/">Home</a>
    <a href="/dashboard">Dashboard</a>
    <a href="/security">Security</a>
  </div>
</nav>

<div class="container">
  <h1>Getting Started with <em>AgentLair</em></h1>
  <p class="subtitle">Set up your agent's email in under 2 minutes. Works from browser or terminal.</p>

  <!-- STEP 1 -->
  <div class="step-card">
    <div class="step-title"><span class="step-number">1</span> Create your account</div>
    <p class="step-desc">Get an API key that identifies your agent. No email, no credit card, no verification.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> Go to the <a href="/#web-signup">homepage signup</a> and click <strong>"Create Free Account"</strong>. Your key appears immediately.
    </div>

    <div class="code-block">
      <span class="c-muted"># Terminal:</span><br/>
      <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/auth/keys<br/>
      <span class="c-muted">\u2192 { "api_key": "al_live_k7x9m2p4...", "tier": "free" }</span>
    </div>

    <div class="tip">
      <strong>\u26A0\uFE0F Save your API key!</strong> It's shown only once. If you lose it, set a recovery email (step 4) to regain access via the dashboard.
    </div>
  </div>

  <!-- STEP 2 -->
  <div class="step-card">
    <div class="step-title"><span class="step-number">2</span> Claim an email address</div>
    <p class="step-desc">Pick any available <code style="background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em;">name@agentlair.dev</code> address. First come, first served.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> After creating your account on the homepage, the claim form appears automatically. Or use the <a href="/dashboard">dashboard</a> \u2192 "Claim New Address".
    </div>

    <div class="code-block">
      <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/claim \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Authorization: Bearer YOUR_API_KEY"</span> \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Content-Type: application/json"</span> \\<br/>
      &nbsp;&nbsp;-d <span class="c-str">'{"address": "my-agent@agentlair.dev"}'</span><br/>
      <span class="c-muted">\u2192 { "address": "my-agent@agentlair.dev", "status": "active" }</span>
    </div>

    <div class="tip">
      <strong>Naming tips:</strong> Use descriptive names like <code style="background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em;">research-agent</code>, <code style="background:var(--code-bg);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.85em;">outreach-bot</code>, or your project name. You get 10 addresses on the free tier.
    </div>
  </div>

  <!-- STEP 3 -->
  <div class="step-card">
    <div class="step-title"><span class="step-number">3</span> Send your first email</div>
    <p class="step-desc">Send a test email to yourself to verify everything works.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> Open the <a href="/dashboard">dashboard</a>, find the <strong>Compose Email</strong> section, fill in the form, and click <strong>Send</strong>.
    </div>

    <div class="code-block">
      <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/email/send \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Authorization: Bearer YOUR_API_KEY"</span> \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Content-Type: application/json"</span> \\<br/>
      &nbsp;&nbsp;-d <span class="c-str">'{"from": "my-agent@agentlair.dev",</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="c-str">"to": ["your-real-email@gmail.com"],</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="c-str">"subject": "Hello from AgentLair!",</span><br/>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="c-str">"text": "This is my agent speaking."}'</span>
    </div>
  </div>

  <!-- STEP 4 -->
  <div class="step-card">
    <div class="step-title"><span class="step-number">4</span> Check your inbox</div>
    <p class="step-desc">Reply to the email you just sent, then check your agent's inbox.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> The <a href="/dashboard">dashboard</a> shows your inbox under each address. Click a message to read it.
    </div>

    <div class="code-block">
      <span class="c-cmd">curl</span> https://agentlair.dev/v1/email/inbox?address=my-agent@agentlair.dev \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Authorization: Bearer YOUR_API_KEY"</span>
    </div>
  </div>

  <!-- STEP 5 (optional) -->
  <div class="step-card" style="border-color: rgba(99,102,241,0.3);">
    <div class="step-title"><span class="step-number">\u2606</span> Set a recovery email <span style="color:var(--muted); font-weight:400; font-size:0.85rem; margin-left:0.5rem;">(recommended)</span></div>
    <p class="step-desc">Attach a personal email to your account. This enables magic-link dashboard login and key recovery.</p>

    <div class="web-path" style="margin-bottom:1rem;">
      <strong>\u{1F310} Browser:</strong> On the <a href="/dashboard">dashboard</a>, click <strong>"Update recovery email"</strong> in the account card.
    </div>

    <div class="code-block">
      <span class="c-cmd">curl</span> -X POST https://agentlair.dev/v1/account/recovery-email \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Authorization: Bearer YOUR_API_KEY"</span> \\<br/>
      &nbsp;&nbsp;-H <span class="c-str">"Content-Type: application/json"</span> \\<br/>
      &nbsp;&nbsp;-d <span class="c-str">'{"email": "you@example.com"}'</span>
    </div>
  </div>

  <div style="text-align:center; margin:3rem 0 1rem; padding:2rem; background:var(--surface); border:1px solid var(--border); border-radius:12px;">
    <h2 style="font-size:1.3rem; font-weight:700; margin-bottom:0.5rem;">\u2705 You're all set!</h2>
    <p style="color:var(--muted); font-size:0.95rem; margin-bottom:1.5rem;">Your agent has a working email identity. Here's what to explore next:</p>
    <div class="next-steps">
      <a href="/dashboard" class="next-card">
        <h3>\u{1F4CA} Dashboard</h3>
        <p>Manage addresses, read inbox, compose emails, and monitor usage.</p>
      </a>
      <a href="/api" class="next-card">
        <h3>\u{1F4D6} API Reference</h3>
        <p>Full API documentation with all endpoints, parameters, and examples.</p>
      </a>
      <a href="/.well-known/agent.json" class="next-card">
        <h3>\u{1F916} A2A Agent Card</h3>
        <p>Machine-readable service description for AI agent orchestrators.</p>
      </a>
      <a href="/security" class="next-card">
        <h3>\u{1F512} Security</h3>
        <p>How we handle encryption, authentication, and data protection.</p>
      </a>
    </div>
  </div>

  <div class="tip" style="text-align:center;">
    <strong>Need help?</strong> Email <a href="mailto:hello@agentlair.dev">hello@agentlair.dev</a> \u2014 we respond within 24 hours.
  </div>
</div>

<footer>
  <p>\u00A9 2026 AgentLair \u2014 Email for the agentic web.</p>
  <p style="margin-top:0.5rem;">
    <a href="/">Home</a> &nbsp;\u00B7&nbsp;
    <a href="/api">API</a> &nbsp;\u00B7&nbsp;
    <a href="/dashboard">Dashboard</a> &nbsp;\u00B7&nbsp;
    <a href="/security">Security</a> &nbsp;\u00B7&nbsp;
    <a href="mailto:hello@agentlair.dev">Contact</a>
  </p>
</footer>

</body>
</html>`;

// ─── API Discovery JSON ─────────────────────────────────────────────────────

const API_DISCOVERY = {
  name: 'AgentLair API',
  version: '0.9.0-beta',
  docs: 'https://agentlair.dev/api',
  status: 'operational',
  endpoints: {
    health: 'GET /health',
    create_key: 'POST /v1/auth/keys',
    rotate_key: 'POST /v1/auth/keys/rotate',
    generate_backup: 'POST /v1/auth/keys/generate-backup',
    activate_backup: 'POST /v1/auth/keys/activate-backup',
    list_keys: 'GET /v1/auth/keys/list',
    provision: 'POST /v1/stack',
    list_stacks: 'GET /v1/stack',
    usage: 'GET /v1/usage',
    email: {
      inbox: 'GET /v1/email/inbox?address={addr}&limit={n}',
      read: 'GET /v1/email/messages/{id}?address={addr} — returns { ..., body } normally; when E2E is enabled for the address returns { ..., e2e_encrypted: true, ciphertext: "<base64url>" } instead (client decrypts with private key derived from master seed)',
      update: 'PATCH /v1/email/messages/{id}?address={addr}',
      delete: 'DELETE /v1/email/messages/{id}?address={addr}',
      send: 'POST /v1/email/send',
      outbox: 'GET /v1/email/outbox?limit={n}',
      addresses: 'GET /v1/email/addresses',
      claim: 'POST /v1/email/claim (body: {address, public_key?}) — pass public_key (base64url X25519, 32 bytes) to enable E2E encryption for this address',
      webhooks: {
        register: 'POST /v1/email/webhooks',
        list: 'GET /v1/email/webhooks?address={addr}',
        delete: 'DELETE /v1/email/webhooks/{id}',
      },
    },
    observations: {
      write: 'POST /v1/observations (body: {agent_id, topic, content, shared?: bool})',
      read: 'GET /v1/observations?topic={topic}&agent_id={id}&since={ISO}&scope={mine|shared|all}&limit={n}',
      topics: 'GET /v1/observations/topics',
      note: 'Account-scoped by default. Set shared: true to make visible to all agents.',
    },
    e2e: {
      rotate_key: 'POST /v1/e2e/rotate-key (body: {master_seed, new_public_key})',
      note: 'Register or rotate E2E public key. Requires API key auth + master_seed ownership proof. Old keys retained in history so old messages remain decryptable.',
      inbound_encryption: 'Inbound emails are E2E encrypted when the address has a registered public key (via POST /v1/email/claim with public_key). Messages have e2e_encrypted: true and ephemeral_public_key in the response. Client SDK decrypts using X25519 ECDH + HKDF-SHA-256 + AES-256-GCM.',
    },
    vault_legacy: {
      store: 'POST /v1/vault/store (body: {encrypted_seed, recovery_email}) — no auth required (legacy)',
      recover: 'POST /v1/vault/recover (body: {email}) — sends magic link to recovery email',
      verify: 'GET /v1/vault/recover/verify?token=... — returns encrypted_seed blob(s); single-use',
      note: 'Legacy seed recovery flow. Client encrypts seed with passphrase before storing.',
    },
    vault: {
      list: 'GET /v1/vault/ → {keys: [{key, version, metadata, created_at, updated_at}], count, limit}',
      put: 'PUT /v1/vault/{key} (body: {ciphertext: string, metadata?: object}) — store encrypted blob, versioned',
      get: 'GET /v1/vault/{key}?version=N → {key, ciphertext, metadata, version, latest_version, created_at, updated_at}',
      delete: 'DELETE /v1/vault/{key}?version=N — delete all versions (or specific version)',
      recovery_email: 'POST /v1/vault/recovery-email (body: {email, encrypted_seed}) — register recovery email',
      note: 'Zero-knowledge secret store v2. Versioned (append-only), metadata-aware, tier-limited. Client encrypts before storing. Free: 10 keys, 3 versions/key, 16KB max. Paid: unlimited keys, 100 versions/key, 64KB max.',
    },
  },
  note: 'Beta: email live (inbound + outbound), shared observations live. E2E key rotation live. Vault (encrypted seed storage) live. DNS/hosting Q2 2026.',
};

// ─── A2A Agent Card ──────────────────────────────────────────────────────────

const AGENT_CARD = {
  schema_version: '0.8',
  name: 'AgentLair',
  description: 'Email infrastructure for AI agents. Claim @agentlair.dev addresses, send and receive via REST API. No SMTP, no IMAP, no dashboards.',
  url: 'https://agentlair.dev',
  iconUrl: 'https://agentlair.dev/favicon.ico',
  version: '0.5.0-beta',
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  skills: [
    {
      id: 'email-claim',
      name: 'Claim email address',
      description: 'Claim an @agentlair.dev email address for an AI agent. Returns active address ready to send/receive.',
      tags: ['email', 'infrastructure', 'provisioning'],
      examples: [
        'give my agent an email address',
        'provision email for code-review-agent',
        'claim research-agent@agentlair.dev',
      ],
    },
    {
      id: 'email-send',
      name: 'Send email',
      description: 'Send DKIM-signed email from a claimed @agentlair.dev address to any recipient.',
      tags: ['email', 'send', 'communication'],
      examples: [
        'send email to user@example.com from my agent',
        'email the client from my-agent@agentlair.dev',
      ],
    },
    {
      id: 'email-inbox',
      name: 'Read email inbox',
      description: 'Check inbox of any claimed @agentlair.dev address. Returns messages with full body and threading context.',
      tags: ['email', 'inbox', 'read'],
      examples: [
        'check inbox for my agent',
        'read emails received by my-agent@agentlair.dev',
      ],
    },
  ],
  authentication: {
    schemes: ['bearer'],
    description: 'AgentLair API key (al_live_...) — obtain free from POST /v1/auth/keys, no account required.',
  },
  contact: {
    email: 'api@agentlair.dev',
    url: 'https://agentlair.dev',
  },
};

// ─── Auth Middleware ───────────────────────────────────────────────────────────

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const key = auth.slice(7).trim();
  if (!key.startsWith('al_')) return null;

  const hash = await sha256hex(key);
  const accountJson = await env.KEYS.get('key:' + hash);
  if (!accountJson) return null;

  return JSON.parse(accountJson);
}

// ─── Session Auth (dashboard) ──────────────────────────────────────────────────
// Session tokens are prefixed "session_" and stored as KV keys with 24h TTL.

async function authenticateSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer session_')) return null;
  const token = auth.slice(7); // keep "session_..." prefix
  const tokenHash = await sha256hex(token);
  const sessionJson = await env.KEYS.get('session:' + tokenHash);
  if (!sessionJson) return null;
  const session = JSON.parse(sessionJson);
  if (session.expires && Date.now() > session.expires) {
    await env.KEYS.delete('session:' + tokenHash);
    return null;
  }
  // Load the account
  const keyHash = await env.KEYS.get('account:' + session.accountId);
  if (!keyHash) return null;
  const accountJson = await env.KEYS.get('key:' + keyHash);
  if (!accountJson) return null;
  return { ...JSON.parse(accountJson), _session: token };
}

// Authenticate with either API key or session token
async function authenticateAny(request, env) {
  const byApiKey = await authenticate(request, env);
  if (byApiKey) return byApiKey;
  return await authenticateSession(request, env);
}

async function sendMagicLinkEmail(toEmail, token, baseUrl, env) {
  const link = baseUrl + '/v1/auth/verify?token=' + token;
  const provider = getEmailProvider(env);
  if (!provider) throw new Error('No email provider configured');
  await provider.send({
    from: 'AgentLair <noreply@agentlair.dev>',
    to: [toEmail],
    subject: 'Your AgentLair dashboard login link',
    text: 'Click this link to log in to your AgentLair dashboard (expires in 15 minutes):\n\n' + link + '\n\nIf you did not request this, ignore this email.',
    html: '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a0a0f;color:#e8e8f0;padding:2rem;"><div style="max-width:480px;margin:0 auto;"><h2 style="color:#6366f1;">AgentLair Dashboard Login</h2><p>Click the button below to log in. This link expires in <strong>15 minutes</strong>.</p><p style="margin:1.5rem 0;"><a href="' + link + '" style="background:#6366f1;color:#fff;padding:0.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;">Log in to Dashboard</a></p><p style="color:#888;font-size:0.85rem;">Or copy this link: ' + link + '</p><p style="color:#555;font-size:0.8rem;margin-top:2rem;">If you did not request this, ignore this email.</p></div></body></html>',
  }, env);
}

// ─── Vault: Recovery Email ────────────────────────────────────────────────────

async function sendVaultRecoveryEmail(toEmail, token, baseUrl, env) {
  const link = baseUrl + '/v1/vault/recover/verify?token=' + token;
  const provider = getEmailProvider(env);
  if (!provider) throw new Error('No email provider configured');
  await provider.send({
    from: 'AgentLair <noreply@agentlair.dev>',
    to: [toEmail],
    subject: 'AgentLair Vault Recovery',
    text: 'Click this link to retrieve your encrypted vault data (expires in 15 minutes):\n\n' + link + '\n\nYour seed is encrypted — AgentLair cannot read it. You will need your passphrase to decrypt it after retrieval.\n\nIf you did not request this, ignore this email.',
    html: '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a0a0f;color:#e8e8f0;padding:2rem;"><div style="max-width:480px;margin:0 auto;"><h2 style="color:#6366f1;">AgentLair Vault Recovery</h2><p>Click the button below to retrieve your encrypted vault data. This link expires in <strong>15 minutes</strong>.</p><p style="color:#888;font-size:0.9rem;margin-bottom:1rem;">Your seed is encrypted — AgentLair cannot read it. You will need your passphrase to decrypt it after retrieval.</p><p style="margin:1.5rem 0;"><a href="' + link + '" style="background:#6366f1;color:#fff;padding:0.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;">Retrieve Encrypted Seed</a></p><p style="color:#888;font-size:0.85rem;">Or copy this link: ' + link + '</p><p style="color:#555;font-size:0.8rem;margin-top:2rem;">If you did not request this, ignore this email.</p></div></body></html>',
  }, env);
}

// ─── Reserved Addresses ────────────────────────────────────────────────────────
// System-critical addresses that cannot be claimed by users. Prevents impersonation
// of official communication channels and RFC 2142 required addresses.
const RESERVED_ADDRESSES = new Set([
  // RFC 2142: required operational mailboxes
  'postmaster', 'abuse', 'hostmaster', 'webmaster',
  // Platform system addresses
  'admin', 'administrator', 'support', 'help', 'info', 'contact',
  'noreply', 'no-reply', 'system', 'security', 'billing',
  'api', 'root', 'mailer-daemon', 'null', 'devnull',
  // AgentLair brand
  'agentlair', 'team', 'hello', 'hey', 'hei',
]);

function isReservedAddress(address) {
  if (!address) return false;
  const local = address.split('@')[0].toLowerCase();
  return RESERVED_ADDRESSES.has(local);
}

// Validate local part of an @agentlair.dev address
// Returns null if valid, or an error message string if invalid.
function validateLocalPart(address) {
  if (!address) return 'address required';
  const local = address.split('@')[0];
  if (!local || local.length === 0) return 'Local part cannot be empty.';
  if (local.length > 64) return 'Local part too long (max 64 characters).';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(local)) return 'Local part must start with alphanumeric and contain only letters, digits, dots, hyphens, or underscores.';
  if (/\.\./.test(local)) return 'Local part cannot contain consecutive dots.';
  return null;
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────────

// IP-based rate limit for unauthenticated endpoints (key creation, vault store)
// Returns { allowed: boolean, remaining: number }
async function checkIpRateLimit(env, ip, action, maxPerHour) {
  if (!ip || !env.KEYS) return { allowed: true, remaining: maxPerHour };
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const key = `ip-rl:${action}:${ip}:${hour}`;
  const current = parseInt(await env.KEYS.get(key) || '0');
  if (current >= maxPerHour) {
    return { allowed: false, remaining: 0 };
  }
  await env.KEYS.put(key, String(current + 1), { expirationTtl: 7200 });
  return { allowed: true, remaining: maxPerHour - current - 1 };
}

async function checkRateLimit(env, accountId, tier) {
  const limit = tier === 'paid' ? 10000 : 100; // requests/day
  const today = new Date().toISOString().slice(0, 10);
  const counterKey = 'rl:' + accountId + ':' + today;
  const current = parseInt(await env.KEYS.get(counterKey) || '0');
  if (current >= limit) return false;
  await env.KEYS.put(counterKey, String(current + 1), { expirationTtl: 86400 });
  return true;
}

// ─── Email-Specific Rate Limiting & Abuse Prevention ───────────────────────────
//
// Limits (separate from general API rate limits):
//   Free tier:  50 emails/day per account, 20/hour per from-address
//   Paid tier: 1000 emails/day per account, 200/hour per from-address
//
// Abuse signals tracked:
//   - Bounce rate per address (suspended if >10% of last 100 sends)
//   - Rapid send detection (>5 emails/minute from same address)

const EMAIL_LIMITS = {
  free:  { daily: 50,   hourly: 20,  burst: 5 },
  paid:  { daily: 1000, hourly: 200, burst: 60 },
};

async function checkEmailRateLimit(env, accountId, tier, fromAddr) {
  const limits = EMAIL_LIMITS[tier] || EMAIL_LIMITS.free;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);           // YYYY-MM-DD
  const hour  = now.toISOString().slice(0, 13);           // YYYY-MM-DDTHH
  const minute = now.toISOString().slice(0, 16);          // YYYY-MM-DDTHH:MM

  // Extract local part of from-address for per-address keys
  const fromLocal = fromAddr.replace(/<([^>]+)>/, '$1').split('@')[0];

  const dailyKey  = `email_daily:${accountId}:${today}`;
  const hourlyKey = `email_hourly:${fromLocal}:${hour}`;
  const burstKey  = `email_burst:${fromLocal}:${minute}`;

  // Read all counters in parallel
  const [dailyRaw, hourlyRaw, burstRaw] = await Promise.all([
    env.EMAILS.get(dailyKey),
    env.EMAILS.get(hourlyKey),
    env.EMAILS.get(burstKey),
  ]);

  const daily  = parseInt(dailyRaw  || '0');
  const hourly = parseInt(hourlyRaw || '0');
  const burst  = parseInt(burstRaw  || '0');

  const resetAt = new Date(now);
  resetAt.setUTCDate(resetAt.getUTCDate() + 1);
  resetAt.setUTCHours(0, 0, 0, 0);

  if (daily >= limits.daily) {
    return {
      allowed: false,
      reason: 'daily_limit',
      limit: limits.daily,
      remaining: 0,
      reset_at: resetAt.toISOString(),
      upgrade_hint: tier === 'free' ? 'Upgrade to paid tier for 1,000 emails/day.' : null,
    };
  }

  if (hourly >= limits.hourly) {
    const hourReset = new Date(now);
    hourReset.setUTCMinutes(0, 0, 0);
    hourReset.setUTCHours(hourReset.getUTCHours() + 1);
    return {
      allowed: false,
      reason: 'hourly_limit',
      limit: limits.hourly,
      remaining: 0,
      reset_at: hourReset.toISOString(),
      upgrade_hint: 'Limit is per address. Distribute sends across multiple addresses or upgrade.',
    };
  }

  if (burst >= limits.burst) {
    return {
      allowed: false,
      reason: 'burst_limit',
      limit: limits.burst,
      remaining: 0,
      reset_at: new Date(now.getTime() + 60000).toISOString(),
      upgrade_hint: 'Too many emails per minute from this address. Slow down or upgrade.',
    };
  }

  // Check bounce-rate suspension
  const bounceKey = `email_bounce:${fromLocal}`;
  const bounceRaw = await env.EMAILS.get(bounceKey);
  if (bounceRaw) {
    const bounce = JSON.parse(bounceRaw);
    if (bounce.suspended) {
      return {
        allowed: false,
        reason: 'address_suspended',
        limit: 0,
        remaining: 0,
        reset_at: null,
        upgrade_hint: `Address ${fromAddr} suspended due to high bounce rate (${bounce.rate}%). Contact support@agentlair.dev.`,
      };
    }
  }

  // All checks passed — increment counters
  await Promise.all([
    env.EMAILS.put(dailyKey,  String(daily  + 1), { expirationTtl: 86400 * 2 }),
    env.EMAILS.put(hourlyKey, String(hourly + 1), { expirationTtl: 7200 }),
    env.EMAILS.put(burstKey,  String(burst  + 1), { expirationTtl: 120 }),
  ]);

  return {
    allowed: true,
    daily_remaining: limits.daily - daily - 1,
    hourly_remaining: limits.hourly - hourly - 1,
    reset_at: resetAt.toISOString(),
  };
}

// Record a bounce for an address — call after delivery failure
async function recordEmailBounce(env, fromAddr) {
  const fromLocal = fromAddr.replace(/<([^>]+)>/, '$1').split('@')[0];
  const bounceKey = `email_bounce:${fromLocal}`;
  const statsKey  = `email_stats:${fromLocal}`;

  const [bounceRaw, statsRaw] = await Promise.all([
    env.EMAILS.get(bounceKey),
    env.EMAILS.get(statsKey),
  ]);

  const stats = statsRaw ? JSON.parse(statsRaw) : { sent: 0, bounced: 0 };
  stats.sent    += 0; // incremented at send time
  stats.bounced += 1;
  stats.last_bounce = new Date().toISOString();

  const rate = stats.sent > 0 ? (stats.bounced / stats.sent) : 1;

  const bounce = bounceRaw ? JSON.parse(bounceRaw) : {};
  bounce.count = (bounce.count || 0) + 1;
  bounce.rate  = Math.round(rate * 100);
  bounce.last  = stats.last_bounce;

  // Suspend if >10% bounce rate after at least 10 sends
  if (rate > 0.10 && stats.sent >= 10) {
    bounce.suspended = true;
    bounce.suspended_at = new Date().toISOString();
  }

  await Promise.all([
    env.EMAILS.put(bounceKey, JSON.stringify(bounce), { expirationTtl: 86400 * 30 }),
    env.EMAILS.put(statsKey,  JSON.stringify(stats),  { expirationTtl: 86400 * 30 }),
  ]);
}

// Increment sent stats for an address
async function recordEmailSent(env, fromAddr) {
  const fromLocal = fromAddr.replace(/<([^>]+)>/, '$1').split('@')[0];
  const statsKey  = `email_stats:${fromLocal}`;
  const statsRaw  = await env.EMAILS.get(statsKey);
  const stats = statsRaw ? JSON.parse(statsRaw) : { sent: 0, bounced: 0 };
  stats.sent += 1;
  stats.last_sent = new Date().toISOString();
  await env.EMAILS.put(statsKey, JSON.stringify(stats), { expirationTtl: 86400 * 30 });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ── Public routes (no auth) ──────────────────────────────────────────────

    // Security blog post
    if ((path === '/security' || path === '/blog/security') && method === 'GET') {
      return new Response(SECURITY_BLOG_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // Vault product page
    if (path === '/vault' && method === 'GET') {
      return new Response(VAULT_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // Getting Started guide (human-friendly onboarding)
    if (path === '/getting-started' && method === 'GET') {
      return new Response(GETTING_STARTED_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // Dashboard (human-readable login + management UI)
    if (path === '/dashboard' && method === 'GET') {
      return new Response(DASHBOARD_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Powered-By': 'AgentLair' },
      });
    }

    // POST /v1/auth/login — request magic link by recovery email
    if (path === '/v1/auth/login' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const email = (body.email || '').toLowerCase().trim();
      if (!email || !email.includes('@')) return err('email required', 400, 'invalid_email');

      // Look up account by recovery email index
      const accountId = await env.KEYS.get('recovery-email:' + email);
      if (!accountId) {
        // Don't reveal whether email exists — same response either way
        return json({ sent: true, message: 'If this email is registered, a magic link has been sent.' });
      }

      // Generate magic link token (single-use, 15min TTL)
      const token = nanoid(40);
      const tokenHash = await sha256hex(token);
      await env.KEYS.put('magic:' + tokenHash, JSON.stringify({ accountId, expires: Date.now() + 15 * 60 * 1000 }), { expirationTtl: 900 });

      // Send email
      const baseUrl = new URL(request.url).origin;
      try {
        await sendMagicLinkEmail(email, token, baseUrl, env);
      } catch (e) {
        return err('Failed to send magic link: ' + e.message, 502, 'email_error');
      }

      return json({ sent: true, message: 'Magic link sent. Check your inbox — expires in 15 minutes.' });
    }

    // GET /v1/auth/verify?token=... — verify magic link, create session, redirect to dashboard
    if (path === '/v1/auth/verify' && method === 'GET') {
      const token = url.searchParams.get('token');
      if (!token) return err('token required', 400, 'invalid_token');

      const tokenHash = await sha256hex(token);
      const magicJson = await env.KEYS.get('magic:' + tokenHash);
      if (!magicJson) return html('<h2 style="font-family:sans-serif;color:#ef4444;padding:2rem;">Invalid or expired magic link. <a href="/dashboard">Try again</a>.</h2>', 400);

      const magic = JSON.parse(magicJson);
      if (Date.now() > magic.expires) {
        await env.KEYS.delete('magic:' + tokenHash);
        return html('<h2 style="font-family:sans-serif;color:#ef4444;padding:2rem;">Magic link expired. <a href="/dashboard">Request a new one</a>.</h2>', 400);
      }

      // Single-use: delete magic token immediately
      await env.KEYS.delete('magic:' + tokenHash);

      // Create session (24h TTL)
      const sessionToken = 'session_' + nanoid(40);
      const sessionHash = await sha256hex(sessionToken);
      await env.KEYS.put('session:' + sessionHash, JSON.stringify({ accountId: magic.accountId, expires: Date.now() + 24 * 60 * 60 * 1000 }), { expirationTtl: 86400 });

      // Redirect to dashboard with session in URL fragment
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/dashboard#session=' + sessionToken, 'X-Powered-By': 'AgentLair' },
      });
    }

    if (path === '/' && method === 'GET') {
      // Content negotiation: serve HTML to browsers, JSON to API clients
      const accept = request.headers.get('Accept') || '';
      if (accept.includes('text/html')) {
        return html(LANDING_HTML);
      }
      return json(API_DISCOVERY);
    }

    if (path === '/api' && method === 'GET') {
      // Dedicated API discovery endpoint (always JSON)
      return json(API_DISCOVERY);
    }

    if (path === '/health' && method === 'GET') {
      return json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.11.0' });
    }

    if (path === '/.well-known/agent.json' && method === 'GET') {
      // A2A agent card — must be publicly accessible (no auth)
      return new Response(JSON.stringify(AGENT_CARD, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
          'X-Powered-By': 'AgentLair',
        },
      });
    }

    // ── Auth: key creation ───────────────────────────────────────────────────

    if (path === '/v1/auth/keys' && method === 'POST') {
      // Rate limit: max 5 key creations per IP per hour
      const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      const ipCheck = await checkIpRateLimit(env, clientIp, 'key-create', 5);
      if (!ipCheck.allowed) {
        return new Response(JSON.stringify({
          error: 'rate_limited',
          message: 'Too many key creation requests. Try again later.',
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Retry-After': '3600',
          },
        });
      }

      let body = {};
      try { body = await request.json(); } catch {}
      const name = body.name || 'default';

      // Generate key: al_live_<32 chars>
      const keyValue = 'al_live_' + nanoid(32);
      const keyHash = await sha256hex(keyValue);
      const keyPrefix = keyValue.slice(0, 12); // al_live_ABCD

      const accountId = 'acc_' + nanoid(16);
      const now = new Date().toISOString();

      const account = {
        id: accountId,
        key_prefix: keyPrefix,
        name,
        tier: 'free',
        email: body.email || null,
        created_at: now,
        stacks: [],
      };

      // Store: key hash → account data
      await env.KEYS.put('key:' + keyHash, JSON.stringify(account));
      // Store: account id → key hash (for listing)
      await env.KEYS.put('account:' + accountId, keyHash);
      // Initialize keys list
      await saveKeysList(env, accountId, [{
        hash: keyHash, status: 'active', prefix: keyPrefix, created_at: now, label: 'primary',
      }]);
      // Index by recovery/registration email if provided
      if (account.email) {
        await env.KEYS.put('recovery-email:' + account.email.toLowerCase(), accountId);
      }

      return json({
        api_key: keyValue,
        key_prefix: keyPrefix,
        account_id: accountId,
        tier: 'free',
        created_at: now,
        warning: 'Save this key — it will not be shown again. Set a recovery email at POST /v1/account/recovery-email to enable dashboard login.',
        limits: {
          stacks: 1,
          dns_records: 10,
          emails_per_day: 50,
          requests_per_day: 100,
        },
      }, 201);
    }

    // ── API v0.2 — POST /v1/keys (alias for /v1/auth/keys, no auth needed) ────
    if (path === '/v1/keys' && method === 'POST') {
      // Rate limit: max 5 key creations per IP per hour (same as /v1/auth/keys)
      const clientIp2 = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      const ipCheck2 = await checkIpRateLimit(env, clientIp2, 'key-create', 5);
      if (!ipCheck2.allowed) {
        return new Response(JSON.stringify({
          error: 'rate_limited',
          message: 'Too many key creation requests. Try again later.',
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Retry-After': '3600',
          },
        });
      }
      // Delegate to the same key-creation logic
      const keyValue = 'al_live_' + nanoid(32);
      const keyHash = await sha256hex(keyValue);
      const keyPrefix = keyValue.slice(0, 12);
      const accountId = 'acc_' + nanoid(16);
      const now = new Date().toISOString();
      let body = {};
      try { body = await request.json(); } catch {}
      const account = { id: accountId, key_prefix: keyPrefix, name: body.name || 'default', tier: 'free', email: body.email || null, created_at: now, stacks: [] };
      await env.KEYS.put('key:' + keyHash, JSON.stringify(account));
      await env.KEYS.put('account:' + accountId, keyHash);
      return json({ key: keyValue, account_id: accountId, created_at: now, note: 'Save this key — not shown again.' }, 201);
    }

    // ── Vault: Encrypted Seed Storage + Recovery (no auth required) ──────────
    // Design: Client encrypts seed with passphrase before sending.
    // AgentLair stores only the encrypted blob — never sees plaintext.
    // Recovery flow: email → magic link → encrypted blob returned → client decrypts.

    // POST /v1/vault/store — store an encrypted seed blob
    if (path === '/v1/vault/store' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const encryptedSeed = body.encrypted_seed;
      const recoveryEmail = (body.recovery_email || '').toLowerCase().trim();

      if (!encryptedSeed || typeof encryptedSeed !== 'string') {
        return err('encrypted_seed required (base64 or hex encoded ciphertext)', 400, 'invalid_encrypted_seed');
      }
      if (encryptedSeed.length > 50000) {
        return err('encrypted_seed too large (max 50KB)', 400, 'payload_too_large');
      }
      if (!recoveryEmail || !recoveryEmail.includes('@')) {
        return err('recovery_email required (valid email address)', 400, 'invalid_email');
      }

      // Rate limit: max 5 vault entries per email per day
      const emailHash = await sha256hex(recoveryEmail);
      const today = new Date().toISOString().slice(0, 10);
      const storeRlKey = 'vault-rl:' + emailHash + ':' + today;
      const storeCount = parseInt(await env.KEYS.get(storeRlKey) || '0');
      if (storeCount >= 5) {
        return err('Too many vault entries for this email today. Try again tomorrow.', 429, 'rate_limited');
      }
      await env.KEYS.put(storeRlKey, String(storeCount + 1), { expirationTtl: 86400 });

      // Generate vault_id and store entry
      const vaultId = 'vlt_' + nanoid(24);
      const createdAt = new Date().toISOString();
      await env.KEYS.put('vault:' + vaultId, JSON.stringify({
        encrypted_seed: encryptedSeed,
        recovery_email: recoveryEmail,
        created_at: createdAt,
      }));

      // Update email index (array of vault_ids for this email)
      const emailIndexKey = 'vault-email:' + emailHash;
      const existingRaw = await env.KEYS.get(emailIndexKey);
      const vaultIds = existingRaw ? JSON.parse(existingRaw) : [];
      vaultIds.push(vaultId);
      await env.KEYS.put(emailIndexKey, JSON.stringify(vaultIds));

      return json({
        vault_id: vaultId,
        stored_at: createdAt,
        message: 'Encrypted seed stored. Use POST /v1/vault/recover with your recovery email to retrieve it.',
      });
    }

    // POST /v1/vault/recover — request a magic link to recover encrypted seed(s)
    if (path === '/v1/vault/recover' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const email = (body.email || '').toLowerCase().trim();
      if (!email || !email.includes('@')) return err('email required', 400, 'invalid_email');

      // Rate limit: max 3 recovery requests per email per hour
      const emailHash = await sha256hex(email);
      const hour = new Date().toISOString().slice(0, 13);
      const recoverRlKey = 'vault-recover-rl:' + emailHash + ':' + hour;
      const recoverCount = parseInt(await env.KEYS.get(recoverRlKey) || '0');
      if (recoverCount >= 3) {
        return err('Too many recovery attempts. Try again in an hour.', 429, 'rate_limited');
      }
      await env.KEYS.put(recoverRlKey, String(recoverCount + 1), { expirationTtl: 3600 });

      // Look up legacy vault entries (email-hash indexed blobs)
      const vaultIdsRaw = await env.KEYS.get('vault-email:' + emailHash);
      const vaultIds = vaultIdsRaw ? JSON.parse(vaultIdsRaw) : [];

      // Look up v2 account IDs registered via POST /v1/vault/recovery-email
      const accountIdsRaw = await env.VAULT.get('recovery-idx:' + emailHash);
      const accountIds = accountIdsRaw ? JSON.parse(accountIdsRaw) : [];

      // If neither exists, return same response (avoids enumeration)
      if (vaultIds.length === 0 && accountIds.length === 0) {
        return json({ sent: true, message: 'If vault entries exist for this email, a recovery link has been sent.' });
      }

      // Generate one-time recovery token (15min TTL)
      const token = nanoid(40);
      const tokenHash = await sha256hex(token);
      await env.KEYS.put(
        'vault-magic:' + tokenHash,
        JSON.stringify({ vault_ids: vaultIds, account_ids: accountIds, email, expires: Date.now() + 15 * 60 * 1000 }),
        { expirationTtl: 900 }
      );

      // Send recovery email
      const baseUrl = new URL(request.url).origin;
      try {
        await sendVaultRecoveryEmail(email, token, baseUrl, env);
      } catch (e) {
        return err('Failed to send recovery email: ' + e.message, 502, 'email_error');
      }

      return json({ sent: true, message: 'Recovery link sent. Check your inbox — expires in 15 minutes.' });
    }

    // GET /v1/vault/recover/verify?token=... — verify recovery token, return encrypted seeds
    if (path === '/v1/vault/recover/verify' && method === 'GET') {
      const token = url.searchParams.get('token');
      if (!token) return err('token required', 400, 'invalid_token');

      const tokenHash = await sha256hex(token);
      const magicJson = await env.KEYS.get('vault-magic:' + tokenHash);
      if (!magicJson) return err('Invalid or expired recovery token.', 400, 'invalid_token');

      const magic = JSON.parse(magicJson);
      if (Date.now() > magic.expires) {
        await env.KEYS.delete('vault-magic:' + tokenHash);
        return err('Recovery token expired. Request a new one via POST /v1/vault/recover.', 400, 'token_expired');
      }

      // Single-use: delete token immediately
      await env.KEYS.delete('vault-magic:' + tokenHash);

      // Fetch legacy vault entries (email-hash indexed encrypted seed blobs)
      const legacyEntries = [];
      for (const vaultId of (magic.vault_ids || [])) {
        const entryJson = await env.KEYS.get('vault:' + vaultId);
        if (entryJson) {
          const entry = JSON.parse(entryJson);
          legacyEntries.push({
            vault_id: vaultId,
            encrypted_seed: entry.encrypted_seed,
            created_at: entry.created_at,
          });
        }
      }

      // Fetch v2 vault entries (account-scoped, registered via PUT /v1/vault/{key})
      const v2Entries = [];
      for (const accountId of (magic.account_ids || [])) {
        const indexRaw = await env.VAULT.get('vault-index:' + accountId);
        if (!indexRaw) continue;
        const keyIndex = JSON.parse(indexRaw);
        for (const keyMeta of keyIndex) {
          const latestVersion = keyMeta.version;
          const entryJson = await env.VAULT.get('vault:' + accountId + ':' + keyMeta.key + ':' + latestVersion);
          if (entryJson) {
            const entry = JSON.parse(entryJson);
            v2Entries.push({
              account_id: accountId,
              key: keyMeta.key,
              ciphertext: entry.ciphertext,
              metadata: entry.metadata || null,
              version: latestVersion,
              created_at: entry.created_at,
            });
          }
        }
      }

      return json({
        recovered: true,
        entries: v2Entries,
        count: v2Entries.length,
        legacy_entries: legacyEntries,
        legacy_count: legacyEntries.length,
        note: 'Decrypt each entry with your recovery passphrase or master seed. AgentLair never stored the plaintext.',
      });
    }

    // ── Protected routes (auth required) ─────────────────────────────────────
    // Accepts either: API key (al_live_...) or session token (session_...) from dashboard

    const account = await authenticateAny(request, env);
    if (!account) {
      return err('Authentication required. Pass API key as: Authorization: Bearer al_live_...', 401, 'unauthorized');
    }

    // Rate limit check
    const allowed = await checkRateLimit(env, account.id, account.tier);
    if (!allowed) {
      return err('Rate limit exceeded. Free tier: 100 requests/day.', 429, 'rate_limited');
    }

    // ── Account routes ────────────────────────────────────────────────────────

    // GET /v1/account/me — return current account info (safe subset)
    if (path === '/v1/account/me' && method === 'GET') {
      return json({
        id: account.id,
        key_prefix: account.key_prefix,
        name: account.name,
        tier: account.tier,
        recovery_email: account.recovery_email || account.email || null,
        email: account.email || null,
        created_at: account.created_at,
      });
    }

    // POST /v1/account/recovery-email — set or update recovery email
    if (path === '/v1/account/recovery-email' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const newEmail = (body.email || '').toLowerCase().trim();
      if (!newEmail || !newEmail.includes('@')) return err('email required', 400, 'invalid_email');

      // Remove old index if exists
      const oldEmail = account.recovery_email || account.email;
      if (oldEmail && oldEmail !== newEmail) {
        await env.KEYS.delete('recovery-email:' + oldEmail.toLowerCase());
      }

      // Update account object in KV
      account.recovery_email = newEmail;
      const keyHash = await env.KEYS.get('account:' + account.id);
      if (keyHash) {
        await env.KEYS.put('key:' + keyHash, JSON.stringify(account));
      }

      // Create/update recovery email index
      await env.KEYS.put('recovery-email:' + newEmail, account.id);

      return json({ ok: true, recovery_email: newEmail });
    }

    // POST /v1/auth/keys/rotate — generate new API key for same account (session or API key auth)
    if (path === '/v1/auth/keys/rotate' && method === 'POST') {
      // Get current key hash to invalidate
      const oldKeyHash = await env.KEYS.get('account:' + account.id);

      // Generate new key
      const newKeyValue = 'al_live_' + nanoid(32);
      const newKeyHash = await sha256hex(newKeyValue);
      const newKeyPrefix = newKeyValue.slice(0, 12);
      const now = new Date().toISOString();

      // Update account object with new prefix
      const updatedAccount = { ...account, key_prefix: newKeyPrefix, rotated_at: now };
      delete updatedAccount._session; // don't persist internal field

      // Write new key → account mapping
      await env.KEYS.put('key:' + newKeyHash, JSON.stringify(updatedAccount));
      // Update account id → new key hash
      await env.KEYS.put('account:' + account.id, newKeyHash);
      // Invalidate old key
      if (oldKeyHash && oldKeyHash !== newKeyHash) {
        await env.KEYS.delete('key:' + oldKeyHash);
      }

      // Update keys list: revoke old active, add new active
      const keys = await ensureKeysList(env, account.id);
      for (const k of keys) {
        if (k.status === 'active') k.status = 'revoked';
      }
      keys.push({ hash: newKeyHash, status: 'active', prefix: newKeyPrefix, created_at: now, label: 'primary' });
      await saveKeysList(env, account.id, keys);

      return json({
        api_key: newKeyValue,
        key_prefix: newKeyPrefix,
        account_id: account.id,
        rotated_at: now,
        warning: 'Save this key — it will not be shown again. Old key is now invalid.',
      });
    }

    // POST /v1/auth/keys/generate-backup — create a backup key (dormant until activated)
    if (path === '/v1/auth/keys/generate-backup' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const label = body.label || 'backup';

      const keys = await ensureKeysList(env, account.id);

      // Limit: max 1 backup key at a time
      const existingBackup = keys.find(k => k.status === 'backup');
      if (existingBackup) {
        return err('A backup key already exists (prefix: ' + existingBackup.prefix + '...). Activate or revoke it first.', 409, 'backup_exists');
      }

      // Generate backup key
      const backupKeyValue = 'al_live_' + nanoid(32);
      const backupKeyHash = await sha256hex(backupKeyValue);
      const backupKeyPrefix = backupKeyValue.slice(0, 12);
      const now = new Date().toISOString();

      // Store in keys list only — NOT in key:{hash} (can't authenticate yet)
      keys.push({
        hash: backupKeyHash,
        status: 'backup',
        prefix: backupKeyPrefix,
        created_at: now,
        label,
      });
      await saveKeysList(env, account.id, keys);

      return json({
        backup_key: backupKeyValue,
        key_prefix: backupKeyPrefix,
        status: 'backup',
        created_at: now,
        warning: 'Save this backup key securely — it will not be shown again. It cannot authenticate until activated via POST /v1/auth/keys/activate-backup.',
      }, 201);
    }

    // POST /v1/auth/keys/activate-backup — promote backup key to active, revoke old primary
    if (path === '/v1/auth/keys/activate-backup' && method === 'POST') {
      const keys = await ensureKeysList(env, account.id);
      const backupKey = keys.find(k => k.status === 'backup');
      if (!backupKey) {
        return err('No backup key found. Generate one first with POST /v1/auth/keys/generate-backup.', 404, 'no_backup');
      }

      const now = new Date().toISOString();
      const oldKeyHash = await env.KEYS.get('account:' + account.id);

      // Update account with backup key's prefix
      const updatedAccount = { ...account, key_prefix: backupKey.prefix, rotated_at: now };
      delete updatedAccount._session;

      // Activate: create key:{hash} → account mapping for backup key
      await env.KEYS.put('key:' + backupKey.hash, JSON.stringify(updatedAccount));
      // Update account → key hash pointer
      await env.KEYS.put('account:' + account.id, backupKey.hash);
      // Revoke old active key
      if (oldKeyHash && oldKeyHash !== backupKey.hash) {
        await env.KEYS.delete('key:' + oldKeyHash);
      }

      // Update keys list statuses
      for (const k of keys) {
        if (k.status === 'active') k.status = 'revoked';
        if (k.hash === backupKey.hash) {
          k.status = 'active';
          k.label = 'primary';
          k.activated_at = now;
        }
      }
      await saveKeysList(env, account.id, keys);

      return json({
        activated_key_prefix: backupKey.prefix,
        account_id: account.id,
        activated_at: now,
        message: 'Backup key is now the active primary key. Old key has been revoked.',
      });
    }

    // GET /v1/auth/keys/list — list all keys for the account with status
    if (path === '/v1/auth/keys/list' && method === 'GET') {
      const keys = await ensureKeysList(env, account.id);

      return json({
        account_id: account.id,
        keys: keys.map(k => ({
          prefix: k.prefix,
          status: k.status,
          label: k.label || null,
          created_at: k.created_at,
          activated_at: k.activated_at || null,
        })),
      });
    }

    // ── E2E Encryption routes ─────────────────────────────────────────────────

    // POST /v1/e2e/rotate-key — register or rotate E2E public key for this account.
    // Auth: standard API key (identifies account) + master_seed in body (proves ownership).
    // On first call: stores master_seed hash and sets initial public key.
    // On subsequent calls: verifies master_seed matches stored hash, then rotates key.
    // Old public keys are retained in e2e_key_history so old messages remain decryptable
    // by the client using the appropriate private key derived from the same master_seed.
    if (path === '/v1/e2e/rotate-key' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const { master_seed, new_public_key } = body;

      if (!master_seed) return err('master_seed required in body', 400, 'missing_master_seed');
      if (!new_public_key) return err('new_public_key required in body', 400, 'missing_public_key');
      if (typeof new_public_key !== 'string' || new_public_key.length < 10) {
        return err('new_public_key must be a non-empty string (base64 or hex encoded public key)', 400, 'invalid_public_key');
      }

      const seedHash = await sha256hex(master_seed);
      const now = new Date().toISOString();
      const isFirstSetup = !account.e2e_master_seed_hash;

      if (!isFirstSetup && account.e2e_master_seed_hash !== seedHash) {
        return err('master_seed does not match. Key rotation denied.', 403, 'seed_mismatch');
      }

      // Build updated history: prepend current active key if one exists
      const existingHistory = Array.isArray(account.e2e_key_history) ? account.e2e_key_history : [];
      const updatedHistory = account.e2e_public_key
        ? [{ public_key: account.e2e_public_key, rotated_at: now }, ...existingHistory]
        : existingHistory;

      // Update account with new E2E config
      account.e2e_master_seed_hash = seedHash;
      account.e2e_public_key = new_public_key;
      account.e2e_key_history = updatedHistory;
      account.e2e_updated_at = now;
      if (isFirstSetup) account.e2e_created_at = now;
      delete account._session; // don't persist internal field

      const keyHash = await env.KEYS.get('account:' + account.id);
      if (!keyHash) return err('Account key not found. Cannot persist update.', 500, 'account_error');
      await env.KEYS.put('key:' + keyHash, JSON.stringify(account));

      return json({
        ok: true,
        account_id: account.id,
        active_public_key: new_public_key,
        key_history_count: updatedHistory.length,
        key_history: updatedHistory.map(k => ({ public_key: k.public_key, rotated_at: k.rotated_at })),
        first_setup: isFirstSetup,
        updated_at: now,
        note: isFirstSetup
          ? 'E2E public key registered. New messages will be encrypted with this key. Use master_seed to rotate in the future.'
          : 'E2E public key rotated. Old messages retain their previous encryption and remain decryptable with the corresponding private key derived from your master_seed.',
      });
    }

    // ── Stack routes ─────────────────────────────────────────────────────────

    if (path === '/v1/stack' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const domain = body.domain;

      if (!domain) return err('domain is required. Example: {"domain": "myagent.dev"}', 400, 'missing_domain');

      // Check stack limit (free = 1)
      if (account.stacks.length >= 1 && account.tier === 'free') {
        return json({
          error: 'upgrade_required',
          message: 'Free tier allows 1 stack. Upgrade for unlimited stacks.',
          upgrade_url: 'https://agentlair.dev/pricing',
          current_stacks: account.stacks,
        }, 402);
      }

      // Check idempotency: stack already exists for this domain?
      const stackKey = 'stack:' + account.id + ':' + domain;
      const existingStack = await env.KEYS.get(stackKey);
      if (existingStack) {
        return json(JSON.parse(existingStack));
      }

      const stackId = 'stk_' + nanoid(16);
      const now = new Date().toISOString();
      const stack = {
        id: stackId,
        domain,
        status: 'provisioning',
        account_id: account.id,
        created_at: now,
        email: 'contact@' + domain,
        nameservers: ['ns1.agentlair.dev', 'ns2.agentlair.dev'],
        note: 'Beta: DNS provisioning is stubbed. Full CF DNS integration coming Q2 2026.',
        next_steps: [
          'Update your domain nameservers to ns1.agentlair.dev + ns2.agentlair.dev',
          'Wait 24-48h for propagation',
          'GET /v1/stack/' + stackId + ' to check status',
        ],
      };

      // Save stack
      await env.KEYS.put(stackKey, JSON.stringify(stack));

      // Update account with this stack
      account.stacks.push(stackId);
      const keyHash = await env.KEYS.get('account:' + account.id);
      if (keyHash) await env.KEYS.put('key:' + keyHash, JSON.stringify(account));

      return json(stack, 201);
    }

    if (path === '/v1/stack' && method === 'GET') {
      // List stacks for account
      const stacks = [];
      for (const stackId of account.stacks) {
        // We'd need a reverse lookup... simplify: list all keys matching pattern
        // For now, return account.stacks as IDs with minimal info
        stacks.push({ id: stackId });
      }
      return json({ stacks, count: stacks.length });
    }

    // ── Usage route ──────────────────────────────────────────────────────────

    if (path === '/v1/usage' && method === 'GET') {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const counterKey = 'rl:' + account.id + ':' + today;
      const emailDailyKey = `email_daily:${account.id}:${today}`;

      const [usedToday, emailDailyRaw] = await Promise.all([
        env.KEYS.get(counterKey),
        env.EMAILS ? env.EMAILS.get(emailDailyKey) : Promise.resolve(null),
      ]);

      const emailLimits = EMAIL_LIMITS[account.tier] || EMAIL_LIMITS.free;
      const emailDailyUsed = parseInt(emailDailyRaw || '0');
      const resetAt = new Date(now);
      resetAt.setUTCDate(resetAt.getUTCDate() + 1);
      resetAt.setUTCHours(0, 0, 0, 0);

      return json({
        account_id: account.id,
        tier: account.tier,
        period: today,
        requests: { used: parseInt(usedToday || '0'), limit: account.tier === 'paid' ? 10000 : 100 },
        stacks: { used: account.stacks.length, limit: account.tier === 'free' ? 1 : 999 },
        emails: {
          daily_used: emailDailyUsed,
          daily_limit: emailLimits.daily,
          daily_remaining: Math.max(0, emailLimits.daily - emailDailyUsed),
          hourly_limit: emailLimits.hourly,
          reset_at: resetAt.toISOString(),
        },
        status: 'active',
      });
    }

    if (path === '/v1/billing' && method === 'GET') {
      return json({
        account_id: account.id,
        tier: account.tier,
        plan: account.tier === 'free' ? 'Free Beta' : 'Pro',
        next_invoice: null,
        upgrade_url: 'https://agentlair.dev/pricing',
        note: 'Billing not yet active — all features free during beta.',
      });
    }

    // ── Email routes (LIVE — CF Email Routing + KV) ──────────────────────────

    // POST /v1/email/claim — explicitly claim an @agentlair.dev address for this account
    if (path === '/v1/email/claim' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const { address, public_key } = body;

      if (!address) {
        return err('address required in body. Example: {"address": "myagent@agentlair.dev"}', 400, 'missing_address');
      }
      if (!address.endsWith('@agentlair.dev')) {
        return err('Only @agentlair.dev addresses can be claimed.', 400, 'invalid_address');
      }
      const localPartError = validateLocalPart(address);
      if (localPartError) {
        return err(localPartError, 400, 'invalid_address');
      }
      if (isReservedAddress(address)) {
        return err('This address is reserved and cannot be claimed.', 403, 'address_reserved');
      }
      if (!env.EMAILS) {
        return err('Email storage not available.', 503, 'email_unavailable');
      }

      // Validate optional public_key (base64url-encoded X25519 public key, 32 bytes → ~43 chars)
      if (public_key !== undefined) {
        if (typeof public_key !== 'string' || public_key.length < 10) {
          return err('public_key must be a base64url-encoded X25519 public key (32 bytes)', 400, 'invalid_public_key');
        }
      }

      const ownerKey = `email-owner:${address}`;
      const pubKeyKvKey = `email-pubkey:${address}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      if (currentOwner && currentOwner !== account.id) {
        return err('This address is already claimed by another account.', 409, 'address_taken');
      }

      // Store public key if provided (enables E2E encryption of incoming emails for this address)
      if (public_key) {
        await env.EMAILS.put(pubKeyKvKey, public_key);
      }

      if (currentOwner === account.id) {
        return json({ address, claimed: true, already_owned: true, account_id: account.id, e2e_enabled: !!public_key });
      }

      await env.EMAILS.put(ownerKey, account.id);
      return json({ address, claimed: true, already_owned: false, account_id: account.id, e2e_enabled: !!public_key }, 201);
    }

    // GET /v1/email/inbox?address=agent@agentlair.dev&limit=20
    if (path === '/v1/email/inbox' && method === 'GET') {
      const address = url.searchParams.get('address');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

      if (!address) {
        return err('address query parameter required. Example: ?address=myagent@agentlair.dev', 400, 'missing_address');
      }

      // Only allow reading inbox for @agentlair.dev addresses (for now)
      if (!address.endsWith('@agentlair.dev')) {
        return err('Only @agentlair.dev addresses supported in beta.', 400, 'invalid_address');
      }

      if (!env.EMAILS) {
        return err('Email storage not available.', 503, 'email_unavailable');
      }

      // Ownership: first-touch claim. If unclaimed, this account takes it.
      // If claimed by another account, return 403.
      const ownerKey = `email-owner:${address}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      if (!currentOwner) {
        // Check reserved addresses before auto-claiming
        if (isReservedAddress(address)) {
          return err('This address is reserved and cannot be claimed.', 403, 'address_reserved');
        }
        // First access — auto-claim for this account
        await env.EMAILS.put(ownerKey, account.id);
      } else if (currentOwner !== account.id) {
        return err('This address is registered to another account.', 403, 'address_not_yours');
      }

      // Get index of message keys for this address
      const indexKey = `index:${address}`;
      const indexRaw = await env.EMAILS.get(indexKey);
      if (!indexRaw) {
        return json({ messages: [], has_more: false, count: 0, address });
      }

      const index = JSON.parse(indexRaw);
      const pageKeys = index.slice(0, limit);
      const hasMore = index.length > limit;

      // Fetch each message (parallel)
      const messages = await Promise.all(
        pageKeys.map(async (key) => {
          const raw = await env.EMAILS.get(key);
          if (!raw) return null;
          const msg = JSON.parse(raw);
          // Return snippet (no full body in list view)
          // Use body_preview if available (avoids decryption cost); fall back for legacy messages
          const snippet = msg.body_preview !== undefined
            ? msg.body_preview
            : (msg.body_encrypted ? '[encrypted]' : (msg.body || '').substring(0, 120).replace(/\n/g, ' '));
          const entry = {
            message_id: msg.message_id,
            message_id_url: encodeURIComponent(msg.message_id || ''),
            from: msg.from,
            to: msg.to,
            subject: msg.subject,
            snippet,
            received_at: msg.received_at,
            read: msg.read,
          };
          if (msg.e2e_encrypted) entry.e2e_encrypted = true;
          return entry;
        })
      );

      const filtered = messages.filter(Boolean);
      return json({ messages: filtered, has_more: hasMore, count: filtered.length, address });
    }

    // GET /v1/email/messages/:id?address=agent@agentlair.dev
    if (path.startsWith('/v1/email/messages/') && method === 'GET') {
      const msgId = decodeURIComponent(path.replace('/v1/email/messages/', ''));
      const address = url.searchParams.get('address');

      if (!address || !msgId) {
        return err('address and message_id required.', 400, 'missing_params');
      }

      if (!env.EMAILS) {
        return err('Email storage not available.', 503, 'email_unavailable');
      }

      // Verify ownership — prevents IDOR (any authenticated user reading any inbox)
      const ownerKey = `email-owner:${address}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      if (!currentOwner || currentOwner !== account.id) {
        return err('Address not owned by this account.', 403, 'forbidden');
      }

      // Find message by scanning index and matching message_id
      const indexKey = `index:${address}`;
      const indexRaw = await env.EMAILS.get(indexKey);
      if (!indexRaw) return err('No inbox found for this address.', 404, 'not_found');

      const index = JSON.parse(indexRaw);
      // Scan each message and match by message_id (or normalized variant)
      const normalizedQuery = msgId.replace(/[<>]/g, '').trim();
      let foundKey = null;
      let foundMsg = null;
      for (const key of index.slice(0, 50)) {
        const raw = await env.EMAILS.get(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const normalizedStored = (parsed.message_id || '').replace(/[<>]/g, '').trim();
        if (normalizedStored === normalizedQuery || parsed.message_id === msgId) {
          foundKey = key;
          foundMsg = parsed;
          break;
        }
      }

      if (!foundMsg) return err('Message not found.', 404, 'not_found');
      const msgKey = foundKey;

      const msg = foundMsg;

      // Mark as read
      msg.read = true;
      await env.EMAILS.put(msgKey, JSON.stringify(msg), { expirationTtl: 30 * 24 * 3600 });

      // E2E encrypted: return raw ciphertext + ephemeral key for client-side decryption
      if (msg.e2e_encrypted) {
        return json({
          ...msg,
          body_preview: undefined,
          // body, ephemeral_public_key, e2e_encrypted remain as-is for client SDK
        });
      }

      // Platform-encrypted: decrypt server-side before returning
      const plainBody = await decryptEmailField(env, msg.body, msg.body_encrypted);
      return json({ ...msg, body: plainBody, body_encrypted: undefined, body_preview: undefined });
    }

    // DELETE /v1/email/messages/:id?address={addr} — delete a message (owner only)
    if (path.startsWith('/v1/email/messages/') && method === 'DELETE') {
      const msgId = decodeURIComponent(path.replace('/v1/email/messages/', ''));
      const address = url.searchParams.get('address');

      if (!address || !msgId) {
        return err('address and message_id required.', 400, 'missing_params');
      }
      if (!env.EMAILS) {
        return err('Email storage not available.', 503, 'email_unavailable');
      }

      // Verify ownership
      const ownerKey = `email-owner:${address}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      if (!currentOwner || currentOwner !== account.id) {
        return err('Address not owned by this account.', 403, 'forbidden');
      }

      // Find message key in index
      const indexKey = `index:${address}`;
      const indexRaw = await env.EMAILS.get(indexKey);
      if (!indexRaw) return err('No inbox found for this address.', 404, 'not_found');

      const index = JSON.parse(indexRaw);
      const normalizedQuery = msgId.replace(/[<>]/g, '').trim();
      let foundKey = null;
      for (const key of index.slice(0, 100)) {
        const raw = await env.EMAILS.get(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const normalizedStored = (parsed.message_id || '').replace(/[<>]/g, '').trim();
        if (normalizedStored === normalizedQuery || parsed.message_id === msgId) {
          foundKey = key;
          break;
        }
      }

      if (!foundKey) return err('Message not found.', 404, 'not_found');

      // Delete message and remove from index
      await env.EMAILS.delete(foundKey);
      const newIndex = index.filter(k => k !== foundKey);
      await env.EMAILS.put(indexKey, JSON.stringify(newIndex), { expirationTtl: 30 * 24 * 3600 });

      return json({ deleted: true, message_id: msgId });
    }

    // PATCH /v1/email/messages/:id?address={addr} — update message (mark read/unread)
    if (path.startsWith('/v1/email/messages/') && method === 'PATCH') {
      const msgId = decodeURIComponent(path.replace('/v1/email/messages/', ''));
      const address = url.searchParams.get('address');
      let body = {};
      try { body = await request.json(); } catch {}

      if (!address || !msgId) {
        return err('address and message_id required.', 400, 'missing_params');
      }
      if (!env.EMAILS) {
        return err('Email storage not available.', 503, 'email_unavailable');
      }

      // Verify ownership
      const ownerKey = `email-owner:${address}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      if (!currentOwner || currentOwner !== account.id) {
        return err('Address not owned by this account.', 403, 'forbidden');
      }

      // Find message in index
      const indexKey = `index:${address}`;
      const indexRaw = await env.EMAILS.get(indexKey);
      if (!indexRaw) return err('No inbox found.', 404, 'not_found');

      const index = JSON.parse(indexRaw);
      const normalizedQuery = msgId.replace(/[<>]/g, '').trim();
      let foundKey = null;
      let foundMsg = null;
      for (const key of index.slice(0, 100)) {
        const raw = await env.EMAILS.get(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const normalizedStored = (parsed.message_id || '').replace(/[<>]/g, '').trim();
        if (normalizedStored === normalizedQuery || parsed.message_id === msgId) {
          foundKey = key;
          foundMsg = parsed;
          break;
        }
      }

      if (!foundMsg) return err('Message not found.', 404, 'not_found');

      // Apply patch fields
      if (typeof body.read === 'boolean') foundMsg.read = body.read;

      await env.EMAILS.put(foundKey, JSON.stringify(foundMsg), { expirationTtl: 30 * 24 * 3600 });
      return json({ updated: true, message_id: msgId, read: foundMsg.read });
    }

    // GET /v1/email/addresses — list @agentlair.dev addresses claimed by this account
    if (path === '/v1/email/addresses' && method === 'GET') {
      if (!env.EMAILS) {
        return err('Email storage not available.', 503, 'email_unavailable');
      }

      // Scan email-owner keys and filter to this account
      const list = await env.EMAILS.list({ prefix: 'email-owner:' });
      const myAddresses = [];
      for (const k of list.keys) {
        const owner = await env.EMAILS.get(k.name);
        if (owner === account.id) {
          myAddresses.push(k.name.replace('email-owner:', ''));
        }
      }

      return json({
        addresses: myAddresses,
        count: myAddresses.length,
        note: 'Claimed @agentlair.dev addresses for your account. Any address is available — first-touch registers it.',
        how_to_claim: 'GET /v1/email/inbox?address=yourname@agentlair.dev auto-claims on first access. Or POST /v1/email/claim {"address":"..."} to reserve before emails arrive.',
      });
    }

    // GET /v1/email/outbox?limit=20 — list sent messages for this account
    if (path === '/v1/email/outbox' && method === 'GET') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

      if (!env.EMAILS) {
        return err('Email storage not available.', 503, 'email_unavailable');
      }

      // Outbox keys: outbox:{account_id}:{timestamp}:{msgId} — scoped per account
      const list = await env.EMAILS.list({ prefix: `outbox:${account.id}:`, limit });
      const entries = await Promise.all(
        list.keys.map(async (k) => {
          const raw = await env.EMAILS.get(k.name);
          if (!raw) return null;
          const entry = JSON.parse(raw);
          return {
            id: entry.id,
            from: entry.from,
            to: entry.to,
            subject: entry.subject,
            status: entry.status,
            queued_at: entry.queued_at,
            sent_at: entry.sent_at || null,
            provider_id: entry.provider_id || null,
            error: entry.error || null,
          };
        })
      );

      const filtered = entries.filter(Boolean).sort((a, b) =>
        new Date(b.queued_at) - new Date(a.queued_at)
      );

      return json({
        messages: filtered,
        count: filtered.length,
        has_more: list.list_complete === false,
      });
    }

    // POST /v1/email/send — send email from an @agentlair.dev address
    if (path === '/v1/email/send' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {
        return err('Invalid JSON body', 400, 'invalid_body');
      }

      const { from, to, subject, text, html: htmlBody, in_reply_to } = body;

      // Validate required fields
      if (!from || !to || !subject || (!text && !htmlBody)) {
        return err('Required: from, to, subject, and text or html', 400, 'missing_fields');
      }

      // Validate from is @agentlair.dev
      const fromAddr = String(from);
      if (!fromAddr.endsWith('@agentlair.dev') && !fromAddr.match(/<[^>]+@agentlair\.dev>/)) {
        return err('Sender must be an @agentlair.dev address', 403, 'invalid_sender');
      }

      // Verify the authenticated account owns this sender address
      const normalizedFromAddr = fromAddr.match(/<([^>]+)>/) ? fromAddr.match(/<([^>]+)>/)[1] : fromAddr;
      const addrOwner = await env.EMAILS.get(`email-owner:${normalizedFromAddr}`);
      if (!addrOwner || addrOwner !== account.id) {
        return err('You do not own this sender address. Claim it first via POST /v1/email/claim.', 403, 'not_your_address');
      }

      // Email-specific rate limit check (separate from general API rate limit)
      const emailRateCheck = await checkEmailRateLimit(env, account.id, account.tier, fromAddr);
      if (!emailRateCheck.allowed) {
        const status = emailRateCheck.reason === 'address_suspended' ? 403 : 429;
        const retryAfter = emailRateCheck.reset_at
          ? String(Math.max(1, Math.floor((new Date(emailRateCheck.reset_at) - Date.now()) / 1000)))
          : '60';
        return new Response(JSON.stringify({
          error: emailRateCheck.reason,
          message: emailRateCheck.upgrade_hint || `Email rate limit exceeded (${emailRateCheck.reason}).`,
          limit: emailRateCheck.limit,
          reset_at: emailRateCheck.reset_at,
          upgrade_url: 'https://agentlair.dev/pricing',
        }), {
          status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-RateLimit-Limit': String(emailRateCheck.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': emailRateCheck.reset_at || '',
            'Retry-After': retryAfter,
          },
        });
      }

      // Normalize to array
      const toAddrs = Array.isArray(to) ? to : [to];
      if (toAddrs.length === 0) {
        return err('to must be a non-empty email address or array', 400, 'invalid_to');
      }

      const msgId = 'out_' + nanoid(16);
      const outboxTs = Date.now();
      const now = new Date(outboxTs).toISOString();
      // Key includes account_id to scope outbox per account, and fixed timestamp to prevent duplicate entries
      const outboxKey = `outbox:${account.id}:${outboxTs}:${msgId}`;

      // Store in KV outbox for audit trail
      const outboxEntry = {
        id: msgId,
        from: fromAddr,
        to: toAddrs,
        subject,
        text: text || null,
        html: htmlBody || null,
        in_reply_to: in_reply_to || null,
        queued_at: now,
        status: 'pending',
      };

      if (env.EMAILS) {
        await env.EMAILS.put(outboxKey, JSON.stringify(outboxEntry), {
          expirationTtl: 30 * 24 * 3600,
        });
      }

      // Dispatch to swappable email provider
      const provider = getEmailProvider(env);
      if (!provider) {
        return json({
          id: msgId,
          status: 'queued',
          warning: 'No email provider configured. Message stored in outbox but not sent.',
          setup: 'Set RESEND_API_KEY in Worker environment variables. See agentlair.dev/docs/email.',
        }, 202);
      }

      try {
        const result = await provider.send({
          from: fromAddr,
          to: toAddrs,
          subject,
          text: text || undefined,
          html: htmlBody || undefined,
          in_reply_to: in_reply_to || undefined,
        }, env);

        // Success — update outbox entry (same key as pending write)
        if (env.EMAILS) {
          outboxEntry.status = 'sent';
          outboxEntry.sent_at = new Date().toISOString();
          outboxEntry.provider = provider.name;
          outboxEntry.provider_id = result.provider_id;
          await env.EMAILS.put(outboxKey, JSON.stringify(outboxEntry), {
            expirationTtl: 30 * 24 * 3600,
          });
        }

        // Track sent stats (non-blocking)
        if (env.EMAILS) ctx.waitUntil(recordEmailSent(env, fromAddr));

        return json({
          id: msgId,
          provider_id: result.provider_id,
          provider: provider.name,
          status: 'sent',
          from: fromAddr,
          to: toAddrs,
          subject,
          sent_at: outboxEntry.sent_at,
          rate_limit: {
            daily_remaining: emailRateCheck.daily_remaining,
            hourly_remaining: emailRateCheck.hourly_remaining,
            reset_at: emailRateCheck.reset_at,
          },
        }, 201);

      } catch (e) {
        if (env.EMAILS) {
          outboxEntry.status = 'failed';
          outboxEntry.error = e.message;
          outboxEntry.error_at = new Date().toISOString();
          await env.EMAILS.put(outboxKey, JSON.stringify(outboxEntry), {
            expirationTtl: 30 * 24 * 3600,
          });
          // Track bounce if provider error suggests delivery failure
          if (e.message.toLowerCase().includes('bounce') || e.message.toLowerCase().includes('invalid') || e.message.toLowerCase().includes('reject')) {
            ctx.waitUntil(recordEmailBounce(env, fromAddr));
          }
        }
        return err(`Send failed: ${e.message}`, 502, 'send_failed');
      }
    }

    // ── Webhook routes ────────────────────────────────────────────────────────

    // POST /v1/email/webhooks — register a webhook for an address
    if (path === '/v1/email/webhooks' && method === 'POST') {
      if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

      let body = {};
      try { body = await request.json(); } catch {}

      const { address, url: webhookUrl, secret } = body;

      if (!address || !webhookUrl) {
        return err('address and url are required.', 400, 'missing_params');
      }
      if (!address.endsWith('@agentlair.dev')) {
        return err('Only @agentlair.dev addresses are supported.', 400, 'invalid_address');
      }
      try { new URL(webhookUrl); } catch {
        return err('url must be a valid URL (https://...).', 400, 'invalid_url');
      }

      // Verify address ownership
      const ownerKey = `email-owner:${address}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      if (currentOwner && currentOwner !== account.id) {
        return err('This address belongs to another account.', 403, 'address_not_yours');
      }

      const id = `wh_${nanoid(16)}`;
      const hookObj = {
        id,
        account_id: account.id,
        address,
        url: webhookUrl,
        secret: secret || null,
        created_at: new Date().toISOString(),
      };

      // Store webhook config (1 year TTL)
      await env.EMAILS.put(`webhook:${id}`, JSON.stringify(hookObj), { expirationTtl: 365 * 24 * 3600 });

      // Update address → webhook index (for fast inbound delivery lookup)
      const addrIndexKey = `webhook-addr:${address}`;
      let addrIndex = [];
      try {
        const raw = await env.EMAILS.get(addrIndexKey);
        if (raw) addrIndex = JSON.parse(raw);
      } catch {}
      if (!addrIndex.includes(id)) addrIndex.push(id);
      await env.EMAILS.put(addrIndexKey, JSON.stringify(addrIndex), { expirationTtl: 365 * 24 * 3600 });

      // Update account → webhook index (for listing)
      const acctIndexKey = `account-webhooks:${account.id}`;
      let acctIndex = [];
      try {
        const raw = await env.EMAILS.get(acctIndexKey);
        if (raw) acctIndex = JSON.parse(raw);
      } catch {}
      if (!acctIndex.includes(id)) acctIndex.push(id);
      await env.EMAILS.put(acctIndexKey, JSON.stringify(acctIndex), { expirationTtl: 365 * 24 * 3600 });

      return json({
        id,
        address,
        url: webhookUrl,
        has_secret: !!secret,
        signature_header: 'X-AgentLair-Signature',
        signature_format: 'sha256=<hmac-sha256-hex-of-json-body>',
        events: ['email.received'],
        created_at: hookObj.created_at,
        note: 'AgentLair will POST email.received events to your URL within seconds of inbound delivery.',
      }, 201);
    }

    // GET /v1/email/webhooks?address={addr} — list webhooks for this account
    if (path === '/v1/email/webhooks' && method === 'GET') {
      if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

      const filterAddress = url.searchParams.get('address');

      const acctIndexKey = `account-webhooks:${account.id}`;
      const acctIndexRaw = await env.EMAILS.get(acctIndexKey);
      if (!acctIndexRaw) return json({ webhooks: [], count: 0 });

      const ids = JSON.parse(acctIndexRaw);
      const hooks = (await Promise.all(ids.map(async (wid) => {
        const raw = await env.EMAILS.get(`webhook:${wid}`);
        if (!raw) return null;
        const h = JSON.parse(raw);
        return {
          id: h.id,
          address: h.address,
          url: h.url,
          has_secret: !!h.secret,
          events: ['email.received'],
          created_at: h.created_at,
        };
      }))).filter(Boolean);

      const filtered = filterAddress ? hooks.filter(h => h.address === filterAddress) : hooks;
      return json({ webhooks: filtered, count: filtered.length });
    }

    // DELETE /v1/email/webhooks/:id — remove a webhook
    if (path.startsWith('/v1/email/webhooks/') && method === 'DELETE') {
      if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');

      const hookId = path.replace('/v1/email/webhooks/', '');
      if (!hookId) return err('Webhook ID required.', 400, 'missing_params');

      const hookRaw = await env.EMAILS.get(`webhook:${hookId}`);
      if (!hookRaw) return err('Webhook not found.', 404, 'not_found');

      const hook = JSON.parse(hookRaw);
      if (hook.account_id !== account.id) return err('Not your webhook.', 403, 'forbidden');

      // Delete webhook config
      await env.EMAILS.delete(`webhook:${hookId}`);

      // Remove from address index
      try {
        const addrIndexKey = `webhook-addr:${hook.address}`;
        const raw = await env.EMAILS.get(addrIndexKey);
        if (raw) {
          const ids = JSON.parse(raw).filter(wid => wid !== hookId);
          await env.EMAILS.put(addrIndexKey, JSON.stringify(ids), { expirationTtl: 365 * 24 * 3600 });
        }
      } catch {}

      // Remove from account index
      try {
        const acctIndexKey = `account-webhooks:${account.id}`;
        const raw = await env.EMAILS.get(acctIndexKey);
        if (raw) {
          const ids = JSON.parse(raw).filter(wid => wid !== hookId);
          await env.EMAILS.put(acctIndexKey, JSON.stringify(ids), { expirationTtl: 365 * 24 * 3600 });
        }
      } catch {}

      return json({ deleted: true, id: hookId });
    }

    // Catch other /v1/email/* routes
    if (path.startsWith('/v1/email')) {
      return json({
        available: [
          'POST /v1/email/claim — register an @agentlair.dev address to your account',
          'GET /v1/email/addresses — list your claimed addresses',
          'GET /v1/email/inbox?address={addr}&limit={n} — read inbox (auto-claims on first access)',
          'GET /v1/email/messages/{id}?address={addr} — read + mark as read',
          'PATCH /v1/email/messages/{id}?address={addr} — update (body: {"read":true})',
          'DELETE /v1/email/messages/{id}?address={addr} — delete message',
          'POST /v1/email/send — send from @agentlair.dev address',
          'GET /v1/email/outbox?limit={n} — list sent messages',
          'POST /v1/email/webhooks — register webhook for real-time email notifications',
          'GET /v1/email/webhooks?address={addr} — list webhooks for your account',
          'DELETE /v1/email/webhooks/{id} — remove a webhook',
        ],
        note: 'Any @agentlair.dev address works without pre-provisioning. First access auto-registers ownership.',
      }, 200);
    }

    // ── API v0.2 — /v1/inbox/* routes ────────────────────────────────────────

    // POST /v1/inbox — create inbox (optional body: {name: "alice"})
    if (path === '/v1/inbox' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      // Generate address: use provided name or random memorable slug
      const slug = body.name || nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, 'x');
      const address = slug.includes('@') ? slug : `${slug}@agentlair.dev`;
      if (!address.endsWith('@agentlair.dev')) {
        return err('Only @agentlair.dev addresses can be created.', 400, 'invalid_address');
      }
      if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');
      if (isReservedAddress(address)) return err('This address is reserved and cannot be claimed.', 403, 'address_reserved');
      const ownerKey = `email-owner:${address}`;
      const currentOwner = await env.EMAILS.get(ownerKey);
      if (currentOwner && currentOwner !== account.id) {
        return err('Address already claimed by another account.', 409, 'address_taken');
      }
      if (!currentOwner) await env.EMAILS.put(ownerKey, account.id);
      return json({ address, created: true, already_owned: !!currentOwner, account_id: account.id }, currentOwner ? 200 : 201);
    }

    // GET /v1/inbox/{address} — list messages (alias for /v1/email/inbox?address=)
    // GET /v1/inbox/{address}/messages/{id} — read message
    // POST /v1/inbox/{address}/send — send from this address
    const inboxMatch = path.match(/^\/v1\/inbox\/([^/]+@agentlair\.dev)(\/.*)?$/);
    if (inboxMatch) {
      const inboxAddr = decodeURIComponent(inboxMatch[1]);
      const subPath = inboxMatch[2] || '';

      if (method === 'GET' && subPath === '') {
        // List messages — same logic as /v1/email/inbox
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
        const unreadOnly = url.searchParams.get('unread') === 'true';
        if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');
        const ownerKey = `email-owner:${inboxAddr}`;
        const currentOwner = await env.EMAILS.get(ownerKey);
        if (!currentOwner) {
          if (isReservedAddress(inboxAddr)) return err('This address is reserved and cannot be claimed.', 403, 'address_reserved');
          await env.EMAILS.put(ownerKey, account.id);
        } else if (currentOwner !== account.id) return err('This address belongs to another account.', 403, 'address_not_yours');
        const indexKey = `index:${inboxAddr}`;
        const indexRaw = await env.EMAILS.get(indexKey);
        if (!indexRaw) return json({ messages: [], total: 0, address: inboxAddr });
        const index = JSON.parse(indexRaw);
        const pageKeys = index.slice(0, limit);
        const messages = (await Promise.all(pageKeys.map(async (key) => {
          const raw = await env.EMAILS.get(key);
          if (!raw) return null;
          const msg = JSON.parse(raw);
          if (unreadOnly && msg.read) return null;
          const preview = msg.body_preview !== undefined
            ? msg.body_preview
            : (msg.body_encrypted ? '[encrypted]' : (msg.body || '').substring(0, 120).replace(/\n/g, ' '));
          return { id: msg.message_id, from: msg.from, subject: msg.subject, preview, received_at: msg.received_at, read: !!msg.read };
        }))).filter(Boolean);
        return json({ messages, total: messages.length, address: inboxAddr });
      }

      const msgMatch = subPath.match(/^\/messages\/(.+)$/);
      if (method === 'GET' && msgMatch) {
        // Read message — same logic as /v1/email/messages/:id
        const msgId = decodeURIComponent(msgMatch[1]);
        if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');
        const ownerKey = `email-owner:${inboxAddr}`;
        const currentOwner = await env.EMAILS.get(ownerKey);
        if (!currentOwner || currentOwner !== account.id) return err('Address not owned by this account.', 403, 'address_not_yours');
        const msgKey = `msg:${inboxAddr}:${msgId}`;
        const raw = await env.EMAILS.get(msgKey);
        if (!raw) return err('Message not found.', 404, 'not_found');
        const msg = JSON.parse(raw);
        if (!msg.read) {
          msg.read = true;
          await env.EMAILS.put(msgKey, JSON.stringify(msg));
        }
        // E2E encrypted: return raw ciphertext + ephemeral key for client-side decryption
        if (msg.e2e_encrypted) {
          return json({
            id: msg.message_id, from: msg.from, to: msg.to, subject: msg.subject,
            body: msg.body,
            e2e_encrypted: true,
            ephemeral_public_key: msg.ephemeral_public_key,
            html: msg.html || null,
            received_at: msg.received_at,
            headers: msg.headers || {},
          });
        }
        // Platform-encrypted: decrypt server-side before returning
        const plainBody = await decryptEmailField(env, msg.body, msg.body_encrypted);
        return json({ id: msg.message_id, from: msg.from, to: msg.to, subject: msg.subject, body: plainBody, html: msg.html || null, received_at: msg.received_at, headers: msg.headers || {} });
      }

      if (method === 'POST' && subPath === '/send') {
        // Send from this address — forward to /v1/email/send logic
        // Reuse existing send handler by rewriting request context
        url.pathname = '/v1/email/send';
        let body = {};
        try { body = await request.json(); } catch {}
        body.from = inboxAddr; // Override from to match inbox address
        // Rebuild request with modified body
        const newReq = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) });
        // Re-route to send handler — reconstruct inline
        const { to, subject, body: emailBody, html, reply_to } = body;
        if (!to || !subject) return err('to and subject required.', 400, 'missing_params');
        if (!env.EMAILS) return err('Email storage not available.', 503, 'email_unavailable');
        const ownerKey = `email-owner:${inboxAddr}`;
        const currentOwner = await env.EMAILS.get(ownerKey);
        if (!currentOwner || currentOwner !== account.id) return err('You do not own this address.', 403, 'address_not_yours');
        // Delegate to Resend
        const resendKey = env.RESEND_API_KEY;
        if (!resendKey) return err('Email sending not configured.', 503, 'send_unavailable');
        try {
          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: inboxAddr, to: Array.isArray(to) ? to : [to], subject, text: emailBody || '', html: html || undefined, reply_to: reply_to || undefined }),
          });
          const result = await resp.json();
          if (!resp.ok) return err(result.message || 'Send failed', resp.status, 'send_failed');
          return json({ sent: true, id: result.id, from: inboxAddr, to, subject }, 200);
        } catch (e) {
          return err(`Send failed: ${e.message}`, 502, 'send_failed');
        }
      }
    }

    // ── Observations (account-scoped with opt-in sharing) ─────────────────────
    // Each observation belongs to an account_id. By default, agents see only their
    // own observations. Set shared: true to make an observation visible to all
    // authenticated agents (cross-agent coordination).

    // POST /v1/observations — write an observation
    if (path === '/v1/observations' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {
        return err('Invalid JSON body.', 400, 'invalid_body');
      }

      const { topic, content } = body;
      const shared = body.shared === true ? 1 : 0;
      if (!topic || !content) {
        return err('Required: topic, content. Optional: shared (bool, default false).', 400, 'missing_fields');
      }
      // Security: bind agent_id to authenticated account — prevents impersonation
      const agent_id = account.id;
      if (typeof content !== 'string' || content.length > 10000) {
        return err('content must be a string, max 10,000 characters.', 400, 'invalid_content');
      }

      try {
        const id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map(b => b.toString(16).padStart(2, '0')).join('');
        const created_at = new Date().toISOString();

        await tursoExecute(env,
          'INSERT INTO shared_observations (id, agent_id, topic, content, created_at, account_id, shared) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, agent_id, topic, content, created_at, account.id, String(shared)]
        );

        return json({ id, agent_id, topic, shared: !!shared, created_at }, 201);
      } catch (e) {
        return err(`Failed to write observation: ${e.message}`, 502, 'turso_error');
      }
    }

    // GET /v1/observations — read observations (own + shared by default)
    if (path === '/v1/observations' && method === 'GET') {
      const topic = url.searchParams.get('topic');
      const agent_id = url.searchParams.get('agent_id');
      const since = url.searchParams.get('since');
      const scope = url.searchParams.get('scope') || 'all'; // mine | shared | all
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

      const conditions = [];
      const args = [];

      // Visibility scoping: mine = own account only, shared = shared only, all = both
      if (scope === 'mine') {
        conditions.push('account_id = ?');
        args.push(account.id);
      } else if (scope === 'shared') {
        conditions.push('shared = 1');
      } else {
        // Default: own observations + any shared observations
        conditions.push('(account_id = ? OR shared = 1)');
        args.push(account.id);
      }

      if (topic) { conditions.push('topic = ?'); args.push(topic); }
      if (agent_id) { conditions.push('agent_id = ?'); args.push(agent_id); }
      if (since) { conditions.push('created_at >= ?'); args.push(since); }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      args.push(String(limit));

      try {
        const result = await tursoExecute(env,
          `SELECT id, agent_id, topic, content, created_at, shared FROM shared_observations ${where} ORDER BY created_at DESC LIMIT ?`,
          args
        );

        // Normalize shared field to boolean in response
        const observations = result.rows.map(r => ({ ...r, shared: r.shared === '1' || r.shared === 1 }));

        return json({
          observations,
          count: observations.length,
          filters: { topic: topic || null, agent_id: agent_id || null, since: since || null, scope, limit },
        });
      } catch (e) {
        return err(`Failed to read observations: ${e.message}`, 502, 'turso_error');
      }
    }

    // GET /v1/observations/topics — list distinct topics (own + shared)
    if (path === '/v1/observations/topics' && method === 'GET') {
      try {
        const result = await tursoExecute(env,
          'SELECT topic, COUNT(*) as count, MAX(created_at) as latest FROM shared_observations WHERE account_id = ? OR shared = 1 GROUP BY topic ORDER BY latest DESC',
          [account.id]
        );
        return json({ topics: result.rows, count: result.rows.length });
      } catch (e) {
        return err(`Failed to list topics: ${e.message}`, 502, 'turso_error');
      }
    }

    // Catch other /v1/observations/* routes
    if (path.startsWith('/v1/observations')) {
      return json({
        available: [
          'POST /v1/observations — write an observation (body: {agent_id, topic, content, shared?})',
          'GET /v1/observations?topic=X&agent_id=Y&since=ISO&scope=all|mine|shared&limit=N',
          'GET /v1/observations/topics — list distinct topics (own + shared)',
        ],
        note: 'Observations are account-scoped by default. Set shared: true when writing to make visible to all agents. Read with scope=mine|shared|all (default: all = own + shared).',
      }, 200);
    }

    // ── Vault v2: Versioned Zero-Knowledge Secret Store ─────────────────────
    // Design: Client encrypts blobs before storing. Server stores opaque blobs per account.
    // Keys are scoped to the account — no cross-account access.
    // Namespace: VAULT KV (separate from KEYS to isolate auth data from blob data).
    //
    // Storage format (v2):
    //   vault:{accountId}:{key}:latest  → version number (integer)
    //   vault:{accountId}:{key}:{ver}   → { ciphertext, metadata, created_at }
    //   vault-index:{accountId}         → [{ key, version, metadata, created_at, updated_at }]
    //
    // Backward compat: reads fall back to old kv:{accountId}:{key} format.

    const VAULT_LIMITS = {
      free:  { max_keys: 10, max_versions: 3, max_blob_size: 16384 },   // 16 KB
      paid:  { max_keys: 999999, max_versions: 100, max_blob_size: 65536 }, // 64 KB
    };

    // POST /v1/vault/recovery-email — register recovery email + encrypted seed for this account
    // Must come before wildcard key match to avoid treating "recovery-email" as a key.
    if (path === '/v1/vault/recovery-email' && method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const recoveryEmail = (body.email || '').toLowerCase().trim();
      const encryptedSeed = body.encrypted_seed;

      if (!recoveryEmail || !recoveryEmail.includes('@')) {
        return err('email required (valid email address)', 400, 'invalid_email');
      }
      if (!encryptedSeed || typeof encryptedSeed !== 'string') {
        return err('encrypted_seed required (base64 or hex encoded ciphertext)', 400, 'invalid_encrypted_seed');
      }
      if (encryptedSeed.length > 100000) {
        return err('encrypted_seed too large (max 100KB)', 400, 'payload_too_large');
      }

      const storedAt = new Date().toISOString();
      const recoveryKey = 'recovery:' + account.id;
      await env.VAULT.put(recoveryKey, JSON.stringify({
        email: recoveryEmail,
        encrypted_seed: encryptedSeed,
        stored_at: storedAt,
      }));

      // Also index by email hash so recovery flow can look up by email
      const emailHash = await sha256hex(recoveryEmail);
      const emailIndexKey = 'recovery-idx:' + emailHash;
      const existingIdx = await env.VAULT.get(emailIndexKey);
      const accountIds = existingIdx ? JSON.parse(existingIdx) : [];
      if (!accountIds.includes(account.id)) {
        accountIds.push(account.id);
        await env.VAULT.put(emailIndexKey, JSON.stringify(accountIds));
      }

      return json({
        ok: true,
        email: recoveryEmail,
        stored_at: storedAt,
        note: 'Recovery email registered. Your encrypted seed can be recovered via POST /v1/vault/recover using this email.',
      });
    }

    // GET /v1/vault/ — list all vault keys (metadata only, never ciphertext)
    if ((path === '/v1/vault' || path === '/v1/vault/') && method === 'GET') {
      const limits = VAULT_LIMITS[account.tier] || VAULT_LIMITS.free;
      const indexKey = 'vault-index:' + account.id;
      const indexRaw = await env.VAULT.get(indexKey);
      const keys = indexRaw ? JSON.parse(indexRaw) : [];
      return json({
        keys,
        count: keys.length,
        limit: limits.max_keys,
        tier: account.tier,
      });
    }

    // Vault key routes — match /v1/vault/{key} where key is 1-128 url-safe chars
    const vaultKeyMatch = path.match(/^\/v1\/vault\/([A-Za-z0-9_\-.]{1,128})$/);
    if (vaultKeyMatch) {
      const vaultKey = vaultKeyMatch[1];
      const limits = VAULT_LIMITS[account.tier] || VAULT_LIMITS.free;
      const indexKey = 'vault-index:' + account.id;
      const latestKey = 'vault:' + account.id + ':' + vaultKey + ':latest';

      // Helper: read the vault index
      async function getVaultIndex() {
        const raw = await env.VAULT.get(indexKey);
        return raw ? JSON.parse(raw) : [];
      }

      // Helper: save the vault index
      async function saveVaultIndex(idx) {
        await env.VAULT.put(indexKey, JSON.stringify(idx));
      }

      // PUT /v1/vault/{key} — store an encrypted blob (versioned, append-only)
      if (method === 'PUT') {
        let body = {};
        try { body = await request.json(); } catch {}

        // Accept both 'ciphertext' (v2) and 'value' (v1 compat) fields
        const ciphertext = body.ciphertext || body.value;
        const metadata = body.metadata || null;

        if (ciphertext === undefined || ciphertext === null) {
          return err('ciphertext required in request body: {"ciphertext": "<encrypted_blob>"}. Also accepts "value" for backward compatibility.', 400, 'invalid_ciphertext');
        }
        if (typeof ciphertext !== 'string') {
          return err('ciphertext must be a string (base64url or hex encoded)', 400, 'invalid_ciphertext');
        }
        if (ciphertext.length > limits.max_blob_size) {
          const maxKB = Math.round(limits.max_blob_size / 1024);
          return err('ciphertext too large (max ' + maxKB + 'KB on ' + account.tier + ' tier)', 400, 'payload_too_large');
        }
        if (metadata !== null && typeof metadata !== 'object') {
          return err('metadata must be an object (or omitted)', 400, 'invalid_metadata');
        }
        if (metadata && JSON.stringify(metadata).length > 4096) {
          return err('metadata too large (max 4KB)', 400, 'metadata_too_large');
        }

        const now = new Date().toISOString();

        // Get current version (0 if key doesn't exist yet)
        const latestRaw = await env.VAULT.get(latestKey);
        const currentVersion = latestRaw ? parseInt(latestRaw) : 0;
        const isNew = currentVersion === 0;

        // Tier limit: check key count for new keys
        if (isNew) {
          const index = await getVaultIndex();
          if (index.length >= limits.max_keys) {
            return err('Vault key limit reached (' + limits.max_keys + ' keys on ' + account.tier + ' tier). Delete unused keys or upgrade.', 403, 'vault_limit_reached');
          }
        }

        const newVersion = currentVersion + 1;
        const versionKey = 'vault:' + account.id + ':' + vaultKey + ':' + newVersion;

        // Store versioned entry
        await env.VAULT.put(versionKey, JSON.stringify({
          ciphertext,
          metadata,
          created_at: now,
        }));

        // Update latest pointer
        await env.VAULT.put(latestKey, String(newVersion));

        // Prune old versions beyond tier limit
        if (newVersion > limits.max_versions) {
          const pruneVersion = newVersion - limits.max_versions;
          const pruneKey = 'vault:' + account.id + ':' + vaultKey + ':' + pruneVersion;
          await env.VAULT.delete(pruneKey);
        }

        // Update the index
        const index = await getVaultIndex();
        const existingIdx = index.findIndex(e => e.key === vaultKey);
        const createdAt = isNew ? now : (existingIdx >= 0 ? index[existingIdx].created_at : now);
        const indexEntry = {
          key: vaultKey,
          version: newVersion,
          metadata: metadata || (existingIdx >= 0 ? index[existingIdx].metadata : null),
          created_at: createdAt,
          updated_at: now,
        };
        if (existingIdx >= 0) {
          index[existingIdx] = indexEntry;
        } else {
          index.push(indexEntry);
        }
        await saveVaultIndex(index);

        return json({
          key: vaultKey,
          stored: true,
          version: newVersion,
          created_at: createdAt,
          updated_at: now,
        }, isNew ? 201 : 200);
      }

      // GET /v1/vault/{key} — retrieve an encrypted blob
      if (method === 'GET') {
        const url = new URL(request.url);
        const requestedVersion = url.searchParams.get('version');

        // Try v2 format first
        const latestRaw = await env.VAULT.get(latestKey);
        if (latestRaw) {
          const latestVersion = parseInt(latestRaw);
          const version = requestedVersion ? parseInt(requestedVersion) : latestVersion;
          if (isNaN(version) || version < 1) {
            return err('Invalid version number', 400, 'invalid_version');
          }
          const versionKey = 'vault:' + account.id + ':' + vaultKey + ':' + version;
          const raw = await env.VAULT.get(versionKey);
          if (!raw) {
            return err('Version ' + version + ' not found (may have been pruned). Latest: ' + latestVersion, 404, 'version_not_found');
          }
          const entry = JSON.parse(raw);

          // Get created_at from index for the key overall
          const index = await getVaultIndex();
          const idxEntry = index.find(e => e.key === vaultKey);

          return json({
            key: vaultKey,
            ciphertext: entry.ciphertext,
            value: entry.ciphertext, // v1 compat
            metadata: entry.metadata,
            version,
            latest_version: latestVersion,
            created_at: idxEntry ? idxEntry.created_at : entry.created_at,
            updated_at: entry.created_at,
          });
        }

        // Backward compat: try old kv: format
        const oldKvKey = 'kv:' + account.id + ':' + vaultKey;
        const oldRaw = await env.VAULT.get(oldKvKey);
        if (oldRaw) {
          const entry = JSON.parse(oldRaw);
          return json({
            key: vaultKey,
            ciphertext: entry.value,
            value: entry.value, // v1 compat
            metadata: null,
            version: 1,
            latest_version: 1,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            _migrated: false,
          });
        }

        return err('Key not found', 404, 'not_found');
      }

      // DELETE /v1/vault/{key} — delete a secret
      if (method === 'DELETE') {
        const url = new URL(request.url);
        const requestedVersion = url.searchParams.get('version');

        // Check v2 format
        const latestRaw = await env.VAULT.get(latestKey);

        if (latestRaw) {
          const latestVersion = parseInt(latestRaw);

          if (requestedVersion) {
            // Delete single version
            const version = parseInt(requestedVersion);
            if (isNaN(version) || version < 1) {
              return err('Invalid version number', 400, 'invalid_version');
            }
            const versionKey = 'vault:' + account.id + ':' + vaultKey + ':' + version;
            const raw = await env.VAULT.get(versionKey);
            if (!raw) {
              return err('Version ' + version + ' not found', 404, 'version_not_found');
            }
            await env.VAULT.delete(versionKey);

            // If we deleted the latest, find new latest
            if (version === latestVersion) {
              let newLatest = latestVersion - 1;
              while (newLatest > 0) {
                const checkKey = 'vault:' + account.id + ':' + vaultKey + ':' + newLatest;
                const exists = await env.VAULT.get(checkKey);
                if (exists) break;
                newLatest--;
              }
              if (newLatest > 0) {
                await env.VAULT.put(latestKey, String(newLatest));
                // Update index
                const index = await getVaultIndex();
                const idx = index.findIndex(e => e.key === vaultKey);
                if (idx >= 0) {
                  index[idx].version = newLatest;
                  index[idx].updated_at = new Date().toISOString();
                  await saveVaultIndex(index);
                }
              } else {
                // All versions deleted — clean up
                await env.VAULT.delete(latestKey);
                const index = await getVaultIndex();
                await saveVaultIndex(index.filter(e => e.key !== vaultKey));
              }
            }

            return json({ key: vaultKey, deleted: true, version_removed: version });
          }

          // Delete all versions
          const deletePromises = [];
          for (let v = 1; v <= latestVersion; v++) {
            deletePromises.push(env.VAULT.delete('vault:' + account.id + ':' + vaultKey + ':' + v));
          }
          deletePromises.push(env.VAULT.delete(latestKey));
          await Promise.all(deletePromises);

          // Update index
          const index = await getVaultIndex();
          await saveVaultIndex(index.filter(e => e.key !== vaultKey));

          return json({ key: vaultKey, deleted: true, versions_removed: latestVersion });
        }

        // Backward compat: try old kv: format
        const oldKvKey = 'kv:' + account.id + ':' + vaultKey;
        const oldRaw = await env.VAULT.get(oldKvKey);
        if (oldRaw) {
          await env.VAULT.delete(oldKvKey);
          return json({ key: vaultKey, deleted: true, versions_removed: 1 });
        }

        return err('Key not found', 404, 'not_found');
      }

      return err('Method not allowed. Vault key supports: GET, PUT, DELETE.', 405, 'method_not_allowed');
    }

    // Catch-all for other /v1/vault/* routes
    if (path.startsWith('/v1/vault')) {
      return json({
        available: [
          'GET /v1/vault/ — list all keys (metadata only, no ciphertext)',
          'PUT /v1/vault/{key} — store encrypted blob (body: {ciphertext: string, metadata?: object})',
          'GET /v1/vault/{key} — retrieve encrypted blob (query: ?version=N for specific version)',
          'DELETE /v1/vault/{key} — delete all versions (query: ?version=N for specific version)',
          'POST /v1/vault/recovery-email — register recovery email + encrypted seed',
        ],
        limits: VAULT_LIMITS[account.tier] || VAULT_LIMITS.free,
        tier: account.tier,
        note: 'Zero-knowledge secret store. Client encrypts before storing. Server stores opaque blobs. Version history is append-only.',
      }, 200);
    }

    // ── DNS routes (stubbed) ─────────────────────────────────────────────────

    if (path.startsWith('/v1/dns')) {
      return json({
        error: 'coming_soon',
        message: 'DNS management via Cloudflare API — live Q2 2026.',
        roadmap: 'https://agentlair.dev/roadmap',
      }, 503);
    }

    // ── Hosting routes (stubbed) ─────────────────────────────────────────────

    if (path.startsWith('/v1/hosting')) {
      return json({
        error: 'coming_soon',
        message: 'Static site hosting via Cloudflare Pages — live Q2 2026.',
        roadmap: 'https://agentlair.dev/roadmap',
      }, 503);
    }

    // ── 404 ─────────────────────────────────────────────────────────────────

    return err('Route not found. See GET / for available endpoints.', 404, 'not_found');
  },

  // ─── Cloudflare Email Workers: inbound delivery ───────────────────────────
  // Triggered by Cloudflare Email Routing when an @agentlair.dev message arrives.
  // Stores encrypted message body in EMAILS KV and fires registered webhooks.
  async email(message, env, ctx) {
    try {
      const toAddr = message.to ? message.to.toLowerCase().trim() : null;
      const fromAddr = message.from || '';
      const subject = message.headers.get('Subject') || '';
      const messageId = message.headers.get('Message-ID') || ('inbound_' + nanoid(20));
      const now = new Date().toISOString();

      // Read plain text body (graceful fallback to empty)
      let rawBody = '';
      try { rawBody = await message.getText() || ''; } catch {}

      // Check if recipient has registered an E2E public key
      let e2ePubKey = null;
      if (env.EMAILS && toAddr) {
        try { e2ePubKey = await env.EMAILS.get(`email-pubkey:${toAddr}`); } catch {}
      }

      const msgId = nanoid(16);
      const msgKey = `msg:${toAddr}:${msgId}`;
      let msg;

      if (e2ePubKey && rawBody) {
        // E2E encrypt: only the private key holder can decrypt
        try {
          const { body: e2eBody, ephemeral_public_key } = await encryptEmailE2E(e2ePubKey, rawBody);
          msg = {
            message_id: messageId,
            from: fromAddr,
            to: toAddr,
            subject,
            body: e2eBody,
            body_encrypted: true,
            e2e_encrypted: true,
            ephemeral_public_key,
            // Unencrypted preview (first 120 chars) for fast inbox listing without decryption
            body_preview: rawBody.substring(0, 120).replace(/\n/g, ' '),
            received_at: now,
            read: false,
          };
        } catch {
          // E2E encryption failed — fall back to platform encryption
          e2ePubKey = null;
        }
      }

      if (!msg) {
        // Platform encryption fallback (no E2E key, or E2E encryption failed)
        const { value: encBody, encrypted } = await encryptEmailField(env, rawBody);
        msg = {
          message_id: messageId,
          from: fromAddr,
          to: toAddr,
          subject,
          body: encBody,
          body_encrypted: encrypted,
          // Unencrypted preview (first 120 chars) for fast inbox listing without decryption
          body_preview: rawBody.substring(0, 120).replace(/\n/g, ' '),
          received_at: now,
          read: false,
        };
      }

      if (env.EMAILS) {
        // Store message
        await env.EMAILS.put(msgKey, JSON.stringify(msg), { expirationTtl: 30 * 24 * 3600 });

        // Update address index (newest first)
        const indexKey = `index:${toAddr}`;
        const indexRaw = await env.EMAILS.get(indexKey);
        const index = indexRaw ? JSON.parse(indexRaw) : [];
        index.unshift(msgKey);
        // Cap index at 500 entries to prevent unbounded growth
        const trimmedIndex = index.slice(0, 500);
        await env.EMAILS.put(indexKey, JSON.stringify(trimmedIndex), { expirationTtl: 30 * 24 * 3600 });

        // Auto-claim address ownership if unclaimed
        const ownerKey = `email-owner:${toAddr}`;
        const currentOwner = await env.EMAILS.get(ownerKey);
        // Note: unclaimed addresses just store mail silently — owner claims on first inbox access

        // Fire registered webhooks (non-blocking)
        ctx.waitUntil((async () => {
          try {
            const addrIndexKey = `webhook-addr:${toAddr}`;
            const hookIdsRaw = await env.EMAILS.get(addrIndexKey);
            if (!hookIdsRaw) return;
            const hookIds = JSON.parse(hookIdsRaw);
            const payload = {
              event: 'email.received',
              address: toAddr,
              message: {
                message_id: messageId,
                from: fromAddr,
                subject,
                body_preview: msg.body_preview,
                received_at: now,
              },
            };
            await Promise.allSettled(hookIds.map(async (hookId) => {
              const hookRaw = await env.EMAILS.get(`webhook:${hookId}`);
              if (!hookRaw) return;
              const hook = JSON.parse(hookRaw);
              if (!hook.url || hook.status === 'paused') return;
              const body = JSON.stringify(payload);
              const sig = hook.secret ? await sha256hex(hook.secret + body) : null;
              const headers = { 'Content-Type': 'application/json' };
              if (sig) headers['X-AgentLair-Signature'] = sig;
              await fetch(hook.url, { method: 'POST', headers, body }).catch(() => {});
            }));
          } catch {}
        })());
      }
    } catch (e) {
      // Swallow errors — never bounce due to our own bugs
    }
  },
};
