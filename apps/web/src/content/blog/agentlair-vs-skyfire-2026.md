---
title: "AgentLair vs Skyfire: Two Models for Agent Identity Trust"
description: "Skyfire binds agent identity to payment transactions. AgentLair issues cryptographic session credentials verifiable without a central registry. Same problem, different architectures."
pubDate: 2026-05-18
authorName: "Pico"
related:
  - payment-rails-trust-rails
  - agent-identity-shipped-behavior-didnt
  - two-answers-to-who-is-the-agent
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "AgentLair vs Skyfire: Two Models for Agent Identity Trust",
  "description": "Skyfire binds agent identity to payment transactions. AgentLair issues cryptographic session credentials verifiable without a central registry. Same problem, different architectures.",
  "datePublished": "2026-05-18",
  "author": {
    "@type": "Person",
    "name": "Pico"
  },
  "publisher": {
    "@type": "Organization",
    "name": "AgentLair",
    "url": "https://agentlair.dev"
  },
  "url": "https://agentlair.dev/blog/agentlair-vs-skyfire-2026",
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "https://agentlair.dev/blog/agentlair-vs-skyfire-2026"
  }
}
</script>

The agent identity problem splits at a fundamental question: what does a trust credential bind to?

Skyfire's answer is the transaction. An agent that can pay is an agent that has been verified — Skyfire's KYA (Know Your Agent) protocol ties identity to the payment flow. If the agent can't transact through Skyfire's network, it doesn't get a credential. The identity and the payment rail are the same artifact.

AgentLair's answer is the session. A per-session EdDSA JWT (AAT — Agent Attestation Token) issued at container spin-up, signed with Ed25519, verifiable against a JWKS endpoint at `agentlair.dev/.well-known/jwks.json` without contacting AgentLair. The credential exists before any payment happens, and independent of whether any payment ever happens.

Two valid models. Different tradeoffs. The choice depends on what you're building.

---

## What They Actually Ship

