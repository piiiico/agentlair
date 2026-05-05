-- PoPA v2 — per-agent enrollment lifecycle
--
-- Extends popa_subscribers (introduced in 0009) with enrollment metadata so the
-- table answers v2 questions: "when was this DID last attested?" and "is this
-- enrollment revoked?". A separate popa_enrollments table would have duplicated
-- the agent_did → enabled mapping the cron already reads — instead we extend.
--
-- enabled=1 + revoked_at=NULL  → active (cron emits)
-- enabled=0 + revoked_at=NULL  → paused (cron skips, can re-enable via enroll)
-- enabled=0 + revoked_at!=NULL → revoked (cron skips; controller-tombstoned)

ALTER TABLE popa_subscribers ADD COLUMN last_attested_at TEXT;
ALTER TABLE popa_subscribers ADD COLUMN revoked_at       TEXT;

-- Cron predicate becomes (enabled = 1 AND revoked_at IS NULL); index helps the
-- nightly scan when the subscriber list grows past a few thousand rows.
CREATE INDEX IF NOT EXISTS idx_popa_subs_active
  ON popa_subscribers(enabled, revoked_at);
