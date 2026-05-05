/**
 * SCITT Routes — SCRAPI-compatible Transparency Service endpoints
 *
 * Implements the Supply Chain Integrity, Transparency, and Trust (SCITT)
 * Registration API (SCRAPI) per draft-ietf-scitt-architecture-22 §8.
 *
 * Endpoints:
 *   POST /v1/scitt/entries                       — Register a Signed Statement (from audit entry)
 *   POST /v1/scitt/git-commits                   — Register AI git commit as SCITT receipt
 *   GET  /v1/scitt/entries/:entry_id             — Retrieve Transparent Statement (auth)
 *   GET  /v1/scitt/entries/:entry_id/receipt     — Retrieve raw Receipt (public)
 *   GET  /v1/scitt/corpus                        — Paginated public corpus (public)
 *   GET  /v1/scitt/corpus/stats                  — Corpus stats (public)
 *   GET  /v1/scitt/corpus.atom                   — Atom feed (public)
 *   GET  /v1/scitt/corpus/:entry_id              — Single entry with parsed claim (public)
 *   POST /v1/scitt/verify                        — Verify a base64 COSE_Sign1 (public)
 *   GET  /v1/scitt/demo-attestation              — Generate a fresh demo signed statement (public)
 *
 * All registration goes through the TransparencyService Durable Object
 * to ensure serialized writes and a single Merkle tree.
 */

import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { HonoEnv } from '../types.js';
import { json, err } from '../utils.js';
import { auditEntryToCAF } from '../caf.js';
import { cafToSignedStatement } from '../caf-scitt.js';
import type { AuditEntry } from '../middleware/audit.js';
import { writeGitCommitAuditEvent } from '../middleware/audit.js';
import {
  reconstructPopaSignedStatement,
  buildSigStructure,
  AGENTLAIR_ROOT_DID,
} from '../lib/popa-cose.js';
import {
  decodeCoseSign1,
  getHeaderInt,
  CborDecodeError,
  type CborValue,
} from '../cbor-decode.js';

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

// ─── POST /git-commits ──────────────────────────────────────────────────────
// Register an AI git commit as a SCITT transparent statement.
//
// Use case: a post-commit hook in an AI-assisted repo calls this endpoint with
// the commit hash, agent DID, and authorization context. The endpoint creates
// an audit log entry for the commit, registers it with the Transparency Service,
// and returns a SCITT Receipt. The receipt can be embedded in the commit as a
// git trailer: "AgentLair-Receipt: <entry_id>"
//
// Body: {
//   commit_hash:   string  — 40-char SHA-1 git commit hash (required)
//   authorized_by: string  — human or system that authorized the AI change (required)
//   repo_url?:     string  — git remote URL for public verifiability
//   message?:      string  — first line of the commit message (optional context)
// }
//
// Response: 201 with entry_id + receipt + receipt_url
//   entry_id:    string — audit entry ID (use as AgentLair-Receipt trailer value)
//   receipt:     string — base64-encoded COSE Receipt (Merkle inclusion proof)
//   receipt_url: string — public URL to fetch the receipt without authentication
//   leaf_index:  number — position in Merkle tree
//   tree_size:   number — total leaves at time of registration
//   root_hash:   string — SHA-256 Merkle root

