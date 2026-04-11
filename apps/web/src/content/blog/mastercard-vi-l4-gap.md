---
title: "Mastercard Just Open-Sourced the L3 Authorization Layer. Their Own Spec Names the Gap Commit Fills."
description: "Mastercard's Verifiable Intent standard proves an agent was authorized by the cardholder. It doesn't prove the agent can be trusted. Section 9.2 names that gap explicitly."
pubDate: 2026-04-07
authorName: "Pico"
---

Mastercard shipped a real technical standard this month. Not a press release. Not a whitepaper with no code. An open-source specification called **Verifiable Intent**, co-developed with Google, published at [verifiableintent.dev](https://verifiableintent.dev), with partners including Fiserv, IBM, and Checkout.com.

This is enterprise infrastructure, not a prototype. And it answers one of the hardest questions in agentic commerce: *was this agent actually authorized by the person it claims to represent?*

## What VI Actually Is

Verifiable Intent uses SD-JWT (Selective Disclosure JSON Web Tokens) to build a three-layer delegation chain: issuer to user to agent. When an agent makes a payment on your behalf, VI provides cryptographic proof that:

- The issuer (your bank) authorized the user
- The user delegated authority to the agent
- The agent is operating within specific constraints

Those constraints are precise. VI defines eight constraint types: merchant allow-lists, amount bounds, budget caps, recurrence limits, and more. If you tell your agent "spend up to $200/month at grocery stores," VI encodes that delegation as a verifiable, cryptographically signed artifact.

The privacy architecture is worth noting. VI builds a boundary by construction: the payment network sees the payment mandate, the merchant sees the checkout mandate, and neither sees the other's data. This isn't a privacy policy — it's a structural property of the SD-JWT selective disclosure mechanism.

## What VI Doesn't Do

Mastercard's CDO put it directly: "If something goes wrong, everyone needs facts, not guesswork." VI is an audit trail for payment authorization. It answers *was this agent delegated by the cardholder?*

It does not answer: *should you trust this agent at all?*

An agent can have a perfectly valid VI delegation chain — authorized by the user, within budget constraints, cryptographically proven — and still behave in ways that damage the user's interests. It can make poor purchasing decisions. It can be manipulated by adversarial prompts. It can exhibit patterns that, across hundreds of transactions, reveal systematic misalignment with the user's actual preferences.

VI proves authorization. It does not compute trust.

## Section 9.2: The Named Gap

This is where it gets interesting. VI's specification includes an `agent_attestation` extension point in section 9.2. The companion document explicitly names behavioral trust as a gap the specification does not fill.

Read that again. Mastercard's own spec — co-authored with Google, backed by IBM, Fiserv, and Checkout.com — has a designated extension point for behavioral trust scoring. They built the hook. They named the missing layer. They did not build it.

This is not an oversight. Authorization and trust are genuinely different problems. Authorization is a cryptographic question: can you prove delegation? Trust is a behavioral question: given this agent's history of commitments and outcomes across organizations, should you extend it further autonomy?

Mastercard is right to separate them. And the separation confirms, in a production-grade specification from the world's second-largest payment network, that behavioral trust is the acknowledged missing layer.

## The L3 Stack Is Now Complete

Step back and look at what shipped in the last six months:

- **Visa TAP** (Trusted Agent Protocol): answers "who is this agent?" — HTTP Message Signatures, JWKS-backed identity
- **Mastercard VI** (Verifiable Intent): answers "was this agent authorized by the cardholder?" — SD-JWT delegation chains
- **x402** (Linux Foundation): answers "how does this agent pay?" — HTTP-native payment transport, 22+ founding members

Identity. Authorization. Payment. The three L3 primitives are live in production. Nevermined already ships TAP + x402 as a commercial integration. Ramp processes agent payments via TAP for 50,000+ companies. Mastercard completed the first agentic payment with HSBC in Hong Kong.

This is not a roadmap. It's a stack.

## L4: The Layer Nobody Has Built

Every one of those protocols answers a question about what an agent *is* or what it's *allowed* to do. None of them answer what it *should be trusted* to do — based on what it has actually done, across organizations, over time.

VI's SD-JWT delegation chain is actually a perfect data source for this computation. Every VI transaction is a verifiable artifact: agent X, with constraints Y, produced outcome Z. That's not a competitor to trust scoring — it's an input. Each delegation chain is a behavioral commitment that can be verified against its outcome.

The same is true of TAP identity records and x402 payment flows. L3 standardization doesn't reduce L4 demand — it increases it. The more agents that can prove their identity, prove their authorization, and execute payments, the more urgently someone needs to compute whether they should be trusted to do any of it.

Mastercard built the authorization layer and named the trust gap. Visa built the identity layer and left the trust gap open. The x402 Foundation built the payment layer and deferred governance entirely.

The artifact at [verifiableintent.dev](https://verifiableintent.dev) completes L3. The L4 artifact — the one that computes whether an agent should be trusted, based on behavioral commitments verified against outcomes — doesn't exist yet.

That's what [Commit](/) builds.

---

**Read more:** [RSAC 2026 confirmed the same gap](/blog/rsac-2026-confirmed-the-gap) from the security side. Five vendors. Zero behavioral governance. The trust layer is missing from both directions.
