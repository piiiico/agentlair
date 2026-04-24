# AgentLair Credential Provisioning API

_Spec version: 0.1 | Date: 2026-04-05_
_Origin: dannygerst HN feedback → working memory thread `agentlair-credential-handoff`_

---

## Problem

A running agent needs a credential (API key, token, secret) from its human operator mid-session. The human doesn't have the agent's master seed or vault key locally. Today, the human must:

1. Copy-paste the credential into a message or environment variable
2. Restart the agent with the new credential

Both break the session. Neither is secure. AgentLair needs a protocol where:
- The **agent initiates** the request ("I need an OpenAI key")
- The **human approves** on their own device (phone, browser)
- The **credential arrives** encrypted in the agent's vault
- The **vault's zero-knowledge property** is preserved

---

## Approach Comparison: Device Flow vs CIBA

### RFC 8628 — Device Authorization Grant (Device Flow)

**How it works:** Agent gets a user code + verification URL. Human visits URL, enters code, provides credential. Agent polls until complete.

| Aspect | Assessment |
|--------|-----------|
| Maturity | RFC since 2019. GitHub Copilot CLI, Azure CLI, dozens of implementations |
| Agent fit | Designed for input-constrained devices — agents are exactly this |
| Human UX | Visit URL + enter code. Well-understood pattern |
| Phishing surface | Device code phishing is a known attack vector (Storm-2372). Mitigated with: short codes, tight TTL, binding to operator email |
| Implementation cost | Low. Stateless polling, KV-backed state machine |
| AgentLair fit | Mirrors existing OTP flow (initiate → poll/verify). Familiar pattern |

### CIBA — Client-Initiated Backchannel Authentication

**How it works:** Agent sends auth request to AgentLair. AgentLair pushes notification to human's device (push, email, SMS). Human approves. Agent polls or gets callback.

| Aspect | Assessment |
|--------|-----------|
| Maturity | IETF draft (draft-klrc-aiagent-auth-01, Mar 2026). Ping/OpenAI/AWS/Zscaler backing |
| Agent fit | Purpose-built for agent HITL auth. The "right" long-term standard |
| Human UX | Push notification → approve. Best UX when push channel exists |
| Phishing surface | Lower than device flow (no user code to intercept). But requires trusted push channel |
| Implementation cost | Higher. Needs push notification infrastructure or webhook callback |
| AgentLair fit | AgentLair has email (Resend) but no push. Email-only CIBA = degraded UX |

### Recommendation: Device Flow Now, CIBA-Ready Design

**Ship device flow first.** It's proven, low-risk, and matches AgentLair's existing OTP pattern (request → code → verify). Design the internal state machine to be protocol-agnostic so CIBA can slot in later when AgentLair gains push notification capability.

**Key architectural decision:** The credential arrives as a one-time plaintext response that the agent encrypts client-side using `VaultCrypto` before storage. This preserves the zero-knowledge property — AgentLair sees the credential only in transit through the approval page, never at rest.

---

## API Design

### Overview

```
Agent                    AgentLair                   Human (browser)
  |                          |                            |
  |-- POST /v1/credentials/request -->|                   |
  |<-- 201 { device_code,   |                            |
  |     user_code,           |                            |
  |     verification_url }   |                            |
  |                          |                            |
  |  (agent shows URL+code to operator via any channel)   |
  |                          |                            |
  |                          |<-- GET /v1/credentials/approve?code=ABC123
  |                          |     (renders approval page) |
  |                          |                            |
  |                          |<-- POST /v1/credentials/approve
  |                          |     { user_code, credential_value,
  |                          |       vault_key, operator_email } |
  |                          |                            |
  |-- POST /v1/credentials/poll -->|                      |
  |<-- 200 { credential_value,     |                      |
  |     vault_key }                |                      |
  |                                |                      |
  | (agent encrypts + vaults)      |                      |
```

### Endpoints

---

#### `POST /v1/credentials/request`

**Auth:** Bearer (agent API key required)

**Purpose:** Agent initiates a credential request. Returns a device code for polling and a user code for the human.

