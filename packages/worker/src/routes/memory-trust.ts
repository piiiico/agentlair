// ─── Memory Trust Routes ──────────────────────────────────────────────────────
//
// GET /v1/agents/:id/memory-trust
//
// Public endpoint — no API key required. Payment IS authentication: 0.01 USDC via x402.
// Returns verified memory behavioral patterns derived from memory access audit events.
//
// How it works:
//   1. Agent issues an AAT with memory:read or memory:write scope via POST /v1/tokens/issue
//   2. AgentLair writes a signed memory.token_issue audit event to the audit trail
//   3. This endpoint queries those events and returns behavioral patterns
//   4. Third parties use this to decide whether to trust an agent's memory claims
//
// Mounted in index.ts BEFORE the /v1/* auth middleware (public, x402-gated).

import { Hono } from 'hono';
import { json, err } from '../utils.js';
import type { HonoEnv } from '../types.js';
import { verifyX402Payment, settleX402Payment, trackX402Spend, make402Response, SERVICE_PRICES } from '../x402.js';

export const memoryTrustRoutes = new Hono<HonoEnv>();

// ─── Validation ───────────────────────────────────────────────────────────────

const ACCOUNT_ID_RE = /^acc_[A-Za-z0-9_-]{1,64}$/;

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemoryAuditRow {
  timestamp: string;
  details: string | null;
  result: string;
}

// ─── GET /v1/agents/:id/memory-trust ─────────────────────────────────────────
//
// Returns verified memory behavioral patterns for an agent:
//   - Total memory-scoped AATs issued
//   - Read vs write breakdown
//   - Temporal consistency score
//   - Access pattern classification (read_heavy / write_heavy / balanced)
//   - Unique memory backends (distinct audience URLs)
//   - Behavioral summary
//
// Requires AUDIT D1 binding. Returns 503 if not configured.
// All patterns derived from the tamper-evident audit trail — not self-reported.

