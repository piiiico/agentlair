-- Migration: findings
-- Stores agent-submitted security findings. Each row corresponds to one signed
-- JWT envelope returned to the submitting agent. JWT itself is reconstructable
-- from these columns + AUDIT_SIGNING_KEY at GET-time (no need to store the JWS bytes).

CREATE TABLE IF NOT EXISTS findings (
  jti TEXT PRIMARY KEY,                -- e.g. finding_<21-char-nanoid>
  agent_id TEXT NOT NULL,              -- account_id of submitting agent (matches AAT.sub)
  audience TEXT NOT NULL,              -- target program (e.g. "https://hackerone.com")
  title TEXT NOT NULL,                 -- short finding title (≤200 chars)
  severity TEXT NOT NULL,              -- 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|'INFO'
  cwe TEXT,                            -- optional CWE id (e.g. "CWE-841")
  target TEXT NOT NULL,                -- commit-pinned reference (e.g. "github:proto/v@a3f9c12")
  evidence_hash TEXT NOT NULL,         -- sha256:... — hex digest of PoC + repro
  evidence_url TEXT,                   -- optional ipfs:// or https:// pin
  tools_used TEXT,                     -- JSON array (e.g. '["slither","foundry-fuzz"]')
  time_to_find_ms INTEGER,             -- optional perf signal
  behavioral_score INTEGER,            -- BHC trust score at submission time (0-100, nullable)
  trust_level TEXT,                    -- ATFLevel snapshot ('intern'|'junior'|'senior'|'principal')
  trust_confidence REAL,               -- [0.0, 1.0]
  submitted_at TEXT NOT NULL           -- ISO 8601
);

CREATE INDEX IF NOT EXISTS idx_findings_agent_submitted ON findings(agent_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_findings_audience ON findings(audience, submitted_at);
