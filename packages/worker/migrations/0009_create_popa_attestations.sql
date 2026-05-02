-- PoPA v1 — Proof-of-Presence Attestations
-- Daily attestation chain anchored in the SCITT transparency log.
-- v1: bootstrap with the AgentLair root DID only. Multi-agent enrollment is v2.

-- Per-attestation row. One row per (agent_did, window_start).
CREATE TABLE IF NOT EXISTS popa_attestations (
  id              TEXT    PRIMARY KEY,
  agent_did       TEXT    NOT NULL,
  entry_id        TEXT    NOT NULL,        -- SCITT entry_id from DO append response
  sequence        INTEGER NOT NULL,        -- monotonic from genesis (per-DID)
  window_start    TEXT    NOT NULL,        -- ISO 8601 UTC, day-aligned
  window_end      TEXT    NOT NULL,        -- ISO 8601 UTC, day-aligned
  mcp_call_count  INTEGER NOT NULL DEFAULT 0,
  gap_detected    INTEGER NOT NULL DEFAULT 0,  -- 1 if gap_hours > 0 vs prev sequence
  gap_hours       REAL    NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_popa_agent_seq     ON popa_attestations(agent_did, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_popa_agent_created ON popa_attestations(agent_did, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_popa_window ON popa_attestations(agent_did, window_start);

-- Subscribers: who emits attestations.
CREATE TABLE IF NOT EXISTS popa_subscribers (
  agent_did   TEXT PRIMARY KEY,
  account_id  TEXT,                         -- nullable; the root DID has no account
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bootstrap: AgentLair root DID
INSERT OR IGNORE INTO popa_subscribers (agent_did, account_id, enabled)
VALUES ('did:web:agentlair.dev', NULL, 1);
