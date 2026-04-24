# AgentLair Credentials API

_Version: v0.18.1 | Verified against live implementation_

Agents use the Credentials API to request secrets from their human operator mid-session — without breaking the session or sharing credentials insecurely. The API implements an RFC 8628-inspired device authorization flow.

## Overview

```
Agent                         AgentLair                     Human (browser)
  |                               |                               |
  |-- POST /v1/credentials/request -->|                           |
  |<-- 201 { device_code,         |                              |
  |           user_code,          |                              |
  |           message }           |                              |
  |                               |-- email notification ------->|
  |  (agent shows URL+code to operator via its own channel)      |
  |                               |                              |
  |                               |<-- GET /approve?code=XXXX-XXXX
  |                               |   (renders approval page)    |
  |                               |                              |
  |                               |<-- POST /approve             |
  |                               |    { user_code, credential_value,
  |                               |      vault_key, operator_email }
  |                               |                              |
  |-- POST /v1/credentials/poll -->|  (repeat every 5s)          |
  |<-- 200 { status: "approved",  |                              |
  |           credential_value }  |                              |
```

**Security properties:**
- Credential is encrypted at rest (AES-256-GCM, key derived from `device_code`) during the 60-second window between approval and poll
- One-time delivery: KV entry is deleted immediately after the agent's first successful poll
- Operator email binding: only the account's registered email can approve
- Max 5 active requests per account, max 5 approval attempts per code

---

## Endpoints

### `POST /v1/credentials/request`

**Auth:** Bearer token (agent API key required)

Agent initiates a credential request. Returns codes for polling and for showing to the human operator.

**Request body:**

