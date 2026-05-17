-- 0021_fix_fixture_jti.sql — Fix demo fixture JTI from 19-char suffix to 21-char suffix.
-- The API validates ^finding_[A-Za-z0-9_-]{21}$ — old JTI 'finding_demoreadoutfixture1'
-- has a 19-char suffix; this migration replaces it with 'finding_demoreadout_fixture_1' (21 chars).

-- Remove old fixture rows (findings_track_record references agent_id, not jti — leave it)
DELETE FROM finding_outcomes WHERE jti = 'finding_demoreadoutfixture1';
DELETE FROM findings WHERE jti = 'finding_demoreadoutfixture1';

-- Re-insert with corrected JTI
INSERT OR IGNORE INTO findings (
  jti, agent_id, audience, title, severity, cwe, target,
  evidence_hash, evidence_url, tools_used, time_to_find_ms,
  behavioral_score, trust_level, trust_confidence, submitted_at
) VALUES (
  'finding_demoreadout_fixture_1',
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
  'finding_demoreadout_fixture_1',
  'prog_demo_hackerone',
  'accepted',
  NULL,
  7.5,
  1500,
  1747500000
);
