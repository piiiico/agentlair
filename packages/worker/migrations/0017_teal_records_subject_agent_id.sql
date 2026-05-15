-- Migration 0017: Add subject_agent_id column to teal_records
-- Allows per-record attribution of the SUBJECT agent (vs SUBMITTER / operator_id).
-- Existing rows keep subject_agent_id = NULL; the read path falls back to operator_id.
-- Pipeline: agentlair-teal-subject-agent-id-20260515
ALTER TABLE teal_records ADD COLUMN subject_agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_teal_subject_agent
  ON teal_records (subject_agent_id) WHERE subject_agent_id IS NOT NULL;
