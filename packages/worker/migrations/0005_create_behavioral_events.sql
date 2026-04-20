-- Migration: 0005_create_behavioral_events.sql
-- RFC-003: Behavioral Event Ingestion Architecture, Section 4.1
-- Creates the external behavioral events table and daily aggregates table.

CREATE TABLE IF NOT EXISTS behavioral_events (
  id TEXT PRIMARY KEY,                    -- Server-assigned nanoid
  event_id TEXT NOT NULL,                 -- Client-submitted idempotency key
  agent_id TEXT NOT NULL,                 -- From AAT sub claim
  timestamp TEXT NOT NULL,                -- Event occurrence time (ISO 8601)
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  resource_type TEXT,
  duration_ms INTEGER,
  error_code TEXT,
  scope_used TEXT,
  metadata_json TEXT,                     -- JSON object, max 10 keys
  session_id TEXT,                        -- Optional grouping
  signed INTEGER NOT NULL DEFAULT 0,      -- 1 if event was cryptographically signed
  source TEXT NOT NULL DEFAULT 'api'      -- 'api' | 'sdk' | 'github_action'
);

-- Primary query: trust engine fetches events for an agent in time range
CREATE INDEX idx_be_agent_ts ON behavioral_events(agent_id, timestamp);

-- Category analysis per agent
CREATE INDEX idx_be_agent_cat ON behavioral_events(agent_id, category, timestamp);

-- Session grouping
CREATE INDEX idx_be_session ON behavioral_events(session_id) WHERE session_id IS NOT NULL;

-- Deduplication check (fast reject of duplicates)
CREATE UNIQUE INDEX idx_be_event_id ON behavioral_events(agent_id, event_id);

-- TTL enforcement (cleanup job)
CREATE INDEX idx_be_received ON behavioral_events(received_at);

CREATE TABLE IF NOT EXISTS behavioral_aggregates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  date TEXT NOT NULL,                     -- YYYY-MM-DD
  category TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  failure_count INTEGER NOT NULL,
  denied_count INTEGER NOT NULL,
  timeout_count INTEGER NOT NULL,
  unique_actions INTEGER NOT NULL,        -- Distinct action strings
  avg_duration_ms REAL,
  signed_ratio REAL NOT NULL,             -- Fraction of events that were signed
  UNIQUE(agent_id, date, category)
);

CREATE INDEX idx_ba_agent_date ON behavioral_aggregates(agent_id, date);
