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

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Public SCITT Corpus Routes (no auth required) ───────────────────────────
//
// Exposes the AgentLair SCITT receipt corpus as a public, paginated feed.
//
// Endpoints:
//   GET /v1/scitt/corpus              — paginated receipt list (JSON)
//   GET /v1/scitt/corpus/stats        — aggregate statistics
//   GET /v1/scitt/corpus.atom         — Atom 1.0 feed (subscribable)
//
// Privacy: account_id exposed only as public DID; no payloads, no IPs, no details.
// These routes must be mounted BEFORE the /v1/* auth middleware in index.ts.

export const publicScittRoutes = new Hono<HonoEnv>();

// ─── GET /corpus ─────────────────────────────────────────────────────────────
// Paginated list of all issued SCITT receipts.
// No auth required — public corpus for EU AI Act Article 12 compliance visibility.
//
// Query params:
//   after=<leaf_index>  — cursor (integer); returns entries with leaf_index > after
//   limit=<n>           — page size (default 50, max 100)
//
// Response:
//   { items: [...], next_cursor: number|null, count: number }
//
// Item fields:
//   entry_id, issuer_did, issued_at, statement_type, leaf_index,
//   tree_size, root_hash, signature, receipt_url

publicScittRoutes.get('/corpus', async (c) => {
  if (!c.env.AUDIT) {
    return err('Transparency Service not available.', 503, 'ts_unavailable');
  }

  const url = new URL(c.req.url);
  const afterParam = url.searchParams.get('after');
  const after = afterParam !== null ? parseInt(afterParam, 10) : -1;
  const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 100);

  if (afterParam !== null && (isNaN(after) || after < -1)) {
    return err('Invalid cursor: after must be a non-negative integer.', 400, 'invalid_cursor');
  }

  try {
    const results = await c.env.AUDIT.prepare(`
      SELECT
        r.entry_id,
        r.leaf_index,
        r.tree_size,
        r.root_hash,
        r.created_at,
        a.account_id,
        a.category,
        a.action,
        a.signature
      FROM scitt_receipts r
      JOIN audit_log a ON a.id = r.entry_id
      WHERE r.leaf_index > ?
      ORDER BY r.leaf_index ASC
      LIMIT ?
    `)
      .bind(after, limit)
      .all<{
        entry_id: string;
        leaf_index: number;
        tree_size: number;
        root_hash: string;
        created_at: string;
        account_id: string;
        category: string;
        action: string;
        signature: string;
      }>();

    const items = (results.results || []).map((row) => ({
      entry_id: row.entry_id,
      issuer_did: `did:web:agentlair.dev:agents:${row.account_id}`,
      issued_at: row.created_at,
      statement_type: `${row.category}.${row.action}`,
      leaf_index: row.leaf_index,
      tree_size: row.tree_size,
      root_hash: row.root_hash,
      signature: row.signature,
      receipt_url: `https://agentlair.dev/v1/scitt/entries/${row.entry_id}/receipt`,
    }));

    const lastItem = items[items.length - 1];
    const next_cursor = items.length === limit ? (lastItem?.leaf_index ?? null) : null;

    return json({
      items,
      next_cursor,
      count: items.length,
    });
  } catch (e) {
    console.error('SCITT corpus query failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to query corpus.', 500, 'corpus_query_error');
  }
});

// ─── GET /corpus/stats ───────────────────────────────────────────────────────
// Aggregate statistics for the entire SCITT corpus.
// No auth required.
//
// Response:
//   {
//     total_receipts: number,
//     unique_issuers: number,
//     by_statement_type: [{ statement_type, count }],
//     by_week: [{ week, count }],        // chronological, last 52 weeks
//     by_issuer: [{ issuer_did, count }] // top 20 by receipt count
//   }

