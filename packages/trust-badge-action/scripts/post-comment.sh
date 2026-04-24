#!/bin/bash
# Post or update a PR comment with AgentLair trust score badge
# Requires: gh CLI (available on all GitHub-hosted runners)

set -euo pipefail

# Required env vars
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${AGENT_ID:?AGENT_ID is required}"
: "${SCORE:?SCORE is required}"
: "${ATF_LEVEL:?ATF_LEVEL is required}"
: "${PR_NUMBER:?PR_NUMBER is required}"
: "${REPO:?REPO is required}"

# Optional (with defaults)
CONFIDENCE="${CONFIDENCE:-0}"
OBSERVATION_COUNT="${OBSERVATION_COUNT:-0}"
DIM_CONSISTENCY="${DIM_CONSISTENCY:-0}"
DIM_RESTRAINT="${DIM_RESTRAINT:-0}"
DIM_TRANSPARENCY="${DIM_TRANSPARENCY:-0}"

BADGE_URL="https://api.agentlair.dev/badge/${AGENT_ID}/score.svg"
EXPLORE_URL="https://agentlair.dev/explore"

# Map ATF level to emoji and description
case "$ATF_LEVEL" in
  principal)  LEVEL_EMOJI="🔵"; LEVEL_DESC="Verified" ;;
  senior)     LEVEL_EMOJI="🟢"; LEVEL_DESC="High Trust" ;;
  junior)     LEVEL_EMOJI="🟡"; LEVEL_DESC="Medium Trust" ;;
  intern|*)   LEVEL_EMOJI="🔴"; LEVEL_DESC="Low Trust" ;;
esac

# README badge snippet
README_BADGE="[![AgentLair Trust](${BADGE_URL})](${EXPLORE_URL})"

# Build comment body
# Note: using printf to avoid issues with special characters in heredoc
COMMENT_BODY=$(cat <<COMMENT_EOF
<!-- agentlair-trust-score -->
## ${LEVEL_EMOJI} AgentLair Trust Score

[![AgentLair Trust](${BADGE_URL})](${EXPLORE_URL})

**Score: ${SCORE}/100** · ${LEVEL_DESC} · ${ATF_LEVEL^}

| Dimension | Score |
|-----------|-------|
| Consistency | ${DIM_CONSISTENCY}/100 |
| Restraint | ${DIM_RESTRAINT}/100 |
| Transparency | ${DIM_TRANSPARENCY}/100 |

> Based on ${OBSERVATION_COUNT} behavioral observations. Confidence: $(echo "scale=0; ${CONFIDENCE} * 100 / 1" | bc 2>/dev/null || echo "${CONFIDENCE}")%

**Embed this badge in your README:**
\`\`\`markdown
${README_BADGE}
\`\`\`

<sub>[What is AgentLair Trust?](${EXPLORE_URL}) · [Agent: ${AGENT_ID}](https://api.agentlair.dev/badge/${AGENT_ID}/score.json)</sub>
COMMENT_EOF
)

# Find existing AgentLair comment on this PR (look for our marker)
EXISTING_COMMENT_ID=$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" \
  --jq '.[] | select(.body | contains("<!-- agentlair-trust-score -->")) | .id' \
  2>/dev/null | head -1 || true)

if [ -n "$EXISTING_COMMENT_ID" ]; then
  echo "::notice::Updating existing comment ${EXISTING_COMMENT_ID}"
  gh api "repos/${REPO}/issues/comments/${EXISTING_COMMENT_ID}" \
    -X PATCH \
    -f body="$COMMENT_BODY"
else
  echo "::notice::Creating new comment on PR #${PR_NUMBER}"
  gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" \
    -f body="$COMMENT_BODY"
fi

echo "::notice::Trust score comment posted on PR #${PR_NUMBER}"
