-- Migration: billing anomaly log
-- Records spend events that deviate >3x from the 7-day rolling average for
-- the same (account_id, category) tuple. Structural risk: silent billing
-- overcharges like the HERMES.md CVE (Anthropic anti-abuse, Apr 2026).
--
-- Detection runs in recordBudgetSpend() after each spend_ledger insert.
-- Requires: minimum 3 prior transactions in the window (avoids new-account noise).

CREATE TABLE IF NOT EXISTS billing_anomalies (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  category TEXT NOT NULL,
  timestamp TEXT NOT NULL,                   -- ISO 8601 UTC — when anomaly occurred
  amount_usdc INTEGER NOT NULL,              -- Atomic USDC (triggering transaction)
  rolling_avg_usdc INTEGER NOT NULL,         -- 7-day average for this (account, category)
  multiplier REAL NOT NULL,                  -- amount_usdc / rolling_avg_usdc
  spend_ledger_id TEXT NOT NULL,             -- Foreign key to spend_ledger.id
  alerted INTEGER NOT NULL DEFAULT 1,        -- 1 = email sent, 0 = alert suppressed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lookup by account for per-account anomaly history
CREATE INDEX IF NOT EXISTS idx_billing_anomalies_account ON billing_anomalies(account_id, timestamp);

-- Lookup by category for cross-account pattern detection
CREATE INDEX IF NOT EXISTS idx_billing_anomalies_category ON billing_anomalies(category, timestamp);
