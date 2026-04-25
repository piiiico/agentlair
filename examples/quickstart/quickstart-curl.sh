#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AgentLair Quickstart — pure curl
#
# Demonstrates the full AgentLair flow in ~30 seconds:
#   1. Register a new agent (creates account + email address)
#   2. Send an email
#   3. Check inbox
#   4. Store a secret in the vault
#   5. Retrieve the secret from the vault
#
# Usage:
#   chmod +x quickstart-curl.sh
#   ./quickstart-curl.sh
#
#   # Or if you already have an API key:
#   AGENTLAIR_API_KEY=al_live_... ./quickstart-curl.sh
#
# Requirements: curl, python3 (for JSON pretty-print)
# Sign up:  https://agentlair.dev
# Docs:     https://agentlair.dev/docs
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="https://agentlair.dev"

# Helper: pretty-print JSON (requires python3)
pjson() {
  python3 -m json.tool 2>/dev/null || cat
}

# Helper: extract a JSON string field from stdin
jget() {
  local field="$1"
  python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('${field}',''))"
}

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  AgentLair Quickstart"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Register a new agent ─────────────────────────────────────────────
# POST /v1/register is the canonical onboarding endpoint.
# No API key required — creates your account and claims an @agentlair.dev
# email address in a single request.
#
# If you already have an API key set as $AGENTLAIR_API_KEY, this step is
# skipped and your existing key is used instead.

if [ -z "${AGENTLAIR_API_KEY:-}" ]; then
  echo "Step 1 ▶  Registering a new agent..."
  echo "          POST $BASE_URL/v1/register"
  echo ""

  REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/register" \
    -H "Content-Type: application/json" \
    -d '{"name": "my-agent"}')

  echo "$REGISTER_RESPONSE" | pjson
  echo ""

  # Extract API key and email from response
  AGENTLAIR_API_KEY=$(echo "$REGISTER_RESPONSE" | jget "api_key")
  AGENT_EMAIL=$(echo "$REGISTER_RESPONSE" | jget "email_address")

  if [ -z "$AGENTLAIR_API_KEY" ]; then
    echo "✗ Registration failed — could not extract api_key from response."
    exit 1
  fi

  echo "✓ API key:   $AGENTLAIR_API_KEY"
  echo "✓ Email:     $AGENT_EMAIL"
  echo ""
  echo "  ⚠  Save your API key — it will not be shown again."
  echo "     export AGENTLAIR_API_KEY=$AGENTLAIR_API_KEY"
  echo ""
else
  echo "Step 1 ▶  Using existing API key: ${AGENTLAIR_API_KEY:0:16}..."
  echo ""

  # Look up the email address associated with this account
  ADDRESSES_RESPONSE=$(curl -s "$BASE_URL/v1/email/addresses" \
    -H "Authorization: Bearer $AGENTLAIR_API_KEY")
  AGENT_EMAIL=$(echo "$ADDRESSES_RESPONSE" | python3 -c \
    "import sys, json; d=json.load(sys.stdin); addrs=d.get('addresses',[]); print(addrs[0] if addrs else '')" 2>/dev/null || echo "")

  if [ -z "$AGENT_EMAIL" ]; then
    echo "  No email address found. Claiming one..."
    CLAIM_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/email/claim" \
      -H "Authorization: Bearer $AGENTLAIR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"address": "my-agent@agentlair.dev"}')
    echo "$CLAIM_RESPONSE" | pjson
    AGENT_EMAIL=$(echo "$CLAIM_RESPONSE" | jget "address")
    echo ""
  fi

  echo "✓ Email: $AGENT_EMAIL"
  echo ""
fi

# ── Step 2: Send an email ─────────────────────────────────────────────────────
# POST /v1/email/send — send from your @agentlair.dev address.
# To demonstrate the loop, we send an email to ourselves.
# The 'from' field must be an address you own (claimed via /v1/register or /v1/email/claim).

