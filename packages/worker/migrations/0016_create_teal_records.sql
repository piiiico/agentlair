CREATE TABLE IF NOT EXISTS teal_records (
  operator_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  prev_hash TEXT,
  agent_sig TEXT,
  signed INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (operator_id, session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_teal_records_session_received
  ON teal_records (operator_id, session_id, received_at);
