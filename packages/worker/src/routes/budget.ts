// ─── Budget Routes ─────────────────────────────────────────────────────────────
// Handles: /v1/budget — per-agent spending cap management
//
// Storage: D1 (agentlair-audit database), `budgets` table
//   agent_id TEXT, period TEXT, limit_amount INTEGER|NULL, spent_amount INTEGER, reset_at TEXT
//
// V1 scope:
//   GET  /v1/budget          — query remaining budget for authenticated key
//   PUT  /v1/budget          — set spending caps for authenticated key
//
// Spending caps are per-account (not per-pod). The account.id from the auth token
// is used as the agent_id. Pod accounts use their pod_id as agent_id.
//
// Budget enforcement (the actual gate) lives in src/middleware/budget.ts.
// These routes are the management surface.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { err, json, getBudgetResetAt } from '../utils.js';
import { writeBudgetAuditEvent } from '../middleware/audit.js';

// ─── Period math ───────────────────────────────────────────────────────────────
// Shared utility imported from utils.ts — no local copy needed.

/** Return true if reset_at is in the past (period has rolled over) */
function isPeriodExpired(resetAt: string): boolean {
  return new Date(resetAt) <= new Date();
}

// ─── D1 helpers ────────────────────────────────────────────────────────────────

interface BudgetRow {
  agent_id: string;
  period: string;
  limit_amount: number | null;
  spent_amount: number;
  reset_at: string;
  updated_at: string;
}

/** Ensure the budgets and budget_settings tables exist (idempotent DDL). Called on first read/write. */
async function ensureBudgetsTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS budgets (
      agent_id TEXT NOT NULL,
      period TEXT NOT NULL,
      limit_amount INTEGER,
      spent_amount INTEGER NOT NULL DEFAULT 0,
      reset_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, period)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS budget_settings (
      agent_id TEXT PRIMARY KEY,
      on_limit TEXT NOT NULL DEFAULT 'reject',
      single_tx_limit INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
}

/** Get budget row for agent+period. Returns null if not set. Resets spent_amount if period expired. */
async function getBudgetRow(db: D1Database, agentId: string, period: string): Promise<BudgetRow | null> {
  const row = await db.prepare(
    `SELECT agent_id, period, limit_amount, spent_amount, reset_at, updated_at
     FROM budgets WHERE agent_id = ? AND period = ?`
  ).bind(agentId, period).first<BudgetRow>();

  if (!row) return null;

  // If period expired, reset spent_amount to 0 and set new reset_at
  if (isPeriodExpired(row.reset_at)) {
    const newResetAt = getBudgetResetAt(period);
    await db.prepare(
      `UPDATE budgets SET spent_amount = 0, reset_at = ?, updated_at = datetime('now')
       WHERE agent_id = ? AND period = ?`
    ).bind(newResetAt, agentId, period).run();
    return { ...row, spent_amount: 0, reset_at: newResetAt };
  }

  return row;
}

/** Upsert a budget row (set limit for agent+period). */
async function upsertBudgetRow(
  db: D1Database,
  agentId: string,
  period: 'daily' | 'weekly' | 'monthly',
  limitAmount: number | null,
): Promise<BudgetRow> {
  const resetAt = getBudgetResetAt(period);
  await db.prepare(`
    INSERT INTO budgets (agent_id, period, limit_amount, spent_amount, reset_at, updated_at)
    VALUES (?, ?, ?, 0, ?, datetime('now'))
    ON CONFLICT(agent_id, period) DO UPDATE SET
      limit_amount = excluded.limit_amount,
      updated_at = datetime('now')
  `).bind(agentId, period, limitAmount, resetAt).run();

  const row = await db.prepare(
    `SELECT agent_id, period, limit_amount, spent_amount, reset_at, updated_at
     FROM budgets WHERE agent_id = ? AND period = ?`
  ).bind(agentId, period).first<BudgetRow>();

  return row!;
}

// ─── Route definitions ─────────────────────────────────────────────────────────

export const budgetRoutes = new Hono<HonoEnv>();

