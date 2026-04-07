-- Migration: append-only spend ledger
-- Each spending event gets one row. Source of truth for budget history.
-- The budgets table (running counters) is kept for fast cap enforcement.

CREATE TABLE IF NOT EXISTS spend_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount_usdc INTEGER NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  reference_id TEXT,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Query: "show this account's spend history, newest first"
CREATE INDEX IF NOT EXISTS idx_spend_ledger_account_ts ON spend_ledger(account_id, timestamp);
