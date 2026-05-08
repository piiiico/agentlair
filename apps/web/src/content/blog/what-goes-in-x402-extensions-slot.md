---
title: "What Goes In x402's Empty Extensions Slot"
description: "x402 V2 reserved a field for identity claims. The slot has been empty since the spec shipped. Two function calls and an Ed25519 JWT close the gap that World ID and ZK proofs are still working on."
pubDate: 2026-05-07
authorName: "Pico"
related:
  - x402-settles-payment-agentlair-answers-who-pays
  - eddsa-jwts-agent-credential-problem
  - agents-can-pay
---

Open the x402 V2 PaymentPayload spec. Find the `extensions` field — optional, a key-value map, described as protocol extensions data. The spec defines the mechanism: servers advertise supported extensions, clients echo them in the payment payload. The architecture is ready.

Since the spec shipped, that field has stayed empty in practice.

Not in some installations. Across every x402 deployment shipping today: Coinbase Agentic Wallets, Google's Agent Payments Protocol routing layer, AWS's agentic commerce examples, the BoltzPay and Invoica integrations, Stripe Sessions. The `extensions` object reaches the resource server with no keys in it. Whatever the spec authors thought might go in there hasn't shown up.

We put something in it. This post walks through what.

## The shape of the gap

x402 was designed to answer one question: *did money move?* It does that well. The EIP-712 payment signature gives a resource server cryptographic proof that 0.01 USDC was authorized to flow from `0x1234…` to the merchant's address. Any facilitator can verify it. Any chain explorer can confirm settlement.

What x402 doesn't answer: *who is `0x1234…`?* The wallet is a hex string. It has no name, no scopes, no operating history, no controller, no permissions beyond "can pay." A merchant accepting an x402 request has settlement guarantees and exactly zero identity guarantees.

The spec authors knew this was a gap. They left `extensions` open so identity claims could ride along with payment claims. Then nobody put anything there. World ID + x402 (Sam Altman, Coinbase, March 2026) tried to plug part of the gap with biometrics, but it answers "is a human behind this" rather than "what is this agent allowed to do." Lemma's Show HN demo a few weeks ago packs ZK attribute proofs into x402 headers, which is real cryptography but expensive per-request and still without DID binding or scopes at the time of the demo.

The slot is a JWT shape. Everyone keeps reaching for fancier primitives.

## What the AAT already is

AgentLair has been issuing AATs (Agent Attestation Tokens) since launch. Each is a compact JWT, EdDSA over Ed25519, signed by a key that lives on the host and never enters any agent's container. JWKS at `https://agentlair.dev/.well-known/jwks.json`. One-hour TTL. The standard claims (`iss`, `sub`, `aud`, `exp`, `iat`, `jti`) plus the agent-specific ones a verifier actually wants: `al_name`, `al_email`, `al_scopes`, `al_audit_url`, and (when the agent has 10+ behavioral observations) `al_trust` carrying a numeric score.

This is already the right shape for the extensions slot. No new crypto. No new keys. JWKS is offline-verifiable, so a resource server fetches the public keys once, caches them for five minutes, and verifies every subsequent AAT locally without phoning home.

The integration is two function calls.

```ts
import {
  packAATIntoX402Extensions,
  verifyAATFromX402Extensions,
} from '@agentlair/worker/x402-identity';

// Client side: pack the audience-bound AAT into the payment payload
const payment = packAATIntoX402Extensions(aat, basePayment);
const xPaymentHeader = btoa(JSON.stringify(payment));

// Resource server: verify both payment AND identity
const claims = await verifyAATFromX402Extensions(payload, {
  resourceUrl: 'https://example.com/v1/data',
});
if (!claims) return new Response('Identity required', { status: 401 });
if (!claims.al_scopes.includes('data:read')) return forbidden(claims);
```

That's the entire wire-up. The pack helper merges the AAT into `extensions['agentlair.dev/identity']` non-destructively. The verify helper handles JWKS fetch, Ed25519 signature check, expiration, issuer, and (the interesting part) audience binding.

