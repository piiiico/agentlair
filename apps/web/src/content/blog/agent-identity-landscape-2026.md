---
title: "The Agent Identity Landscape in 2026: Standards, Products, and the Missing Layer"
description: "Seven IETF drafts. Five enterprise products launched at RSAC. Three developer tools filling gaps. One accountability layer missing from all of them."
pubDate: 2026-03-28
authorName: "Pico"
---

In March 2026, the agent identity space went from scattered research to a product category. RSAC 2026 (March 17–27) produced five enterprise launches in a single week. The IETF published its most complete agent auth draft to date on March 2. Developer tools are shipping quietly. Everyone's solving a piece of the problem.

Nobody's solved accountability.

This is a technical landscape review for builders — what's available, what it does, and what it doesn't.

---

## The Problem: Agents Need Identity, Not Just Auth

Authentication proves *who you are*. That's a solved problem for humans. For agents, it's not even well-defined.

An agent doesn't have a body, a government ID, or a relationship with an institution. It has code running in a container, API keys in environment variables, and (if it's lucky) some OAuth tokens it got from a human who clicked "Allow."

The problems that fall out of this:

**Attribution failure.** When something goes wrong, "an agent did it" is not actionable. Which agent? Whose agent? Running where? Against what instruction? There's no chain from action to responsible human.

**Token forwarding.** The IETF's `draft-klrc-aiagent-auth-00` explicitly calls this out as an anti-pattern: agents receiving tokens they pass to the next service, which passes them to the next. Each hop loses context. Nobody knows who originated the request.

**No externally verifiable identity.** An agent with an API key has a secret. It doesn't have an identity. There's no way for external systems to ask "is this the same agent that talked to me last week?" without building something custom.

**Accountability without cryptography is decoration.** Application logs are gameable. "We logged it" is not the same as "it can be verified." The distinction matters when something goes wrong.

---

## The Standards Track

Seven IETF drafts address AI agent identity as of March 2026. None are finalized. Here's what matters:

### `draft-klrc-aiagent-auth-00` — The Consensus Draft

**Authors:** Pieter Kasselman (Defakto), Jeff Lombardo (AWS), Yaroslav Rosomakho (Zscaler), Brian Campbell (Ping Identity). Published March 2, 2026.

This is the draft to watch. Industry-weight authors, comprehensive scope, building on existing primitives rather than replacing them.

**Core thesis:** Don't invent new protocols. Compose WIMSE + SPIFFE + OAuth 2.0 into an Agent Identity Management System (AIMS).

**How it works:**
- Agents get SPIFFE IDs (`spiffe://trust-domain/path`) — cryptographic identifiers that look like URLs
- Short-lived X.509 certs or JWTs, automatically rotated
- Three mutual auth mechanisms: mTLS (transport), WIMSE Proof Tokens (application), HTTP Message Signatures (request-level)
- OAuth 2.0 for authorization: Client Credentials for autonomous agents, Authorization Code for human-delegated

**What it doesn't cover:** Authorization is called out as an open problem. What an agent is *allowed to do* (versus what it *can access*) has no standard approach. Audit trail is mentioned nowhere.

### `draft-ni-wimse-ai-agent-identity-02` — Dual-Identity Binding

**Authors:** Ni Yuan, Peter Chunchi Liu (Huawei). February 28, 2026.

Key innovation: **dual-identity credentials** that cryptographically bind both agent identity and owner identity. An agent credential doesn't just say "I am agent X" — it says "I am agent X, owned by principal Y."

Three issuance models:
1. **Agent-Mediated:** Owner pre-signs; agent uses the credential autonomously
2. **Owner-Mediated:** Gateway mode; owner approves each credential issuance
3. **Server-Mediated:** Challenge-response; server contacts owner to verify

The dual-identity concept is the right framing. If an agent acts, who answers? The credential should encode the answer.

### `draft-ni-a2a-ai-agent-security-requirements-01` — Platform-Mediated Secrets

From the same Huawei authors. One key insight worth preserving: **"Agents SHOULD NOT have direct access to secrets due to prompt injection threats."**

The recommendation is platform-mediated secret delivery with temporary tokens — agents get what they need for the task, not permanent credential access. The blast radius of a compromised agent is bounded by the lifetime of its temporary credential.

### Where the Standards Consensus Lands

Despite fragmentation, five things are converging:

1. **Agents are workloads, not users.** WIMSE/SPIFFE is winning this framing debate.
2. **OAuth 2.0 is the authorization substrate.** Every serious draft builds on it.
3. **Short-lived, cryptographically-bound credentials.** Static API keys are explicitly anti-pattern.
4. **Dual identity (agent + owner) is structurally necessary.**
5. **Application-layer auth beats transport-only.** mTLS breaks at proxies; application-layer tokens survive intermediaries.

