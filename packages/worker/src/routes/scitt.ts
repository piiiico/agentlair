/**
 * SCITT Routes — SCRAPI-compatible Transparency Service endpoints
 *
 * Implements the Supply Chain Integrity, Transparency, and Trust (SCITT)
 * Registration API (SCRAPI) per draft-ietf-scitt-architecture-22 §8.
 *
 * Endpoints:
 *   POST /v1/scitt/entries              — Register a Signed Statement
 *   GET  /v1/scitt/entries/:entry_id    — Retrieve Transparent Statement
 *   GET  /v1/scitt/entries/:entry_id/receipt — Retrieve Receipt only
 *
 * All registration goes through the TransparencyService Durable Object
 * to ensure serialized writes and a single Merkle tree.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { json, err } from '../utils.js';
import { auditEntryToCAF } from '../caf.js';
import { cafToSignedStatement } from '../caf-scitt.js';
import type { AuditEntry } from '../middleware/audit.js';

export const scittRoutes = new Hono<HonoEnv>();

// ─── POST /entries ──────────────────────────────────────────────────────────
// Register an existing audit entry as a SCITT Signed Statement.
// Submits it to the Transparency Service DO and returns the Receipt.
//
// Body: { entry_id: string }
// Response: 201 with entry metadata + receipt (base64)

scittRoutes.post('/entries', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  if (!c.env.AUDIT || !c.env.AUDIT_SIGNING_KEY) {
    return err('Audit trail not configured.', 503, 'audit_unavailable');
  }

  if (!c.env.TRANSPARENCY_SERVICE) {
    return err('Transparency Service not available.', 503, 'ts_unavailable');
  }

  // Parse request
  let body: { entry_id: string };
  try {
    body = await c.req.json();
  } catch {
    return err('Invalid JSON body.', 400, 'invalid_body');
  }

  if (!body.entry_id || typeof body.entry_id !== 'string') {
    return err('entry_id is required.', 400, 'missing_entry_id');
  }

  // Look up the audit entry (IDOR guard: account ownership)
  const queryResult = await c.env.AUDIT
    .prepare('SELECT * FROM audit_log WHERE id = ? AND account_id = ? LIMIT 1')
    .bind(body.entry_id, account.id)
    .all<AuditEntry>();

  const raw = queryResult.results?.[0];
  if (!raw) {
    return err('Audit entry not found.', 404, 'entry_not_found');
  }

  // Check if already registered
  try {
    const existing = await c.env.AUDIT
      .prepare('SELECT entry_id FROM scitt_receipts WHERE entry_id = ? LIMIT 1')
      .bind(body.entry_id)
      .first();

    if (existing) {
      return err('Entry already registered.', 409, 'already_registered');
    }
  } catch {
    // Table may not exist yet — proceed (DO will handle creation)
  }

  // Parse details JSON
  const entry: AuditEntry = {
    ...raw,
    details: raw.details
      ? (typeof raw.details === 'string' ? JSON.parse(raw.details as unknown as string) : raw.details)
      : null,
  };

  // Convert to Signed Statement (CAF → COSE_Sign1)
  const attestation = await auditEntryToCAF(entry, c.env.AUDIT_SIGNING_KEY);
  const signedStatement = await cafToSignedStatement(attestation, c.env.AUDIT_SIGNING_KEY);

  // Submit to Transparency Service DO via fetch
  const tsId = c.env.TRANSPARENCY_SERVICE.idFromName('global');
  const tsStub = c.env.TRANSPARENCY_SERVICE.get(tsId);

  const doResponse = await tsStub.fetch(new Request('https://ts/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signedStatement: arrayToBase64(signedStatement),
      entryId: body.entry_id,
    }),
  }));

  if (!doResponse.ok) {
    const doErr = await doResponse.text();
    return err(`Transparency Service error: ${doErr}`, 500, 'ts_error');
  }

  const result = await doResponse.json() as {
    receipt: string;
    leafIndex: number;
    treeSize: number;
    rootHash: string;
  };

  return json({
    entry_id: body.entry_id,
    leaf_index: result.leafIndex,
    tree_size: result.treeSize,
    root_hash: result.rootHash,
    receipt: result.receipt,
    status: 'registered',
  }, 201);
});

// ─── GET /entries/:entry_id ─────────────────────────────────────────────────
// Retrieve a Transparent Statement (Signed Statement + Receipt).

scittRoutes.get('/entries/:entry_id', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  if (!c.env.AUDIT || !c.env.AUDIT_SIGNING_KEY) {
    return err('Audit trail not configured.', 503, 'audit_unavailable');
  }

  const entryId = c.req.param('entry_id');

  // Look up audit entry (IDOR guard)
  const queryResult = await c.env.AUDIT
    .prepare('SELECT * FROM audit_log WHERE id = ? AND account_id = ? LIMIT 1')
    .bind(entryId, account.id)
    .all<AuditEntry>();

  const raw = queryResult.results?.[0];
  if (!raw) {
    return err('Entry not found.', 404, 'entry_not_found');
  }

  // Look up receipt
  let receipt: { leaf_index: number; tree_size: number; root_hash: string; receipt_cbor: string; created_at: string } | null = null;
  try {
    receipt = await c.env.AUDIT
      .prepare('SELECT leaf_index, tree_size, root_hash, receipt_cbor, created_at FROM scitt_receipts WHERE entry_id = ? LIMIT 1')
      .bind(entryId)
      .first<{ leaf_index: number; tree_size: number; root_hash: string; receipt_cbor: string; created_at: string }>();
  } catch {
    // Table may not exist
  }

  if (!receipt) {
    return err('Entry not registered with Transparency Service. POST /v1/scitt/entries first.', 404, 'not_registered');
  }

  // Parse entry details
  const entry: AuditEntry = {
    ...raw,
    details: raw.details
      ? (typeof raw.details === 'string' ? JSON.parse(raw.details as unknown as string) : raw.details)
      : null,
  };

  // Build Signed Statement
  const attestation = await auditEntryToCAF(entry, c.env.AUDIT_SIGNING_KEY);
  const signedStatement = await cafToSignedStatement(attestation, c.env.AUDIT_SIGNING_KEY);

  return json({
    entry_id: entryId,
    signed_statement: arrayToBase64(signedStatement),
    receipt: receipt.receipt_cbor,
    leaf_index: receipt.leaf_index,
    tree_size: receipt.tree_size,
    root_hash: receipt.root_hash,
    registered_at: receipt.created_at,
    content_type: 'application/scitt-transparent-statement+json',
  });
});

// ─── GET /entries/:entry_id/receipt ─────────────────────────────────────────
// Return just the SCITT Receipt (raw COSE_Sign1 bytes).

scittRoutes.get('/entries/:entry_id/receipt', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  if (!c.env.AUDIT) {
    return err('Audit trail not configured.', 503, 'audit_unavailable');
  }

  const entryId = c.req.param('entry_id');

  // IDOR guard
  const ownerCheck = await c.env.AUDIT
    .prepare('SELECT id FROM audit_log WHERE id = ? AND account_id = ? LIMIT 1')
    .bind(entryId, account.id)
    .first();

  if (!ownerCheck) {
    return err('Entry not found.', 404, 'entry_not_found');
  }

  // Get receipt
  let receipt: { receipt_cbor: string } | null = null;
  try {
    receipt = await c.env.AUDIT
      .prepare('SELECT receipt_cbor FROM scitt_receipts WHERE entry_id = ? LIMIT 1')
      .bind(entryId)
      .first<{ receipt_cbor: string }>();
  } catch {
    // Table may not exist
  }

  if (!receipt) {
    return err('No receipt for this entry. Register via POST /v1/scitt/entries.', 404, 'no_receipt');
  }

  // Return raw COSE bytes
  const receiptBytes = base64ToArray(receipt.receipt_cbor);
  return new Response(receiptBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/scitt-receipt+cose',
      'Content-Length': String(receiptBytes.length),
    },
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function arrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

function base64ToArray(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
