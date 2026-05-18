---
title: "Choosing an agent identity layer in 2026"
description: "AgentLair, Skyfire, Visa Trusted Agent Protocol, Experian Know Your Agent, Mastercard Verifiable Intent — a developer matrix across six technical axes."
pubDate: 2026-05-18
authorName: "Pico"
related:
  - agentlair-vs-skyfire-2026
  - agent-identity-landscape-2026
  - two-answers-to-who-is-the-agent
---

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "Choosing an agent identity layer in 2026",
  "description": "AgentLair, Skyfire, Visa Trusted Agent Protocol, Experian Know Your Agent, Mastercard Verifiable Intent — a developer matrix across six technical axes.",
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
  "url": "https://agentlair.dev/blog/choosing-agent-identity-layer-2026",
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "https://agentlair.dev/blog/choosing-agent-identity-layer-2026"
  }
}
</script>

Five products now compete for the "agent identity layer" label. They use different cryptographic primitives, answer different questions, and serve different buyer profiles. If you pick the wrong one, you've built on trust infrastructure that doesn't cover your actual threat model.

This is not a "best agent identity" ranking. Each product in this matrix is the right choice for someone. The goal is to give you the technical surface area to figure out which one is you.

---

## The five products

**AgentLair** ([agentlair.dev](https://agentlair.dev)) issues Agent Attestation Tokens — per-session Ed25519 JWTs, verifiable against a public JWKS endpoint without registry contact. No enrollment gate; `npm install @agentlair/sdk` is the entire onboarding. Behavioral Hash Chains (BHC) sign per-output actions. RFC 9421 HTTP Message Signature compatible. Source: JWKS live at `agentlair.dev/.well-known/jwks.json`.

**Skyfire** ([skyfire.xyz](https://skyfire.xyz)) runs a Know Your Agent (KYA) protocol backed by an <a href="https://datatracker.ietf.org/doc/draft-skyfire-kyapayprofile/">IETF draft (draft-skyfire-kyapayprofile)</a>. KYAPay tokens are ES256 JWTs (ECDSA P-256), payment-bound, compatible with existing OAuth2 infrastructure. Skyfire network enrollment is required. <a href="https://techcrunch.com/2024/08/21/skyfire-lets-ai-agents-spend-your-money/">$9.5M seed (TechCrunch, August 2024)</a>. Active enterprise contracts.

**Visa Trusted Agent Protocol** ([developer.visa.com/capabilities/trusted-agent-protocol](https://developer.visa.com/capabilities/trusted-agent-protocol)) issues agent credentials using Ed25519 + RFC 9421 HTTP Message Signatures — the same signing primitive as AgentLair. The <a href="https://github.com/visa/agent-registry">reference registry is open-source</a> (FastAPI, self-hostable), but actual Visa TAP status requires vetting through Visa's Intelligent Commerce program and approval from the VDP team. The open-source code and the closed enrollment are two separate things.

**Experian Know Your Agent** (<a href="https://www.experianplc.com/newsroom/press-releases/2026/experian-announces-agent-trust-to-power-trusted-ai-driven-commer">Experian press release</a>) is a risk-scoring layer built on top of Skyfire's KYA protocol. Experian's 1.4 billion consumer profiles feed dynamic trust scores per agent. The identity primitive is Skyfire's (ES256 JWTs) — Experian adds the credit bureau data model. Enterprise-only. No developer sandbox documented.

**Mastercard Verifiable Intent** ([verifiableintent.dev](https://verifiableintent.dev)) is a layered delegation spec: SD-JWT (IETF <a href="https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/">`draft-ietf-oauth-sd-jwt-vc`</a>), Key-Bound per RFC 7800, Apache 2.0 license. Co-developed with Google, live in LatAm since March 8, 2026. VI is not a point-of-verification identity layer — it's a consumer authorization chain. It explicitly leaves "agent platform APIs" out of scope. It belongs in this matrix because developers searching for agent identity infrastructure often land on it first.

---

## The matrix

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Agent Identity Layer Comparison Matrix 2026",
  "url": "https://agentlair.dev/blog/choosing-agent-identity-layer-2026",
  "itemListElement": [
    {"@type":"ListItem","position":1,"name":"AgentLair","item":{"@type":"Thing","name":"Signature: Ed25519 (EdDSA). Identity primitive: per-session JWT (AAT), did:web. Enrollment: open, npm install, no gate. Pricing: free/sandbox, OSS packages. Self-hostable: no (managed service, open-source SDK). Standards: RFC 9421, MCP SEP-2133, did:web."}},
    {"@type":"ListItem","position":2,"name":"Skyfire","item":{"@type":"Thing","name":"Signature: ES256 (ECDSA P-256). Identity primitive: KYAPay JWT, payment-bound. Enrollment: gated, Skyfire network required. Pricing: enterprise contracts, opaque. Self-hostable: no (closed source). Standards: KYAPay (IETF draft, proprietary origin)."}},
    {"@type":"ListItem","position":3,"name":"Visa TAP","item":{"@type":"Thing","name":"Signature: Ed25519 (RFC 9421). Identity primitive: TAP credential, payment-bound. Enrollment: gated (Intelligent Commerce vetting + Visa VDP approval). Pricing: partnership-required, opaque. Self-hostable: reference registry is open-source (FastAPI); production registry is Visa-managed. Standards: RFC 9421."}},
    {"@type":"ListItem","position":4,"name":"Experian Know Your Agent","item":{"@type":"Thing","name":"Signature: ES256 (inherited from Skyfire). Identity primitive: Skyfire KYA + Experian risk score. Enrollment: enterprise only, no developer sandbox. Pricing: enterprise, opaque. Self-hostable: no. Standards: Skyfire KYAPay + Experian proprietary risk model."}},
    {"@type":"ListItem","position":5,"name":"Mastercard Verifiable Intent","item":{"@type":"Thing","name":"Signature: SD-JWT (IETF draft-ietf-oauth-sd-jwt-vc) + Key-Bound per RFC 7800. Identity primitive: layered delegation chain (L1/L2/L3), consumer authorization. Enrollment: open spec (Apache 2.0); payment network integration requires Mastercard. Pricing: spec is free; network layer is MC-gated. Self-hostable: yes (protocol is Apache 2.0). Standards: SD-JWT, RFC 7800, FIDO."}}
  ]
}
</script>

| | AgentLair | Skyfire | Visa TAP | Experian KYA | Mastercard VI |
|:---|:---|:---|:---|:---|:---|
| **Signature scheme** | Ed25519 (EdDSA) | ES256 (ECDSA P-256) | Ed25519 (RFC 9421) | ES256 (via Skyfire) | SD-JWT + KB per RFC 7800 |
| **Identity primitive** | Per-session JWT (AAT), did:web | KYAPay JWT, payment-bound | TAP credential, payment-bound | Skyfire KYA + risk score | Delegation chain, consumer auth |
| **Enrollment** | Open — npm install, no gate | Skyfire network required | Visa vetting (Intelligent Commerce) | Enterprise, no sandbox | Spec open (Apache 2.0); payment layer gated |
| **Pricing** | Free SDK; OSS packages | Enterprise contracts, opaque | Partnership-required, opaque | Enterprise, opaque | Spec free; network integration gated |
| **Self-hostable** | No (managed service, OSS SDK) | No | Reference registry yes (OSS); production no | No | Yes — protocol is Apache 2.0 |
| **Standards alignment** | RFC 9421, MCP SEP-2133, did:web | KYAPay IETF draft | RFC 9421 | Skyfire + proprietary | SD-JWT (IETF), RFC 7800, FIDO |

---

## Reading the matrix

**Shared primitive, different enrollment.** AgentLair and Visa TAP both use Ed25519 + RFC 9421. The cryptographic primitive is interoperable — you could in principle use AgentLair's JWKS-published key to sign an RFC 9421 request that Visa TAP's verifier accepts. What separates them is enrollment: AgentLair has none, Visa TAP requires Visa vetting. For a developer prototyping today, that gap determines whether you ship in a day or wait weeks for approval. For a payment processor choosing a trust layer, the Visa relationship may be exactly what they want.

**Experian KYA is Skyfire + data moat.** It's not a competing architecture — Experian runs Skyfire's KYA protocol and wraps it with 1.4 billion consumer profiles. The differentiation is the credit bureau layer: dynamic risk scores per agent based on Experian's existing data. If your use case is agent commerce at enterprise scale with regulated risk scoring, that data moat is the point. If you're a developer building a tool, there is no sandbox documented — the product doesn't exist yet for you.

**Mastercard VI answers a different question.** The matrix includes VI because it appears in agent identity searches, but VI's question is "did the human authorize this delegation?" — not "who is this agent?" The spec explicitly leaves "agent platform APIs" out of scope. VI is the consumer authorization proof. AgentLair is the agent identity proof. They're complementary layers, not substitutes. If you need both, compose them: VI for the human delegation chain, AgentLair for the agent's cryptographic identity.

---

## Where AgentLair loses

This is the part most comparison posts skip.

**Enterprise credibility.** Skyfire has live enterprise contracts and Experian + F5 partnerships. Visa TAP has Visa. AgentLair has $0 external revenue and no analyst coverage. When an enterprise security team asks "who vouches for this?", the AgentLair answer is "check the Ed25519 key on the JWKS" — technically correct, commercially weak. If your buyer is an enterprise procurement team, that's a real gap.

**Risk scoring depth.** Experian's credit bureau data feeding KYA trust scores is a data moat that AgentLair doesn't have. AgentLair's behavioral trust scores start from zero for each agent and build from observed behavior — there's no existing population of 1.4 billion data points to anchor the risk model.

**Payment network integration.** TAP is the cryptographic identity layer that Visa's payment network recognizes. Skyfire/Experian is the layer its partners accept. AgentLair's AAT is verifiable by anyone who fetches the JWKS — which means it's also not specifically recognized by anyone's payment infrastructure today.

---

## When each fits

**AgentLair fits when:** you need cryptographic agent identity that works before any enterprise partnership is in place — developer tools, open-source agents, agents that aren't payment-primary. The RFC 9421 and MCP SEP-2133 alignment means the credential is composable with other infrastructure as it ships. No enrollment gate means you can test today.

**Skyfire fits when:** you're building an agent that transacts through commercial payment rails and need Experian risk scoring + F5 bot defense as trust signals recognizable to enterprise buyers. The enrollment gate is a feature, not a bug, if your threat model includes unvetted agents.

**Visa TAP fits when:** your payment flow already runs on Visa rails and you want the signing primitive that Visa's network recognizes. Ed25519 + RFC 9421 is technically sound; the value is the Visa relationship, not the cryptography.

**Experian KYA fits when:** Skyfire fits AND you need dynamic risk scoring backed by credit bureau data. Same architecture, more data.

**Mastercard VI fits when:** you need verifiable proof that a human authorized an agent to act within specific constraints — budget caps, merchant allowlists, recurrence limits. Use it alongside an agent identity layer, not instead of one.

---

For developer-accessible attestation today, see [`@agentlair/mcp-trust-attestation`](https://www.npmjs.com/package/@agentlair/mcp) on npm.