```json
{
  "description": "OpenAI API key for GPT-4 access",
  "vault_key": "openai-api-key",
  "metadata": {
    "service": "openai"
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `description` | string | **Yes** | Shown on the approval page. Max 200 chars |
| `vault_key` | string | No | Suggested vault key name. Operator can override |
| `metadata` | object | No | Arbitrary metadata. Stored unencrypted |

**Response: `201 Created`**

```json
{
  "request_id": "credreq_a1b2c3d4e5f6g7h8",
  "device_code": "dc_7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w",
  "user_code": "WDJB-MJHT",
  "verification_url": "https://agentlair.dev/v1/credentials/approve",
  "verification_url_complete": "https://agentlair.dev/v1/credentials/approve?code=WDJB-MJHT",
  "expires_in": 600,
  "interval": 5,
  "message": "Ask your operator to visit https://agentlair.dev/v1/credentials/approve?code=WDJB-MJHT"
}
```

| Field | Description |
|-------|-------------|
| `request_id` | Unique ID for audit trail |
| `device_code` | Opaque token used to poll. **Never show to humans** |
| `user_code` | 8-char uppercase code (format: `XXXX-XXXX`). Show this to operator |
| `verification_url` | Base approval URL |
| `verification_url_complete` | Approval URL with code pre-filled (use for QR codes, links, messages) |
| `expires_in` | Seconds until codes expire (600 = 10 minutes) |
| `interval` | Minimum seconds between poll attempts |
| `message` | Ready-to-show message for the operator |

**Error responses:**

| Status | Code | Cause |
|--------|------|-------|
| `400` | `missing_description` | `description` field absent or empty |
| `401` | `unauthorized` | Missing or invalid API key |
| `403` | `no_operator_email` | Account has no registered operator email (complete OTP verification first) |
| `429` | `rate_limited` | Max 5 active requests per account |

---

### `GET /v1/credentials/approve`

**Auth:** None (public HTML page)

Renders the operator-facing approval page in a browser. This is not a JSON API — it returns HTML.

**Query parameters:**

| Param | Required | Notes |
|-------|----------|-------|
| `code` | No | Pre-fills the user code field. Use `verification_url_complete` to link directly |

**Behavior:**
- If `code` is valid and request is pending: shows agent identity (name, account ID), credential description, and fields for operator email + credential value
- If `code` is invalid or expired: shows an error with the code pre-filled
- If no `code` provided: shows a blank form where operator can enter the code manually

**Operator email binding:** AgentLair also sends a notification email to the account's registered operator email when a request is created, including the approval link.

---

### `POST /v1/credentials/approve`

**Auth:** None (public), validated via `user_code` + `operator_email` binding

Human operator submits the credential. Accepts JSON or `application/x-www-form-urlencoded` (HTML form submission).

**Request body (JSON):**

```json
{
  "user_code": "WDJB-MJHT",
  "credential_value": "sk-proj-abc123...",
  "vault_key": "openai-api-key",
  "operator_email": "hakon@example.com"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `user_code` | string | **Yes** | Case-insensitive, normalized to uppercase |
| `credential_value` | string | **Yes** (on approve) | The secret to deliver. Max 8192 bytes |
| `vault_key` | string | **Yes** (on approve) | Final vault key name |
| `operator_email` | string | **Yes** | Must match the account's registered operator email |
| `approved` | boolean | No | Legacy deny: set to `false` to deny without a credential |
| `action` / `_action` | string | No | `"approve"` (default) or `"deny"` |

**To deny a request**, set `"approved": false` (or `"action": "deny"`). `credential_value` is not required for denials.

**Response: `200 OK` (approved)**

```json
{
  "status": "approved",
  "message": "Credential will be delivered to the agent on next poll."
}
```

**Response: `200 OK` (denied)**

```json
{
  "status": "denied",
  "message": "Credential request denied."
}
```

**Error responses:**

| Status | Code | Cause |
|--------|------|-------|
| `400` | `missing_user_code` | `user_code` not provided |
| `400` | `missing_credential_value` | `credential_value` absent on approve |
| `400` | `missing_vault_key` | `vault_key` absent on approve |
| `400` | `missing_operator_email` | `operator_email` not provided |
| `400` | `payload_too_large` | `credential_value` exceeds 8192 bytes |
| `400` | `invalid_code` | User code not found or expired |
| `400` | `code_expired` | Request TTL exceeded |
| `400` | `request_not_pending` | Request already approved/denied |
| `400` | `email_mismatch` | `operator_email` doesn't match account's registered email |
| `429` | `max_attempts_exceeded` | 5 approval attempts used (code is locked) |

---

### `POST /v1/credentials/poll`

**Auth:** Bearer token (agent API key required)

Agent polls for the credential. Call every `interval` seconds (default: 5s) until status is terminal.

**Request body:**

```json
{
  "device_code": "dc_7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w"
}
```

**Poll responses — all `200 OK`:**

| `status` | Meaning | Action |
|----------|---------|--------|
| `authorization_pending` | Human hasn't approved yet | Wait `interval` seconds, retry |
| `slow_down` | Polling too fast (>60 polls in window) | Wait `interval` seconds from response |
| `approved` | Credential ready | Read `credential_value`, vault it, done |
| `denied` | Operator denied the request | Notify user, abort |
| `expired` | TTL elapsed (or device_code never existed) | Abort; optionally create a new request |

**Response when approved:**

```json
{
  "status": "approved",
  "credential_value": "sk-proj-abc123...",
  "vault_key": "openai-api-key",
  "request_id": "credreq_a1b2c3d4e5f6g7h8"
}
```

**Response when slow_down:**

```json
{
  "status": "slow_down",
  "interval": 30
}
```

> **One-time delivery:** The KV entry is deleted immediately after returning `approved`. A second poll for the same `device_code` returns `expired`. Store the credential immediately.

**Error responses:**

| Status | Code | Cause |
|--------|------|-------|
| `400` | `missing_device_code` | `device_code` field absent |
| `401` | `unauthorized` | Missing or invalid API key |
| `403` | `forbidden` | `device_code` belongs to a different account |

---

## Full Flow — Code Example

```typescript
// ── Step 1: Request ──────────────────────────────────────────────────────────
const requestRes = await fetch('https://agentlair.dev/v1/credentials/request', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${agentApiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    description: 'OpenAI API key for GPT-4 image analysis',
    vault_key: 'openai-api-key',
  }),
});

if (!requestRes.ok) throw new Error(`Request failed: ${requestRes.status}`);
const credReq = await requestRes.json();
// credReq: { device_code, user_code, message, expires_in, interval, ... }

// ── Step 2: Notify operator ──────────────────────────────────────────────────
console.log(credReq.message);
// → "Ask your operator to visit https://agentlair.dev/v1/credentials/approve?code=WDJB-MJHT"

// ── Step 3: Poll until resolved ──────────────────────────────────────────────
const deadline = Date.now() + credReq.expires_in * 1000;
let intervalSec = credReq.interval;

while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, intervalSec * 1000));

  const pollRes = await fetch('https://agentlair.dev/v1/credentials/poll', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agentApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_code: credReq.device_code }),
  });

  const poll = await pollRes.json();

  if (poll.status === 'approved') {
    // ── Step 4: Vault the credential immediately ─────────────────────────────
    const ciphertext = await vaultCrypto.encrypt(poll.credential_value, poll.vault_key);
    await vaultClient.put(poll.vault_key, { ciphertext });
    console.log(`Credential stored in vault at key: ${poll.vault_key}`);
    break;
  }

  if (poll.status === 'denied') {
    throw new Error('Operator denied the credential request');
  }

  if (poll.status === 'expired') {
    throw new Error('Credential request expired — no approval received');
  }

  if (poll.status === 'slow_down') {
    intervalSec = poll.interval; // back off to 30s
  }
  // 'authorization_pending': continue polling
}
```

---

## State Machine

```
POST /credentials/request
          |
          v
      [ PENDING ] ────────── TTL expires ──────────> [ expired ]
          |                                            (KV deleted)
   POST /credentials/approve
       /         \
  approved       denied
      |             |
      v             v
 [ APPROVED ]  [ DENIED ] ───── POST /poll ──────> { status: "denied" }
      |                                              (KV deleted)
 POST /poll (first success)
      |
      v
 { status: "approved",         (KV deleted immediately)
   credential_value: "..." }
```

**KV TTLs:**
- Pending state: 600 seconds (10 minutes)
- Approved state: 60 seconds (window for agent to poll)
- Delivered/denied: deleted immediately

---

## Notes

- **`description` is required.** Without it the request returns `400 missing_description`.
- **`approved: false` is a valid deny signal** in JSON bodies (legacy compatibility). Prefer `"action": "deny"`.
- **Polling returns `expired` (not `404`)** when a `device_code` is not found or has timed out.
- **The GET approve endpoint returns HTML**, not JSON. Use the approval URL from `verification_url_complete` to direct operators to the browser-based approval page.
- **Operator email is bound at account registration.** The account must have completed OTP verification before using this API.
- **Rate limits apply to both sides:** agents (max 5 active requests per account) and operators (max 5 approval attempts per code).
