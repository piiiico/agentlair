-- Migration: append-only spend ledger
-- Each spending event gets one row. Source of truth for budget history.
-- The budgets table (running counters) is kept for fast cap enforcement.
--
-- Spec reference: agentlair-spending-caps-spec.md §4.2

CREATE TABLE IF NOT EXISTS spend_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  key_id TEXT,                                         -- API key that incurred the spend (nullable for back-compat)
  timestamp TEXT NOT NULL,                             -- ISO 8601 UTC
  amount_usdc INTEGER NOT NULL,                        -- Atomic USDC units (1,000,000 = 1 USDC)
  currency TEXT NOT NULL DEFAULT 'USDC',               -- V1: USDC only
  category TEXT NOT NULL,                              -- 'email' | 'vault' | 'calendar' | 'pod' | 'x402' | 'platform'
  description TEXT NOT NULL,                           -- Human-readable: "Email send via Resend"
  reference_id TEXT,                                   -- Correlation: email ID, vault entry, x402 tx hash
  audit_entry_id TEXT,                                 -- Links to audit trail entry (signed + chained)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Query: "show this account's spend history, newest first"
CREATE INDEX IF NOT EXISTS idx_spend_ledger_account_ts ON spend_ledger(account_id, timestamp);
-- Query: "how much has this key spent this period?"
CREATE INDEX IF NOT EXISTS idx_spend_ledger_key_ts ON spend_ledger(key_id, timestamp);
