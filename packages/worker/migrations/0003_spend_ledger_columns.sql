-- Migration: add missing columns to spend_ledger table
-- 0002 was deployed with basic schema (id, account_id, amount_usdc, category,
-- description, reference_id, timestamp, created_at). This migration adds:
--   key_id        — API key that incurred the spend (may already exist from ALTER TABLE hack)
--   currency      — USDC (V1 only)
--   audit_entry_id — links to signed audit trail entry
--
-- SQLite does not support IF NOT EXISTS on ALTER TABLE.
-- Run key_id last as it may already exist in production (added via middleware hack).
-- The CF D1 API will error on duplicate column — run idempotently by catching errors.

ALTER TABLE spend_ledger ADD COLUMN currency TEXT NOT NULL DEFAULT 'USDC';
ALTER TABLE spend_ledger ADD COLUMN audit_entry_id TEXT;

-- Index on key_id + timestamp for per-key spend queries
CREATE INDEX IF NOT EXISTS idx_spend_ledger_key_ts ON spend_ledger(key_id, timestamp);