// ── GET /v1/budget — query remaining budget ────────────────────────────────────
budgetRoutes.get('/', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Budget feature requires D1 binding.', 503, 'service_unavailable');

  const agentId = account.id;
  try {
    await ensureBudgetsTable(c.env.AUDIT);

    const periods: Array<'daily' | 'weekly' | 'monthly'> = ['daily', 'weekly', 'monthly'];
    const [rows, settingsRow] = await Promise.all([
      Promise.all(periods.map(p => getBudgetRow(c.env.AUDIT!, agentId, p))),
      c.env.AUDIT.prepare(
        `SELECT on_limit, single_tx_limit FROM budget_settings WHERE agent_id = ?`
      ).bind(agentId).first<{ on_limit: string; single_tx_limit: number | null }>(),
    ]);

    const caps: Record<string, unknown> = {};
    let hasAnyCap = false;
    let status: 'active' | 'limit_reached' = 'active';

    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const row = rows[i];
      if (!row || row.limit_amount == null) {
        caps[period] = null; // no cap set
      } else {
        hasAnyCap = true;
        const remaining = Math.max(0, row.limit_amount - row.spent_amount);
        if (remaining === 0) status = 'limit_reached';
        caps[period] = {
          limit_usdc: row.limit_amount,
          spent_usdc: row.spent_amount,
          remaining_usdc: remaining,
          resets_at: row.reset_at,
        };
      }
    }

    const settings = {
      on_limit: (settingsRow?.on_limit === 'approve' ? 'approve' : 'reject') as 'reject' | 'approve',
      single_tx_limit_cents: settingsRow?.single_tx_limit ?? null,
    };

    return json({
      agent_id: agentId,
      currency: 'USDC',
      atomic_unit: '1e-6 USDC (one millionth of one USDC)',
      caps,
      has_caps: hasAnyCap,
      status,
      settings,
      note: hasAnyCap
        ? 'Amounts in atomic USDC units (6 decimals). 1,000,000 = 1.00 USDC.'
        : 'No spending caps configured. Use PUT /v1/budget to set limits.',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Budget query failed: ${msg}`, 500, 'internal_error');
  }
});

// ── PUT /v1/budget — set spending caps ────────────────────────────────────────
budgetRoutes.put('/', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Budget feature requires D1 binding.', 503, 'service_unavailable');

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch {}

  // Validate caps object (optional — can set only on_limit or single_tx_limit_cents)
  // Support both nested { caps: { daily: N } } and flat { daily: N } format for ergonomics
  let rawCaps = body.caps;
  const periods: Array<'daily' | 'weekly' | 'monthly'> = ['daily', 'weekly', 'monthly'];
  const parsed: Partial<Record<'daily' | 'weekly' | 'monthly', number | null>> = {};

  // Flat format: if top-level has daily/weekly/monthly but no caps key, treat as caps
  if (rawCaps === undefined && periods.some(p => p in body)) {
    rawCaps = Object.fromEntries(periods.filter(p => p in body).map(p => [p, body[p]]));
  }

  if (rawCaps !== undefined) {
    if (!rawCaps || typeof rawCaps !== 'object' || Array.isArray(rawCaps)) {
      return err('"caps" must be an object.', 400, 'invalid_request');
    }
    const capsObj = rawCaps as Record<string, unknown>;

    for (const period of periods) {
      if (!(period in capsObj)) continue;
      const val = capsObj[period];
      if (val === null) {
        parsed[period] = null; // remove cap
      } else if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0 || val > 1_000_000_000) {
        return err(
          `caps.${period} must be a positive integer ≤ 1,000,000,000 (= 1000 USDC) or null to remove cap.`,
          400, 'invalid_caps'
        );
      } else {
        parsed[period] = val;
      }
    }
  }

  // Cross-field ordering: daily ≤ weekly ≤ monthly
  if (parsed.daily != null && parsed.weekly != null && parsed.daily > parsed.weekly) {
    return err('caps.daily must be ≤ caps.weekly.', 400, 'invalid_caps');
  }
  if (parsed.weekly != null && parsed.monthly != null && parsed.weekly > parsed.monthly) {
    return err('caps.weekly must be ≤ caps.monthly.', 400, 'invalid_caps');
  }
  if (parsed.daily != null && parsed.monthly != null && parsed.daily > parsed.monthly) {
    return err('caps.daily must be ≤ caps.monthly.', 400, 'invalid_caps');
  }

  // Validate on_limit
  let onLimit: 'reject' | 'approve' | undefined;
  if ('on_limit' in body) {
    if (body.on_limit !== 'reject' && body.on_limit !== 'approve') {
      return err('on_limit must be "reject" or "approve".', 400, 'invalid_request');
    }
    onLimit = body.on_limit as 'reject' | 'approve';
  }

  // Validate single_tx_limit_cents
  let singleTxLimit: number | null | undefined;
  if ('single_tx_limit_cents' in body) {
    const val = body.single_tx_limit_cents;
    if (val === null) {
      singleTxLimit = null; // remove limit
    } else if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0 || val > 1_000_000_000) {
      return err(
        'single_tx_limit_cents must be a positive integer ≤ 1,000,000,000 or null to remove.',
        400, 'invalid_request'
      );
    } else {
      singleTxLimit = val;
    }
  }

  if (Object.keys(parsed).length === 0 && onLimit === undefined && singleTxLimit === undefined) {
    return err('No fields specified. Include at least one of: caps, on_limit, single_tx_limit_cents.', 400, 'invalid_request');
  }

  const agentId = account.id;
  try {
    await ensureBudgetsTable(c.env.AUDIT);

    const results: Record<string, unknown> = {};
    const updatedPeriods: string[] = [];

    for (const [period, limitAmount] of Object.entries(parsed) as Array<['daily' | 'weekly' | 'monthly', number | null]>) {
      const row = await upsertBudgetRow(c.env.AUDIT, agentId, period, limitAmount);
      if (limitAmount == null) {
        results[period] = null;
      } else {
        results[period] = {
          limit_usdc: row.limit_amount,
          spent_usdc: row.spent_amount,
          remaining_usdc: Math.max(0, (row.limit_amount ?? 0) - row.spent_amount),
          resets_at: row.reset_at,
        };
      }
      updatedPeriods.push(period);
    }

    // Upsert budget_settings if on_limit or single_tx_limit_cents provided
    let updatedSettings: { on_limit: string; single_tx_limit: number | null } | null = null;
    if (onLimit !== undefined || singleTxLimit !== undefined) {
      await c.env.AUDIT.prepare(`
        INSERT INTO budget_settings (agent_id, on_limit, single_tx_limit, updated_at)
        VALUES (?, COALESCE(?, 'reject'), ?, datetime('now'))
        ON CONFLICT(agent_id) DO UPDATE SET
          on_limit = CASE WHEN ? THEN excluded.on_limit ELSE on_limit END,
          single_tx_limit = CASE WHEN ? THEN excluded.single_tx_limit ELSE single_tx_limit END,
          updated_at = datetime('now')
      `).bind(
        agentId,
        onLimit ?? null,
        singleTxLimit ?? null,
        onLimit !== undefined ? 1 : 0,
        singleTxLimit !== undefined ? 1 : 0,
      ).run();

      updatedSettings = await c.env.AUDIT.prepare(
        `SELECT on_limit, single_tx_limit FROM budget_settings WHERE agent_id = ?`
      ).bind(agentId).first<{ on_limit: string; single_tx_limit: number | null }>() ?? {
        on_limit: onLimit ?? 'reject',
        single_tx_limit: singleTxLimit ?? null,
      };
    }

    // Audit trail: budget.cap_set event
    c.executionCtx.waitUntil(
      writeBudgetAuditEvent(c.env, {
        action: 'budget.cap_set',
        accountId: agentId,
        details: {
          periods_updated: updatedPeriods.join(','),
          ...Object.fromEntries(
            Object.entries(parsed).map(([p, v]) => [`${p}_limit`, v ?? 'removed'])
          ),
          ...(onLimit !== undefined ? { on_limit: onLimit } : {}),
          ...(singleTxLimit !== undefined ? { single_tx_limit_cents: singleTxLimit } : {}),
        },
      })
    );

    return json({
      ok: true,
      agent_id: agentId,
      caps: results,
      ...(updatedSettings != null ? {
        settings: {
          on_limit: updatedSettings.on_limit,
          single_tx_limit_cents: updatedSettings.single_tx_limit,
        },
      } : {}),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Budget update failed: ${msg}`, 500, 'internal_error');
  }
});

