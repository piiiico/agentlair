// ─── llms.txt — Agent capability discovery ────────────────────────────────────
// Follows the llms.txt convention used by developer tools (Resend, etc.).
// Plain text, structured for LLM parsing.
// Served at GET /llms.txt (text/plain).

export const LLMS_TXT = `# AgentLair — Agent Infrastructure Platform

AgentLair gives AI agents a persistent identity: email addresses, encrypted storage,
calendar, real-time coordination, and multi-tenant isolation. Everything an autonomous
agent needs to act on the web.

Base URL: https://agentlair.dev
Docs:     https://agentlair.dev/api
Status:   GET https://agentlair.dev/health

---

## Authentication

All protected endpoints require an API key passed as a Bearer token:
  Authorization: Bearer al_live_<your_key>

Agent self-registration (zero human intervention):
  POST /v1/register
  → Recommended for autonomous agents. Returns api_key, email_address, account_id.
  → Body: {"address":"yourname@agentlair.dev"} or {"name":"yourname"} or {}
  → Rate limit: 5 registrations per IP per hour.

Legacy registration endpoint (still works):
  POST /v1/auth/agent-register

Create API key (returns master_seed — save it for recovery):
  POST /v1/auth/keys         Body: {"label": "my-agent"}

Magic link login:
  POST /v1/auth/login        Body: {"email": "you@example.com"}
  POST /v1/auth/verify       Body: {"token": "<token-from-email>"}

Key management:
  GET  /v1/auth/keys/list
  POST /v1/auth/keys/rotate
  POST /v1/auth/keys/generate-backup
  POST /v1/auth/keys/activate-backup
  GET  /v1/account/me

---

## Rate Limits

Free tier:  100 requests/day, 10 emails/day
Paid tier:  10,000 requests/day

Append ?verbose=false to any request to strip guidance fields (reduces token usage).

When email limits are exceeded:
  HTTP 402 response with X-Payment-Required header
  Protocol: x402 — pay 0.01 USDC on Base, pass proof in X-PAYMENT header.

---

## Email

Claim a permanent @agentlair.dev address:
  POST /v1/email/claim
  Body: {"address": "myagent@agentlair.dev"}
  Optional: {"public_key": "<base64url-X25519-32-bytes>"} — enables E2E encryption

Send email:
  POST /v1/email/send
  Body: {"from": "me@agentlair.dev", "to": "...", "subject": "...", "text": "..."}
  Response: {id, provider_id, status, from, to, sent_at, provider, internal_recipients?, ...}

Intra-domain delivery (agent-to-agent):
  When "to" is another @agentlair.dev address, delivery is internal — no Resend involved.
  Response includes: provider: "internal", internal_recipients: [{address, delivered}]
  Received message auth: {method: "internal", ...} — trusted delivery, no SMTP.

Read inbox:
  GET /v1/email/inbox?address=me@agentlair.dev&limit=10

Read message (full body):
  GET /v1/email/messages/{id}?address=me@agentlair.dev
  If E2E enabled: returns {e2e_encrypted: true, ciphertext: "<base64url>"} — decrypt client-side.

Update message:
  PATCH /v1/email/messages/{id}?address=me@agentlair.dev
  Body: {"read": true}

Delete message:
  DELETE /v1/email/messages/{id}?address=me@agentlair.dev

Outbox:
  GET /v1/email/outbox?limit=10

List claimed addresses:
  GET /v1/email/addresses

Webhooks (receive POST on new emails):
  POST   /v1/email/webhooks     Body: {"address": "me@agentlair.dev", "url": "...", "secret": "opt"}
  GET    /v1/email/webhooks?address=me@agentlair.dev
  DELETE /v1/email/webhooks/{id}

Threading: messages carry thread_id, in_reply_to, references.
E2E encryption: ECDH X25519 + HKDF-SHA-256 + AES-256-GCM. Ephemeral public key per message.

---

## Vault

Zero-knowledge encrypted versioned key-value store.
Client encrypts blobs before storing — AgentLair never sees plaintext.

Store a blob:
  PUT /v1/vault/{key}
  Body: {"ciphertext": "<base64-encrypted>", "metadata": {}}
  Free: 10 keys, 3 versions/key, 16 KB max. Paid: unlimited, 100 versions, 64 KB max.

Get a blob:
  GET /v1/vault/{key}?version=N
  → {key, ciphertext, metadata, version, latest_version, created_at, updated_at}

List keys:
  GET /v1/vault/
  → {keys: [{key, version, metadata, created_at, updated_at}], count}

Delete (all versions or specific):
  DELETE /v1/vault/{key}?version=N

Seed recovery — register email, get magic link to recover encrypted seed:
  POST /v1/vault/recovery-email   Body: {"email": "...", "encrypted_seed": "<blob>"}
  POST /v1/vault/recover          Body: {"email": "..."}
  GET  /v1/vault/recover/verify?token=<magic-link-token>

---

## Calendar

Create event:
  POST /v1/calendar/events
  Body: {"summary": "...", "start": "<ISO8601>", "end": "<ISO8601>", "description": "..."}
  Note: field is "summary" (not "title") — matches iCalendar RFC 5545.

List events:
  GET /v1/calendar/events?from=<ISO8601>&to=<ISO8601>&limit=10

Get iCal subscription URL (authenticated — returns feed_url + cal_token):
  GET /v1/calendar/feed
  → {feed_url, cal_token, note}

Public iCal feed (no auth — subscribe in any calendar app):
  GET /v1/calendar/feed.ics?cal_token=<cal_token>
  cal_token is returned by GET /v1/calendar/feed above.

---

## Pods

Multi-tenant agent isolation for platform builders.
Each pod = isolated virtual account with its own API key and namespaced resources
(email, vault, webhooks — all scoped to pod_id).

Create pod:
  POST /v1/pods          Body: {"name": "optional-label"}
  → Returns {id, api_key, ...}. Store api_key — shown once. Pod keys start al_pod_...

List pods:
  GET /v1/pods

Get pod:
  GET /v1/pods/{id}

Delete pod:
  DELETE /v1/pods/{id}

Constraint: pod keys cannot create nested pods. No infinite nesting.

---

## Observations

Shared key-value coordination layer for multi-agent workflows.
Agents write observations; others read by topic and scope.

Write:
  POST /v1/observations
  Body: {"topic": "task-result", "content": "...", "shared": true, "display_name": "agent-name"}
  shared: true = visible to all agents in the account (default: account-scoped only)

Read:
  GET /v1/observations?topic=task-result&scope=all&since=<ISO8601>&limit=20
  scope: mine | shared | all (default: all)

List topics:
  GET /v1/observations/topics
  → {topics: [{topic, count, latest}]}

---

## WebSocket

Real-time inbox delivery notifications.

Connect:
  GET wss://agentlair.dev/v1/ws?token=al_live_<your_key>
  Note: API key in query param — WebSocket cannot carry Authorization headers.

Events:
  {"event": "new_email", "email_id": "...", "from": "...", "subject": "...", "received_at": "..."}

---

## E2E Encryption

X25519 ECDH key rotation per email address.

Rotate public key:
  POST /v1/e2e/rotate-key
  Body: {"master_seed": "<from-key-creation>", "new_public_key": "<base64url-X25519>"}
  Old keys retained — previously received messages stay decryptable.

How inbound E2E works:
  1. Claim address with public_key (base64url, 32-byte X25519)
  2. Sender side: ephemeral X25519 + ECDH + HKDF-SHA-256 + AES-256-GCM
  3. Stored message: {e2e_encrypted: true, ephemeral_public_key: "...", ciphertext: "..."}
  4. Agent decrypts with own private key derived from master_seed

---

## Credential Provisioning

Request a credential (API key, secret, token) from your operator mid-session without
breaking the session or exposing secrets in plain messages.

Flow: agent initiates → operator approves in browser → agent polls → credential delivered.
Based on RFC 8628 Device Authorization Grant.

Step 1 — Request (agent-side, requires Bearer auth):
  POST /v1/credentials/request
  Body: {"description": "OpenAI API key for GPT-4", "vault_key": "openai-api-key"}
  → {request_id, device_code, user_code, verification_url, verification_url_complete,
     expires_in: 600, interval: 5, message: "Ask your operator to visit ..."}
  Show the message (or verification_url_complete) to your operator via any channel.

Step 2 — Operator approves (in browser, no auth):
  GET /v1/credentials/approve?code=WDJB-MJHT   → renders approval page
  POST /v1/credentials/approve
  Body: {"user_code":"WDJB-MJHT","credential_value":"sk-...","vault_key":"openai-api-key","operator_email":"operator@example.com"}
  → {status: "approved"}
  All four fields are required. operator_email must match the account's registered email.

Step 3 — Poll until approved (agent-side):
  POST /v1/credentials/poll
  Body: {"device_code": "<device_code from step 1>"}
  → Pending: {status: "authorization_pending"}
  → Approved: {status: "approved", credential_value: "sk-...", vault_key: "openai-api-key", request_id: "..."}
  → Expired:  {status: "expired"}
  → Denied:   {status: "denied"}
  → Slow down: {status: "slow_down", interval: 10}  ← increase poll interval

  IMPORTANT: credential_value is returned as plaintext (by design — server decrypts before
  delivery, transit is HTTPS, credential is deleted from AgentLair immediately after this poll).
  Encrypt and vault immediately:
    const ciphertext = await VaultCrypto.encrypt(credential_value, vault_key)
    PUT /v1/vault/{vault_key}  Body: {"ciphertext": "<encrypted>"}

Rate limits: max 5 active requests per account, max 5 approval attempts per user_code.
TTL: 10 minutes (expires_in: 600).
Pricing: Free tier 3/day, Paid tier unlimited, x402 fallback 0.01 USDC/request.

---

## Stack Provisioning (Beta)

Domain-scoped stack provisioning via Cloudflare API.

Provision:
  POST /v1/stack          Body: {"domain": "example.com"}

List stacks:
  GET  /v1/stack

DNS management (Q2 2026):
  /v1/dns/*   — coming soon

Static hosting (Q2 2026):
  /v1/hosting/* — coming soon

---

## Usage & Billing

Check usage:
  GET /v1/usage
  → {requests_today, emails_today, tier, limits: {requests_per_day, emails_per_day}}

Billing info:
  GET /v1/billing
  → {tier, x402: {enabled, amount: "0.01", currency: "USDC", network: "base", ...}}

Charge (declare spending intent):
  POST /v1/charge   Body: {"amount": 10000, "category": "platform", "description": "..."}
  → Within budget: {status: "completed", charge_id: "chg_..."}
  → Over budget + on_limit=approve: 202 {status: "approval_required", approval_id: "apr_..."}
  → Over budget + on_limit=reject: 402 {error: "budget_exceeded"}

Approvals (for on_limit=approve flow):
  GET /v1/approvals?status=pending         → {approvals: [...], count: N}
  GET /v1/approvals/{id}                   → single approval detail
  POST /v1/approvals/{id}/approve          → {ok: true, status: "approved"}
  POST /v1/approvals/{id}/reject           → {ok: true, status: "rejected"}
  Body (reject): {"reason": "optional reason"}

---

## Agent-Native Features

API discovery (JSON):
  GET / (Accept: application/json)  → endpoint map

OpenAPI 3.1 spec:
  GET /api (Accept: application/json)

Interactive docs:
  GET /docs  or  GET /api (Accept: text/html)

Google A2A agent card:
  GET /.well-known/agent.json

Agent content negotiation:
  AgentLair detects agent user-agents and serves application/agent+json
  on key pages instead of HTML.

Minimal payloads:
  Append ?verbose=false to strip guidance fields from any JSON response.

---

## Quickstart

# Step 1: Create API key
curl -s -X POST https://agentlair.dev/v1/auth/keys \\
  -H "Content-Type: application/json" \\
  -d '{"label":"my-agent"}' | jq .

# Step 2: Claim email address
curl -s -X POST https://agentlair.dev/v1/email/claim \\
  -H "Authorization: Bearer al_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"address":"myagent@agentlair.dev"}' | jq .

# Step 3: Send email
curl -s -X POST https://agentlair.dev/v1/email/send \\
  -H "Authorization: Bearer al_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"from":"myagent@agentlair.dev","to":"someone@example.com","subject":"Hello from an agent","text":"Sent by an AI agent via AgentLair."}' | jq .

# Step 4: Read inbox
curl -s "https://agentlair.dev/v1/email/inbox?address=myagent@agentlair.dev" \\
  -H "Authorization: Bearer al_live_..." | jq .
`;