memoryTrustRoutes.get('/:id/memory-trust', async (c) => {
  // ── Validate agent ID ───────────────────────────────────────────────────────
  const agentId = c.req.param('id');
  if (!agentId || !ACCOUNT_ID_RE.test(agentId)) {
    return err('Invalid agent ID format. Expected: acc_<alphanumeric>.', 400, 'invalid_agent_id');
  }

  // ── x402 payment required ────────────────────────────────────────────────────
  const xPayment = c.req.header('X-PAYMENT');
  if (!xPayment) {
    return make402Response(SERVICE_PRICES.memory_trust);
  }

  const verification = await verifyX402Payment(xPayment, SERVICE_PRICES.memory_trust);
  if (!verification.valid) {
    return make402Response(SERVICE_PRICES.memory_trust, { payment_error: verification.error });
  }

  const settlement = await settleX402Payment(xPayment, SERVICE_PRICES.memory_trust);
  if (!settlement.settled) {
    return make402Response(SERVICE_PRICES.memory_trust, { payment_error: settlement.error });
  }

  if (settlement.receipt) {
    c.header('X-Payment-Response', settlement.receipt);
  }

  c.executionCtx.waitUntil(
    trackX402Spend(c.env, 'anonymous', SERVICE_PRICES.memory_trust.amount, {
      payer: verification.payer,
      service: 'memory_trust',
    }).catch(() => {}),
  );

  // ── Query audit trail for memory events ─────────────────────────────────────
  const db = c.env.AUDIT;
  if (!db) {
    return err(
      'Memory trust requires the audit trail database (AUDIT D1 binding). Not configured.',
      503,
      'audit_unavailable',
    );
  }

  let rows: MemoryAuditRow[] = [];
  try {
    const result = await db
      .prepare(
        `SELECT timestamp, details, result
         FROM audit_log
         WHERE account_id = ? AND category = 'memory' AND action = 'memory.token_issue'
         ORDER BY timestamp DESC
         LIMIT 500`,
      )
      .bind(agentId)
      .all<MemoryAuditRow>();
    rows = result.results ?? [];
  } catch {
    return err('Failed to query memory audit trail.', 500, 'query_error');
  }

  // ── Compute behavioral patterns ─────────────────────────────────────────────

  let readCount = 0;
  let writeCount = 0;
  let firstAccess: string | null = null;
  let lastAccess: string | null = null;
  const accessTimes: number[] = [];
  const audiences = new Set<string>();

  // Rows come back newest-first; iterate to collect all
  for (const row of rows) {
    let details: Record<string, unknown> = {};
    try {
      if (row.details) details = JSON.parse(row.details) as Record<string, unknown>;
    } catch { /* ignore malformed details */ }

    if (details.memory_read === true) readCount++;
    if (details.memory_write === true) writeCount++;
    if (typeof details.audience === 'string' && details.audience.length > 0) {
      audiences.add(details.audience);
    }

    const ts = new Date(row.timestamp).getTime();
    if (!isNaN(ts)) {
      accessTimes.push(ts);
      // First/last: rows sorted newest-first
      if (!lastAccess) lastAccess = row.timestamp;
      firstAccess = row.timestamp; // overwrites each iteration → ends up oldest
    }
  }

  const totalTokens = readCount + writeCount;
  const readWriteRatio = totalTokens > 0 ? readCount / totalTokens : 0;
  const accessPattern =
    readWriteRatio > 0.7 ? 'read_heavy' : readWriteRatio < 0.3 ? 'write_heavy' : 'balanced';

  // Temporal consistency: coefficient of variation of inter-access gaps (lower CV = more consistent)
  let consistencyScore = 0;
  if (accessTimes.length >= 3) {
    const sorted = [...accessTimes].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((t, i) => t - sorted[i]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (mean > 0) {
      const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
      const cv = Math.sqrt(variance) / mean;
      consistencyScore = Math.max(0, Math.min(1, 1 - cv / 2));
    } else {
      consistencyScore = 0.5; // all at same timestamp — burst access
    }
  } else if (accessTimes.length === 2) {
    consistencyScore = 0.5; // two points — no pattern yet
  } else if (accessTimes.length === 1) {
    consistencyScore = 0.3; // single event — too early to judge
  }

  // Day span for summary
  const daysSpan =
    firstAccess && lastAccess && firstAccess !== lastAccess
      ? Math.max(1, Math.round(
          (new Date(lastAccess).getTime() - new Date(firstAccess).getTime()) / 86_400_000,
        ))
      : 0;

  let behavioralSummary: string;
  if (totalTokens === 0) {
    behavioralSummary =
      'No memory access events recorded. Agent has not issued memory-scoped AATs.';
  } else if (totalTokens < 5) {
    behavioralSummary = `Early-stage memory usage. ${totalTokens} memory token(s) issued — insufficient data for behavioral profiling.`;
  } else {
    const span = daysSpan > 0 ? ` over ${daysSpan} day(s)` : '';
    const consistency =
      consistencyScore >= 0.7 ? 'consistent' : consistencyScore >= 0.4 ? 'irregular' : 'bursty';
    behavioralSummary = `Agent issued ${totalTokens} memory-scoped AATs${span}. Pattern: ${accessPattern}, access cadence: ${consistency}. Consistency score: ${(consistencyScore * 100).toFixed(0)}%.`;
  }

  return json({
    agent_id: agentId,
    memory_behavior: {
      total_memory_tokens: totalTokens,
      memory_read_count: readCount,
      memory_write_count: writeCount,
      read_write_ratio: Number(readWriteRatio.toFixed(3)),
      first_memory_access: firstAccess,
      last_memory_access: lastAccess,
      unique_memory_backends: audiences.size,
      consistency_score: Number(consistencyScore.toFixed(3)),
      access_pattern: accessPattern,
      behavioral_summary: behavioralSummary,
    },
    verified_by: 'agentlair.dev',
    jwks_uri: 'https://agentlair.dev/.well-known/jwks.json',
    audit_source: `https://agentlair.dev/v1/audit?account=${agentId}&category=memory`,
    generated_at: new Date().toISOString(),
  });
});
