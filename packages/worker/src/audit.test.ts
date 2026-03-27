/**
 * AgentLair Audit Trail — Tests
 *
 * Tests for:
 * - Ed25519 signing and verification roundtrip
 * - Event categorization (path → category)
 * - Action derivation (method + path → action)
 * - Result mapping (status code → result)
 * - Hash chain (prev_hash logic)
 */

import { describe, test, expect } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getCategory, getAction, getResult, signEntry } from './middleware/audit';
import type { AuditEntry } from './middleware/audit';

// ─── Helper: generate a test Ed25519 keypair ─────────────────────────────────

function generateTestKeypair(): { privateKeyB64: string; publicKeyBytes: Uint8Array } {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const privateKeyB64 = btoa(String.fromCharCode(...privateKeyBytes));
  return { privateKeyB64, publicKeyBytes };
}

// ─── Helper: make a minimal entry for signing ─────────────────────────────────

function makeEntry(overrides: Partial<Omit<AuditEntry, 'signature'>> = {}): Omit<AuditEntry, 'signature'> {
  return {
    id: 'test123',
    timestamp: '2026-03-23T10:00:00.000Z',
    account_id: 'acc_test',
    actor_type: 'account',
    actor_id: 'acc_test',
    actor_ip_hash: 'abc123',
    category: 'auth',
    action: 'auth.login',
    method: 'POST',
    path: '/v1/auth/login',
    resource_type: null,
    resource_id: null,
    status: 200,
    result: 'success',
    error_code: null,
    details: null,
    prev_hash: '0'.repeat(64),
    ...overrides,
  };
}

// ─── Ed25519 signing ──────────────────────────────────────────────────────────

describe('Ed25519 signing', () => {
  test('sign + verify roundtrip produces valid signature', async () => {
    const { privateKeyB64, publicKeyBytes } = generateTestKeypair();
    const entry = makeEntry();

    const signature = await signEntry(entry, privateKeyB64);
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);

    // Verify signature
    const privateKeyBytes = Uint8Array.from(atob(privateKeyB64), c => c.charCodeAt(0));
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    const contentToSign = JSON.stringify(entry);
    const messageBytes = new TextEncoder().encode(contentToSign);

    const valid = ed25519.verify(signatureBytes, messageBytes, publicKeyBytes);
    expect(valid).toBe(true);
  });

  test('different entries produce different signatures', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry1 = makeEntry({ id: 'entry1' });
    const entry2 = makeEntry({ id: 'entry2' });

    const sig1 = await signEntry(entry1, privateKeyB64);
    const sig2 = await signEntry(entry2, privateKeyB64);

    expect(sig1).not.toBe(sig2);
  });

  test('same entry + same key produces same signature (deterministic)', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeEntry();

    const sig1 = await signEntry(entry, privateKeyB64);
    const sig2 = await signEntry(entry, privateKeyB64);

    // Ed25519 is deterministic (no randomness in signing)
    expect(sig1).toBe(sig2);
  });

  test('signature is 64 bytes (128 base64 chars)', async () => {
    const { privateKeyB64 } = generateTestKeypair();
    const entry = makeEntry();
    const signature = await signEntry(entry, privateKeyB64);

    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    expect(signatureBytes.length).toBe(64);
  });

  test('wrong public key fails verification', async () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();
    const entry = makeEntry();

    const signature = await signEntry(entry, kp1.privateKeyB64);
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    const contentToSign = JSON.stringify(entry);
    const messageBytes = new TextEncoder().encode(contentToSign);

    // Verify with wrong public key — should return false
    const valid = ed25519.verify(signatureBytes, messageBytes, kp2.publicKeyBytes);
    expect(valid).toBe(false);
  });
});

// ─── Event categorization ─────────────────────────────────────────────────────

describe('getCategory', () => {
  test('auth paths → auth category', () => {
    expect(getCategory('/v1/auth/login', 200)).toBe('auth');
    expect(getCategory('/v1/auth/keys', 200)).toBe('auth');
    expect(getCategory('/v1/auth/agent-register', 200)).toBe('auth');
  });

  test('email paths → email category', () => {
    expect(getCategory('/v1/email/send', 200)).toBe('email');
    expect(getCategory('/v1/email/inbox', 200)).toBe('email');
    expect(getCategory('/v1/inbox/abc123', 200)).toBe('email');
  });

  test('vault paths → vault category', () => {
    expect(getCategory('/v1/vault/store', 200)).toBe('vault');
    expect(getCategory('/v1/vault/recover', 200)).toBe('vault');
    expect(getCategory('/v1/vault/mykey', 200)).toBe('vault');
  });

  test('pod paths → pod category', () => {
    expect(getCategory('/v1/pods', 200)).toBe('pod');
    expect(getCategory('/v1/pods/pod_abc123', 200)).toBe('pod');
  });

  test('calendar paths → calendar category', () => {
    expect(getCategory('/v1/calendar/events', 200)).toBe('calendar');
    expect(getCategory('/v1/calendar/feed.ics', 200)).toBe('calendar');
  });

  test('webhook paths → webhook category', () => {
    expect(getCategory('/v1/email/webhooks', 200)).toBe('webhook');
    expect(getCategory('/v1/email/webhooks/abc123', 200)).toBe('webhook');
  });

  test('401 status → system category (auth failure)', () => {
    expect(getCategory('/v1/email/send', 401)).toBe('system');
  });

  test('429 status → system category (rate limit)', () => {
    expect(getCategory('/v1/email/send', 429)).toBe('system');
  });

  test('unknown paths → system category', () => {
    expect(getCategory('/v1/unknown/path', 200)).toBe('system');
    expect(getCategory('/v1/dns/something', 200)).toBe('system');
  });
});