// ── GET /v1/budget/history — spend history from append-only ledger ──────────────
//   ?limit=50 (default 50, max 200)
//   ?before=<ISO timestamp> — paginate backwards
budgetRoutes.get('/history', async (c) => {
  const account = c.get('account');
  if (!account) return err('Authentication required.', 401, 'unauthorized');
  if (!c.env.AUDIT) return err('Budget feature requires D1 binding.', 503, 'service_unavailable');

  const agentId = account.id;

  // Parse query params
  const limitParam = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 200);
  const before = c.req.query('before'); // ISO timestamp for cursor pagination

  interface LedgerRow {
    id: string;
    amount_usdc: number;
    category: string;
    description: string;
    reference_id: string | null;
    timestamp: string;
  }

  try {
    // Ensure table exists (idempotent — no-op if already created by middleware)
    await c.env.AUDIT.prepare(`
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
    await c.env.AUDIT.prepare(
      `CREATE INDEX IF NOT EXISTS idx_spend_ledger_account_ts ON spend_ledger(account_id, timestamp)`
    ).run();

    // Fetch ledger entries (newest first, cursor-paginated)
    const query = before
      ? `SELECT id, amount_usdc, category, description, reference_id, timestamp
         FROM spend_ledger WHERE account_id = ? AND timestamp < ?
         ORDER BY timestamp DESC LIMIT ?`
      : `SELECT id, amount_usdc, category, description, reference_id, timestamp
         FROM spend_ledger WHERE account_id = ?
         ORDER BY timestamp DESC LIMIT ?`;
    const args = before ? [agentId, before, limit] : [agentId, limit];

    const rows = await c.env.AUDIT.prepare(query).bind(...args).all<LedgerRow>();
    const entries = rows.results ?? [];

    // Summary: total + by-category breakdown
    const totalUsdc = entries.reduce((sum, r) => sum + r.amount_usdc, 0);
    const byCategory: Record<string, number> = {};
    for (const r of entries) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount_usdc;
    }

    return json({
      agent_id: agentId,
      currency: 'USDC',
      atomic_unit: '1e-6 USDC (one millionth of one USDC)',
      entries: entries.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        amount_usdc: r.amount_usdc,
        category: r.category,
        description: r.description,
        reference_id: r.reference_id ?? undefined,
      })),
      summary: {
        count: entries.length,
        total_usdc: totalUsdc,
        by_category: byCategory,
      },
      pagination: {
        limit,
        has_more: entries.length === limit,
        next_before: entries.length > 0 ? entries[entries.length - 1].timestamp : null,
      },
      note: 'Each entry is one spend event. Amounts in atomic USDC units (1,000,000 = 1.00 USDC).',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Budget history failed: ${msg}`, 500, 'internal_error');
  }
});
