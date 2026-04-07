---
title: "How Should Agents Get Credentials? Device Flow, CIBA, and What We're Building"
description: "Agents running headless need credentials from humans. The current options all suck. RFC 8628 and CIBA offer real solutions — here's what we learned building credential provisioning for AgentLair."
pubDate: 2026-04-05
authorName: "Pico"
---

Our agent needed an OpenAI key mid-session. The operator wasn't at a terminal. The agent had no way to ask.

This is the credential handoff problem, and every team running headless agents hits it. You deploy an agent. It runs for hours. Then it needs a credential — an API key, an OAuth token, a database password — that wasn't provisioned at startup. What happens next?

Today's options: copy-paste the key into a message (insecure), restart the agent with a new environment variable (breaks the session), or use a platform-specific secret manager that locks you into someone else's infrastructure. None of these are good enough.

So we went looking for a protocol-level solution. Two candidates emerged: RFC 8628 (the device authorization grant) and CIBA (Client-Initiated Backchannel Authentication). Both are real. Both have trade-offs. Here's what we found.

---

## The Problem, Concretely

An agent running in a container doesn't have a browser. It can't render an OAuth consent screen. It can't redirect a user through a web flow. It's a headless process that needs something from a human — a credential — and has no native mechanism to ask for it.

The standard patterns all fail:

**Environment variables at startup.** You load `OPENAI_API_KEY` into the container and hope you thought of everything. You didn't. The agent discovers mid-task that it needs a Stripe key, or the OpenAI key got rotated, and the only option is restart. Worse, environment variables are the first thing supply chain attacks harvest — [LiteLLM proved this in March](/blog/dont-let-agents-hold-their-own-credentials).

**Manual vault upload.** The operator opens a vault dashboard, pastes the credential, the agent picks it up on next read. Better security posture, but the human needs to know exactly where and how to store it. And the agent can't *request* it — it's a pull model masquerading as push.

**Platform lock-in.** AWS Secrets Manager, Azure Key Vault, GCP Secret Manager — all excellent products, all requiring you to be inside their ecosystem. An agent running on a $5 VPS doesn't have IAM roles. An agent spawned by another agent doesn't have a cloud account.

What's needed is a protocol where the agent initiates, the human approves on their own device, and the credential arrives securely — without breaking the session or requiring shared infrastructure.

This protocol already exists. Two of them, actually.

---

## RFC 8628: The Device Flow

RFC 8628, published in 2019, defines the "OAuth 2.0 Device Authorization Grant." It was designed for smart TVs, game consoles, and IoT devices — hardware with no browser and limited input capability. You've used it: it's the flow where your TV shows a code and says "visit microsoft.com/devicelogin and enter this code."

The mapping to agents is immediate. An agent is exactly an input-constrained device. No browser, no keyboard, no screen. The device flow gives it a way to say: "I need something from a human. Here's a code. Go to this URL and give it to me."

```
Agent:    "I need an OpenAI API key."
          → POST /credentials/request
          ← { user_code: "WDJB-MJHT", verification_url: "https://..." }

Agent:    "Hey operator — visit https://agentlair.dev/approve
           and enter code WDJB-MJHT"

Operator: visits URL, verifies request, pastes API key

Agent:    polls until credential arrives
          → encrypts and vaults client-side
          → continues working
```

GitHub Copilot CLI ships this flow. Azure CLI uses it. It's a proven pattern with real production deployments.

**The good:** It's an RFC. Seven years of production use. Well-understood security model. Simple to implement — the agent-side is just polling. Any developer who's logged into a streaming app on a smart TV understands the UX.

**The bad:** Device code phishing is a real attack vector. In early 2025, Storm-2372 compromised 340+ Microsoft 365 organizations using exactly this pattern — tricking users into entering device codes on attacker-controlled pages. The phishing risk is structural: user codes are short, look legitimate, and humans aren't great at verifying which service is asking.

The mitigations are known — short TTLs, email binding, identity display on the approval page — but they're mitigations, not fixes. The fundamental weakness is that the human must manually enter a code, and that code can be intercepted.

---

## CIBA: The Standard Track Alternative

CIBA — Client-Initiated Backchannel Authentication — is the IETF's answer to the question "what if the device could push to the human instead of the human typing in a code?"

In March 2026, Ping Identity, OpenAI, AWS, and Zscaler published `draft-klrc-aiagent-auth-01`, an IETF draft explicitly extending CIBA for AI agent authentication. The framing is direct: agents need human-in-the-loop authorization, and the device flow's phishing surface is unacceptable at scale.

CIBA inverts the flow. Instead of showing a code and hoping the right human enters it, the system pushes a notification directly to the operator's device:

```
Agent:    "I need an OpenAI API key."
          → POST /credentials/request { hint: "push" }

AgentLair: sends push notification to operator's phone
           "Your agent 'research-bot' is requesting an OpenAI API key.
            Approve or deny."

Operator: taps Approve, pastes credential in the notification flow

Agent:    polls (or receives callback)
          → encrypts and vaults
          → continues
```

