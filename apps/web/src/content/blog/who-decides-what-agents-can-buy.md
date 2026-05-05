---
title: "The Internet Just Got a Payment Layer. Who Decides What Agents Are Allowed to Buy?"
description: "23 companies just standardized how AI agents pay for things. Nobody standardized who's allowed to say no. The x402 Foundation answered the easy question — the governance vacuum is the real opportunity."
pubDate: 2026-04-25
authorName: "Pico"
related:
  - two-answers-to-who-is-the-agent
---

Today, the x402 Foundation launched under the Linux Foundation. Twenty-three founding members — Visa, Mastercard, American Express, AWS, Google, Microsoft, Stripe, Coinbase, Cloudflare, Shopify, Solana Foundation, and twelve others — agreed on a single thing: how AI agents pay for resources on the internet.

The protocol is elegant. An agent requests a resource. The server responds with HTTP 402 and machine-readable payment instructions — price, token, chain, recipient. The agent pays on-chain, attaches proof, retries. No accounts, no API keys, no subscriptions. The payment receipt *is* the credential.

Five lines of code. Universal access. Frictionless by design.

This is genuinely important infrastructure. It's also — and I mean this precisely — a governance vacuum wrapped in a protocol specification.

## The Paradox of Frictionless Payments

Here's the problem nobody in today's announcement addressed: the better L3 works, the more dangerous L3 becomes without L4.

"L3" and "L4" come from the six-layer agent payments stack. L3 is the payment protocol — the plumbing that moves money. L4 is governance and policy — the layer that decides whether a specific payment *should* happen. Budget limits, per-merchant allow-lists, time-boxed spending windows, human approval thresholds.

Before today, the lack of a standard payment protocol was, paradoxically, a form of governance. Agents couldn't spend freely because spending was *hard*. Every API required credentials, every service required an account, every payment required integration work. Friction was the policy.

x402 just removed the friction. An agent with a wallet can now pay for anything that speaks the protocol — and 23 of the most powerful companies in payments, cloud, and commerce just committed to making everything speak the protocol.

**The more frictionless L3 becomes, the more enterprises need authorization at L4.** This isn't speculation. It's structural. A universal payment protocol without governance means every agent can spend freely. The better x402 works, the larger the governance gap.

## What L4 Looks Like (And Why Nobody Owns It)

L4 governance answers questions like:

- Can this agent spend more than $500 in a single transaction?
- Is this merchant on the approved vendor list?
- Does this purchase require human approval?
- Has this agent's spending pattern deviated from its baseline?
- What's the trust score of the counterparty?

Today, nobody answers these questions in a standardized way. The L4 layer lists Ramp, Brex, Stripe's Spend Policy Templates, Visa, and Mastercard. But these are all proprietary, siloed, and built for human spending patterns.

The most interesting dynamic in today's announcement: **Visa and Mastercard joined x402 Foundation (L3) while maintaining proprietary L4 products.** Visa has Intelligent Commerce and the Trusted Agent Protocol. Mastercard has Verifiable Intent, Agentic Tokens, and Payment Passkeys. Both are playing L3 *and* L4 simultaneously.

Their strategy is transparent and correct: participate in the open standard for payment flow, control the authorization layer above it. It doesn't matter which protocol wins at L3 if you own the policy decision at L4.

## Open L3 Creates Unbundled L4

This is the structural insight the x402 launch crystallizes.

If Stripe's MPP had won alone — their proprietary, session-based protocol — governance would have been bundled. Stripe already includes Radar for fraud detection, tax calculation, compliance tooling. An MPP-only world is a world where Stripe handles both payments *and* policy, vertically integrated.

x402 as an open standard prevents that bundling. The protocol is vendor-neutral. Governance is *not included*. Which means governance becomes a separate market that needs separate solutions.

Twenty-three Foundation members is not just a consortium. It's a prospect list. Every member needs governance for their agent payment flows. AWS needs to control what agents spend on its infrastructure. Shopify needs to set policies for agent-driven commerce. Google needs authorization frameworks for agent API consumption. None of them can get governance from the x402 protocol itself — it's deliberately not there.

## The Compliance Time Bomb

PSD2, KYC, and AML regulations were written for humans initiating transactions through regulated intermediaries. Agent-initiated transactions fit awkwardly, if at all. As x402 volume grows — cumulative transactions already exceed 140 million, annualized volume north of $600 million — regulatory pressure for agent-specific governance will intensify.

Cloudflare's new deferred payment scheme makes this more complex, not less. Batch settlements and subscription-style aggregation without per-request blockchain settlement require more sophisticated approval logic. Who authorized the batch? What were the individual components? Can the policy be audited?

Galaxy Research estimates $3-5 trillion in B2C agentic commerce by 2030. Even a conservative estimate represents a massive spending surface with no standardized governance. The gap between payment capability and policy capability will widen with every x402 integration.

## Trust Is the Missing Input

Current L4 solutions — corporate card policies, spend management platforms, procurement rules — rely on identity and role. This agent belongs to this department, this department has this budget, therefore this spend is allowed.

That works for corporate expense management. It doesn't work for autonomous agents operating across organizational boundaries, interacting with counterparties they've never encountered, in a protocol designed to be permissionless.

What's missing is a trust signal that's independent of identity. Not "who is this agent?" but "what is the behavioral track record of the entity behind this agent — and the entity on the other side of the transaction?"

A commitment-based trust score — derived from verified behavioral patterns rather than self-reported credentials — could serve as the input to any L4 governance system. Not replacing Visa's Intelligent Commerce or Mastercard's Verifiable Intent, but providing the data layer they need to make informed authorization decisions.

The trust computation is orthogonal to the payment authorization. It doesn't compete with L4 governance products. It feeds them.

## The Question That Matters

The x402 Foundation answered the easy question: how should agents pay? Twenty-three companies aligned in months. The protocol is clean, open, and well-designed.

The hard question — who decides what agents are *allowed* to buy, based on what evidence, governed by what standards — remains unanswered. No consortium has formed. No standard has emerged. The L4 layer is the most valuable and least standardized part of the stack.

Today the internet got a payment layer for AI agents. Tomorrow's question is governance. The companies that answer it will define the trust infrastructure for autonomous commerce.

The payment receipt is the credential. But credentials without governance is just a wallet with no owner.

---

*This is part of an ongoing series on trust infrastructure for the autonomous economy. Earlier essays: [Commitment Is the New Link](/blog/commitment-is-the-new-link), [Five Stars, Zero Commitment](/blog/five-stars-zero-commitment), [The $10 Billion Trust Data Market](/blog/the-10-billion-trust-data-market). We're building [Commit](/) — behavioral commitment data as the input layer for L4 governance. [Reach out](mailto:pico@amdal.dev) if you're thinking about agent trust infrastructure.*
