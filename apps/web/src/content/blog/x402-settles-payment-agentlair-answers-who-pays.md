---
title: "x402 settles the payment. AgentLair answers who's paying."
description: "Google, Coinbase, and AWS are shipping x402 at platform scale. The on-chain record shows what was paid and when. It does not show who the agent is. That's the unsolved layer."
pubDate: 2026-05-05
authorName: "Pico"
related:
  - two-answers-to-who-is-the-agent
---

On March 15, 2026, AWS published "x402 and Agentic Commerce: Redefining Autonomous Payments in Financial Services." Halfway through the post, this line:

> "Every x402 transaction produces an immutable on-chain record: what was accessed, when, by which agent, and at what cost."

Read it again. *By which agent.*

The x402 record knows what wallet signed the transaction. It does not know who that wallet belongs to.

## The platforms are converging fast

Last month the x402 Foundation moved to Linux Foundation. Founding members: Coinbase, Cloudflare, Google, Visa, Mastercard, Stripe, AWS, Microsoft, Adyen, Fiserv, Shopify, and a dozen others. Google's Agent Payments Protocol routes through x402. Stripe Sessions integrated it. AsterPay does EUR settlement. BoltzPay and Invoica.ai are live.

The payment rail is real. It works. It clears.

What's still missing is the layer that connects "this address paid" to "this agent paid." AWS papered over the gap with one preposition. *By.* Merchants reading that line will assume agent identity is somewhere in the protocol. It isn't.

## What TLS got right in 1995

Before TLS, connections were unencrypted. Eavesdroppers read traffic. TLS encrypted the channel.

But TLS by itself doesn't tell you who's at the other end. You need a certificate authority. A chain of trust. A verifiable claim that this server is who it says it is. Encryption without authentication is an open door with a private corridor.

x402 is at the same stage. The channel is built. The settlement is clean. Authentication isn't part of it.

## What the merchant actually sees

A merchant exposing a paid API today gets, from x402:

- Confirmation that a wallet authorized the payment
- The amount transferred
- A timestamp on Base or Solana

What the merchant doesn't get:

- Whether the caller is an autonomous agent or a human with a hot wallet
- Which org or developer is responsible for the agent's behavior
- Whether the agent has any operating history at all
- A way to revoke trust if the agent goes rogue

A wallet address can be spun up in seconds. There's no skin in the game, no track record, no accountability past the payment itself. If an agent racks up $4,000 in API calls and then someone disputes the work, the on-chain trail tells you which address paid. Nothing more.

That's not enough to settle a customer dispute. It's certainly not enough to underwrite agent insurance.

## What AgentLair adds

AgentLair issues an AAT, an Agent Attestation Token. It's a signed JWT, EdDSA-keyed, valid for an hour. The signing key is published as a JWKS at agentlair.dev. Any merchant can verify any AAT in five lines of code, against a known authority.

The AAT carries:

- An agent identifier scoped to a controller (the org or developer behind it)
- The issuer (agentlair.dev or a delegated authority)
- A short TTL so leaked tokens expire fast
- A session ID that binds to a SCITT log entry

Behind it: SCITT, a tamper-evident transparency log of agent actions. Every attestation produces a corpus entry. Anyone with the entry ID can fetch and verify the signed CBOR statement. If an agent misbehaves, the audit trail is cryptographic and external. Anyone can verify it without trusting AgentLair.

So:

x402 says: *this wallet paid 0.01 USDC at 14:32:01Z.*

AgentLair says: *this AAT belongs to agent `acc_qgdxSULsXsmtHklZ`, controlled by `did:web:agentlair.dev`, issued at 14:32:01Z, valid for the next 47 minutes, with this signed action history at SCITT corpus ID `popa_5nJkiDL8Mu9Ph2Zy`.*

Different question. Complementary answer.

## The conversation that ends contracts

If you're building an agent that calls paid APIs, you'll eventually have this exchange.

Customer: *Was that really your agent?*

You: *The wallet matches our key vault.*

Customer: *Could anyone holding that key have done it?*

You: *...yes.*

That conversation ends a contract.

Pair x402 with a verifiable identity layer and the conversation changes:

Customer: *Was that really your agent?*

You: *Here's the AAT, JWKS-verified, with the SCITT corpus link. Issuer is our org DID, session matches our internal logs, action history checks out.*

That conversation closes a renewal.

## The piece that's still missing

The agentic commerce stack is maturing fast at the bottom. Settlement: solved. Routing: solved. Wallet UX: improving every week. The Linux Foundation move locked the protocol layer for the next decade.

The piece that isn't solved is the one that lets a merchant tell autonomous traffic apart from forged traffic, with cryptographic proof issued outside the agent's own runtime, verifiable against a public JWKS.

That's the layer AgentLair builds. The agentic web has a `402 Payment Required` header. It still needs a `WWW-Authenticate` for agents.

Try it: [agentlair.dev](https://agentlair.dev). The AAT is free to issue, JWKS is public, SCITT corpus is queryable. Five lines of verifier code on your side.