## Why audience binding is the load-bearing claim

The AAT is issued with `aud` set to the resource URL the agent intends to access. The verifier checks `claims.aud === resource_url` before trusting anything in the token. An AAT minted for `api.foo.com` cannot be replayed against `api.bar.com` even if a malicious server captures the entire `X-PAYMENT` header.

That gives you a cryptographic chain that nothing else in the agentic commerce stack provides:

The EIP-712 signature proves *USDC moved for this resource*. The Ed25519 signature on the AAT proves *this agent, with these scopes, was the one paying*. The audience binding glues the two together: payment and identity reference the same resource URL, signed by independent keys, verifiable separately.

Neither half works alone. Anonymous money plus signed claims isn't enough. Signed claims plus no economic stake isn't enough. The composition is what merchants actually want.

## What it looks like running

Demo PoC at `/experiments/aat-x402-poc/`. No real funds, mocked facilitator, real Ed25519 throughout. Four steps:

```
→ GET /v1/data (no payment)
  HTTP 402 — Payment required: 0.01 USDC + AgentLair identity

→ Issue AAT (aud=resource URL, scope=data:read)
  AAT issued: eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtp...

→ Build X-PAYMENT with AAT in extensions['agentlair.dev/identity']
  X-PAYMENT header built (1756 chars)

→ GET /v1/data (with X-PAYMENT + identity)
  HTTP 200 — access granted
    agent:  demo-agent
    email:  demo-agent@agentlair.dev
    scopes: data:read
    trust:  score=82.4 level=senior conf=0.91
    payer:  0x1234…5678
    amount: 0.01 USDC
```

Then the failure modes that matter:

```
→ Wrong scope (read:admin instead of data:read)
  HTTP 403: scope rejected

→ Wrong audience (AAT issued for a different resource URL)
  HTTP 401: aud binding rejected
```

The 403 is the reason agents need scopes at all. An agent that paid for `data:read` cannot escalate to admin actions even if the merchant's authorization logic is sloppy, because the AAT itself states what the agent is allowed to do. The 401 is the reason audience binding matters. A captured X-PAYMENT header is useless against any URL except the one the AAT was minted for.

## Why JWT and not ZK

The case for ZK proofs in payment headers is real. They preserve privacy. They allow attribute disclosure without identity disclosure. They make sense when an agent wants to prove *something* about itself without revealing *what* it is.

That's not the agent commerce problem most merchants face. The merchant wants attribution. They want to know which agent is calling, how much it's paid in the past, what its behavioral score is, and where the audit trail lives. The agent wants the merchant to know who they are so the merchant treats them like a returning customer rather than a fresh wallet. Both sides are pulling toward identity, not away from it.

For the cases where privacy genuinely matters (regulated identity attributes, cross-tenant brokerage, biometric proofs), ZK is the right tool. For the 95% of agent commerce that's "this agent calls this API and pays per call," signed claims are the right tool. They're cheaper to verify, simpler to debug, and supported by every JWT library on earth.

## What's open

The `extensions` slot stays open. Other identity providers can register their own keys (`worldid.org/identity`, `lemma.xyz/proof`, etc.) and resource servers can read whichever ones they trust. We're not claiming the namespace; we're claiming the entry that says `agentlair.dev/identity` and proving the slot can carry production-grade signed identity today.

Production helper: `@agentlair/worker/x402-identity` (`packAATIntoX402Extensions`, `verifyAATFromX402Extensions`). PoC: `/experiments/aat-x402-poc/demo.ts`. AAT issuance: `POST https://agentlair.dev/v1/tokens/issue` with `{ aud, scopes }`.

The `extensions: {}` field stops being empty the moment somebody uses it. Better that be a JWKS-verifiable identity claim than another year of waiting for the right ZK paper.

---

*[AgentLair](https://agentlair.dev) issues signed identity tokens for autonomous agents. JWKS-verifiable, audit-trail attached, audience-bindable to any x402 resource. The slot was reserved. We furnished it.*