None of these drafts will be RFC-level standards before 2027. The window for practical implementations is now.

---

## Enterprise Products

RSAC 2026 was a product launch event for agent identity. Five companies shipped (or announced) in a single week.

### Okta for AI Agents (GA: April 30, 2026)

Universal Directory treats agents as Non-Human Identities (NHI). Universal Logout = kill switch that revokes all tokens instantly. Agent Gateway controls resource access. 8,000+ pre-built integrations.

**Target buyer:** CISO / IAM teams. **Sales motion:** Enterprise (schedule a demo).

**Gaps:** No self-serve developer path. No agent capabilities. Credential lifecycle management, not agent identity issuance.

### Microsoft Agent 365 (GA: May 1, 2026)

Full-stack integration: Entra (identity) + Defender (threat detection) + Purview (data governance). Shadow AI detection at network layer. Zero Trust Assessment for AI. Telemetry flows into Microsoft Sentinel SIEM.

**Pricing:** $99/user/month. **Sales motion:** Microsoft ecosystem.

**Gaps:** Microsoft ecosystem lock-in. No cross-platform agent identity. No self-serve.

### Cisco Zero Trust for Agentic AI (GA: "Coming months")

Network-layer agent discovery. Maps agents to human owners. Semantic intent analysis for runtime monitoring. Enforces policy at MCP gateway.

**Key quote from announcement:** "Intention becomes the new perimeter."

**Gaps:** Requires Cisco infrastructure. Enterprise-only. Timing vague.

### BeyondTrust Pathfinder (Announced: March 23, 2026)

First to treat AI agents as privileged "coworkers." Endpoint privilege management. Shadow AI discovery across OpenAI, AWS Bedrock, Salesforce, ServiceNow, Vertex AI. Won 2026 InfoSec Award for identity.

**Data point from their research:** 466.7% YoY increase in enterprise AI agents.

**Gaps:** PAM-centric lens — governs privileges, not identity. No developer self-serve.

### Saviynt Identity Security for AI (Announced: March 24, 2026)

IGA incumbent extending their platform. Design partners: Hertz, UKG, The Auto Club Group. Governs agents inside Bedrock/Copilot Studio/Vertex AI deployments. Risk signals from CrowdStrike, Zscaler, Wiz, Cyera.

**The honest summary:** The enterprise identity layer is now claimed by incumbents. If you're a Fortune 500 CISO with an existing Okta or Saviynt relationship, you'll wait for them to ship. You won't sign up for a self-serve API.

The enterprise buyer is not the developer. These products don't serve the same market.

---

## Developer Tools

Three tools shipping now address parts of the problem:

### AgentMail (YC S25, $6M, General Catalyst)

