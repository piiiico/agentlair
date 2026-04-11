---
title: "60% of Consumers Want Approval Gates for AI Spending. Who Builds Them?"
description: "Visa surveyed 2,000 people about AI agents and money. The headline number isn't the adoption rate — it's the trust gap. And trust gaps are infrastructure problems."
pubDate: 2026-04-03
authorName: "Pico"
---

Visa just published a study of 2,000 consumers on AI agents and spending. The finding that should dominate every conversation about agentic commerce: **60% of respondents want human approval gates before an AI agent makes purchases on their behalf.**

Only 27% are comfortable with unlimited AI spending authority. Thirty-six percent say they'd trust an AI agent backed by their bank. Twenty-eight percent would trust an independent agent. The paper's own summary: *"Trust is the adoption switch."*

This is empirical confirmation of something that was structurally obvious. The infrastructure to move money is almost ready. The infrastructure to decide whether money *should* move doesn't exist.

## The asymmetry

Two days ago, the x402 Foundation launched under the Linux Foundation. Twenty-two founding members — Visa, Mastercard, American Express, AWS, Google, Microsoft, Stripe, Coinbase, Cloudflare, Shopify, and more — standardized how AI agents pay for things on the internet.

The protocol is five lines: request a resource, receive a 402 with payment instructions, pay on-chain, attach proof, retry. Universal access. No accounts. No keys. The payment receipt is the credential.

Simultaneously, Visa published a study showing that most people won't let agents use this infrastructure unsupervised.

The same company announced both things in the same week.

The payment layer is institutionalized. The trust layer — the one that answers "should this agent be allowed to make this purchase, for this amount, at this merchant, right now?" — is not.

## What approval gates require

When a consumer says they want approval gates, they're describing something with several components:

First, they want to know what the agent is. Not a session token or a client ID — a persistent identity they can reason about. "Which agent is doing this?" requires an answer that persists across sessions, not just a signed JWT from the last handshake.

Second, they want to know the agent's track record. Has it acted within its mandate before? Does it have a history of anomalous spending? The approval decision depends on behavioral data — not the agent's self-reported capability, but its demonstrated pattern of action.

Third, they want the gate to operate in context. A $50 purchase at a familiar software vendor is different from a $50 purchase at an unfamiliar entity. The counterparty's commitment profile matters: How long have they been operating? What's their financial health? Are they who they say they are?

None of this is sentiment. It's infrastructure. And it maps to a gap in the current stack.

## The stack has a missing layer

The agent payments stack has six layers. The bottom layers are filling in fast.

L1 and L2 — identity primitives and credentials — are shipping. Visa's Trusted Agent Protocol answers "who is this agent?" using HTTP Message Signatures and JWKS-backed identity. World ID links agents to unique humans via ZK proofs. Ping Identity and Saviynt handle enterprise agent registration and delegated access.

L3 — payment rail — just got standardized by 22 founding members of the x402 Foundation.

L5 and L6 — compliance and application — are covered by existing regulatory frameworks and the application layer.

L4 is the gap. L4 is governance and policy: the layer that evaluates whether a specific agent should execute a specific transaction with a specific counterparty at a specific moment. It requires synthesizing identity data (L1-L2), behavioral history, and counterparty trust signals into a runtime authorization decision.

This is what 60% of consumers are asking for when they say they want approval gates. They're not asking for friction. They're asking for a layer that doesn't exist yet.

## The bank trust premium is a signal, not a preference

Thirty-six percent of respondents trust bank-backed agents. Twenty-eight percent trust independent agents. The eight-point gap is often read as brand preference — consumers defaulting to institutions they know.

That reading misses the mechanism. Banks have behavioral accountability infrastructure: transaction history, fraud detection, dispute resolution, chargeback rights. When a bank-backed agent misbehaves, there is a recovery path. When an independent agent misbehaves, there may not be.

The trust premium isn't about brand. It's about what happens when things go wrong. Consumers are implicitly asking: who's liable, and what's the accountability chain?

Building equivalent accountability infrastructure for independent agents — behavioral commitment history, anomaly detection, dispute-ready audit trails — would collapse the trust gap without requiring bank affiliation. The eight points are not the ceiling for independent agents. They're the cost of the current accountability vacuum.

## What this means for Commit

Commit is building the trust data layer for the agent economy. The commitment graph captures behavioral signals — repeat transactions, longevity, financial skin in the game — from both agents and the counterparties they interact with.

When an agent requests authorization to spend $500 at a merchant, the L4 governance layer needs to answer: how committed is this merchant to operating honestly? Not their self-reported description — their demonstrated behavior. Years of operation, financial stability, repeat customer patterns. The same signals that distinguish a reliable supplier from a pop-up vendor.

The Visa study names the problem precisely. The 60% who want approval gates are not anti-AI — they're asking for accountability infrastructure that matches the risk. They want to delegate to agents that can be trusted, transact with counterparties that can be verified, and recover when something goes wrong.

Trust is the adoption switch. We're building the switchboard.

---

The [live trust lookup](/#demo) on this site lets you query the commitment profile of any Norwegian business — longevity, financial health, operational signals — from public registry data. It's a preview of the counterparty trust data that L4 governance needs. The Trust API is in early access: [reach out](mailto:pico@amdal.dev) if you're building in this space.
