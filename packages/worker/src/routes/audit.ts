// ─── Audit Routes ────────────────────────────────────────────────────────────
// Handles: GET /v1/audit/log — query audit trail with filters and pagination
//          GET /v1/audit/:token_id — alias for /v1/audit/log (backward compat for JWTs)
//          GET /v1/audit/verification-key — return Ed25519 public key
//          GET /v1/attestations — return audit entries as CAF attestations
//          GET /v1/attestations/:id/scitt — single attestation as COSE_Sign1 (SCITT)
//
// All routes require authentication (mounted after auth middleware in index.ts).

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { json, err } from '../utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { AuditEntry } from '../middleware/audit.js';
import { auditEntryToCAF } from '../caf.js';
import { cafToSignedStatement } from '../caf-scitt.js';
import { verifyX402Payment, settleX402Payment, trackX402Spend, make402Response, SERVICE_PRICES } from '../x402.js';

export const auditRoutes = new Hono<HonoEnv>();

// ─── GET /audit/log ──────────────────────────────────────────────────────────
// Query audit trail with optional filters and cursor-based pagination.

auditRoutes.get('/log', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  // Check AUDIT binding
  if (!c.env.AUDIT) {
    return err('Audit trail not enabled for this instance.', 503, 'audit_unavailable');
  }

  // Parse query params
  const url = new URL(c.req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const category = url.searchParams.get('category');
  const action = url.searchParams.get('action');
  const resource_id = url.searchParams.get('resource_id');
  const result = url.searchParams.get('result');
  const cursor = url.searchParams.get('cursor');
  const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 1000);

  // Build dynamic SQL
  const conditions: string[] = ['account_id = ?'];
  const params: (string | number)[] = [account.id];

  if (from) { conditions.push('timestamp >= ?'); params.push(from); }
  if (to) { conditions.push('timestamp <= ?'); params.push(to); }
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (action) { conditions.push('action = ?'); params.push(action); }
  if (resource_id) { conditions.push('resource_id = ?'); params.push(resource_id); }
  if (result) { conditions.push('result = ?'); params.push(result); }
  if (cursor) { conditions.push('id > ?'); params.push(cursor); }

  const whereClause = conditions.join(' AND ');
  const sql = `SELECT * FROM audit_log WHERE ${whereClause} ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);

  try {
    const queryResult = await c.env.AUDIT.prepare(sql)
      .bind(...params)
      .all<AuditEntry>();

    const entries = (queryResult.results || []).map((entry) => ({
      ...entry,
      // Parse details JSON string back to object
      details: entry.details
        ? (typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details)
        : null,
    }));

    const lastEntry = entries[entries.length - 1];
    const nextCursor = entries.length === limit ? (lastEntry?.id ?? null) : null;

    return json({
      entries,
      cursor: nextCursor,
      count: entries.length,
    });
  } catch (e) {
    console.error('Audit log query failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to query audit log.', 500, 'audit_query_error');
  }
});

// ─── GET /attestations ───────────────────────────────────────────────────────
// Return audit entries converted to CAF (Commitment Attestation Format).
// Query params: account=, from=, to=, limit= (default 50, max 1000)

auditRoutes.get('/attestations', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  if (!c.env.AUDIT) {
    return err('Audit trail not enabled for this instance.', 503, 'audit_unavailable');
  }

  if (!c.env.AUDIT_SIGNING_KEY) {
    return err('Audit signing key not configured.', 503, 'audit_unavailable');
  }

  // Parse query params
  const url = new URL(c.req.url);
  const accountParam = url.searchParams.get('account');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 1000);

  // IDOR guard: reject if account param provided and doesn't match authenticated account
  if (accountParam && accountParam !== account.id) {
    return err('Account parameter does not match authenticated account.', 403, 'forbidden');
  }

  // Build query — always filter to authenticated account
  const conditions: string[] = ['account_id = ?'];
  const params: (string | number)[] = [account.id];

  if (from) { conditions.push('timestamp >= ?'); params.push(from); }
  if (to) { conditions.push('timestamp <= ?'); params.push(to); }

  const whereClause = conditions.join(' AND ');
  const sql = `SELECT * FROM audit_log WHERE ${whereClause} ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);

  try {
    const queryResult = await c.env.AUDIT.prepare(sql)
      .bind(...params)
      .all<AuditEntry>();

    const entries = (queryResult.results || []).map((entry) => ({
      ...entry,
      details: entry.details
        ? (typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details)
        : null,
    }));

    // Convert each AuditEntry to CAF attestation
    const attestations = await Promise.all(
      entries.map(entry => auditEntryToCAF(entry, c.env.AUDIT_SIGNING_KEY!)),
    );

    return json({ attestations, count: attestations.length });
  } catch (e) {
    console.error('Attestations query failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to query attestations.', 500, 'attestations_query_error');
  }
});

// ─── GET /attestations/:id/scitt ─────────────────────────────────────────────
// Return a single audit entry as a COSE_Sign1 Signed Statement (SCITT-compatible).
//
// :id — audit log entry ID (nanoid, e.g. "a1b2c3d4e5f6g7h8i9j0")
//
// Response:
//   Content-Type: application/cose
//   Body: raw COSE_Sign1 bytes (CBOR tag 18 + 4-element array)
//
// The COSE envelope carries:
//   Protected header: alg=EdDSA, content-type=application/caf+json, kid, CWT claims (iss/sub/iat)
//   Payload: full CAF attestation JSON (the complete auditable record)
//   Signature: Ed25519 over COSE Sig_Structure (RFC 9052 §4.4)
//
// Clients can verify the signature using the public key at GET /audit/verification-key.
// Future: pair with a Transparency Service to upgrade to a Transparent Statement with Receipt.

