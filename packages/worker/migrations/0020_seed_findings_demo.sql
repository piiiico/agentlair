-- 0020_seed_findings_demo.sql — Idempotent demo fixture for findings public readout pipeline.
-- All rows use INSERT OR IGNORE so re-applying is a no-op.
-- Agent id and jti are deterministic strings to make smoke tests reproducible.

INSERT OR IGNORE INTO program_api_keys (program_id, api_key_hash, audience, display_name, created_at)
VALUES (
  'prog_demo_hackerone',
  '0000000000000000000000000000000000000000000000000000000000000000',
  'https://hackerone.com',
  'Demo HackerOne (fixture — non-functional hash)',
  '2026-05-17T00:00:00Z'
);

INSERT OR IGNORE INTO findings (
  jti, agent_id, audience, title, severity, cwe, target,
  evidence_hash, evidence_url, tools_used, time_to_find_ms,
  behavioral_score, trust_level, trust_confidence, submitted_at
) VALUES (
  'finding_demoreadoutfixture1',
  'acc_demoreadoutfixture',
  'https://hackerone.com',
  'Demo: SQL injection in /v1/items search filter',
  'HIGH',
  'CWE-89',
  'https://example.test/api/v1/items?search=*',
  'sha256:0000000000000000000000000000000000000000000000000000000000000001',
  NULL,
  '["semgrep","bun"]',
  4200,
  72,
  'l2',
  0.83,
  '2026-05-17T18:00:00Z'
);

INSERT OR IGNORE INTO finding_outcomes (jti, program_id, outcome, reason, severity_confirmed, payout_usd, ts)
VALUES (
  'finding_demoreadoutfixture1',
  'prog_demo_hackerone',
  'accepted',
  NULL,
  7.5,
  1500,
  1747500000
);

INSERT OR IGNORE INTO findings_track_record (
  agent_id, findings_submitted, findings_accepted, findings_rejected,
  valid_rate, false_positive_rate, avg_severity, updated_ts
) VALUES (
  'acc_demoreadoutfixture',
  1, 1, 0,
  1.0000, 0.0000, 7.5,
  1747500000
);