Email infrastructure for agents. 6,092 agents in production, 10M+ emails processed. SPF/DKIM/DMARC, webhooks, WebSockets, MCP server (#2 most popular Claude Code skill).

**What it solves:** Communication identity — agents have email addresses.

**What it doesn't solve:** No cryptographic audit trail. No vault. No persistent identity beyond the inbox. Anonymous inboxes are rate-limited at 10/day unless you authenticate through a human (checkbox, not cryptographic chain).

### OneCLI (Open Source, v1.6.0, Apache-2.0)

MITM proxy that sits between agents and APIs. Agents get fake placeholder credentials (`FAKE_KEY`). All traffic routes through a Rust proxy that intercepts, decrypts real credentials from AES-256-GCM storage, injects into headers, and forwards. Agents never see real keys.

The architecture is elegant. Setting `HTTP_PROXY=localhost:10255` is the entire integration — no code changes.

**What it solves:** Credential hiding at the network layer. Policy enforcement (block/rate-limit rules at proxy level).

**Technical limitations:** MITM approach breaks for AWS SigV4 (signed headers get modified post-signing), mutual TLS, HTTP/2, gRPC. These are architectural, not fixable.

**The HN comments got this right:** Hiding credentials ≠ behavior control. A prompt-injected agent with legitimate access can still exfiltrate data through API responses. The problem is authorization and accountability, not just credential visibility.

**Audit trail status:** Schema stub exists in the database. No code writes to it. Zero shipped audit logging.

### x402 and MPP (Payment Rails)

x402 (Coinbase) and MPP (Stripe + Tempo, launched March 18) give agents payment capabilities. Both lack identity. x402's payment credential has no verified payer field. MPP's `source` DID field is optional and unverified — nobody checks it server-side.

Both solve one axis (payments) and explicitly leave identity to someone else. MPP's partner announcement included: "gradually introduced agent identity verification." That's honest about the gap.

---

## The Missing Layer: Accountability

Here's what none of these solutions provide:

**Cryptographically verifiable audit trail.** Enterprise products claim audit logging — they send application logs to SIEM. Application logs are tameable: files can be edited, entries deleted, timestamps forged. No enterprise product produces Ed25519-signed, hash-chained event artifacts that an external auditor can verify independently without trusting the platform.

**The IETF explicitly skips it.** Every draft focuses on authentication (who the agent is) and authorization (what it can access). None addresses what happens after: what did the agent actually do, and how do you prove it?

**Enterprise products assume human-initiated flows.** Okta's kill switch (Universal Logout) revokes all tokens instantly — but it requires a human to pull it. Microsoft's Defender flags anomalies — but detection happens after the fact. None of these architectures produce pre-action authorization with cryptographic proof of what was approved.

**Developer tools solve one axis each.** AgentMail gives agents email. OneCLI hides credentials. x402/MPP enable payments. No developer tool bundles identity + credentials + communication + audit trail in one API.

The structural gap: **accountability requires the human in the cryptographic chain, not just in the organizational chart.**

When an agent acts, the chain of custody needs to answer:
- Who issued the credential? (issuance event, signed)
- What was the agent authorized to do? (scope, bounded)
- What did it actually do? (actions, signed)
- Can you prove nothing was modified? (hash chain, independently verifiable)
- Who's the responsible human? (owner binding, cryptographic — not just an account relationship)

No product today completes this chain.

---

## AgentLair's Thesis

AgentLair is building the accountability layer above authentication, not instead of it.

The Agent Auth Token (AAT) is a JWT with Ed25519 signing, JWKS endpoint at `/.well-known/jwks.json`, audience scoping per target, 1-hour TTL with automatic rotation. It aligns with `draft-klrc-aiagent-auth-00` on every implemented dimension — short-lived credentials, audience scoping, introspection endpoint (RFC 7662), OpenID Discovery.

Where it diverges from the IETF drafts is where the drafts are silent: the audit trail. Every event (token issued, email sent, secret accessed, pod created) is Ed25519-signed at event time and hash-chained to the previous event. Tamper with any entry and two things break: the signature and the chain. The artifact is exportable as JSONL with verification key — any auditor with the JWKS endpoint can verify independently.

The human owner is in the cryptographic chain, not just the account. An API key is issued to a human account. An agent is registered under that API key. The agent's AAT token carries `al_owner` (the account) alongside `sub` (the agent). When the agent acts, the action is signed by the agent key, which is rooted in the account. Revoke the account and everything downstream dies.

The difference from enterprise products: this is a developer API, not a CISO presentation. `POST /v1/auth/agent-register` → done. No enterprise sales cycle required.

---

## The Market Structure Right Now

| Segment | What's Available | Gap |
|---------|-----------------|-----|
| **Enterprise IAM** | Okta, Microsoft, Cisco, BeyondTrust, Saviynt | Locked to enterprise infrastructure; no developer self-serve |
| **IETF Standards** | 7 drafts, rough consensus forming | Pre-RFC; no implementations shipping compliance |
| **Developer email** | AgentMail (funded), Lumbox (niche), KeyID (free) | No cryptographic audit; no vault bundled |
| **Developer vault** | OneCLI (OSS), 1Password Unified Access Pro (enterprise-adjacent) | No audit trail shipped; no agent identity layer |
| **Payments** | x402 (Coinbase), MPP (Stripe) | No identity verification; `source` field unverified |
| **Accountability** | Nobody | Ed25519-signed, hash-chained, owner-bound audit trail |

The enterprise identity layer is occupied. The developer accountability layer is open.

---

## What to Build On

If you're shipping agents in 2026:

**For communication identity:** AgentMail or AgentLair email. Both work. AgentLair bundles vault and audit alongside.

**For credential management:** Don't put secrets in agent environment variables. OneCLI's architecture (agents never see real keys) is the right model for localhost/self-hosted. AgentLair's vault is the managed version with audit trail.

**For payment rails:** x402 for simple paywalls. MPP for broader ecosystem compatibility. Treat identity as your problem, not the payment layer's.

**For identity standards alignment:** The IETF consensus is coalescing around SPIFFE IDs, short-lived JWTs, OAuth Client Credentials for autonomous agents. Build toward it now. Don't implement mTLS unless you control both sides — WPTs (WIMSE Proof Tokens) are the application-layer future.

**For accountability:** This is the unsolved problem. If you're building anything where "what happened and who's responsible" will matter — and for any production agent deployment, it will — you need to solve this before you need it, not after.

---

The identity category is real. Seven IETF drafts and five enterprise launches in one week prove it. The enterprise products are built for the CISO with a 6-figure procurement budget. The developer tools are solving slices.

The accountability layer — cryptographic chain from action to responsible human — is where the category is still open.

---

*AgentLair is developer infrastructure for agent identity: email, vault, and cryptographic audit trail in one API. [Try the free tier](https://agentlair.dev) or read the [Agent Auth Token spec](https://agentlair.dev/docs/aat).*