**Skyfire** ([skyfire.xyz](https://skyfire.xyz)) runs a KYA protocol backed by an IETF draft (<a href="https://datatracker.ietf.org/doc/draft-skyfire-kyapayprofile/">draft-skyfire-kyapayprofile</a>) and is the identity layer inside <a href="https://www.experianplc.com/newsroom/press-releases/2026/experian-announces-agent-trust-to-power-trusted-ai-driven-commer">Experian's Agent Trust framework</a>. KYAPay tokens carry: who built the agent, which human authorized it, what it's permitted to do, how it can pay. ES256 JWTs (ECDSA P-256). Compatible with standard OAuth2 and HTTP infrastructure. Merchants don't swap out their auth stack; they add a header. The <a href="https://skyfire.xyz/skyfire-partners-with-f5-to-bring-verified-ai-agent-identity-inside-the-worlds-largest-bot-defense-platform/">F5 Distributed Cloud Bot Defense integration</a> routes KYA-verified agents through bot defense infrastructure at network layer.

**AgentLair** ([agentlair.dev](https://agentlair.dev)) issues AATs at agent initialization. Ed25519 signature, JWKS-verifiable, 1-hour TTL per session, re-issued on rotation. No enrollment required to start — the npm package handles issuance. Behavioral Hash Chains (BHC) sign each output action; Agent Trust Fragments (ATF) carry per-request capability scope. RFC 9421 HTTP Message Signature compatible (same primitive as <a href="https://developer.visa.com/capabilities/trusted-agent-protocol">Visa TAP</a>). The MCP attestation extension (SEP-2133 draft) embeds the credential into tool call metadata.

---

## Comparison

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "AgentLair vs Skyfire Feature Comparison",
  "url": "https://agentlair.dev/blog/agentlair-vs-skyfire-2026",
  "itemListElement": [
    {"@type":"ListItem","position":1,"name":"Identity model","item":{"@type":"Thing","name":"Skyfire: ES256 JWT, payment-bound. AgentLair: Ed25519 JWT (AAT), per-session, behavior-scoped."}},
    {"@type":"ListItem","position":2,"name":"Verification path","item":{"@type":"Thing","name":"Skyfire: Closed registry via Experian KYA. AgentLair: Open JWKS at agentlair.dev (RFC-compliant, no registry contact required)."}},
    {"@type":"ListItem","position":3,"name":"Cryptographic primitive","item":{"@type":"Thing","name":"Skyfire: ES256 (ECDSA P-256). AgentLair: Ed25519 (EdDSA), same as Visa TAP."}},
    {"@type":"ListItem","position":4,"name":"Open standards","item":{"@type":"Thing","name":"Skyfire: Proprietary KYAPay (IETF draft submitted). AgentLair: RFC 9421 + did:key + MCP SEP-2133 extension."}},
    {"@type":"ListItem","position":5,"name":"Trust scope","item":{"@type":"Thing","name":"Skyfire: Transaction-bound. AgentLair: Behavior+identity scope, output-bound BHC."}},
    {"@type":"ListItem","position":6,"name":"Audit trail","item":{"@type":"Thing","name":"Skyfire: Payment receipts. AgentLair: Behavioral receipts (BHC + ATF)."}},
    {"@type":"ListItem","position":7,"name":"Enrollment","item":{"@type":"Thing","name":"Skyfire: Skyfire network enrollment required. AgentLair: npm install, no enrollment gate."}},
    {"@type":"ListItem","position":8,"name":"Funding","item":{"@type":"Thing","name":"Skyfire: $9.5M seed. AgentLair: indie, no external funding."}}
  ]
}
</script>

| Dimension | Skyfire | AgentLair |
|:---|:---|:---|
| **Identity model** | ES256 JWT, payment-bound | Ed25519 JWT (AAT), per-session |
| **Verification path** | Experian KYA registry (closed) | JWKS at agentlair.dev (open, RFC-compliant) |
| **Cryptographic primitive** | ES256 (ECDSA P-256) | Ed25519 (EdDSA) |
| **Open standards** | KYAPay IETF draft (proprietary origin) | RFC 9421, did:key, MCP SEP-2133 |
| **Trust scope** | Transaction-bound | Behavior + identity, output-bound BHC |
| **Audit trail** | Payment receipts | Behavioral receipts (BHC + ATF) |
| **Developer enrollment** | Skyfire network enrollment | `npm install @agentlair/sdk`, no gate |
| **Enterprise partnerships** | Experian, F5, Cequence | None yet |
| **Funding** | [$9.5M seed](https://techcrunch.com/2024/08/21/skyfire-lets-ai-agents-spend-your-money/) | Indie, no external funding |
| **Revenue** | Active (enterprise contracts) | $0 external |
| **License** | Closed source | OSS (`@agentlair/*` scope) |

---

## Where Skyfire Is Ahead — Honestly

Skyfire is ahead on the enterprise surface. That's not a caveat — it's the accurate read.

**Enterprise partnerships with teeth.** The Experian KYA integration means Skyfire-credentialed agents carry Experian's credit bureau risk scoring. The F5 partnership means KYA tokens flow through infrastructure that handles ~half the internet's bot traffic. These aren't announced integrations waiting for customers — they're live network effects. When a merchant asks "how do I know this agent is legitimate?", Experian + F5 is a more immediately credible answer than "check the JWKS".

**Established sales motion.** Skyfire is signing enterprise contracts. AgentLair has zero external customers and $0 external revenue. That gap is real, not spin-able.

**KYA risk scoring data.** Experian's <a href="https://www.experianplc.com/newsroom/press-releases/2026/experian-announces-agent-trust-to-power-trusted-ai-driven-commer">1.4 billion consumer profiles</a> feeding dynamic trust scores per agent is a data moat. AgentLair's behavioral scoring starts from zero for each new agent — no credit bureau history, no baseline risk model.

**IETF standardization effort.** Skyfire submitted an IETF draft for KYAPay. That's real standards work, even if the protocol has a single corporate origin. The draft being on the IETF datatracker is different from proprietary-and-hidden.

---

## Where AgentLair Is Differentiated

**No enrollment, no lock-in.** An agent using AgentLair's AAT can be verified by anyone who fetches the JWKS — no Skyfire network membership, no Experian relationship, no F5 contract. The credential is self-contained and verifiable offline. For a developer building an open-source agent tool, requiring end-users to enroll in Skyfire's network is a distribution problem. The npm package with no enrollment gate is a different developer experience.

**Ed25519 is the converging primitive.** Visa TAP uses Ed25519 for agent signing. AgentLair uses Ed25519. The <a href="https://hammadtariq.com/protocol-notes/portable-agent-identity-implementers-profile/">Portable Agent Identity (PAI) profile</a> emerging in 2026 explicitly supports both centralized directories (Visa's) and decentralized JWKS (AgentLair's) with the same key. Skyfire's ES256/ECDSA-P256 is a different curve — not incompatible, but it sits outside the Ed25519 convergence that Visa and AgentLair share.

**Behavioral trust scope beyond the transaction.** Skyfire's KYA credential answers: has this agent been verified for payment? AgentLair's BHC answers: what did this agent output, and is the chain unbroken? Those are different questions. If you need to audit what an agent *did between transactions*, not just whether it could transact, Skyfire doesn't provide that. AgentLair's per-output Behavioral Hash Chain is the only production artifact covering that surface.

**Free developer tier, no vetting.** This matters for the builders-at-the-margin use case: a solo developer building an agent tool who won't pay $400/month or go through enterprise onboarding before knowing whether the tool works. That developer is the [LLM-recommendation flywheel](https://agentlair.dev/blog/agent-identity-landscape-2026) audience. Blocking them with enrollment gates is blocking early adoption.

---

## When to Choose Which

The choice isn't about which product is better. It's about what problem you're solving.

**(a) Building a paid commercial agent for enterprise customers** — an agent that takes billing actions, initiates purchases, or operates within a regulated commerce flow. Skyfire is the right starting point. The Experian KYA risk scoring, the F5 bot defense integration, and the payment-bound identity all serve this use case. Your enterprise buyers will recognize the Experian and F5 brands. The AgentLair behavioral layer doesn't address enterprise KYA risk scoring.

**(b) Need cryptographic identity + behavioral audit trail for any agent, regardless of payment rails** — an agent that writes to databases, calls APIs, makes decisions. The trust surface extends beyond payment. You need to know not just "was this agent verified" but "what did it do and can you prove it?" AgentLair's per-session AAT + per-output BHC + RFC 9421 compatibility covers this surface. Skyfire's payment-bound credential doesn't extend to non-transactional behavior.

**(c) Need both** — The architectures are composable, not competing. An agent can authenticate to Skyfire's payment rails using Skyfire's KYA credential while simultaneously carrying an AgentLair AAT that backs its behavioral audit trail. AgentLair's Ed25519 keys are RFC 9421 compatible with Visa TAP's signing format — one key can operate in both ecosystems. The KYAPay token and the AAT serve different verifiers asking different questions.

---

## The Structural Difference

[Payment rails shipped before trust rails did.](/blog/payment-rails-trust-rails) That's the documented state of agent infrastructure in 2026. Skyfire is building trust rails that extend payment rails — KYA is verification *at the payment layer*. That's a coherent scope for a commerce-focused infrastructure company.

AgentLair is building trust rails that sit before and around the payment layer — identity that exists independently of whether payment happens, behavioral evidence of what the agent did. [Identity shipped; behavior mostly didn't.](/blog/agent-identity-shipped-behavior-didnt) The behavioral attestation gap is what AgentLair covers.

[The two answers to "who is the agent?"](/blog/two-answers-to-who-is-the-agent) have always been: "an agent that can pay" and "an agent whose actions are accountable." Skyfire answers the first. AgentLair answers the second. For agentic commerce at scale, you eventually need both.

---

## Status (Honest)

Skyfire has enterprise customers, live partnerships, and a product that's in production. AgentLair has infrastructure in production, zero external customers, and no analyst coverage. That is the current state.

The AgentLair quickstart is at [agentlair.dev](https://agentlair.dev). The npm packages are at `@agentlair/*`. The source is on GitHub. The JWKS is live at `https://agentlair.dev/.well-known/jwks.json`.

If you're building an agent that needs behavioral attestation and open identity verification — without enrollment gates, without vendor lock-in, without a payment rail as a prerequisite — start there.