publicScittRoutes.get('/corpus/stats', async (c) => {
  if (!c.env.AUDIT) {
    return err('Transparency Service not available.', 503, 'ts_unavailable');
  }

  try {
    // Total receipts + unique issuers (single JOIN query)
    const totals = await c.env.AUDIT.prepare(`
      SELECT
        COUNT(*) as total_receipts,
        COUNT(DISTINCT a.account_id) as unique_issuers
      FROM scitt_receipts r
      JOIN audit_log a ON a.id = r.entry_id
    `).first<{ total_receipts: number; unique_issuers: number }>();

    // Count by statement type (category.action)
    const byType = await c.env.AUDIT.prepare(`
      SELECT
        a.category || '.' || a.action as statement_type,
        COUNT(*) as count
      FROM scitt_receipts r
      JOIN audit_log a ON a.id = r.entry_id
      GROUP BY statement_type
      ORDER BY count DESC
      LIMIT 50
    `).all<{ statement_type: string; count: number }>();

    // Count by ISO week (last 52 weeks, returned in chronological order)
    const byWeek = await c.env.AUDIT.prepare(`
      SELECT
        strftime('%Y-W%W', r.created_at) as week,
        COUNT(*) as count
      FROM scitt_receipts r
      GROUP BY week
      ORDER BY week DESC
      LIMIT 52
    `).all<{ week: string; count: number }>();

    // Top 20 issuers by receipt count
    const byIssuer = await c.env.AUDIT.prepare(`
      SELECT
        a.account_id,
        COUNT(*) as count
      FROM scitt_receipts r
      JOIN audit_log a ON a.id = r.entry_id
      GROUP BY a.account_id
      ORDER BY count DESC
      LIMIT 20
    `).all<{ account_id: string; count: number }>();

    return json({
      total_receipts: totals?.total_receipts ?? 0,
      unique_issuers: totals?.unique_issuers ?? 0,
      by_statement_type: byType.results || [],
      // Reverse so oldest week is first (chronological)
      by_week: (byWeek.results || []).reverse(),
      by_issuer: (byIssuer.results || []).map((r) => ({
        issuer_did: `did:web:agentlair.dev:agents:${r.account_id}`,
        count: r.count,
      })),
    });
  } catch (e) {
    console.error('SCITT corpus stats failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to query corpus stats.', 500, 'corpus_stats_error');
  }
});

// ─── GET /corpus.atom ─────────────────────────────────────────────────────────
// Atom 1.0 feed of the 50 most recent SCITT receipts.
// No auth required. Subscribable via any feed reader.
// Cache-Control: public, max-age=300 (5 minutes).

publicScittRoutes.get('/corpus.atom', async (c) => {
  if (!c.env.AUDIT) {
    return new Response('Transparency Service not available.', { status: 503 });
  }

  try {
    const results = await c.env.AUDIT.prepare(`
      SELECT
        r.entry_id,
        r.leaf_index,
        r.tree_size,
        r.root_hash,
        r.created_at,
        a.account_id,
        a.category,
        a.action
      FROM scitt_receipts r
      JOIN audit_log a ON a.id = r.entry_id
      ORDER BY r.leaf_index DESC
      LIMIT 50
    `).all<{
      entry_id: string;
      leaf_index: number;
      tree_size: number;
      root_hash: string;
      created_at: string;
      account_id: string;
      category: string;
      action: string;
    }>();

    const rows = results.results || [];
    const lastUpdated = rows[0]?.created_at ?? new Date().toISOString();

    const entries = rows.map((row) => {
      const stType = `${row.category}.${row.action}`;
      const did = `did:web:agentlair.dev:agents:${row.account_id}`;
      const entryUrl = `https://agentlair.dev/v1/scitt/entries/${xmlEscape(row.entry_id)}`;
      return `  <entry>
    <id>${entryUrl}</id>
    <title>${xmlEscape(stType)} [leaf:${row.leaf_index}]</title>
    <updated>${xmlEscape(row.created_at)}</updated>
    <author>
      <name>${xmlEscape(did)}</name>
      <uri>${xmlEscape(did)}</uri>
    </author>
    <link rel="related" href="${entryUrl}/receipt"/>
    <summary>SCITT receipt — type: ${xmlEscape(stType)}, leaf: ${row.leaf_index}, tree_size: ${row.tree_size}, root: ${xmlEscape(row.root_hash)}</summary>
  </entry>`;
    }).join('\n');

    const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>AgentLair SCITT Receipt Corpus</title>
  <id>https://agentlair.dev/v1/scitt/corpus.atom</id>
  <updated>${xmlEscape(lastUpdated)}</updated>
  <link rel="self" type="application/atom+xml" href="https://agentlair.dev/v1/scitt/corpus.atom"/>
  <link rel="alternate" type="application/json" href="https://agentlair.dev/v1/scitt/corpus"/>
  <author>
    <name>AgentLair Transparency Service</name>
    <uri>https://agentlair.dev</uri>
  </author>
  <subtitle>Verifiable SCITT receipts from the AgentLair Transparency Service. EU AI Act Article 12 aligned.</subtitle>
${entries}
</feed>`;

    return new Response(atom, {
      status: 200,
      headers: {
        'Content-Type': 'application/atom+xml; charset=UTF-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (e) {
    console.error('SCITT corpus Atom feed failed:', e instanceof Error ? e.message : String(e));
    return new Response('Failed to generate feed.', { status: 500 });
  }
});