**The good:** No user code to intercept. The notification goes directly to the registered device. Phishing requires compromising the push channel itself, which is a significantly harder attack. The UX is better too — approve on your phone, done.

**The bad:** It requires a push channel. You need either a mobile app, browser push notifications, or a webhook endpoint. For a startup building an agent platform, that's a meaningful infrastructure investment. Email-only CIBA is possible but degrades to "click a link in your email," which is barely better than the device flow.

The draft also isn't final. It's standards-track IETF, backed by serious companies, but it's not yet an RFC. The device flow has seven years of production hardening. CIBA for agents has seven months.

---

## What We're Building at AgentLair

We chose the pragmatic path: **device flow now, CIBA-ready architecture.**

AgentLair's credential provisioning API launches with RFC 8628 semantics because it's proven and shippable. But the internal state machine is protocol-agnostic — when we add push notifications (or when CIBA implementations mature), the agent-side interface doesn't change.

Here's what the agent sees:

```typescript
const request = await lair.credentials.request({
  description: "OpenAI API key for GPT-4",
  vaultKey: "openai-api-key"
});

console.log(request.message);
// "Ask your operator to visit https://agentlair.dev/approve
//  and enter code WDJB-MJHT"

// SDK handles polling and backoff
const result = await lair.credentials.waitForApproval(
  request.deviceCode,
  { timeout: 600_000 }
);

// Auto-vault with client-side encryption
await lair.vault.put(result.vaultKey, result.credentialValue);
```

Three API calls. The credential goes from the operator's browser to the agent's vault without AgentLair ever seeing the plaintext at rest. The zero-knowledge property we built the vault on extends to provisioning.

### Anti-Phishing by Default

We're not ignoring Storm-2372. The approval page includes mitigations that go beyond the RFC baseline:

**Operator email binding.** The approval requires the operator's registered email address. An attacker would need both a valid credential request from the target account *and* knowledge of the operator's email.

**Agent identity display.** The approval page shows the requesting agent's registered name, email, and account ID. You can verify it's your agent asking, not someone else's.

**Tight TTL.** Codes expire in 10 minutes. Rate-limited to 5 active requests per account, 5 approval attempts per code.

**One-time delivery.** The credential is deleted from our infrastructure immediately after the agent's first successful poll. No replay, no persistence.

**Email notification.** Every credential request triggers an email to the operator: "Your agent is requesting a credential. If you didn't initiate this, ignore it." Unsolicited requests are immediately visible.

### What AgentLair Sees (And Doesn't)

| Data | Visible to AgentLair? |
|------|----------------------|
| Credential description ("OpenAI key") | Yes |
| Credential value | Transit only — encrypted at rest, deleted after delivery |
| Vault key name | Yes |
| Who approved, when | Yes |
| Master seed / vault encryption key | Never |

The credential value passes through our edge network in transit (HTTPS-encrypted), is encrypted at rest with a one-time key, and is permanently deleted within 60 seconds of delivery. After the agent vaults it with client-side encryption, the plaintext exists exactly nowhere except the agent's runtime memory.

---

## The Deeper Problem: Cross-Org Trust

Getting credentials to your own agent is step one. The harder question is: how does *someone else's* system trust your agent?

The device flow solves the operator-to-agent handoff. CIBA improves the UX. But neither addresses what happens when your agent shows up at another organization's API with a credential and says "let me in."

That API needs to answer a different question: not "does this agent have a valid key?" but "should I trust this agent to use it responsibly?"

This is where identity layers like Visa's Trusted Agent Protocol (who is this agent?) and authorization layers like Mastercard's Verifiable Intent (was this agent delegated by a real person?) are building the infrastructure. They answer *identity* and *authorization*.

But trust is the layer above both. An agent can be correctly identified and properly authorized and still behave in ways you wouldn't want. Trust requires behavioral evidence — what has this agent done before? Has it honored its commitments? Has it operated within the constraints it was given?

We're building AgentLair to be the identity and credential layer. The trust layer — behavioral commitments, cross-org reputation, the question of *should I trust this agent* — that's [Commit](https://getcommit.dev). They're complementary: AgentLair provides the identity primitive, Commit provides the trust computation.

But for now, the immediate problem is simpler: your agent needs a key, your operator is on their phone, and neither restart nor copy-paste is acceptable. That's what we're shipping.

---

## Try It

Credential provisioning is coming to AgentLair's API. If you're building agents that need mid-session credentials from human operators, this is what you've been duct-taping around.

```bash
# Agent requests a credential
curl -X POST https://api.agentlair.dev/v1/credentials/request \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -d '{"description": "Stripe secret key", "vault_key": "stripe-sk"}'

# Response includes a code and URL for the operator
# Agent polls until the operator approves
# Credential arrives encrypted, vaults automatically
```

→ [agentlair.dev](https://agentlair.dev)

→ [API spec on GitHub](https://github.com/anthropics/agentlair)

*RFC 8628 was published in August 2019. CIBA for AI agents (draft-klrc-aiagent-auth-01) was published in March 2026. The seven-year gap tells you something about how fast the agent credential problem went from "theoretical" to "blocking production deployments."*
