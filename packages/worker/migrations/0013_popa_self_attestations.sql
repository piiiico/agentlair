-- PoPA Self-Attestations — agent-signed liveness proofs
--
-- Complements controller-issued popa_attestations (0009). The controller path
-- is cron-driven (once per UTC day). The self-attest path is agent-driven:
-- an agent presents its AAT and the server records an on-demand liveness proof.
--
-- One self-attestation per DID per UTC day (idx_psa_did_date enforces this).
-- The aat_jti unique index prevents replay — the same token cannot produce two
-- attestations even within its 1-hour TTL.

CREATE TABLE IF NOT EXISTS popa_self_attestations (
  id            TEXT    PRIMARY KEY,      -- "psa_<nanoid(16)>"
  agent_did     TEXT    NOT NULL,         -- DID from AAT `did` claim
  account_id    TEXT    NOT NULL,         -- account ID from AAT `sub`
  aat_jti       TEXT    NOT NULL,         -- AAT jti — replay prevention
  sequence      INTEGER NOT NULL,         -- monotonic per DID, from 1
  window_date   TEXT    NOT NULL,         -- UTC date "YYYY-MM-DD"
  attested_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  signed_claim  TEXT                      -- signed liveness JSON (optional)
);

CREATE INDEX        IF NOT EXISTS idx_psa_did_seq  ON popa_self_attestations(agent_did, sequence DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_psa_did_date ON popa_self_attestations(agent_did, window_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_psa_jti      ON popa_self_attestations(aat_jti);