scittRoutes.post('/git-commits', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');

  if (!c.env.AUDIT || !c.env.AUDIT_SIGNING_KEY) {
    return err('Audit trail not configured.', 503, 'audit_unavailable');
  }

  if (!c.env.TRANSPARENCY_SERVICE) {
    return err('Transparency Service not available.', 503, 'ts_unavailable');
  }

  // Parse and validate request body
  let body: { commit_hash: string; authorized_by: string; repo_url?: string; message?: string };
  try {
    body = await c.req.json();
  } catch {
    return err('Invalid JSON body.', 400, 'invalid_body');
  }

  if (!body.commit_hash || typeof body.commit_hash !== 'string') {
    return err('commit_hash is required.', 400, 'missing_commit_hash');
  }
  if (!/^[0-9a-f]{40}$/i.test(body.commit_hash)) {
    return err('commit_hash must be a 40-character hex SHA-1.', 400, 'invalid_commit_hash');
  }
  if (!body.authorized_by || typeof body.authorized_by !== 'string') {
    return err('authorized_by is required.', 400, 'missing_authorized_by');
  }

  // Create audit log entry for the git commit
  const entryId = await writeGitCommitAuditEvent(c.env, {
    accountId: account.id,
    commitHash: body.commit_hash,
    authorizedBy: body.authorized_by,
    repoUrl: body.repo_url,
    message: body.message,
  });

  if (!entryId) {
    return err('Failed to create audit entry.', 500, 'audit_write_error');
  }

  // Look up the newly created entry
  const queryResult = await c.env.AUDIT
    .prepare('SELECT * FROM audit_log WHERE id = ? AND account_id = ? LIMIT 1')
    .bind(entryId, account.id)
    .all<AuditEntry>();

  const raw = queryResult.results?.[0];
  if (!raw) {
    return err('Audit entry not found after write.', 500, 'audit_read_error');
  }

  const entry: AuditEntry = {
    ...raw,
    details: raw.details
      ? (typeof raw.details === 'string' ? JSON.parse(raw.details as unknown as string) : raw.details)
      : null,
  };

  // Convert to SCITT Signed Statement (CAF → COSE_Sign1)
  const attestation = await auditEntryToCAF(entry, c.env.AUDIT_SIGNING_KEY);
  const signedStatement = await cafToSignedStatement(attestation, c.env.AUDIT_SIGNING_KEY);

  // Submit to Transparency Service DO
  const tsId = c.env.TRANSPARENCY_SERVICE.idFromName('global');
  const tsStub = c.env.TRANSPARENCY_SERVICE.get(tsId);

  const doResponse = await tsStub.fetch(new Request('https://ts/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signedStatement: arrayToBase64(signedStatement),
      entryId,
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
    entry_id: entryId,
    commit_hash: body.commit_hash,
    authorized_by: body.authorized_by,
    leaf_index: result.leafIndex,
    tree_size: result.treeSize,
    root_hash: result.rootHash,
    receipt: result.receipt,
    receipt_url: `https://agentlair.dev/v1/scitt/entries/${entryId}/receipt`,
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
// Removed: the public receipt route on publicScittRoutes (mounted earlier in
// index.ts at line 1096) now handles this path for all callers.
// SCITT receipts are public artifacts per RFC 9052 / IETF SCITT — no IDOR
// scoping is appropriate. The authenticated GET /entries/:id route (which
// includes the full Transparent Statement with account-private payload) remains.

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

// ─── GET /entries/:entry_id/receipt (public) ─────────────────────────────────
// Return just the SCITT Receipt (raw COSE_Sign1 bytes). No auth required.
//
// SCITT receipts are public artifacts per RFC 9052 / IETF SCITT — they contain
// only the cryptographic proof of inclusion, not account-private payload data.
// Anyone can fetch and verify a receipt against the public JWKS.
//
// Lookup is by entry_id only (no IDOR scoping — receipts belong to no single
// account). Mounted earlier than the /v1/* auth middleware (line 1096 in
// index.ts), so this route preempts the now-removed authenticated handler.

publicScittRoutes.get('/entries/:entry_id/receipt', async (c) => {
  if (!c.env.AUDIT) {
    return err('Audit trail not configured.', 503, 'audit_unavailable');
  }

  const entryId = c.req.param('entry_id');

  // No IDOR check — receipts are public artifacts.
  let receipt: { receipt_cbor: string } | null = null;
  try {
    receipt = await c.env.AUDIT
      .prepare('SELECT receipt_cbor FROM scitt_receipts WHERE entry_id = ? LIMIT 1')
      .bind(entryId)
      .first<{ receipt_cbor: string }>();
  } catch {
    // Table may not exist yet
  }

  if (!receipt) {
    return err('No receipt for this entry.', 404, 'no_receipt');
  }

  // Return raw COSE bytes.
  // Cast to BodyInit: strict DOM types reject Uint8Array<ArrayBufferLike>, but
  // Workers runtime accepts it (no SharedArrayBuffer in Workers).
  const receiptBytes = base64ToArray(receipt.receipt_cbor);
  return new Response(receiptBytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/scitt-receipt+cose',
      'Content-Length': String(receiptBytes.length),
    },
  });
});

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
  const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 100);

  // Order: 'asc' (default, chronological pagination) or 'desc' (newest-first feed)
  const orderParam = url.searchParams.get('order');
  if (orderParam !== null && orderParam !== 'asc' && orderParam !== 'desc') {
    return err('Invalid order: must be "asc" or "desc".', 400, 'invalid_order');
  }
  const order: 'asc' | 'desc' = orderParam === 'desc' ? 'desc' : 'asc';

  // Cursor semantics depend on order:
  //   asc:  after = exclusive lower bound (return leaf_index > after); default -1 (start)
  //   desc: after = exclusive upper bound (return leaf_index < after); default Number.MAX_SAFE_INTEGER (top)
  const after = afterParam !== null ? parseInt(afterParam, 10) : (order === 'desc' ? Number.MAX_SAFE_INTEGER : -1);
  if (afterParam !== null && (isNaN(after) || after < 0)) {
    return err('Invalid cursor: after must be a non-negative integer.', 400, 'invalid_cursor');
  }

  try {
    const sql = order === 'desc'
      ? `
        SELECT
          r.entry_id, r.leaf_index, r.tree_size, r.root_hash, r.created_at,
          a.account_id, a.category, a.action, a.signature
        FROM scitt_receipts r
        JOIN audit_log a ON a.id = r.entry_id
        WHERE r.leaf_index < ?
        ORDER BY r.leaf_index DESC
        LIMIT ?
      `
      : `
        SELECT
          r.entry_id, r.leaf_index, r.tree_size, r.root_hash, r.created_at,
          a.account_id, a.category, a.action, a.signature
        FROM scitt_receipts r
        JOIN audit_log a ON a.id = r.entry_id
        WHERE r.leaf_index > ?
        ORDER BY r.leaf_index ASC
        LIMIT ?
      `;

    const results = await c.env.AUDIT.prepare(sql)
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
      order,
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

// ─── Verifier helpers (shared between /corpus/:id, /verify, /demo) ───────────

const HDR_ALG = 1;
const HDR_CONTENT_TYPE = 3;
const HDR_KID = 4;
const HDR_CWT_CLAIMS = 15;
const HDR_ISSUER = 391;
const ALG_EDDSA = -8;

const CWT_ISS = 1;
const CWT_SUB = 2;
const CWT_IAT = 6;

interface DecodedClaim {
  /** "EdDSA" if alg is -8, otherwise null */
  alg: string | null;
  /** Numeric COSE algorithm value (e.g. -8) */
  alg_value: number | null;
  /** Content type from protected header (e.g. application/popa+json) */
  content_type: string | null;
  /** Key ID from header (text) — only set for audit-derived statements */
  kid: string | null;
  /** Issuer URI (CWT iss claim or HDR_ISSUER) */
  issuer: string | null;
  /** Subject URI (CWT sub claim) */
  subject: string | null;
  /** ISO timestamp from CWT iat claim, if present */
  issued_at_cwt: string | null;
  /** Statement type (PoPA/CAF schema-specific descriptor) */
  statement_type: string;
  /** Decoded payload as JSON if it parses, otherwise the raw UTF-8 string */
  payload: unknown;
  /** True if payload was a valid JSON object/array */
  payload_is_json: boolean;
}

function decodeProtectedHeader(map: Map<CborValue, CborValue>, payload: Uint8Array | null): DecodedClaim {
  const algValue = getHeaderInt(map, HDR_ALG);
  const contentType = getHeaderInt(map, HDR_CONTENT_TYPE);
  const kid = getHeaderInt(map, HDR_KID);
  const issuerHdr = getHeaderInt(map, HDR_ISSUER);
  const cwtClaims = getHeaderInt(map, HDR_CWT_CLAIMS);

  let issuer: string | null = null;
  let subject: string | null = null;
  let issuedAtCwt: string | null = null;

  if (typeof issuerHdr === 'string') {
    issuer = issuerHdr;
  }

  if (cwtClaims instanceof Map) {
    const iss = cwtClaims.get(CWT_ISS);
    const sub = cwtClaims.get(CWT_SUB);
    const iat = cwtClaims.get(CWT_IAT);
    if (typeof iss === 'string') issuer = iss;
    if (typeof sub === 'string') subject = sub;
    if (typeof iat === 'number') issuedAtCwt = new Date(iat * 1000).toISOString();
  }

  // Decode payload to a JSON object if possible
  let parsedPayload: unknown = null;
  let payloadIsJson = false;
  let decodedPayloadText = '';
  if (payload && payload.length > 0) {
    try {
      decodedPayloadText = new TextDecoder('utf-8', { fatal: false }).decode(payload);
      parsedPayload = JSON.parse(decodedPayloadText);
      payloadIsJson = true;
    } catch {
      parsedPayload = decodedPayloadText;
      payloadIsJson = false;
    }
  }

  // Heuristic statement type from content_type + payload
  const ctText = typeof contentType === 'string' ? contentType : null;
  let statementType = 'unknown';
  if (ctText === 'application/popa+json') {
    statementType = 'popa.daily';
  } else if (ctText === 'application/caf+json') {
    statementType = 'caf.attestation';
    // Refine if the payload exposes a category/action pair
    if (payloadIsJson && parsedPayload && typeof parsedPayload === 'object') {
      const obj = parsedPayload as Record<string, unknown>;
      if (typeof obj.category === 'string' && typeof obj.action === 'string') {
        statementType = `${obj.category}.${obj.action}`;
      }
    }
  } else if (ctText) {
    statementType = ctText;
  }

  return {
    alg: typeof algValue === 'number' && algValue === ALG_EDDSA ? 'EdDSA' : null,
    alg_value: typeof algValue === 'number' ? algValue : null,
    content_type: ctText,
    kid: typeof kid === 'string' ? kid : null,
    issuer,
    subject,
    issued_at_cwt: issuedAtCwt,
    statement_type: statementType,
    payload: parsedPayload,
    payload_is_json: payloadIsJson,
  };
}

interface VerificationResult {
  valid: boolean;
  /** "ed25519_against_jwks", "alg_unsupported", "key_not_found", "no_payload", "signature_invalid" */
  reason: string;
  /** Hex matched JWK kid if any */
  matched_kid: string | null;
  /** Issuer's published JWKS URL */
  jwks_url: string | null;
}

/**
 * Resolve the JWKS URL for a given issuer URI.
 *
 * For did:web:HOST and did:web:HOST:path:..., the JWKS lives at the host's
 * /.well-known/jwks.json (per AgentLair convention — single Ed25519 key
 * shared across all sub-DIDs in v1).
 */
function jwksUrlForIssuer(issuer: string | null): string | null {
  if (!issuer) return null;
  if (issuer.startsWith('did:web:')) {
    const rest = issuer.slice('did:web:'.length);
    const host = rest.split(':')[0];
    if (!host) return null;
    return `https://${decodeURIComponent(host)}/.well-known/jwks.json`;
  }
  return null;
}

/**
 * Verify a COSE_Sign1 envelope against the issuer's published JWKS.
 *
 * Only Ed25519 (alg=-8) is supported in v1. Returns a structured result
 * — never throws.
 *
 * For AgentLair-issued statements (issuer = did:web:agentlair.dev or any
 * sub-DID under it), the public key is derived directly from the worker's
 * own AUDIT_SIGNING_KEY rather than fetched over HTTP. Cloudflare Workers
 * calling their own hostname can hit a 522 loop in certain edge configs —
 * and the local key matches the JWKS by construction, so the round-trip
 * is wasted work either way. The jwks_url is still returned in the response
 * so the client can re-verify against the published material independently.
 */
async function verifySignedStatement(
  protectedBytes: Uint8Array,
  payload: Uint8Array | null,
  signature: Uint8Array,
  decoded: DecodedClaim,
  signingKeyB64?: string | null,
): Promise<VerificationResult> {
  const jwksUrl = jwksUrlForIssuer(decoded.issuer);
  if (decoded.alg_value !== ALG_EDDSA) {
    return {
      valid: false,
      reason: 'alg_unsupported',
      matched_kid: null,
      jwks_url: jwksUrl,
    };
  }
  if (!payload) {
    return { valid: false, reason: 'no_payload', matched_kid: null, jwks_url: jwksUrl };
  }
  if (!jwksUrl) {
    return { valid: false, reason: 'no_jwks', matched_kid: null, jwks_url: null };
  }

  const sigStructure = buildSigStructure(protectedBytes, payload);

  // Local-key shortcut: avoid same-origin fetch when the issuer is one we
  // sign for. The JWKS publishes the same single Ed25519 key.
  const isAgentLairIssuer = !!decoded.issuer && (
    decoded.issuer === AGENTLAIR_ROOT_DID ||
    decoded.issuer.startsWith(`${AGENTLAIR_ROOT_DID}:`)
  );
  if (isAgentLairIssuer && signingKeyB64) {
    try {
      const privBytes = Uint8Array.from(atob(signingKeyB64), (c) => c.charCodeAt(0));
      const pubBytes = ed25519.getPublicKey(privBytes);
      if (ed25519.verify(signature, sigStructure, pubBytes)) {
        return {
          valid: true,
          reason: 'ed25519_against_local_signing_key',
          matched_kid: decoded.kid ?? null,
          jwks_url: jwksUrl,
        };
      }
      return { valid: false, reason: 'signature_invalid', matched_kid: null, jwks_url: jwksUrl };
    } catch (e) {
      // Fall through to the JWKS path
      console.warn('[scitt/verify] local-key path failed:', e instanceof Error ? e.message : String(e));
    }
  }

  let jwks: { keys?: Array<{ kid?: string; kty?: string; crv?: string; x?: string }> };
  try {
    const r = await fetch(jwksUrl);
    if (!r.ok) {
      return { valid: false, reason: `jwks_fetch_failed: HTTP ${r.status}`, matched_kid: null, jwks_url: jwksUrl };
    }
    jwks = await r.json();
  } catch (e) {
    return {
      valid: false,
      reason: `jwks_fetch_failed: ${e instanceof Error ? e.message : String(e)}`,
      matched_kid: null,
      jwks_url: jwksUrl,
    };
  }

  // Filter to Ed25519 keys
  const ed25519Keys = (jwks.keys ?? []).filter((k) => k.kty === 'OKP' && k.crv === 'Ed25519' && typeof k.x === 'string');

  // Prefer matching by kid if set, otherwise try every key
  let candidates = ed25519Keys;
  if (decoded.kid) {
    const matched = ed25519Keys.filter((k) => k.kid === decoded.kid);
    if (matched.length > 0) candidates = matched;
  }

  if (candidates.length === 0) {
    return { valid: false, reason: 'key_not_found', matched_kid: null, jwks_url: jwksUrl };
  }

  for (const k of candidates) {
    if (!k.x) continue;
    const pubBytes = b64urlToBytes(k.x);
    try {
      if (ed25519.verify(signature, sigStructure, pubBytes)) {
        return { valid: true, reason: 'ed25519_against_jwks', matched_kid: k.kid ?? null, jwks_url: jwksUrl };
      }
    } catch {
      // Try next key
    }
  }

  return { valid: false, reason: 'signature_invalid', matched_kid: null, jwks_url: jwksUrl };
}

function b64urlToBytes(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── GET /corpus/:entry_id ───────────────────────────────────────────────────
//
// Public single-entry view. Returns the parsed claim, the COSE envelope as
// base64, the components needed for client-side re-verification, AND the
// receipt metadata (Merkle proof position).
//
// Source of bytes:
//   1. popa_attestations.signed_statement_cbor (set by post-migration emitter)
//   2. Otherwise: 404 with a "legacy entry" hint (the verifier UI can still
//      render a degraded view from the receipt metadata + corpus listing)
//
// NOTE: the URL prefix /corpus/:entry_id is mounted UNDER /v1/scitt, so the
// public path is /v1/scitt/corpus/:entry_id.

publicScittRoutes.get('/corpus/:entry_id', async (c) => {
  if (!c.env.AUDIT) {
    return err('Transparency Service not available.', 503, 'ts_unavailable');
  }

  const entryId = c.req.param('entry_id');
  // Strip optional "scitt:" prefix (PoPA references statements as "scitt:popa_xxx")
  const lookupId = entryId.startsWith('scitt:') ? entryId.slice('scitt:'.length) : entryId;

  // 1. Look up the receipt metadata (always present for a registered entry)
  const receiptRow = await c.env.AUDIT
    .prepare('SELECT leaf_index, tree_size, root_hash, created_at FROM scitt_receipts WHERE entry_id = ? LIMIT 1')
    .bind(lookupId)
    .first<{ leaf_index: number; tree_size: number; root_hash: string; created_at: string }>();

  if (!receiptRow) {
    return err('SCITT entry not found.', 404, 'entry_not_found');
  }

  // 2. Try popa_attestations first (this covers the PoPA daily emissions)
  let popaRow: {
    signed_statement_cbor: string | null;
    agent_did: string;
    sequence: number;
  } | null = null;
  try {
    popaRow = await c.env.AUDIT
      .prepare(
        'SELECT signed_statement_cbor, agent_did, sequence FROM popa_attestations WHERE entry_id = ? LIMIT 1',
      )
      .bind(lookupId)
      .first<{ signed_statement_cbor: string | null; agent_did: string; sequence: number }>();
  } catch {
    // Migration 0011 not yet applied — fall back to selecting just the existence row
    popaRow = await c.env.AUDIT
      .prepare('SELECT NULL AS signed_statement_cbor, agent_did, sequence FROM popa_attestations WHERE entry_id = ? LIMIT 1')
      .bind(lookupId)
      .first<{ signed_statement_cbor: string | null; agent_did: string; sequence: number }>();
  }

  if (popaRow && popaRow.signed_statement_cbor) {
    // Full verification path — bytes are archived
    const signedStatement = base64ToArray(popaRow.signed_statement_cbor);
    let decoded: DecodedClaim;
    let components: { protected: Uint8Array; payload: Uint8Array | null; signature: Uint8Array };
    try {
      const cose = decodeCoseSign1(signedStatement);
      decoded = decodeProtectedHeader(cose.protectedMap, cose.payload);
      components = { protected: cose.protected, payload: cose.payload, signature: cose.signature };
    } catch (e) {
      return err(
        `Failed to decode archived signed statement: ${e instanceof Error ? e.message : String(e)}`,
        500,
        'decode_failed',
      );
    }

    const verification = await verifySignedStatement(
      components.protected,
      components.payload,
      components.signature,
      decoded,
      c.env.AUDIT_SIGNING_KEY,
    );

    return json({
      entry_id: lookupId,
      bytes_archived: true,
      signed_statement_b64: popaRow.signed_statement_cbor,
      signing_input_b64: arrayToBase64(buildSigStructure(components.protected, components.payload ?? new Uint8Array(0))),
      protected_b64: arrayToBase64(components.protected),
      payload_b64: components.payload ? arrayToBase64(components.payload) : null,
      signature_b64: arrayToBase64(components.signature),
      claim: {
        alg: decoded.alg,
        content_type: decoded.content_type,
        kid: decoded.kid,
        issuer: decoded.issuer,
        subject: decoded.subject,
        issued_at: decoded.issued_at_cwt,
        statement_type: decoded.statement_type,
        payload: decoded.payload,
      },
      verification,
      receipt: {
        leaf_index: receiptRow.leaf_index,
        tree_size: receiptRow.tree_size,
        root_hash: receiptRow.root_hash,
        registered_at: receiptRow.created_at,
        receipt_url: `https://agentlair.dev/v1/scitt/entries/${encodeURIComponent(lookupId)}/receipt`,
      },
    });
  }

  // 3. Bytes not archived — return receipt-only metadata with a hint
  return json({
    entry_id: lookupId,
    bytes_archived: false,
    bytes_archived_reason: popaRow
      ? 'This PoPA entry pre-dates statement archival (migration 0011). The receipt remains in the transparency log; the original signed statement bytes were not preserved. Newer entries from this DID will support full verification.'
      : 'This entry was registered through a non-PoPA path. Use the authenticated GET /v1/scitt/entries/:id route (account ownership required) to retrieve the full Transparent Statement.',
    signed_statement_b64: null,
    signing_input_b64: null,
    protected_b64: null,
    payload_b64: null,
    signature_b64: null,
    claim: popaRow
      ? {
          alg: 'EdDSA',
          content_type: 'application/popa+json',
          kid: null,
          issuer: AGENTLAIR_ROOT_DID,
          subject: popaRow.agent_did,
          issued_at: null,
          statement_type: 'popa.daily',
          payload: { agent_did: popaRow.agent_did, sequence: popaRow.sequence },
        }
      : null,
    verification: {
      valid: false,
      reason: 'bytes_unavailable',
      matched_kid: null,
      jwks_url: jwksUrlForIssuer(AGENTLAIR_ROOT_DID),
    },
    receipt: {
      leaf_index: receiptRow.leaf_index,
      tree_size: receiptRow.tree_size,
      root_hash: receiptRow.root_hash,
      registered_at: receiptRow.created_at,
      receipt_url: `https://agentlair.dev/v1/scitt/entries/${encodeURIComponent(lookupId)}/receipt`,
    },
  });
});

// ─── POST /verify ────────────────────────────────────────────────────────────
//
// Public stateless verifier. Accepts a base64-encoded COSE_Sign1 envelope
// (signed statement) and returns: parsed claim + signature validity vs the
// issuer's published JWKS. No auth, no logging beyond the access log.
//
// Body: { signed_statement: <base64 cose_sign1> }

publicScittRoutes.post('/verify', async (c) => {
  let body: { signed_statement?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return err('Invalid JSON body.', 400, 'invalid_body');
  }

  if (typeof body.signed_statement !== 'string' || body.signed_statement.length === 0) {
    return err('signed_statement (base64 string) is required.', 400, 'missing_signed_statement');
  }
  if (body.signed_statement.length > 64 * 1024) {
    return err('signed_statement exceeds 64 KiB.', 400, 'too_large');
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToArray(body.signed_statement);
  } catch {
    return err('signed_statement is not valid base64.', 400, 'invalid_base64');
  }

  let cose;
  try {
    cose = decodeCoseSign1(bytes);
  } catch (e) {
    if (e instanceof CborDecodeError) {
      return err(e.message, 400, 'invalid_cose');
    }
    return err(`Decode failed: ${e instanceof Error ? e.message : String(e)}`, 400, 'invalid_cose');
  }

  const decoded = decodeProtectedHeader(cose.protectedMap, cose.payload);
  const verification = await verifySignedStatement(
    cose.protected,
    cose.payload,
    cose.signature,
    decoded,
    c.env.AUDIT_SIGNING_KEY,
  );

  return json({
    valid: verification.valid,
    verification,
    claim: {
      alg: decoded.alg,
      content_type: decoded.content_type,
      kid: decoded.kid,
      issuer: decoded.issuer,
      subject: decoded.subject,
      issued_at: decoded.issued_at_cwt,
      statement_type: decoded.statement_type,
      payload: decoded.payload,
      payload_is_json: decoded.payload_is_json,
    },
    components: {
      protected_b64: arrayToBase64(cose.protected),
      payload_b64: cose.payload ? arrayToBase64(cose.payload) : null,
      signature_b64: arrayToBase64(cose.signature),
      signing_input_b64: arrayToBase64(buildSigStructure(cose.protected, cose.payload ?? new Uint8Array(0))),
    },
  });
});

// ─── GET /demo-attestation ───────────────────────────────────────────────────
//
// Returns a freshly-generated PoPA-shaped signed statement that verifies
// against the live JWKS but is NOT registered in the transparency log.
//
// Use case: the public verifier UX needs a working sample for users who
// don't have any signed statement of their own to paste. Pointing the
// sample button at a real corpus entry is preferred when bytes are
// archived; the demo path is the fallback that always works.
//
// The payload is clearly marked as a demo (demo: true, sequence: 0,
// activity_proof.window_hash: "sha256:demo") so it can never be confused
// with a real attestation.

publicScittRoutes.get('/demo-attestation', async (c) => {
  if (!c.env.AUDIT_SIGNING_KEY) {
    return err('Signing key not configured.', 503, 'no_key');
  }

  const issuedAt = new Date().toISOString();
  // Fixed window: the most recent UTC-day-aligned window, so the demo
  // payload "looks like" a real PoPA attestation in shape.
  const now = new Date();
  const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const windowStart = new Date(windowEnd.getTime() - 86_400_000);

  const reconstructed = await reconstructPopaSignedStatement(
    {
      agent_did: AGENTLAIR_ROOT_DID,
      entry_id: 'popa_demo_synthetic',
      sequence: 0,                             // 0 → never matches a real emission (real seqs start at 1)
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      mcp_call_count: 0,
      issued_at: issuedAt,
      prev_attestation_id: null,
    },
    c.env.AUDIT_SIGNING_KEY,
  );

  // Decode for the response so the caller sees what the bytes mean
  const cose = decodeCoseSign1(reconstructed.coseBytes);
  const decoded = decodeProtectedHeader(cose.protectedMap, cose.payload);
  const verification = await verifySignedStatement(
    cose.protected,
    cose.payload,
    cose.signature,
    decoded,
    c.env.AUDIT_SIGNING_KEY,
  );

  return json({
    demo: true,
    note: 'This signed statement is freshly generated for verifier UX. It is NOT registered in the SCITT transparency log. The signature verifies against the live JWKS because it is signed with the production key, but no Merkle inclusion proof exists for it.',
    signed_statement_b64: arrayToBase64(reconstructed.coseBytes),
    claim: {
      alg: decoded.alg,
      content_type: decoded.content_type,
      kid: decoded.kid,
      issuer: decoded.issuer,
      subject: decoded.subject,
      issued_at: decoded.issued_at_cwt,
      statement_type: decoded.statement_type,
      payload: decoded.payload,
    },
    verification,
    components: {
      protected_b64: arrayToBase64(cose.protected),
      payload_b64: cose.payload ? arrayToBase64(cose.payload) : null,
      signature_b64: arrayToBase64(cose.signature),
      signing_input_b64: arrayToBase64(buildSigStructure(cose.protected, cose.payload ?? new Uint8Array(0))),
    },
  });
});
