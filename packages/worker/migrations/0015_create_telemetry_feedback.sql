-- Migration: 0015_create_telemetry_feedback.sql
-- Phase 2.5 Component 4 — operator-submitted claim outcomes.
-- Spec: memory/knowledge/agentlair-trust-scoring-algorithm.md line 1734.
--
-- One row per (account_id, claim_id). Storage is read by the Component 6 scorer
-- (computeEpistemicIntegrity) alongside audit_log verification events.

CREATE TABLE IF NOT EXISTS telemetry_feedback (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  outcome_correct INTEGER NOT NULL,          -- 0 or 1 (D1 has no native bool)
  evidence_type TEXT NOT NULL,
  confidence_stated REAL,                    -- nullable; [0.0, 1.0] when present
  created_at INTEGER NOT NULL                -- unix epoch milliseconds
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_feedback_account_claim
  ON telemetry_feedback(account_id, claim_id);