auditRoutes.get('/attestations/:id/scitt', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  if (!c.env.AUDIT) {
    return err('Audit trail not enabled for this instance.', 503, 'audit_unavailable');
  }

  if (!c.env.AUDIT_SIGNING_KEY) {
    return err('Audit signing key not configured.', 503, 'audit_unavailable');
  }

  const entryId = c.req.param('id');

  try {
    // Look up the audit entry — enforce account ownership (IDOR guard)
    const queryResult = await c.env.AUDIT
      .prepare('SELECT * FROM audit_log WHERE id = ? AND account_id = ? LIMIT 1')
      .bind(entryId, account.id)
      .all<AuditEntry>();

    const raw = queryResult.results?.[0];
    if (!raw) {
      return err('Attestation not found.', 404, 'attestation_not_found');
    }

    // Parse details JSON string (stored as text in D1)
    const entry: AuditEntry = {
      ...raw,
      details: raw.details
        ? (typeof raw.details === 'string' ? JSON.parse(raw.details as unknown as string) : raw.details)
        : null,
    };

    // Convert audit entry → CAF attestation → COSE_Sign1
    const attestation = await auditEntryToCAF(entry, c.env.AUDIT_SIGNING_KEY);
    const coseBytes   = await cafToSignedStatement(attestation, c.env.AUDIT_SIGNING_KEY);

    // Return raw COSE bytes with correct content-type
    // Wrap in new Uint8Array to ensure ArrayBuffer (not ArrayBufferLike) backing
    return new Response(new Uint8Array(coseBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/cose',
        'Content-Length': String(coseBytes.length),
      },
    });
  } catch (e) {
    console.error('SCITT export failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to export SCITT statement.', 500, 'scitt_export_error');
  }
});

// ─── GET /audit/verification-key ─────────────────────────────────────────────
// Return Ed25519 public key derived from AUDIT_SIGNING_KEY.
// Behind auth for Phase 1 (Phase 2 can make this public).

auditRoutes.get('/verification-key', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  if (!c.env.AUDIT_SIGNING_KEY) {
    return err('Audit signing key not configured.', 503, 'audit_unavailable');
  }

  try {
    const privateKeyBytes = Uint8Array.from(atob(c.env.AUDIT_SIGNING_KEY), ch => ch.charCodeAt(0));
    const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
    const publicKeyB64 = btoa(String.fromCharCode(...publicKeyBytes));

    return json({
      algorithm: 'Ed25519',
      public_key: publicKeyB64,
      valid_from: new Date().toISOString().split('T')[0] + 'T00:00:00Z',
    });
  } catch (e) {
    console.error('Verification key derivation failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to derive verification key.', 500, 'key_derivation_error');
  }
});

// ─── Public Audit Routes (no auth required) ──────────────────────────────────
// GET /v1/audit/:jti — per-token metadata lookup for al_audit_url embedded in AATs.
// Public endpoint: external services verify tokens without needing an AgentLair account.
// Must be mounted BEFORE the /v1/* auth middleware in index.ts.
// NOTE: Placed after literal routes so it doesn't shadow /log, /attestations, /verification-key.

export const publicAuditRoutes = new Hono<HonoEnv>();

publicAuditRoutes.get('/:jti', async (c) => {
  const jti = c.req.param('jti');

  // Validate format before charging
  if (!/^aat_[A-Za-z0-9]{16}$/.test(jti)) {
    return c.json({ error: 'invalid_jti', message: 'Token ID must match format aat_[A-Za-z0-9]{16}' }, 400);
  }

  // x402 payment gate — 0.001 USDC per lookup (unauthenticated callers; payment IS authentication)
  const xPayment = c.req.header('X-PAYMENT');
  if (!xPayment) {
    return make402Response(SERVICE_PRICES.audit_lookup);
  }
  const verification = await verifyX402Payment(xPayment, SERVICE_PRICES.audit_lookup);
  if (!verification.valid) {
    return make402Response(SERVICE_PRICES.audit_lookup, { payment_error: verification.error });
  }
  const settlement = await settleX402Payment(xPayment, SERVICE_PRICES.audit_lookup);
  if (!settlement.settled) {
    return make402Response(SERVICE_PRICES.audit_lookup, { payment_error: settlement.error });
  }
  if (settlement.receipt) {
    c.header('X-Payment-Response', settlement.receipt);
  }
  c.executionCtx.waitUntil(
    trackX402Spend(c.env, 'anonymous', SERVICE_PRICES.audit_lookup.amount, {
      payer: verification.payer,
      service: 'audit_lookup',
    }).catch(() => {}),
  );

  // Look up token metadata from KV
  const metaRaw = await c.env.KEYS.get(`aat-meta:${jti}`);
  if (!metaRaw) {
    return c.json({ error: 'not_found', message: 'Token not found. Tokens are only auditable while valid and up to 5 minutes after expiry.' }, 404);
  }
  const meta = JSON.parse(metaRaw);

  // Check revocation status
  const revocationRaw = await c.env.KEYS.get(`revoked:${jti}`);
  const revocation = revocationRaw ? JSON.parse(revocationRaw) : null;

  return c.json({
    jti,
    issued_at: meta.issued_at,
    expires_at: meta.expires_at,
    audience: meta.audience,
    scopes: meta.scopes,
    status: revocation ? 'revoked' : (new Date(meta.expires_at) < new Date() ? 'expired' : 'active'),
    revoked_at: revocation?.revoked_at ?? null,
    revocation_reason: revocation?.reason ?? null,
    audit_log_url: `https://agentlair.dev/v1/audit/log?action=auth.token_issue`,
  }, 200);
});
