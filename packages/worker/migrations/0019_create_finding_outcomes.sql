-- Migration: finding_outcomes + program_api_keys + findings_track_record
-- ───────────────────────────────────────────────────────────────────────────
-- Closes the reputation loop for security findings (spec §3 "Reputation Over
-- Time"). Programs (HackerOne, Immunefi, …) authenticate with a prog_ API key
-- and attest accept/reject on a finding identified by jti. Each (jti,
-- program_id) pair is unique → idempotency surface enforced by PRIMARY KEY.
-- After every write the handler recomputes the agent-scoped track_record from
-- finding_outcomes ⨝ findings and UPSERTs into findings_track_record.

-- Per-(jti, program) outcome attestation. Unique constraint = idempotency boundary.
CREATE TABLE IF NOT EXISTS finding_outcomes (
  jti TEXT NOT NULL,
  program_id TEXT NOT NULL,
  outcome TEXT NOT NULL,                 -- 'accepted' | 'rejected'
  reason TEXT,                           -- nullable: 'duplicate' | 'invalid' | 'out_of_scope' | 'informative' | 'other'
  severity_confirmed REAL,               -- nullable CVSS 0..10
  payout_usd REAL,                       -- nullable, non-negative
  ts INTEGER NOT NULL,                   -- unix seconds at submission
  PRIMARY KEY (jti, program_id)
);

CREATE INDEX IF NOT EXISTS idx_finding_outcomes_jti ON finding_outcomes(jti);

-- Program identity registry. MVP: rows added manually via D1 INSERT during
-- deploy (self-service onboarding is a separate pipeline). The audience column
-- is the trust boundary: a program key may only attest on findings whose
-- finding.audience matches this column. Mismatch → 403 IDOR rejection.
CREATE TABLE IF NOT EXISTS program_api_keys (
  program_id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL UNIQUE,     -- sha256 hex of bearer token (prog_<token>)
  audience TEXT NOT NULL,                -- e.g. 'https://hackerone.com'
  display_name TEXT,                     -- human-readable
  created_at TEXT NOT NULL,              -- ISO 8601
  disabled_at TEXT                       -- nullable; non-null disables auth
);

CREATE INDEX IF NOT EXISTS idx_program_api_keys_audience ON program_api_keys(audience);

-- Agent-scoped findings track record. UPSERT target on every outcome write.
-- DELIBERATELY SEPARATE from trust_profiles (0004): trust_profiles is BHC-style
-- behavioral scoring (consistency/restraint/transparency dimensions) with a
-- different recompute path. Conflating them would force every BHC tick to also
-- recompute findings aggregates and vice versa. Worth one extra table.
CREATE TABLE IF NOT EXISTS findings_track_record (
  agent_id TEXT PRIMARY KEY,
  findings_submitted INTEGER NOT NULL DEFAULT 0,
  findings_accepted INTEGER NOT NULL DEFAULT 0,
  findings_rejected INTEGER NOT NULL DEFAULT 0,
  valid_rate REAL NOT NULL DEFAULT 0.0,
  false_positive_rate REAL NOT NULL DEFAULT 0.0,
  avg_severity REAL,                     -- nullable until first confirmed-severity accept
  updated_ts INTEGER NOT NULL
);
