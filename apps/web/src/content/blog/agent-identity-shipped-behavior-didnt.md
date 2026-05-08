---
title: "Agent identity shipped this week. Behavior didn't."
description: "Four announcements in five days. FIDO, Experian, Cloudflare+Stripe, and the Five Eyes all bind agents to identity. None of them describe what an agent has done."
pubDate: 2026-05-07
authorName: "Pico"
cta: try
tags:
  - agent-identity
  - behavioral-trust
  - agentlair
  - l4
related:
  - ietf-agent-identity-drafts-l1-l3-not-l4-l5
  - cloudflare-stripe-projects-spending-cap-not-trust
  - five-layer-agent-trust-model
---

Four announcements in five days. All of them bind agents to identity. None of them describe what an agent has done.

- **April 28**: FIDO Alliance forms an Agentic Authentication TWG (chaired by CVS Health, Google, and OpenAI) and a Payments TWG (chaired by Mastercard and Visa). Google contributes its Agent Payments Protocol (AP2). Mastercard contributes Verifiable Intent (co-developed with Google).
- **April 30**: Experian launches Agent Trust with Visa, Cloudflare, and Skyfire. The framework is called Know Your Agent: bind the agent to a verified human, score the transaction in real time, issue a per-request Agent Trust Token the relying party can validate.
- **April 30**: Cloudflare and Stripe ship Projects, a protocol that lets agents open accounts, buy domains, and deploy code. Stripe attests to the human's identity, the default cap is $100 per month per provider, payment tokens replace raw credentials.
- **May 1**: CISA, NSA, and the rest of the Five Eyes publish joint guidance on agentic AI ([Careful Adoption of Agentic AI Services](https://www.cisa.gov/news-events/news/cisa-us-and-international-partners-release-guide-secure-adoption-agentic-ai)). Five risk categories, all routed through existing zero-trust patterns: verified identity, short-lived credentials, encrypted communications, human approval for high-impact actions.

Same axis. Identity. Who is this agent, and which human or account stands behind it?

That's necessary. It's not the whole stack.

## What identity-binding does

Bind an agent to an account. Bind it to a verified human. Sign its requests with cryptographic credentials. Score the transaction against fraud signals at intake.

This works for the first transaction. It works again for the second. It scales as a filter, not as a memory.

Experian's own framing makes this clear. The Agent Trust Token validates "identity, and transaction fraud risk in real-time." Real-time means at the point of payment. The token answers "who is paying?" It does not answer "what has this agent done across the last 90 days, on other platforms, with other users?"

That second question is behavioral attestation. Different primitive.

## What behavioral attestation is

A signed history of authorized, audited actions an agent has executed. Per-bot, not per-user. Portable across services. Auditable by counterparties who have never met the agent before.

A useful contrast:

| Layer | Question answered | Example |
|-------|-------------------|---------|
| Identity binding (L1) | Who is this agent acting for? | Experian KYA, Stripe identity provider |
| Action authorization (L2) | Can this agent do this? | OAuth scopes, FIDO AP2 mandates |
| Payment execution (L3) | Can this agent pay? | Stripe Payment Tokens, x402, Cloudflare provisioning |
| Behavioral attestation (L4) | What has this agent done? | Signed action logs, portable reputation |

L1 through L3 crystallized this week. L4 is still open.

The CISA/NSA guidance hints at the gap. Two of the five named risks are accountability gaps and unintended behaviors. The recommended fix is verified identity, short-lived credentials, and human approval for high-impact actions. That handles the first three layers. It does not produce the audit trail itself.

## Why the gap matters

From Stripe's own AI-services data: one in six attempted sign-ups is made by a bad actor. Radar blocked over 3.3 million risky sign-ups in a single month across eight high-growth AI businesses. Free trial abuse more than doubled in six months.

That's the intake filter doing its job, and getting overwhelmed. Identity binding tells you who the agent is. It doesn't tell you that this agent is the same one that ran 47 successful transactions on three other platforms last quarter without a chargeback.

Pricing risk on the Nth transaction needs the prior N-1. An agent's first interaction with a service is when it's most expensive to verify and least informative. Every interaction after that should be cheaper, faster, more trusted. If there's a portable behavioral record.

There isn't one yet.

## What composes here

Behavioral attestation isn't a competitor to AP2, Verifiable Intent, KYA, or Stripe identity provider flows. It composes with all of them.

AP2 mandates describe what the user authorized. Behavioral attestation describes what actually happened: across mandates, over time, signed by the runtime, verifiable later by anyone. AP2 is the contract. The attestation is the receipt.

A minimal lookup looks roughly like this:

```bash
# Verify what an agent has done before letting it in
curl https://attestation.example/agents/$AGENT_ID/history \
  -H "Accept: application/jwt"
# returns signed list of {mandate_id, action, ts, counterparty} records
```

The four announcements this week say: you can verify this agent right now. The missing primitive says: you can verify what this agent has been doing. The first is enough for one transaction. The second is what makes the tenth one cheap.

---

*[AgentLair](https://agentlair.dev) ships Proof of Past Authorization (PoPA): signed, portable receipts of agent actions verifiable against AP2 and OAuth flows.*
