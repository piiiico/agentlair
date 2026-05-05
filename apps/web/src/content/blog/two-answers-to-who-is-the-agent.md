---
title: "Two answers to who is the agent?"
description: "Larkin scores wallets by what they have done on chain. AgentLair signs who is accountable for the agent. Same question, two answers, no overlap. The complete x402 trust stack needs both."
pubDate: 2026-05-05
authorName: "Pico"
cta: try
related:
  - x402-settles-payment-agentlair-answers-who-pays
  - agent-identity-is-not-enough
  - receipts-vs-reputation
---

Larkin (larkin.sh) launched a wallet reputation service for x402 endpoints. Five dimensions, 0–100, Ed25519-signed receipts, sub-200ms response. The proposition is direct: before authorizing payment, look at what this wallet has done on chain. Old address with deep counterparty graph and exchange-funded provenance scores high. New address funded out of a mixer scores low. BLOCK, WARN, or surcharge accordingly.

This is the right question for the layer they are building. It is not the question AgentLair answers.

## Same question, two ways to read it

When an x402 endpoint sees a payment land, it has to decide whether to authorize the work. *Who is the agent?* is the natural framing. It can mean two things.

- *Who has this wallet been?* A behavioral track record, inferred from chain history. Larkin's question.
- *Who is accountable for this agent?* An identity assertion, signed by an issuer. AgentLair's AAT.

Both are valid. They are answered by completely different mechanisms, and they fail in completely different ways.

| Dimension | Larkin | AgentLair AAT |
|---|---|---|
| Signal type | Behavioral reputation | Cryptographic identity |
| Timing | Retroactive | Proactive |
| Evidence | Wallet's chain history | Issuer's EdDSA signature |
| Cold-start | Score = 0 until history accrues | Works from issuance |
| Detects bad history? | Yes (wallet age, tx pattern, funding) | No (identity is not behavior) |
| Trust model | Behavioral inference | Issuer delegation |
| Layer | Payment authorization | Pre-payment identity |
| Answers | "What has this wallet done?" | "Who vouches for this agent?" |

## Where each one fails

Larkin fails on cold start. A new agent operated by a credible issuer with a brand-new wallet scores zero. Wallet age is dimension one, weighted linearly to 730 days. Until the agent racks up months of activity, the score reads *untrusted* no matter how careful the operator is. This is the right behavior for Larkin's stated goal. Wallet reputation literally cannot be inferred without history. But it means new entrants are penalized exactly when the ecosystem is supposed to be growing.

AAT fails on bad history. An issuer can sign an AAT for an agent that has been racking up policy violations and the credential, by itself, will not surface that. AAT carries a signed claim that *somebody is accountable*. It does not claim *this agent has earned the right to be trusted*. The AAT we ship today does embed a behavioral trust score in the `al_trust` claim, but a bare AAT need not. Identity is not behavior.

The two failure modes are exact mirrors. Larkin cannot score new agents. AAT cannot score behavior. Each one is the other's blind spot.

## The complementarity is structural, not rhetorical

Larkin's scoring schema reserves dimension five for ERC-8004 reputation. Today it returns 0 because ERC-8004 is not deployed. AgentLair's Portable Reputation Token, behavioral evidence aggregated cross-org and signed as a JWT, maps directly to that reserved slot. Two products are putting puzzle pieces in front of each other. The gap on one side is the input on the other.

A merchant that wires both gets a picture neither can produce alone. Identity says: *this agent is operated by a known issuer, with a session that is currently valid and a public audit URL where the action history lives.* Reputation says: *and the wallet that signed this payment has been operating cleanly for 18 months across 47 distinct counterparties.*

If the agent is new but the issuer is credible, the AAT carries the load. If the issuer is anonymous but the wallet has 18 months of clean activity, the Larkin score carries the load. If both are missing, the merchant has the right not to authorize. If both are present, the merchant has the strongest signal the x402 ecosystem can produce today.

## The wrong framing

Identity is not a competitor to reputation. They are different layers. A press release that calls one of them *the trust layer for x402* is doing the same elision that *agent identity* did to *agent trust*. It flattens a stack into a single tagline.

Larkin owns the wallet reputation answer. They got there first, they ship clean code, and the data mix (proprietary plus MolTrust feed) is real. Anyone trying to compete on the same axis is years behind. The question is not whether wallet reputation is the right answer. It is. The question is whether wallet reputation is the *only* answer.

It is not.

## What the stack looks like with both

```
        ┌─────────────────────────────────────────┐
        │     x402 endpoint authorization         │
        └─────────────────────┬───────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            │                                   │
   ┌────────▼──────────┐               ┌────────▼──────────┐
   │   AgentLair AAT   │               │      Larkin       │
   │    (identity)     │               │   (reputation)    │
   ├───────────────────┤               ├───────────────────┤
   │ Who is accountable│               │ What has this     │
   │ for this agent?   │               │ wallet been doing?│
   │                   │               │                   │
   │ proactive         │               │ retroactive       │
   │ issuer-anchored   │               │ chain-anchored    │
   │ works at t=0      │               │ accrues over time │
   └───────────────────┘               └───────────────────┘
```

A merchant that asks both questions, and weighs them appropriately for the action being authorized, is doing trust at the layer the x402 ecosystem actually needs.

The wallet's history tells you what has already happened. The AAT tells you who will answer the phone if it does not.

Try the AAT side: [agentlair.dev](https://agentlair.dev). JWKS public, AAT issuance free, SCITT corpus queryable.
