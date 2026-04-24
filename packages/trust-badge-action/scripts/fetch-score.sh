#!/bin/bash
# Fetch AgentLair trust score for a given agent ID
# Outputs: score, atf-level, confidence, observation-count, badge-url, score-json, dimensions

set -euo pipefail

if [ -z "${AGENT_ID:-}" ]; then
  echo "::error::agent-id input is required"
  exit 1
fi

# Validate format: acc_<alphanumeric>
if ! echo "$AGENT_ID" | grep -qE '^acc_[A-Za-z0-9_-]+$'; then
  echo "::error::Invalid agent-id format. Expected: acc_<alphanumeric> (e.g. acc_myagent)"
  exit 1
fi

SCORE_URL="https://api.agentlair.dev/badge/${AGENT_ID}/score.json"
BADGE_URL="https://api.agentlair.dev/badge/${AGENT_ID}/score.svg"

echo "::notice::Fetching trust score from ${SCORE_URL}"

# Fetch with retry (up to 3 attempts)
SCORE_JSON=""
for attempt in 1 2 3; do
  SCORE_JSON=$(curl -sf --max-time 10 "$SCORE_URL" 2>/dev/null) && break
  echo "::warning::Attempt ${attempt}/3 failed, retrying..."
  sleep 2
done

if [ -z "$SCORE_JSON" ]; then
  echo "::error::Failed to fetch trust score from AgentLair API after 3 attempts"
  exit 1
fi

# Parse fields using jq (available on all GitHub-hosted runners)
SCORE=$(echo "$SCORE_JSON" | jq -r '.score // 0')
ATF_LEVEL=$(echo "$SCORE_JSON" | jq -r '.atfLevel // "intern"')
CONFIDENCE=$(echo "$SCORE_JSON" | jq -r '.confidence // 0')
OBSERVATION_COUNT=$(echo "$SCORE_JSON" | jq -r '.observationCount // 0')
DIM_CONSISTENCY=$(echo "$SCORE_JSON" | jq -r '.dimensions.consistency.score // 0')
DIM_RESTRAINT=$(echo "$SCORE_JSON" | jq -r '.dimensions.restraint.score // 0')
DIM_TRANSPARENCY=$(echo "$SCORE_JSON" | jq -r '.dimensions.transparency.score // 0')

# Write outputs to GITHUB_OUTPUT
{
  echo "score=${SCORE}"
  echo "atf-level=${ATF_LEVEL}"
  echo "confidence=${CONFIDENCE}"
  echo "observation-count=${OBSERVATION_COUNT}"
  echo "badge-url=${BADGE_URL}"
  echo "dim-consistency=${DIM_CONSISTENCY}"
  echo "dim-restraint=${DIM_RESTRAINT}"
  echo "dim-transparency=${DIM_TRANSPARENCY}"
  # Multiline output needs EOF delimiter
  echo "score-json<<SCORE_JSON_EOF"
  echo "$SCORE_JSON"
  echo "SCORE_JSON_EOF"
} >> "$GITHUB_OUTPUT"

echo "::notice::Trust score fetched: ${SCORE} (${ATF_LEVEL}) — ${OBSERVATION_COUNT} observations"
echo "::notice::Badge URL: ${BADGE_URL}"
