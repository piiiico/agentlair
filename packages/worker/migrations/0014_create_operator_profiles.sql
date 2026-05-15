-- Migration: 0014_create_operator_profiles.sql
-- Phase 2.5 Components 2 + 3 — operator-declared workflow attestation.
-- Spec: memory/knowledge/agentlair-trust-scoring-algorithm.md §1.2 Dimension 6.
--
-- One row per account. Storage is read by the Component 6 scorer
-- (computeEpistemicIntegrity) alongside trust_profiles and audit_log.

CREATE TABLE IF NOT EXISTS operator_profiles (
  account_id TEXT PRIMARY KEY,
  attestation_workflow_json TEXT NOT NULL,  -- JSON-encoded AttestationWorkflow
  review_bandwidth_json TEXT NOT NULL,      -- JSON-encoded ReviewBandwidth
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
