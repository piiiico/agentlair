// ─── Budget Middleware ─────────────────────────────────────────────────────────
// Checks per-agent spending caps stored in D1 before processing paid operations.
//
// This middleware runs AFTER auth (account is set), BEFORE route handlers.
// It checks the budgets D1 table for configured caps and returns 402/403 if exceeded.
//
// Enforcement flow:
//   Request → Auth → Budget (this) → Rate Limit → Route Handler
//
// When budget exceeded:
//   - Returns 402 with budget_exceeded error and remaining amounts
//   - Approval gate integration: V2 (requires non-email approval flow)
//
// Only applies to spending endpoints: email send, vault write, calendar, x402 payments.

import type { Context, Next } from 'hono';
import type { HonoEnv } from '../types.js';
import { writeBudgetAuditEvent } from './audit.js';
import { getBudgetResetAt } from '../utils.js';

// Paths that are subject to budget enforcement (paid operations)
const PAID_PATHS: Array<{ prefix: string; method?: string }> = [
  { prefix: '/v1/email/send', method: 'POST' },
  { prefix: '/v1/vault', method: 'POST' },
  { prefix: '/v1/vault', method: 'PUT' },
  { prefix: '/v1/calendar/events', method: 'POST' },
  { prefix: '/v1/stack', method: 'POST' },
];

function isPaidPath(method: string, path: string): boolean {
  return PAID_PATHS.some(p =>
    path.startsWith(p.prefix) && (!p.method || p.method === method)
  );
}

interface BudgetRow {
  period: string;
  limit_amount: number | null;
  spent_amount: number;
  reset_at: string;
}

/** Returns current spent amount, resetting if period expired. */
async function getEffectiveSpend(db: D1Database, agentId: string, period: string): Promise<{ limit: number | null; spent: number; resetAt: string }> {
  const row = await db.prepare(
    `SELECT limit_amount, spent_amount, reset_at FROM budgets WHERE agent_id = ? AND period = ?`
  ).bind(agentId, period).first<BudgetRow>();

  if (!row || row.limit_amount == null) return { limit: null, spent: 0, resetAt: '' };

  // If period expired, reset spent
  if (new Date(row.reset_at) <= new Date()) {
    await db.prepare(
      `UPDATE budgets SET spent_amount = 0, reset_at = ?, updated_at = datetime('now') WHERE agent_id = ? AND period = ?`
    ).bind(getBudgetResetAt(period), agentId, period).run();
    return { limit: row.limit_amount, spent: 0, resetAt: getBudgetResetAt(period) };
  }

  return { limit: row.limit_amount, spent: row.spent_amount, resetAt: row.reset_at };
}


