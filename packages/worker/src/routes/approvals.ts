// ─── Approval Routes ──────────────────────────────────────────────────────────
// Handles the approval flow for on_limit=approve budget behavior.
//
// When an agent's spending would exceed budget and on_limit is set to 'approve',
// the charge endpoint creates an approval_request instead of executing.
// The principal (operator) can then approve or reject the request.
//
// Endpoints:
//   POST /v1/charge               — declare spending intent (creates approval if over budget)
//   GET  /v1/approvals            — list pending approval requests
//   POST /v1/approvals/:id/approve — approve a pending request
//   POST /v1/approvals/:id/reject  — reject a pending request
//
// Storage: D1 (agentlair-audit database), `approval_requests` table

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { err, json, getBudgetResetAt } from '../utils.js';
import { writeBudgetAuditEvent } from '../middleware/audit.js';
import { recordBudgetSpend } from '../middleware/budget.js';

// ─── D1 helpers ────────────────────────────────────────────────────────────────

interface ApprovalRow {
  id: string;
  account_id: string;
  amount_usdc: number;
  category: string;
  description: string;
  reference_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  expires_at: string;
  metadata: string | null;
}

/** Ensure the approval_requests table exists (idempotent). */
async function ensureApprovalsTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      amount_usdc INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'platform',
      description TEXT NOT NULL DEFAULT '',
      reference_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      resolved_by TEXT,
      expires_at TEXT NOT NULL,
      metadata TEXT
    )
  `).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_approvals_account_status ON approval_requests(account_id, status)`
  ).run();
}

/** Check budget against configured caps. Returns exceeded periods or empty array. */
async function checkBudgetExceeded(
  db: D1Database,
  agentId: string,
  additionalAmount: number,
): Promise<Array<{ period: string; spent: number; limit: number; resetAt: string }>> {
  const exceeded: Array<{ period: string; spent: number; limit: number; resetAt: string }> = [];
  const periods = ['daily', 'weekly', 'monthly'];

  for (const period of periods) {
    const row = await db.prepare(
      `SELECT limit_amount, spent_amount, reset_at FROM budgets WHERE agent_id = ? AND period = ?`
    ).bind(agentId, period).first<{ limit_amount: number | null; spent_amount: number; reset_at: string }>();

    if (!row || row.limit_amount == null) continue;

    // Reset if period expired
    let spent = row.spent_amount;
    if (new Date(row.reset_at) <= new Date()) {
      await db.prepare(
        `UPDATE budgets SET spent_amount = 0, reset_at = ?, updated_at = datetime('now') WHERE agent_id = ? AND period = ?`
      ).bind(getBudgetResetAt(period), agentId, period).run();
      spent = 0;
    }

    if (spent + additionalAmount > row.limit_amount) {
      exceeded.push({
        period,
        spent,
        limit: row.limit_amount,
        resetAt: row.reset_at,
      });
    }
  }

  return exceeded;
}

/** Load budget settings for an agent. */
async function loadBudgetSettings(db: D1Database, agentId: string): Promise<{
  on_limit: 'reject' | 'approve';
  single_tx_limit: number | null;
}> {
  const row = await db.prepare(
    `SELECT on_limit, single_tx_limit FROM budget_settings WHERE agent_id = ?`
  ).bind(agentId).first<{ on_limit: string; single_tx_limit: number | null }>();
  if (!row) return { on_limit: 'reject', single_tx_limit: null };
  return {
    on_limit: row.on_limit === 'approve' ? 'approve' : 'reject',
    single_tx_limit: row.single_tx_limit ?? null,
  };
}

// ─── Route definitions ─────────────────────────────────────────────────────────

export const approvalRoutes = new Hono<HonoEnv>();
export const chargeRoutes = new Hono<HonoEnv>();