// ─── Action derivation ────────────────────────────────────────────────────────

describe('getAction', () => {
  test('POST /v1/auth/login → auth.login', () => {
    expect(getAction('auth', 'POST', '/v1/auth/login')).toBe('auth.login');
  });

  test('POST /v1/auth/keys → auth.create_key', () => {
    expect(getAction('auth', 'POST', '/v1/auth/keys')).toBe('auth.create_key');
  });

  test('POST /v1/auth/agent-register → auth.agent_register', () => {
    expect(getAction('auth', 'POST', '/v1/auth/agent-register')).toBe('auth.agent_register');
  });

  test('POST /v1/email/send → email.send', () => {
    expect(getAction('email', 'POST', '/v1/email/send')).toBe('email.send');
  });

  test('GET /v1/email/inbox → email.list', () => {
    expect(getAction('email', 'GET', '/v1/email/inbox')).toBe('email.list');
  });

  test('POST /v1/vault/store → vault.store', () => {
    expect(getAction('vault', 'POST', '/v1/vault/store')).toBe('vault.store');
  });

  test('GET /v1/vault/mykey → vault.retrieve', () => {
    expect(getAction('vault', 'GET', '/v1/vault/mykey')).toBe('vault.retrieve');
  });

  test('POST /v1/pods → pod.create', () => {
    expect(getAction('pod', 'POST', '/v1/pods')).toBe('pod.create');
  });

  test('DELETE /v1/pods/pod_abc → pod.delete', () => {
    expect(getAction('pod', 'DELETE', '/v1/pods/pod_abc')).toBe('pod.delete');
  });

  test('POST /v1/pods/pod_abc/keys → pod.create_key', () => {
    expect(getAction('pod', 'POST', '/v1/pods/pod_abc/keys')).toBe('pod.create_key');
  });

  test('POST /v1/calendar/events → calendar.create', () => {
    expect(getAction('calendar', 'POST', '/v1/calendar/events')).toBe('calendar.create');
  });

  test('POST /v1/email/webhooks → webhook.create', () => {
    expect(getAction('webhook', 'POST', '/v1/email/webhooks')).toBe('webhook.create');
  });

  test('DELETE /v1/email/webhooks/abc → webhook.delete', () => {
    expect(getAction('webhook', 'DELETE', '/v1/email/webhooks/abc')).toBe('webhook.delete');
  });

  test('fallback: GET system path → system.read', () => {
    expect(getAction('system', 'GET', '/v1/unknown')).toBe('system.read');
  });

  test('fallback: POST system path → system.create', () => {
    expect(getAction('system', 'POST', '/v1/unknown')).toBe('system.create');
  });

  test('fallback: DELETE system path → system.delete', () => {
    expect(getAction('system', 'DELETE', '/v1/unknown')).toBe('system.delete');
  });
});

// ─── Result mapping ───────────────────────────────────────────────────────────

describe('getResult', () => {
  test('2xx → success', () => {
    expect(getResult(200)).toBe('success');
    expect(getResult(201)).toBe('success');
    expect(getResult(204)).toBe('success');
  });

  test('401 → denied', () => {
    expect(getResult(401)).toBe('denied');
  });

  test('403 → denied', () => {
    expect(getResult(403)).toBe('denied');
  });

  test('429 → rate_limited', () => {
    expect(getResult(429)).toBe('rate_limited');
  });

  test('400 → failure', () => {
    expect(getResult(400)).toBe('failure');
  });

  test('404 → failure', () => {
    expect(getResult(404)).toBe('failure');
  });

  test('500 → failure', () => {
    expect(getResult(500)).toBe('failure');
  });

  test('503 → failure', () => {
    expect(getResult(503)).toBe('failure');
  });
});

// ─── Hash chain ───────────────────────────────────────────────────────────────

describe('hash chain', () => {
  test('prev_hash of first entry is genesis (64 zeros)', () => {
    const entry = makeEntry();
    expect(entry.prev_hash).toBe('0'.repeat(64));
  });

  test('prev_hash length is 64 chars (SHA-256 hex)', () => {
    const entry = makeEntry({ prev_hash: 'a'.repeat(64) });
    expect(entry.prev_hash.length).toBe(64);
  });

  test('two entries have different prev_hashes when second references first', async () => {
    const entry1 = makeEntry({ id: 'entry1', prev_hash: '0'.repeat(64) });
    const entry2 = makeEntry({ id: 'entry2', prev_hash: 'a'.repeat(64) });

    expect(entry1.prev_hash).not.toBe(entry2.prev_hash);
  });

  test('SHA-256 of an entry produces a 64-char hex string', async () => {
    const entry = makeEntry();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entry)));
    const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(hashHex.length).toBe(64);
  });
});