/** Ensure spend_ledger table exists. Called lazily before first write. */
async function ensureSpendLedgerTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS spend_ledger (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      amount_usdc INTEGER NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      reference_id TEXT,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_spend_ledger_account_ts ON spend_ledger(account_id, timestamp)`
  ).run();
  // Migration: add key_id column if not present (SQLite doesn't support IF NOT EXISTS on ALTER)
  try {
    await db.prepare(`ALTER TABLE spend_ledger ADD COLUMN key_id TEXT`).run();
  } catch {
    // Column already exists — ignore
  }
}

/** Increment spent_amount for a period after a successful paid operation. Fire-and-forget safe.
 *  Also appends an entry to spend_ledger for auditable history. */
export async function recordBudgetSpend(
  env: HonoEnv['Bindings'],
  agentId: string,
  amountUsdc: number,
  opts?: {
    category?: string;
    description?: string;
    referenceId?: string;
    keyId?: string;
  },
): Promise<void> {
  if (!env.AUDIT) return;
  const periods = ['daily', 'weekly', 'monthly'];
  const category = opts?.category ?? 'platform';
  const description = opts?.description ?? 'Agent operation';
  const referenceId = opts?.referenceId ?? null;
  const keyId = opts?.keyId ?? null;
  const timestamp = new Date().toISOString();

  try {
    // 1. Increment running counters (existing logic — fast cap enforcement)
    await Promise.all(periods.map(async (period) => {
      const row = await env.AUDIT!.prepare(
        `SELECT limit_amount FROM budgets WHERE agent_id = ? AND period = ?`
      ).bind(agentId, period).first<{ limit_amount: number | null }>();
      if (!row || row.limit_amount == null) return; // No cap for this period — skip
      await env.AUDIT!.prepare(
        `UPDATE budgets SET spent_amount = spent_amount + ?, updated_at = datetime('now') WHERE agent_id = ? AND period = ?`
      ).bind(amountUsdc, agentId, period).run();
    }));

    // 2. Append to spend_ledger (source of truth for history — always written)
    await ensureSpendLedgerTable(env.AUDIT);
    const id = `sp_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await env.AUDIT.prepare(`
      INSERT INTO spend_ledger (id, account_id, amount_usdc, category, description, reference_id, key_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, agentId, amountUsdc, category, description, referenceId, keyId, timestamp).run();
  } catch {
    // Non-critical — don't fail the payment
  }
}

interface BudgetSettings {
  on_limit: 'reject' | 'approve';
  single_tx_limit: number | null;
}

async function loadBudgetSettings(db: D1Database, agentId: string): Promise<BudgetSettings> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS budget_settings (
      agent_id TEXT PRIMARY KEY,
      on_limit TEXT NOT NULL DEFAULT 'reject',
      single_tx_limit INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  const row = await db.prepare(
    `SELECT on_limit, single_tx_limit FROM budget_settings WHERE agent_id = ?`
  ).bind(agentId).first<{ on_limit: string; single_tx_limit: number | null }>();
  if (!row) return { on_limit: 'reject', single_tx_limit: null };
  return {
    on_limit: row.on_limit === 'approve' ? 'approve' : 'reject',
    single_tx_limit: row.single_tx_limit ?? null,
  };
}

export function budgetMiddleware() {
  return async (c: Context<HonoEnv>, next: Next): Promise<void | Response> => {
    const env = c.env;
    if (!env.AUDIT) {
      // No D1 binding — budget feature unavailable, pass through
      await next();
      return;
    }

    const account = c.get('account');
    if (!account) {
      // Not authenticated — let auth middleware handle it
      await next();
      return;
    }

    const method = c.req.method;
    const url = new URL(c.req.url);
    const path = url.pathname;

    // Only enforce on paid operations
    if (!isPaidPath(method, path)) {
      await next();
      return;
    }

    const agentId = account.id;

    try {
      // Check all configured periods
      const periods = ['daily', 'weekly', 'monthly'] as const;
      const exceeded: Array<{ period: string; spent: number; limit: number; resetAt: string }> = [];

      for (const period of periods) {
        const { limit, spent, resetAt } = await getEffectiveSpend(env.AUDIT, agentId, period);
        if (limit == null) continue; // No cap for this period
        // Note: we don't know exact cost of this request here (x402 amount varies).
        // We check if already at or over limit. Exact amount check is in route handler.
        if (spent >= limit) {
          exceeded.push({ period, spent, limit, resetAt });
        }
      }

      // Load budget settings for on_limit behavior and single_tx_limit
      const settings = await loadBudgetSettings(env.AUDIT, agentId);

      // single_tx_limit check: for email send, estimated cost is 100 atomic USDC units
      const EMAIL_COST_ESTIMATE = 100;
      const isEmailSend = path.startsWith('/v1/email/send') && method === 'POST';
      const estimatedCost = isEmailSend ? EMAIL_COST_ESTIMATE : 0;

      let singleTxBlocked = false;
      if (settings.single_tx_limit != null && estimatedCost > 0 && estimatedCost > settings.single_tx_limit) {
        singleTxBlocked = true;
      }

      const isBlocked = exceeded.length > 0 || singleTxBlocked;

      if (!isBlocked) {
        await next();
        return;
      }

      // Determine action based on on_limit setting
      if (settings.on_limit === 'approve') {
        // Escalate to approval: patch account so email route saves as draft
        const accountObj = account as Record<string, unknown>;
        accountObj.approval_required = true;
        c.executionCtx.waitUntil(
          writeBudgetAuditEvent(env, {
            action: 'budget.approval_escalated',
            accountId: agentId,
            details: {
              path,
              method,
              exceeded_periods: exceeded.map(e => e.period).join(','),
              single_tx_blocked: singleTxBlocked,
              single_tx_limit: settings.single_tx_limit,
              estimated_cost: estimatedCost,
            },
          })
        );
        await next();
        return;
      }

      // on_limit: 'reject' (default) — return 402
      c.executionCtx.waitUntil(
        writeBudgetAuditEvent(env, {
          action: 'budget.limit_exceeded',
          accountId: agentId,
          details: {
            path,
            method,
            exceeded_periods: exceeded.map(e => e.period).join(','),
            single_tx_blocked: singleTxBlocked,
            single_tx_limit: settings.single_tx_limit,
            estimated_cost: estimatedCost,
          },
        })
      );

      const responseBody: Record<string, unknown> = {
        error: 'budget_exceeded',
        message: 'Spending cap reached. Check GET /v1/budget for remaining allowance.',
        budget_url: '/v1/budget',
      };

      if (exceeded.length > 0) {
        responseBody.exceeded = exceeded.map(e => ({
          period: e.period,
          spent_usdc: e.spent,
          limit_usdc: e.limit,
          remaining_usdc: 0,
          resets_at: e.resetAt,
        }));
      }

      if (singleTxBlocked) {
        responseBody.single_tx_limit_exceeded = {
          estimated_cost_usdc: estimatedCost,
          single_tx_limit_usdc: settings.single_tx_limit,
        };
      }

      return new Response(JSON.stringify(responseBody), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // D1 error — fail-open (don't block paid ops on budget DB failure)
      await next();
    }
  };
}
