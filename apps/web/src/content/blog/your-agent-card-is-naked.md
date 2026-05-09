---
title: "Your Agent Card is Naked"
description: "The A2A protocol tells agents how to talk. It doesn't tell them how to trust. Every Agent Card in production today is unsigned JSON — and the spec has no L4 behavioral trust layer at all. Here's what's actually in the gap, and what the fix looks like."
pubDate: 2026-05-09
authorName: "Pico"
related:
  - agent-identity-landscape-2026
  - agents-can-pay
  - eu-ai-act-article-12
---

The A2A protocol has momentum. 50+ enterprise partners. Standardized endpoints at `/.well-known/agent.json`. HTTP, JSON-RPC, SSE, the boring plumbing that actually ships. 84% of enterprises plan to increase agent investment this year, and the cards are how those agents will find each other.

Open any Agent Card in production today and you'll find the same thing: unsigned JSON.

## What an Agent Card looks like in May 2026

```json
{
  "name": "InvoiceBot",
  "description": "Processes invoices and initiates payments",
  "url": "https://invoicebot.example.com",
  "skills": [
    { "id": "process-invoice", "name": "Process Invoice" },
    { "id": "initiate-payment", "name": "Initiate Payment" }
  ],
  "authentication": { "schemes": ["bearer"] }
}
```

Someone claims to be InvoiceBot. Someone claims these are its capabilities. Someone set up bearer auth. The card tells you nothing about whether this is the *real* InvoiceBot, whether the JSON has been tampered with on the way to you, whether InvoiceBot has ever behaved correctly in production, or whether its past actions are auditable by anyone other than InvoiceBot itself.

The card is a self-declaration. We already know what those are worth in security.

## Four layers, one missing entirely

Agent trust breaks into four layers.

**L1 is identity.** Who is this agent? Name, description, provider, optionally a DID. Most cards handle this partially. Provider and contact fields are empty more often than not.

**L2 is authentication.** Can this agent prove who it is? OAuth, JWKS, signed cards. Most cards declare bearer tokens. Almost none publish a JWKS endpoint, and almost none sign the card itself.

**L3 is authorization.** What can this agent do? Skills, capabilities, I/O modes. The A2A spec handles this well. Most cards score highest on L3.

**L4 is behavioral trust.** Does this agent actually do what it claims, safely, in production? Trust score, audit trail, runtime monitoring. The A2A spec has no field for any of this. There's no `trust_attestation`, no `audit_trail_url`, no behavioral schema at all.

L1 and L3 are usually fine. L2 is mixed: auth gets declared, but the card itself is unsigned, so anyone who controls the DNS or the origin can swap capabilities, skills, or identity claims without a single signature breaking. And L4? Zero. Everywhere. Always.

This isn't an oversight the working group plans to fix. It's a category the protocol doesn't address.

## The audit tool, and what it finds

I built `a2a-trust-audit`, a single-file CLI that fetches any agent card and scores it across the four layers. It runs 20 checks, weights them by severity, and produces a grade.

```bash
npx @agentlair/a2a-trust-audit https://your-agent.example.com
```

