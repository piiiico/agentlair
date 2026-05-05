-- BCC Credentials — Bonded Credibility Certificates (W3C VC 2.0)
-- Issued via POST /v1/bcc/issue; retrieved via GET /v1/bcc/:id.

CREATE TABLE IF NOT EXISTS bcc_credentials (
  id                TEXT PRIMARY KEY,     -- e.g. "bcc_<nanoid>"
  issuer_account_id TEXT NOT NULL,        -- AgentLair account of the issuer
  subject_did       TEXT NOT NULL,        -- DID of the credential subject
  bcc_profile       TEXT NOT NULL,        -- "BCC-Capital" | "BCC-Claims" | "BCC-Existence"
  stake_medium      TEXT NOT NULL,        -- "capital" | "claims" | "existence"
  confidence        REAL NOT NULL,        -- 0.0 to 1.0
  claim_json        TEXT NOT NULL,        -- JSON string of the bonded claim
  credential_json   TEXT NOT NULL,        -- Full signed BCC VC as JSON-LD
  issued_at         TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at        TEXT                  -- NULL = active, ISO 8601 = revoked
);

CREATE INDEX IF NOT EXISTS idx_bcc_subject ON bcc_credentials(subject_did);
CREATE INDEX IF NOT EXISTS idx_bcc_issuer  ON bcc_credentials(issuer_account_id);
CREATE INDEX IF NOT EXISTS idx_bcc_issued  ON bcc_credentials(issued_at DESC);