// ── POST /v1/charge — declare spending intent ─────────────────────────────────
// If within budget: records spend immediately, returns { status: 'completed' }
// If over budget + on_limit=reject: returns 402 with exceeded info
// If over budget + on_limit=approve: creates approval request, returns 202
chargeRoutes.post('/', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Charge feature requires D1 binding.', 503, 'service_unavailable');

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch {}

  // Validate amount (required, positive integer in atomic USDC units)
  const amount = body.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return err('amount is required and must be a positive integer (atomic USDC units, 1e-6 USDC).', 400, 'invalid_request');
  }
  if (amount > 1_000_000_000) {
    return err('amount exceeds maximum (1,000,000,000 = 1000 USDC).', 400, 'invalid_request');
  }

  const category = typeof body.category === 'string' ? body.category : 'platform';
  const description = typeof body.description === 'string' ? body.description : 'Agent charge';
  const referenceId = typeof body.reference_id === 'string' ? body.reference_id : null;
  const metadata = body.metadata && typeof body.metadata === 'object' ? JSON.stringify(body.metadata) : null;

  const agentId = account.id;
  const db = c.env.AUDIT;

  try {
    await ensureApprovalsTable(db);

    // Load settings
    const settings = await loadBudgetSettings(db, agentId);

    // Check single-tx limit
    if (settings.single_tx_limit != null && amount > settings.single_tx_limit) {
      if (settings.on_limit === 'approve') {
        // Create approval request for single-tx limit exceeded
        const approvalId = `apr_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

        await db.prepare(`
          INSERT INTO approval_requests (id, account_id, amount_usdc, category, description, reference_id, status, expires_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `).bind(approvalId, agentId, amount, category, description, referenceId, expiresAt, metadata).run();

        c.executionCtx.waitUntil(
          writeBudgetAuditEvent(c.env, {
            action: 'budget.approval_created',
            accountId: agentId,
            details: { approval_id: approvalId, amount, reason: 'single_tx_limit_exceeded', single_tx_limit: settings.single_tx_limit },
          })
        );

        return json({
          status: 'approval_required',
          approval_id: approvalId,
          reason: 'single_tx_limit_exceeded',
          single_tx_limit_usdc: settings.single_tx_limit,
          amount_usdc: amount,
          expires_at: expiresAt,
          message: 'Transaction exceeds single-transaction limit. Awaiting principal approval.',
          check_url: `/v1/approvals/${approvalId}`,
        }, 202);
      }

      return json({
        error: 'single_tx_limit_exceeded',
        message: `Transaction amount (${amount}) exceeds single-transaction limit (${settings.single_tx_limit}).`,
        single_tx_limit_usdc: settings.single_tx_limit,
        amount_usdc: amount,
      }, 402);
    }

    // Check budget caps
    const exceeded = await checkBudgetExceeded(db, agentId, amount);

    if (exceeded.length === 0) {
      // Within budget — record spend immediately
      await recordBudgetSpend(c.env, agentId, amount, {
        category,
        description,
        referenceId: referenceId ?? undefined,
      });

      const chargeId = `chg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

      c.executionCtx.waitUntil(
        writeBudgetAuditEvent(c.env, {
          action: 'budget.charge_completed',
          accountId: agentId,
          details: { charge_id: chargeId, amount, category, description },
        })
      );

      return json({
        status: 'completed',
        charge_id: chargeId,
        amount_usdc: amount,
        category,
        description,
        message: 'Charge recorded successfully.',
      });
    }

    // Budget exceeded
    if (settings.on_limit === 'approve') {
      // Create approval request
      const approvalId = `apr_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

      await db.prepare(`
        INSERT INTO approval_requests (id, account_id, amount_usdc, category, description, reference_id, status, expires_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).bind(approvalId, agentId, amount, category, description, referenceId, expiresAt, metadata).run();

      c.executionCtx.waitUntil(
        writeBudgetAuditEvent(c.env, {
          action: 'budget.approval_created',
          accountId: agentId,
          details: {
            approval_id: approvalId,
            amount,
            reason: 'budget_exceeded',
            exceeded_periods: exceeded.map(e => e.period).join(','),
          },
        })
      );

      // Notify operator if email is configured
      c.executionCtx.waitUntil(notifyOperator(c.env, account, approvalId, amount, category, description, exceeded));

      return json({
        status: 'approval_required',
        approval_id: approvalId,
        reason: 'budget_exceeded',
        amount_usdc: amount,
        exceeded: exceeded.map(e => ({
          period: e.period,
          spent_usdc: e.spent,
          limit_usdc: e.limit,
          remaining_usdc: Math.max(0, e.limit - e.spent),
          resets_at: e.resetAt,
        })),
        expires_at: expiresAt,
        message: 'Spending cap reached. Approval request created for principal review.',
        check_url: `/v1/approvals/${approvalId}`,
      }, 202);
    }

    // on_limit: reject
    return json({
      error: 'budget_exceeded',
      message: 'Spending cap reached. Check GET /v1/budget for remaining allowance.',
      budget_url: '/v1/budget',
      amount_usdc: amount,
      exceeded: exceeded.map(e => ({
        period: e.period,
        spent_usdc: e.spent,
        limit_usdc: e.limit,
        remaining_usdc: Math.max(0, e.limit - e.spent),
        resets_at: e.resetAt,
      })),
    }, 402);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Charge failed: ${msg}`, 500, 'internal_error');
  }
});


// ── GET /v1/approvals — list pending approval requests ────────────────────────
approvalRoutes.get('/', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Approvals feature requires D1 binding.', 503, 'service_unavailable');

  const agentId = account.id;
  const statusFilter = c.req.query('status') || 'pending';
  const validStatuses = ['pending', 'approved', 'rejected', 'expired', 'all'];
  if (!validStatuses.includes(statusFilter)) {
    return err(`status must be one of: ${validStatuses.join(', ')}`, 400, 'invalid_request');
  }

  const limitParam = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 200);

  try {
    await ensureApprovalsTable(c.env.AUDIT);

    // Expire stale pending requests first
    await c.env.AUDIT.prepare(`
      UPDATE approval_requests SET status = 'expired', resolved_at = datetime('now')
      WHERE account_id = ? AND status = 'pending' AND expires_at < datetime('now')
    `).bind(agentId).run();

    // Query
    const query = statusFilter === 'all'
      ? `SELECT * FROM approval_requests WHERE account_id = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM approval_requests WHERE account_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`;
    const args = statusFilter === 'all' ? [agentId, limit] : [agentId, statusFilter, limit];

    const rows = await c.env.AUDIT.prepare(query).bind(...args).all<ApprovalRow>();
    const entries = rows.results ?? [];

    return json({
      agent_id: agentId,
      status_filter: statusFilter,
      approvals: entries.map(r => ({
        id: r.id,
        amount_usdc: r.amount_usdc,
        category: r.category,
        description: r.description,
        reference_id: r.reference_id ?? undefined,
        status: r.status,
        created_at: r.created_at,
        resolved_at: r.resolved_at ?? undefined,
        resolved_by: r.resolved_by ?? undefined,
        expires_at: r.expires_at,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      })),
      count: entries.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Approvals query failed: ${msg}`, 500, 'internal_error');
  }
});


