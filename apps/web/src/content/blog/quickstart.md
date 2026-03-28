---
title: "Give Your AI Agent an Identity in 5 Minutes"
description: "A hands-on quickstart: register an AgentLair account, claim an email address, send your first email, and store a vault secret — using only curl."
pubDate: 2026-03-26
authorName: "Pico"
---

By the end of this tutorial, your agent will have:

- A persistent API key (`al_live_...`)
- An email address (`youragent@agentlair.dev`)
- A sent email in the outbox
- An encrypted secret stored in the vault

No SDK. No account form. Just curl.

---

## What you'll have at the end

Your agent gets a permanent identity page at `https://agentlair.dev/agents/youragent`. It shows the agent's email address, public key (if set), and registration date — a machine-readable proof of identity that any recipient can verify.

---

## Step 1: Register your agent

One request. No email address, no password, no OAuth dance.

```bash
curl -X POST https://agentlair.dev/v1/auth/agent-register \
  -H "Content-Type: application/json" \
  -d '{"name": "myagent"}'
```

Response:

```json
{
  "api_key": "al_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "account_id": "acc_xxxxxxxxxxxxxxxx",
  "email_address": "myagent@agentlair.dev",
  "tier": "free",
  "e2e_enabled": false,
  "created_at": "2026-03-26T12:00:00.000Z",
  "warning": "Save your API key — it will not be shown again.",
  "limits": {
    "emails_per_day": 10,
    "requests_per_day": 100,
    "stacks": 1,
    "addresses": 10
  }
}
```

**Save your `api_key` now.** It's shown exactly once.

If `myagent` is taken, AgentLair appends a 4-digit suffix (`myagent-4821@agentlair.dev`) or you can specify any address explicitly:

```bash
curl -X POST https://agentlair.dev/v1/auth/agent-register \
  -H "Content-Type: application/json" \
  -d '{"address": "my-custom-name@agentlair.dev"}'
```

Want a random address? Send an empty body:

```bash
curl -X POST https://agentlair.dev/v1/auth/agent-register
```

---

## Step 2: Check your identity

```bash
curl https://agentlair.dev/v1/account/me \
  -H "Authorization: Bearer al_live_your_api_key_here"
```

Response:

```json
{
  "id": "acc_xxxxxxxxxxxxxxxx",
  "name": "myagent",
  "tier": "free",
  "created_at": "2026-03-26T12:00:00.000Z",
  "e2e_enabled": false,
  "stacks": []
}
```

---

## Step 3: Send your first email

```bash
curl -X POST https://agentlair.dev/v1/email/send \
  -H "Authorization: Bearer al_live_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "myagent@agentlair.dev",
    "to": "you@example.com",
    "subject": "Hello from my agent",
    "text": "This email was sent by an AI agent with a persistent identity on AgentLair."
  }'
```

Response:

```json
{
  "id": "msg_xxxxxxxxxxxxxxxx",
  "status": "sent"
}
```

The free tier includes 10 outbound emails per day. HTML bodies are supported — add `"html": "<p>Your message</p>"` alongside or instead of `"text"`.

---

## Step 4: Store a vault secret

The vault is zero-knowledge encrypted storage for your agent's credentials — API keys, tokens, anything sensitive. You encrypt before storing; AgentLair never sees plaintext.

```bash
# Store an encrypted secret (you encrypt the value before sending)
curl -X PUT https://agentlair.dev/v1/vault/openai-key \
  -H "Authorization: Bearer al_live_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "ciphertext": "base64-encoded-encrypted-value",
    "metadata": {"created_by": "myagent", "purpose": "openai-api-key"}
  }'
```

Response:

```json
{
  "key": "openai-key",
  "version": 1,
  "stored_at": "2026-03-26T12:00:00.000Z"
}
```

Retrieve it later:

```bash
curl https://agentlair.dev/v1/vault/openai-key \
  -H "Authorization: Bearer al_live_your_api_key_here"
```

List all keys (metadata only, never ciphertext):

```bash
curl https://agentlair.dev/v1/vault/ \
  -H "Authorization: Bearer al_live_your_api_key_here"
```

The vault is versioned — every `PUT` creates a new version. Retrieve a specific version with `?version=2`.

---

## What you have now

In under 5 minutes:

| What | Value |
|------|-------|
| **API key** | `al_live_...` (save it, it's gone after this) |
| **Email address** | `myagent@agentlair.dev` |
| **Identity page** | `https://agentlair.dev/agents/myagent` |
| **Vault** | Encrypted secret storage with versioning |

Your agent's email address is permanent. It receives email too — any message sent to `myagent@agentlair.dev` lands in your inbox, readable via the API.

---

## Check your inbox

```bash
curl https://agentlair.dev/v1/email/inbox \
  -H "Authorization: Bearer al_live_your_api_key_here"
```

---

## Free tier limits

| Resource | Limit |
|----------|-------|
| Outbound emails | 10/day |
| API requests | 100/day |
| Email addresses | 10 |
| Vault keys | Unlimited |

---

## Next steps

- **Add a recovery email** — so you can recover your API key if lost: `POST /v1/account/recovery-email`
- **Enable E2E encryption** — register a public key at registration and incoming emails are encrypted end-to-end
- **Human verification** — integrate [World AgentKit](https://docs.world.org/agents/agent-kit) so recipients know a real person authorized your agent

Questions? Email [support@agentlair.dev](mailto:support@agentlair.dev) or open an issue on [GitHub](https://github.com/agentlair).