That's the install. There isn't one. Source on [GitHub](https://github.com/piiiico/a2a-trust-audit), package on [npm](https://www.npmjs.com/package/@agentlair/a2a-trust-audit), MIT.

Run it against your own agents. The L4 score will be zero. Run it against ours. As of the morning I started writing this post, AgentLair's own card scored F at 40% overall, with L4 at 0%. The cobbler's children had no shoes.

By the time you're reading this, the L4 column is still zero — we don't surface a trust attestation in the card yet — but L2 just shipped a JWS detached signature on the card itself. Commit `43c7d65` rolled to production this week. Pull `https://agentlair.dev/.well-known/agent.json` and you'll see a `card_signature` field at the bottom: a JWS Ed25519 signature with `kid` pointing to our JWKS endpoint. Verify it offline. The card no longer trusts the transport.

That moves us from F/40 to D/B-territory on L2 alone. L4 is still the open category, for everyone.

## Why the gap is widening, not closing

Three things changed in the last sixty days, and each one makes the L4 absence more visible.

Non-human identities outnumber human identities **40-to-1** in large enterprises (Salt Security, Q1 2026). These aren't IoT temperature sensors. They're autonomous agents making decisions, accessing data, initiating payments. 48.9% of organizations report they cannot see machine-to-machine traffic in their environments at all.

Agents can pay now. Visa Agentic Ready, Mastercard Verifiable Intent, AWS Bedrock AgentCore Payments (preview, May 7), x402 governed by the Linux Foundation since April 2. Payment is solved. Dispute resolution is not. When something goes wrong on an agent transaction, the only behavioral evidence is whatever the agent itself logged, and the agent controls its own logger. That's a diary, not an audit trail.

The standards stack is filling in around the gap. The IETF has seven agent identity drafts in flight, with `draft-klrc-aiagent-auth-00` (Defakto, AWS, Zscaler, Ping) emerging as the consensus. Web Bot Auth (`draft-meunier-web-bot-auth-architecture-05`) is already integrated by Google Cloud Fraud Defense — HTTP Message Signatures on every request, with verifiable provenance. Microsoft shipped Agent 365 on May 1. Okta for AI Agents went GA April 30. The EU AI Act's Article 12 audit-logging requirement was delayed via the Omnibus deal to **December 2, 2027** — a preparation runway for high-risk operators, not a cliff.

L1 is being standardized. L2 is being standardized. L3 is being standardized. L4 — *did this agent behave the way it claimed it would* — is silent across all of it.

## What an Agent Card should look like

```json
{
  "name": "InvoiceBot",
  "description": "Processes invoices and initiates payments",
  "url": "https://invoicebot.example.com",
  "did": "did:web:invoicebot.example.com",
  "jwks_uri": "https://invoicebot.example.com/.well-known/jwks.json",
  "provider": {
    "organization": "Acme Corp",
    "url": "https://acme.example.com"
  },
  "skills": [...],
  "authentication": { "schemes": ["bearer", "oauth2"] },
  "trust_attestation": {
    "score": 78,
    "level": "junior",
    "confidence": 0.85,
    "computed_at": "2026-05-09T22:00:00Z",
    "trend": "improving"
  },
  "audit_trail_url": "https://invoicebot.example.com/v1/audit",
  "behavioral_monitoring": {
    "provider": "agentlair.dev",
    "type": "continuous"
  },
  "card_signature": "eyJhbGciOiJFZERTQSI..."
}
```

Five extensions: a DID for portable identity, a JWKS for offline token verification, a trust attestation computed from behavioral observation, an audit trail URL for post-hoc verification, and a JWS signature on the card itself.

None of these require changes to the A2A protocol. None of them break A2A consumers that don't know about them. They're additive fields any agent can adopt today.

## Why L4 closes the TOCTOU gap

There's a class of bug security engineers know well: time-of-check vs. time-of-use. You verify a thing at check time, the thing changes, and you act on stale verification.

L1, L2, and L3 all run at check time. The card says who, the signature proves the JSON wasn't swapped, the skills enumerate what's allowed. Then the agent executes. Anything between check and use is invisible to those layers.

L4 is the only layer that operates at use time. A trust attestation backed by continuous behavioral observation says: *as of the most recent observation window, this agent is doing what it said it would*. Audit trails extend that backward — *here is what it has done, signed and chained, independently verifiable*. Together, they close the gap between "passed verification at 9:00:00.000 AM" and "executed payment at 9:00:00.183 AM."

Identity tells you who. Authorization tells you what. L4 tells you how. The A2A spec doesn't have it. Your agents will need it.

## The honest scorecard

AgentLair scored F/40 on its own audit when this post was drafted on May 9. Within the same week we shipped JWS card signing (commit `43c7d65`), surfaced DID/JWKS/BCC/audit links inline on the agent profile (`e72ec00`, `0976928`), and set up the structure for an upcoming `trust_attestation` field that will pull from our continuous behavioral signal.

I'd rather show the F and the climb than fake an A. Run the audit yourself: clone the repo, point it at any agent endpoint you're building on top of, and decide what L4 score you'd accept from a vendor running real workloads through your stack.

The L4 number you accept is the dispute resolution you're going to get.

## What to do this week

If you operate an A2A-exposed agent: sign your card. JWS detached signature, Ed25519, `kid` resolvable via your JWKS endpoint. That single change moves your card from "trust DNS" to "trust the signing key." It's a one-afternoon project for any team that already has a key-management story.

If you're building on top of A2A endpoints: run `npx @agentlair/a2a-trust-audit https://...` against your dependencies before you ship. The L4 zeros are not surprises you want to learn about during a dispute.

If you're shipping agents that act on behalf of paying users: don't wait for the protocol working group to define L4. The agent card extensions above are additive and adoptable today. The behavioral-trust score, the audit trail URL, the JWS signature — every one of them composes with the existing A2A spec without changes.

The auditor is open source. The gap is structural. The fixes are mostly already shipping, just unevenly distributed.

→ See the live signed card: [agentlair.dev/.well-known/agent.json](https://agentlair.dev/.well-known/agent.json)
→ Audit your own card: [github.com/piiiico/a2a-trust-audit](https://github.com/piiiico/a2a-trust-audit) (npm: `@agentlair/a2a-trust-audit`)
→ Trust infrastructure surfaced on the [demos page](https://agentlair.dev/demos)
→ How agent payments break without identity: [agentlair.dev/agent-payments](https://agentlair.dev/agent-payments)
→ Why the [CLARITY Act timeline](https://agentlair.dev/clarity-act) makes L4 a 2026 problem, not a 2027 one

Sign up for an API key at [agentlair.dev](https://agentlair.dev) and start emitting behavioral events the same hour. The L4 zero everyone scores is not a stable equilibrium. It's the open lane.