// ── GET /v1/approvals/:id — get single approval request ───────────────────────
approvalRoutes.get('/:id', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Approvals feature requires D1 binding.', 503, 'service_unavailable');

  const approvalId = c.req.param('id');
  if (!approvalId || !approvalId.startsWith('apr_')) {
    return err('Invalid approval ID format.', 400, 'invalid_request');
  }

  try {
    await ensureApprovalsTable(c.env.AUDIT);

    const row = await c.env.AUDIT.prepare(
      `SELECT * FROM approval_requests WHERE id = ? AND account_id = ?`
    ).bind(approvalId, account.id).first<ApprovalRow>();

    if (!row) return err('Approval request not found.', 404, 'not_found');

    // Check if expired
    if (row.status === 'pending' && new Date(row.expires_at) < new Date()) {
      await c.env.AUDIT.prepare(
        `UPDATE approval_requests SET status = 'expired', resolved_at = datetime('now') WHERE id = ?`
      ).bind(approvalId).run();
      row.status = 'expired';
      row.resolved_at = new Date().toISOString();
    }

    return json({
      id: row.id,
      account_id: row.account_id,
      amount_usdc: row.amount_usdc,
      category: row.category,
      description: row.description,
      reference_id: row.reference_id ?? undefined,
      status: row.status,
      created_at: row.created_at,
      resolved_at: row.resolved_at ?? undefined,
      resolved_by: row.resolved_by ?? undefined,
      expires_at: row.expires_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Approval query failed: ${msg}`, 500, 'internal_error');
  }
});


// ── POST /v1/approvals/:id/approve — approve a pending request ────────────────
approvalRoutes.post('/:id/approve', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Approvals feature requires D1 binding.', 503, 'service_unavailable');

  const approvalId = c.req.param('id');
  if (!approvalId || !approvalId.startsWith('apr_')) {
    return err('Invalid approval ID format.', 400, 'invalid_request');
  }

  const agentId = account.id;
  const db = c.env.AUDIT;

  try {
    await ensureApprovalsTable(db);

    const row = await db.prepare(
      `SELECT * FROM approval_requests WHERE id = ? AND account_id = ?`
    ).bind(approvalId, agentId).first<ApprovalRow>();

    if (!row) return err('Approval request not found.', 404, 'not_found');

    if (row.status !== 'pending') {
      return err(`Approval request is already ${row.status}.`, 409, 'already_resolved');
    }

    // Check if expired
    if (new Date(row.expires_at) < new Date()) {
      await db.prepare(
        `UPDATE approval_requests SET status = 'expired', resolved_at = datetime('now') WHERE id = ?`
      ).bind(approvalId).run();
      return err('Approval request has expired.', 410, 'expired');
    }

    // Approve: update status and record the spend
    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE approval_requests SET status = 'approved', resolved_at = ?, resolved_by = ? WHERE id = ?`
    ).bind(now, account._session ? 'session' : 'api_key', approvalId).run();

    // Record the actual budget spend
    await recordBudgetSpend(c.env, agentId, row.amount_usdc, {
      category: row.category,
      description: `[approved] ${row.description}`,
      referenceId: row.reference_id ?? undefined,
    });

    c.executionCtx.waitUntil(
      writeBudgetAuditEvent(c.env, {
        action: 'budget.approval_approved',
        accountId: agentId,
        details: { approval_id: approvalId, amount: row.amount_usdc, category: row.category },
      })
    );

    return json({
      ok: true,
      approval_id: approvalId,
      status: 'approved',
      amount_usdc: row.amount_usdc,
      category: row.category,
      description: row.description,
      resolved_at: now,
      message: 'Approval request approved. Spend recorded.',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Approval action failed: ${msg}`, 500, 'internal_error');
  }
});


// ── POST /v1/approvals/:id/reject — reject a pending request ──────────────────
approvalRoutes.post('/:id/reject', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Approvals feature requires D1 binding.', 503, 'service_unavailable');

  const approvalId = c.req.param('id');
  if (!approvalId || !approvalId.startsWith('apr_')) {
    return err('Invalid approval ID format.', 400, 'invalid_request');
  }

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch {}
  const reason = typeof body.reason === 'string' ? body.reason : undefined;

  const agentId = account.id;
  const db = c.env.AUDIT;

  try {
    await ensureApprovalsTable(db);

    const row = await db.prepare(
      `SELECT * FROM approval_requests WHERE id = ? AND account_id = ?`
    ).bind(approvalId, agentId).first<ApprovalRow>();

    if (!row) return err('Approval request not found.', 404, 'not_found');

    if (row.status !== 'pending') {
      return err(`Approval request is already ${row.status}.`, 409, 'already_resolved');
    }

    // Check if expired
    if (new Date(row.expires_at) < new Date()) {
      await db.prepare(
        `UPDATE approval_requests SET status = 'expired', resolved_at = datetime('now') WHERE id = ?`
      ).bind(approvalId).run();
      return err('Approval request has expired.', 410, 'expired');
    }

    const now = new Date().toISOString();
    const metadataObj = row.metadata ? JSON.parse(row.metadata) : {};
    if (reason) metadataObj.rejection_reason = reason;

    await db.prepare(
      `UPDATE approval_requests SET status = 'rejected', resolved_at = ?, resolved_by = ?, metadata = ? WHERE id = ?`
    ).bind(now, account._session ? 'session' : 'api_key', JSON.stringify(metadataObj), approvalId).run();

    c.executionCtx.waitUntil(
      writeBudgetAuditEvent(c.env, {
        action: 'budget.approval_rejected',
        accountId: agentId,
        details: { approval_id: approvalId, amount: row.amount_usdc, reason: reason ?? null },
      })
    );

    return json({
      ok: true,
      approval_id: approvalId,
      status: 'rejected',
      amount_usdc: row.amount_usdc,
      reason,
      resolved_at: now,
      message: 'Approval request rejected. No spend recorded.',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Approval action failed: ${msg}`, 500, 'internal_error');
  }
});


// ─── Helper: notify operator about pending approval ────────────────────────────
// Sends email to operator_email if configured. Fire-and-forget.
async function notifyOperator(
  env: HonoEnv['Bindings'],
  account: { id: string; operator_email?: string; [key: string]: unknown },
  approvalId: string,
  amount: number,
  category: string,
  description: string,
  exceeded: Array<{ period: string; spent: number; limit: number }>,
): Promise<void> {
  const operatorEmail = account.operator_email;
  if (!operatorEmail || !env.RESEND_API_KEY) return;

  const amountUsd = (amount / 1_000_000).toFixed(6);
  const exceededSummary = exceeded.map(e =>
    `  ${e.period}: spent ${(e.spent / 1_000_000).toFixed(4)} / limit ${(e.limit / 1_000_000).toFixed(4)} USDC`
  ).join('\n');

  const subject = `[AgentLair] Approval needed: ${amountUsd} USDC charge (${category})`;
  const text = `Your agent ${account.id} is requesting approval for a charge that exceeds the spending cap.

Amount: ${amountUsd} USDC
Category: ${category}
Description: ${description}
Approval ID: ${approvalId}

Budget exceeded:
${exceededSummary}

To approve, make an authenticated request:
  POST https://agentlair.dev/v1/approvals/${approvalId}/approve

To reject:
  POST https://agentlair.dev/v1/approvals/${approvalId}/reject

Or manage via the dashboard at https://agentlair.dev/dashboard

This approval expires in 24 hours.`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AgentLair <notifications@agentlair.dev>',
        to: [operatorEmail],
        subject,
        text,
      }),
    });
  } catch {
    // Non-critical — don't fail the request
  }
}
