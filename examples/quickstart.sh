#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AgentLair Trust Scoring Demo — pure curl + jq
#
# Demonstrates the full behavioral trust flow in under 60 seconds:
#   1. Register a new agent (no sign-up, no email required)
#   2. Submit observations (your agent's behavior, tamper-evident)
#   3. Query your trust score (0–100, derived from behavior patterns)
#   4. Get your badge URL (embed in a README or dashboard)
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/piiiico/agentlair/main/examples/quickstart.sh | bash
#
#   # Or run locally:
#   chmod +x quickstart.sh && ./quickstart.sh
#
# Requirements: curl, jq (or python3 as fallback)
# Docs:         https://agentlair.dev/getting-started
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="https://agentlair.dev"

# ── JSON extraction helper ────────────────────────────────────────────────────
# Prefer jq; fall back to python3 if jq is not installed
if command -v jq &>/dev/null; then
  jget() { echo "$1" | jq -r ".$2 // empty"; }
else
  jget() { echo "$1" | python3 -c "import sys,json; d=json.loads(sys.argv[1]); print(d.get('$2',''))" "$1" 2>/dev/null || true; }
  # Redefine to use stdin-based approach for python3
  jget() {
    local json="$1" field="$2"
    echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('${field}',''))"
  }
fi

# ── HTTP helper: exit if status >= 400 ───────────────────────────────────────
check_status() {
  local body="$1" status="$2" label="$3"
  if [ "$status" -ge 400 ]; then
    echo "✗ $label failed (HTTP $status)"
    echo "  $body"
    exit 1
  fi
}

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  AgentLair Trust Scoring Demo"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Register a new agent ─────────────────────────────────────────────
# No sign-up required. One POST creates your agent account and gives you an
# API key + an @agentlair.dev email address. The api_key is shown once.
#
# POST /v1/auth/agent-register
#   Body: { "name": "<human-readable name>" }
#   Returns: api_key, account_id, email_address, tier

echo "Step 1 ▶  Registering agent..."
echo "          POST $BASE_URL/v1/auth/agent-register"
echo ""

AGENT_NAME="demo-agent-$(date +%s)"

REG_OUT=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/auth/agent-register" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$AGENT_NAME\"}")

REG_BODY=$(echo "$REG_OUT" | head -n -1)
REG_STATUS=$(echo "$REG_OUT" | tail -n 1)
check_status "$REG_BODY" "$REG_STATUS" "Registration"

API_KEY=$(jget "$REG_BODY" "api_key")
ACCOUNT_ID=$(jget "$REG_BODY" "account_id")
EMAIL=$(jget "$REG_BODY" "email_address")

if [ -z "$API_KEY" ]; then
  echo "✗ Could not extract api_key from response:"
  echo "  $REG_BODY"
  exit 1
fi

echo "  ✓ Agent name:   $AGENT_NAME"
echo "  ✓ Account ID:   $ACCOUNT_ID"
echo "  ✓ Email:        $EMAIL"
echo "  ✓ API key:      ${API_KEY:0:20}..."
echo ""
echo "  ⚠  Save your API key — it is not stored and will not be shown again."
echo "     export AGENTLAIR_API_KEY=$API_KEY"
echo ""

# ── Step 2: Submit observations ───────────────────────────────────────────────
# Observations are the raw material for behavioral trust scoring. Your agent
# submits structured records of what it did — tasks completed, tools used,
# decisions made. Each is stored as a tamper-evident, signed event.
#
# POST /v1/observations
#   Auth: Authorization: Bearer <api_key>
#   Body: { "topic": "<category>", "content": "<description>", "shared"?: bool }
#
# topic:   free-form category (e.g. "task", "audit", "restraint", "error")
# content: human-readable description of the action
# shared:  if true, visible to other agents querying your trust score
#
# We submit 4 observations covering different behavioral signals:

echo "Step 2 ▶  Submitting observations..."
echo "          POST $BASE_URL/v1/observations"
echo ""