**Request:**
```json
{
  "description": "OpenAI API key for GPT-4 access",
  "vault_key": "openai-api-key",
  "metadata": {
    "service": "openai",
    "environment": "production"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Human-readable description shown on approval page. Max 200 chars |
| `vault_key` | string | No | Suggested vault key name. Human can override on approval page |
| `metadata` | object | No | Metadata to store with the vault entry (unencrypted) |

**Response (201):**
```json
{
  "request_id": "credreq_a1b2c3d4e5f6",
  "device_code": "dc_7g8h9i0j1k2l3m4n5o6p",
  "user_code": "WDJB-MJHT",
  "verification_url": "https://agentlair.dev/approve",
  "verification_url_complete": "https://agentlair.dev/approve?code=WDJB-MJHT",
  "expires_in": 600,
  "interval": 5,
  "message": "Ask your operator to visit https://agentlair.dev/approve and enter code WDJB-MJHT"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | string | Unique request identifier for audit trail |
| `device_code` | string | Opaque code for polling. Not shown to human |
| `user_code` | string | Short code (8 chars, uppercase + hyphen). Shown to human |
| `verification_url` | string | Base URL for approval |
| `verification_url_complete` | string | URL with code pre-filled (for QR codes, links) |
| `expires_in` | number | Seconds until codes expire. Default: 600 (10 min) |
| `interval` | number | Minimum seconds between poll requests |
| `message` | string | Pre-formatted message the agent can show to operator |

**Errors:**
- `401` — Invalid or missing API key
- `403` — Account not verified (must complete OTP registration first)
- `429` — Rate limit: max 5 active requests per account

---

#### `GET /v1/credentials/approve`

**Auth:** None (public page, but requires valid user_code)

**Purpose:** Renders the approval page where the human enters the credential.

**Query params:**
- `code` (optional) — Pre-fills the user code field

**Response:** HTML page with:
1. User code input (pre-filled if `code` param provided)
2. Display of requesting agent's identity (name, email, account_id)
3. Display of credential description
4. Credential value input (password field, no autocomplete)
5. Vault key name input (pre-filled from agent's suggestion, editable)
6. Anti-phishing indicators (see Security section)
7. Submit button

---

#### `POST /v1/credentials/approve`

**Auth:** None (public), but validated by user_code + operator_email verification

**Purpose:** Human submits the credential value.

**Request:**
```json
{
  "user_code": "WDJB-MJHT",
  "credential_value": "sk-proj-abc123...",
  "vault_key": "openai-api-key",
  "operator_email": "hakon@example.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_code` | string | Yes | The user code from the agent |
| `credential_value` | string | Yes | The credential to deliver. Max 8192 bytes |
| `vault_key` | string | Yes | Final vault key name (may differ from agent's suggestion) |
| `operator_email` | string | Yes | Must match the account's registered operator email |

**Response (200):**
```json
{
  "status": "approved",
  "message": "Credential will be delivered to the agent on next poll."
}
```

**Errors:**
- `400 invalid_code` — User code not found or expired
- `400 code_expired` — Request TTL exceeded
- `400 email_mismatch` — operator_email doesn't match account's registered email
- `429` — Max 5 approval attempts per user_code

**Security notes:**
- The credential value is held in KV with a 60-second TTL after approval
- It is encrypted at rest using a one-time key derived from the device_code (see Storage section)
- After the agent polls and receives it, the KV entry is immediately deleted
- The credential never touches AgentLair's database — KV only, ephemeral

---

#### `POST /v1/credentials/poll`

**Auth:** Bearer (agent API key required)

**Purpose:** Agent polls for the credential after showing the user code to its operator.

**Request:**
```json
{
  "device_code": "dc_7g8h9i0j1k2l3m4n5o6p"
}
```

**Response — Pending (200):**
```json
{
  "status": "authorization_pending"
}
```

**Response — Approved (200):**
```json
{
  "status": "approved",
  "credential_value": "sk-proj-abc123...",
  "vault_key": "openai-api-key",
  "request_id": "credreq_a1b2c3d4e5f6"
}
```

**Response — Slow Down (200):**
```json
{
  "status": "slow_down",
  "interval": 10
}
```

**Response — Expired (200):**
```json
{
  "status": "expired"
}
```

**Response — Denied (200):**
```json
{
  "status": "denied"
}
```

**Plaintext delivery (by design):** The poll response returns `credential_value` as plaintext over HTTPS. AgentLair decrypts the at-rest KV entry before delivery so the agent never needs KV encryption keys. The zero-knowledge property is preserved because: (a) the credential is deleted from KV immediately after this poll, (b) the agent re-encrypts with its own master seed before vaulting, and (c) AgentLair never sees the master seed. The transit window is single-use.

**After receiving `approved`:** The agent should immediately:
1. Encrypt the credential using `VaultCrypto.encrypt(credential_value, vault_key)`
2. Store the ciphertext via `PUT /v1/vault/{vault_key}`
3. Zero out the plaintext from memory

**Errors:**
- `401` — Invalid API key
- `404` — Device code not found (expired or never existed)

---

### State Machine

```
                  POST /request
                       |
                       v
                  [ PENDING ]
                   /       \
     POST /approve          TTL expires
          |                      |
          v                      v
     [ APPROVED ]          [ EXPIRED ]
          |
    POST /poll (success)
          |
          v
     [ COMPLETED ]
```

States stored in KV at `credreq:{device_code}`:

```typescript
interface CredentialRequest {
  request_id: string;
  account_id: string;
  device_code: string;            // opaque, used by agent to poll
  user_code: string;              // short, shown to human
  user_code_hash: string;         // SHA-256 of user_code (indexed for lookup)
  description: string;
  vault_key_suggestion: string;
  metadata?: Record<string, unknown>;
  status: 'pending' | 'approved' | 'completed' | 'expired' | 'denied';
  created_at: string;
  expires_at: string;

  // Set after approval
  credential_encrypted?: string;  // AES-256-GCM encrypted with device_code-derived key
  vault_key_final?: string;       // Human's chosen vault key name
  approved_at?: string;
  approved_by_email?: string;

  // Anti-abuse
  poll_count: number;
  last_poll_at?: string;
  approval_attempts: number;
}
```

**KV Keys:**
- `credreq:{device_code}` → CredentialRequest (TTL: `expires_in` seconds)
- `credreq-code:{sha256(user_code)}` → device_code (TTL: `expires_in` seconds, for code→request lookup)
- `credreq-active:{account_id}` → count of active requests (for rate limiting)

---

## Security Considerations

### Device Code Phishing (Storm-2372 Pattern)

**Attack:** Adversary tricks human into entering credential on a phishing page that proxies to AgentLair's real approval endpoint.

**Mitigations:**

1. **Operator email binding.** The approval page requires the operator's email, which must match the account's registered `operator_email`. An attacker would need to know the operator's email AND have a valid credential request from the target account.

2. **Short user codes with tight TTL.** User codes are 8 characters (alphanumeric, uppercase, hyphenated for readability). TTL is 10 minutes. Short window limits phishing campaigns.

3. **Agent identity display.** The approval page prominently shows the requesting agent's registered name and email. The operator can verify this matches their running agent.

4. **Rate limiting.** Max 5 active requests per account. Max 5 approval attempts per user code. Prevents brute-force code guessing.

5. **One-time delivery.** The credential is deleted from KV immediately after the agent's first successful poll. No replay possible.

6. **Email notification.** When a credential request is created, AgentLair sends an email to the operator's registered email: "Your agent [name] is requesting a credential. If you didn't initiate this, ignore this message." This alerts the operator to unexpected requests.

### Transit Security

The credential value passes through AgentLair's infrastructure in two places:

1. **Approval submission** (human → AgentLair): HTTPS encrypted. Credential is immediately encrypted with a key derived from `device_code` before KV storage.

2. **Poll response** (AgentLair → agent): HTTPS encrypted. Credential is decrypted from KV, delivered in response, KV entry deleted.

**At-rest encryption:** Between approval and poll, the credential sits in KV encrypted with `HKDF-SHA-256(device_code, "credreq-encryption")`. Since only the agent knows the `device_code`, AgentLair operators cannot read it at rest. (Defense in depth — the KV TTL is 60 seconds.)

**Post-delivery:** The agent encrypts with VaultCrypto using the master seed and stores the ciphertext via the vault API. AgentLair never sees the master seed. Zero-knowledge property preserved.

### What AgentLair Learns

| Data | Visible to AgentLair? |
|------|----------------------|
| Credential description ("OpenAI key") | Yes (plaintext) |
| Credential value | Transit only, encrypted at rest, deleted after delivery |
| Vault key name | Yes (plaintext metadata) |
| Who approved | Yes (operator email) |
| When requested/approved | Yes (timestamps) |
| Master seed / vault encryption key | Never |

### Audit Trail

Every credential provisioning event is logged:

```typescript
// Request created
{ category: "credentials", action: "request.created",
  resource_id: request_id, details: { description, vault_key } }

// Approval submitted
{ category: "credentials", action: "request.approved",
  resource_id: request_id, details: { approved_by: operator_email } }

// Credential delivered to agent
{ category: "credentials", action: "request.completed",
  resource_id: request_id, details: { vault_key: vault_key_final } }

// Request expired (no approval)
{ category: "credentials", action: "request.expired",
  resource_id: request_id }
```

---

## Future: CIBA Upgrade Path

When AgentLair gains push notification capability (mobile app, browser push, or webhook), the device flow can be augmented or replaced with CIBA:

1. **Same `POST /v1/credentials/request`** — agent interface unchanged
2. **Push notification replaces user code** — human gets notified directly
3. **Same `POST /v1/credentials/poll`** — agent polling unchanged (or switch to webhook callback)
4. **Approval page becomes approve/deny in notification** — no URL visit needed

The state machine is identical. The only change is the notification channel. This is why the internal design uses a protocol-agnostic state machine.

### CIBA-Specific Additions (Future)

```json
// Additional field in POST /v1/credentials/request
{
  "hint": "push",  // "push" | "email" | "device_code"
  // If push: send push notification to operator's registered device
  // If email: send approval link via email (hybrid)
  // If device_code: current behavior (default)
}
```

---

## Implementation Notes

### Fits Existing Patterns

| Pattern | Existing | Credential Provisioning |
|---------|----------|------------------------|
| KV state machine | OTP registration (`register-otp:{accountId}`) | `credreq:{device_code}` |
| Email notification | OTP delivery via Resend | Request notification via Resend |
| SHA-256 indexed lookup | OTP hash verification | `credreq-code:{sha256(user_code)}` |
| Rate limiting | IP-based registration limits | Account-based request limits |
| x402 payment | Vault writes, email sends | Optional: premium feature (paid tier only, or x402 per-request) |
| Audit trail | Auth events, email events | Credential events |

### User Code Generation

```typescript
// 8 chars: 4 alphanumeric + hyphen + 4 alphanumeric
// ~2 billion combinations. Collision-resistant for 10-min windows.
function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 (ambiguity)
  const left = Array.from({ length: 4 }, () =>
    chars[crypto.getRandomValues(new Uint8Array(1))[0] % chars.length]
  ).join('');
  const right = Array.from({ length: 4 }, () =>
    chars[crypto.getRandomValues(new Uint8Array(1))[0] % chars.length]
  ).join('');
  return `${left}-${right}`;
}
```

### Pricing

- **Free tier:** 3 credential requests per day
- **Paid tier:** Unlimited
- **x402 fallback:** 0.01 USDC per request (same as vault write)

### SDK Integration

```typescript
// Agent-side (TypeScript SDK)
const request = await lair.credentials.request({
  description: "OpenAI API key for GPT-4",
  vaultKey: "openai-api-key"
});

console.log(request.message);
// "Ask your operator to visit https://agentlair.dev/approve and enter code WDJB-MJHT"

// Poll until approved (SDK handles backoff)
const result = await lair.credentials.waitForApproval(request.deviceCode, {
  timeout: 600_000,  // 10 minutes
  onPending: () => console.log("Waiting for operator approval...")
});

// Auto-vault the credential
const vc = VaultCrypto.fromSeed(masterSeed);
const ciphertext = await vc.encrypt(result.credentialValue, result.vaultKey);
await lair.vault.put(result.vaultKey, { ciphertext });
```

---

## Open Questions

1. **Should the approval page require authentication?** Current design uses operator email binding (lightweight). Alternative: require session auth (dashboard login). Tradeoff: security vs. friction for quick mobile approvals.

2. **Credential rotation.** Should repeated requests for the same `vault_key` auto-version the vault entry? The vault already supports versioning — this would be natural. But it means the agent can trigger version bumps.

3. **Multi-credential requests.** Should agents be able to request multiple credentials in a single approval flow? Reduces human friction for initial setup. Adds complexity.

4. **Deny flow.** The current design supports `denied` status but doesn't define how the human denies. Options: explicit deny button on approval page, or implicit deny via TTL expiry.

---

_References:_
- RFC 8628: OAuth 2.0 Device Authorization Grant
- draft-klrc-aiagent-auth-01: CIBA for AI Agents (Ping/OpenAI/AWS/Zscaler, Mar 2026)
- Storm-2372: Microsoft advisory on device code phishing (2025)
- AgentLair OTP flow: `/workspace/agentlair/packages/worker/src/routes/register.ts`
- AgentLair vault: `/workspace/agentlair/packages/worker/src/routes/vault.ts`
- VaultCrypto: `/workspace/agentlair/packages/vault-crypto/src/index.ts`
