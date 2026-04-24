-- Migration: trust_profiles
-- Stores computed Phase 1 trust scores for agents.
-- Recomputed on-demand from audit_log; this table acts as a cache and history log.

CREATE TABLE IF NOT EXISTS trust_profiles (
  agent_id TEXT NOT NULL,
  score INTEGER NOT NULL,           -- [0, 100]
  confidence REAL NOT NULL,         -- [0.0, 1.0]
  atf_level TEXT NOT NULL,          -- 'intern' | 'junior' | 'senior' | 'principal'
  observation_count INTEGER NOT NULL,
  dimensions_json TEXT NOT NULL,    -- JSON: { consistency, restraint, transparency }
  computed_at TEXT NOT NULL,
  PRIMARY KEY (agent_id)
);

-- History table: append-only score snapshots for trend computation
CREATE TABLE IF NOT EXISTS trust_score_history (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  confidence REAL NOT NULL,
  atf_level TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trust_history_agent_ts ON trust_score_history(agent_id, recorded_at);