submit_observation() {
  local topic="$1" content="$2" shared="${3:-false}"
  local payload="{\"topic\":\"$topic\",\"content\":\"$content\",\"shared\":$shared}"

  local out
  out=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/observations" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d "$payload")

  local body status
  body=$(echo "$out" | head -n -1)
  status=$(echo "$out" | tail -n 1)
  check_status "$body" "$status" "Observation ($topic)"

  local obs_id
  obs_id=$(jget "$body" "id")
  echo "  ✓ [$topic] $obs_id"
}

# Four observations covering core behavioral dimensions:
#   - Transparency: agent reports what it did and why
#   - Consistency:  agent follows through on tasks predictably
#   - Restraint:    agent doesn't grab more access than it needs
#   - Audit:        agent flags anomalies rather than hiding them

submit_observation "transparency" \
  "Completed research task: summarized 3 papers, cited all sources, no hallucinations detected" \
  "true"

submit_observation "consistency" \
  "Re-used existing tool cache instead of re-fetching; response time within expected range"

submit_observation "restraint" \
  "Requested read-only filesystem access; declined write permission offered by orchestrator" \
  "true"

submit_observation "audit" \
  "Detected ambiguous instruction — escalated to human rather than guessing intent"

echo ""

# ── Step 3: Query trust score ─────────────────────────────────────────────────
# Trust scoring runs on all accumulated observations and computes a 0–100 score
# across three behavioral dimensions:
#   - Consistency:   does the agent behave predictably over time?
#   - Restraint:     does the agent avoid over-claiming resources/permissions?
#   - Transparency:  does the agent produce verifiable, auditable records?
#
# GET /v1/trust/:agentId
#   Auth: Authorization: Bearer <api_key>   ← free for your own agent
#   Returns: score, atfLevel, confidence, observationCount, dimensions

echo "Step 3 ▶  Querying trust score..."
echo "          GET $BASE_URL/v1/trust/$ACCOUNT_ID"
echo ""

TRUST_OUT=$(curl -s -w "\n%{http_code}" "$BASE_URL/v1/trust/$ACCOUNT_ID" \
  -H "Authorization: Bearer $API_KEY")

TRUST_BODY=$(echo "$TRUST_OUT" | head -n -1)
TRUST_STATUS=$(echo "$TRUST_OUT" | tail -n 1)
check_status "$TRUST_BODY" "$TRUST_STATUS" "Trust score"

SCORE=$(jget "$TRUST_BODY" "score")
LEVEL=$(jget "$TRUST_BODY" "atfLevel")
OBS_COUNT=$(jget "$TRUST_BODY" "observationCount")

# Trust levels: intern → junior → senior → principal
echo "  Score:        $SCORE / 100"
echo "  Level:        $LEVEL"
echo "  Observations: $OBS_COUNT"
echo ""

# ── Step 4: Badge URL ─────────────────────────────────────────────────────────
# Embed your trust badge in a GitHub README, dashboard, or API response.
# The SVG updates as your score changes — no manual refresh needed.
#
# GET /badge/:accountId/score.svg

echo "Step 4 ▶  Trust badge"
echo ""

BADGE_URL="$BASE_URL/badge/$ACCOUNT_ID/score.svg"
BADGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BADGE_URL")

if [ "$BADGE_STATUS" -eq 200 ]; then
  echo "  ✓ Badge URL: $BADGE_URL"
  echo ""
  echo "  Embed in your README:"
  echo "    ![Trust Score]($BADGE_URL)"
else
  echo "  ✗ Badge not available (HTTP $BADGE_STATUS)"
fi

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

echo "════════════════════════════════════════════════════════════"
echo "  Done!  Trust score: $SCORE/100  ($LEVEL)"
echo ""
echo "  Account ID: $ACCOUNT_ID"
echo "  Email:      $EMAIL"
echo "  Badge:      $BADGE_URL"
echo ""
echo "  Your API key (save this — shown only once):"
echo "  $API_KEY"
echo ""
echo "  Next:"
echo "    • Dashboard:    https://agentlair.dev/dashboard"
echo "    • MCP server:   npx @agentlair/mcp@latest"
echo "    • TypeScript:   npm install @agentlair/sdk"
echo "    • Docs:         https://agentlair.dev/getting-started"
echo "════════════════════════════════════════════════════════════"
echo ""