echo "Step 2 ▶  Sending an email..."
echo "          POST $BASE_URL/v1/email/send"
echo ""

SEND_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/email/send" \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"from\": \"$AGENT_EMAIL\",
    \"to\": [\"$AGENT_EMAIL\"],
    \"subject\": \"Hello from AgentLair!\",
    \"text\": \"This email was sent by an AI agent via AgentLair.\\n\\nTimestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }")

echo "$SEND_RESPONSE" | pjson
echo ""
echo "✓ Email sent"
echo ""

# ── Step 3: Check inbox ───────────────────────────────────────────────────────
# GET /v1/email/inbox — list messages for an address you own.
# Pass ?limit=N to control page size (max 50).

echo "Step 3 ▶  Checking inbox..."
echo "          GET $BASE_URL/v1/email/inbox?address=$AGENT_EMAIL"
echo ""

INBOX_RESPONSE=$(curl -s "$BASE_URL/v1/email/inbox?address=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$AGENT_EMAIL'))")&limit=5" \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY")

echo "$INBOX_RESPONSE" | pjson
echo ""

MSG_COUNT=$(echo "$INBOX_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo "?")
echo "✓ Inbox: $MSG_COUNT message(s)"
echo ""

# ── Step 4: Store a secret in the vault ──────────────────────────────────────
# PUT /v1/vault/{key} — store an encrypted blob under a named key.
# The vault is zero-knowledge: the server stores opaque ciphertext.
# In production, encrypt your value with @agentlair/vault-crypto before storing.
# Here we use base64 as a stand-in for an encrypted blob.

echo "Step 4 ▶  Storing a secret in the vault..."
echo "          PUT $BASE_URL/v1/vault/my-api-key"
echo ""

# base64-encode the "secret" (in production: encrypt this with vault-crypto)
SECRET_VALUE="sk_prod_my_super_secret_api_key"
SECRET_B64=$(echo -n "$SECRET_VALUE" | base64)

VAULT_PUT_RESPONSE=$(curl -s -X PUT "$BASE_URL/v1/vault/my-api-key" \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"ciphertext\": \"$SECRET_B64\",
    \"metadata\": {\"label\": \"production API key\", \"created_by\": \"quickstart\"}
  }")

echo "$VAULT_PUT_RESPONSE" | pjson
echo ""
echo "✓ Secret stored (version: $(echo "$VAULT_PUT_RESPONSE" | jget "version"))"
echo ""

# ── Step 5: Retrieve the secret ───────────────────────────────────────────────
# GET /v1/vault/{key} — retrieve the encrypted blob.
# The 'ciphertext' field contains what you stored.
# In production, decrypt it with @agentlair/vault-crypto.

echo "Step 5 ▶  Retrieving the secret..."
echo "          GET $BASE_URL/v1/vault/my-api-key"
echo ""

VAULT_GET_RESPONSE=$(curl -s "$BASE_URL/v1/vault/my-api-key" \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY")

echo "$VAULT_GET_RESPONSE" | pjson
echo ""

# Decode the retrieved value
RETRIEVED_B64=$(echo "$VAULT_GET_RESPONSE" | jget "ciphertext")
RETRIEVED=$(echo "$RETRIEVED_B64" | base64 --decode 2>/dev/null || echo "(decode failed)")
echo "✓ Retrieved: $RETRIEVED"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────

echo "════════════════════════════════════════════════════════════"
echo "  Quickstart complete!"
echo ""
echo "  Your agent: $AGENT_EMAIL"
echo "  Dashboard:  https://agentlair.dev/dashboard"
echo "  Docs:       https://agentlair.dev/docs"
echo ""
echo "  Next steps:"
echo "    - npm install @agentlair/sdk   (TypeScript/Node)"
echo "    - pip install git+https://github.com/piiiico/agentlair-python.git  (Python)"
echo "    - Read the docs for webhooks, budgets, and trust scores"
echo "════════════════════════════════════════════════════════════"
echo ""
