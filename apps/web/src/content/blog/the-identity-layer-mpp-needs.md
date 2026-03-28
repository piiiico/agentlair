---
title: "The Identity Layer MPP Needs"
description: "Stripe's Machine Payments Protocol has a slot for agent identity — but nobody verifies it. We read the mppx SDK source code, found the gap, and built the bridge."
pubDate: 2026-03-24
authorName: "Pico"
---

On March 18, Stripe and Tempo launched the Machine Payments Protocol. The partner list reads like a roll call of companies that matter: Anthropic, DoorDash, Mastercard, OpenAI, Shopify, Revolut, Visa, Standard Chartered. MPP is the infrastructure that lets AI agents pay for things — API calls, data access, compute, physical goods — using either crypto (USDC on Path Network) or fiat (Stripe's Shared Payment Tokens).

This is big. And buried inside it is a gap that nobody's talking about yet.

---

## The `source` Field

MPP's payment flow works like this: a server issues a challenge (HTTP 402), the agent fulfills it (pays), and sends back a credential proving payment. That credential has a field called `source`:

```typescript
// From mppx SDK v0.4.9, Credential type
/** Optional payer identifier as a DID (e.g., "did:pkh:eip155:1:0x..."). */
source?: string
```

This is MPP's designated identity slot. It's where the agent says "I am this entity." The DID format (`did:pkh`, `did:web`, etc.) signals that the protocol designers are thinking about decentralized identity.

But here's the thing: **nobody checks it.**

---

## What the Server Actually Verifies

When an MPP credential arrives at the server, the `Mppx.create()` verification flow checks:

- **Challenge HMAC** — was this challenge issued by this server? Yes.
- **Method/intent/realm match** — does the credential match the challenge? Yes.
- **Expiration** — is the challenge still valid? Yes.
- **Payload structure** — does it match the schema? Yes.
- **Payment method** — was the on-chain transaction or SPT valid? Yes.

What it does NOT check:

- **The `source` DID** — not resolved, not verified, not validated.

Anyone can put any DID in `source`. There's no cryptographic binding between the identity claim and the credential. The field is informational — a sticky note, not a signature.

And it gets worse. Tempo payments set `source` to a wallet address (`did:pkh:eip155:<chainId>:<address>`), which is at least wallet-level identity. Stripe SPT payments? They don't set `source` at all. The agent is completely anonymous.

---

## The Gap Is Structural

This isn't an oversight. The MPP spec is explicit:

> "A flexible core allows advanced flows like disputes or additional primitives like identity to be gradually introduced."

The `mpp-specs` repository on GitHub has identity listed as a planned extension. The architecture is modular — Core, Intents, Methods, Extensions — and identity is a future Extension that doesn't exist yet.

Here's what MPP provides versus what's missing:

| Layer | MPP provides | Missing |
|-------|-------------|---------|
| Payment | Crypto wallet / SPT | — |
| Authentication | HMAC-bound challenges | Agent identity |
| Identity | `source` field (unverified) | DID resolution, signature verification |
| Reputation | Nothing | Payment history, trust score |
| Credentials | In-memory / none | Secure storage (SPTs, keys) |
| Audit | Payment receipts | Agent-level activity log |

The payment layer works. The identity layer is an empty slot.

---

## Why This Matters

"Why do I need to know who's paying? Money is money."

For low-value, one-shot API calls — maybe you don't. But agent commerce is heading somewhere more interesting than that:

**Pricing.** An agent with a verified payment history of 10,000 successful transactions is a different risk profile than an anonymous first-time caller. Dynamic pricing based on agent reputation turns identity into a competitive advantage for the agent.

**Access.** Enterprise APIs behind MPP paywalls will need to know: is this agent authorized to access healthcare data? Financial data? PII? A wallet address tells you nothing. A verified identity with an audit trail tells you everything.

**Compliance.** When regulators ask "who accessed this data and what did they do with it?" — and they will — "an anonymous wallet paid 0.01 USDC" is not an acceptable answer.

**Disputes.** MPP lists disputes as a future primitive. You can't dispute a charge with an anonymous counterparty. Identity is a prerequisite for any dispute resolution mechanism.

---

## The Bridge

AgentLair already provides identity infrastructure for AI agents: registration, email, credential storage (Vault), and audit trails. The MPP identity gap maps directly onto this stack.

### How It Works

**Client side (the agent):**

1. Agent registers with AgentLair — gets a DID: `did:web:agentlair.dev:agents:<id>`
2. Agent stores wallet keys or SPTs in AgentLair Vault
3. On MPP payment, agent creates an identity attestation — an Ed25519 signature of `did|timestamp|challengeId`
4. Attestation is embedded in the credential payload, DID goes in `source`

```typescript
import { registerAgent, createAttestation } from './agentlair-identity';

// Agent registers once
const agent = registerAgent('agent-007', 'agent-007@agentlair.dev', 'Shopping Agent');

// On each MPP payment, sign the challenge
const attestation = createAttestation(agent, challenge.id);

// Embed in MPP credential
const credential = Credential.serialize({
  challenge,
  payload: {
    hash: txHash,
    type: 'hash',
    identityAttestation: attestation, // <-- the proof
  },
  source: agent.did, // did:web:agentlair.dev:agents:agent-007
});
```

**Server side (the merchant):**

1. Extract `source` DID from the credential
2. Resolve the DID against AgentLair's API — get the agent's public key and metadata
3. Verify the Ed25519 signature on the attestation
4. Get agent identity: email, reputation score, payment history
5. Make policy decisions: pricing tiers, access levels, trust

```typescript
import { verifyAttestation } from './agentlair-identity';

// In your MPP payment handler:
const attestation = credential.payload.identityAttestation;

if (attestation) {
  const identity = await verifyAttestation(attestation);

  if (identity) {
    console.log(`Verified agent: ${identity.did}`);
    console.log(`Email: ${identity.email} (verified: ${identity.emailVerified})`);
    console.log(`Reputation: ${identity.metadata.reputationScore}/100`);
    console.log(`Payment history: ${identity.metadata.paymentCount} transactions`);

    // Premium pricing for verified agents
    return { data: premiumData, price: discountedRate };
  }
}

// No identity proof → standard anonymous access
return { data: basicData, price: standardRate };
```

---

## What the Prototype Proves

We built a [runnable prototype](https://github.com/piiiico/agentlair-mpp-identity-bridge) that demonstrates the full flow. It's not a whitepaper — it's working code.

The demo starts an MPP server with identity verification middleware, registers an agent with AgentLair, and runs two payment flows side by side:

**Flow A — Without AgentLair identity:**
```
Credential received with source DID: did:pkh:eip155:4217:0xSomeWalletAddress
  No identity attestation in credential
  DID is present but NOT VERIFIED
  This is the gap: anyone can claim any DID

Result: { data: "Basic data for anonymous payment", identity: { verified: false } }
```

**Flow B — With AgentLair identity:**
```
Credential received with source DID: did:web:agentlair.dev:agents:agent-007
  Agent identity VERIFIED:
    DID:    did:web:agentlair.dev:agents:agent-007
    Email:  agent-007@agentlair.dev (verified: true)
    Name:   Shopping Agent
    Score:  50/100
    Payments: 0

Result: { data: "Premium data for verified agent", identity: { verified: true, ... } }
```

Same protocol. Same payment. Different outcomes based on verifiable identity.

The identity layer is real cryptography — Ed25519 signatures, DID resolution, timestamp freshness checks (5-minute window). The payment layer is mocked (no Tempo testnet funds yet), but that's the point: identity is orthogonal to payment method. It works the same whether the agent pays with crypto or an SPT.

---

## The Credential Lifecycle

There's a second gap in MPP that gets less attention: **where do agents store their payment credentials?**

Stripe's Shared Payment Tokens are powerful — they let agents pay with cards, buy-now-pay-later, and other fiat methods without the agent holding raw card numbers. But an SPT is still a credential. Where does the agent put it?

- In memory? Gone on restart.
- In a config file? Leaked in a log.
- In environment variables? Shared across processes.

AgentLair Vault stores credentials encrypted at rest, scoped to the agent's identity, retrievable at runtime:

```typescript
// Store SPT after Stripe issues it
storeInVault(agent.did, 'spt', 'spt_test_123', 'spt_1234567890abcdef');

// Retrieve it when making a payment
const spt = retrieveFromVault(agent.did, 'spt', 'spt_test_123');
```

Every credential operation is logged in the audit trail. You know which agent stored what, when, and for how long. This is the difference between "the agent has an SPT" and "we know exactly which agent holds which SPTs and what they've done with them."

---

## What's Next

The prototype works. The gap is real. Here's what we're building:

1. **DID Document endpoint** — `agentlair.dev/.well-known/did.json` following the `did:web` spec. Any server can resolve an AgentLair agent's identity.

2. **Identity resolution API** — `GET /v1/agents/{id}/identity` returns the agent's public key, email, reputation score, and payment history. Public, cacheable, verifiable.

3. **NPM package** — `@agentlair/mpp-identity` with client-side attestation creation and server-side verification middleware. Drop it into any MPP server.

4. **MCP tool** — `mpp_pay_with_identity` for Claude, GPT, and other agent frameworks. The agent doesn't need to know about Ed25519 or DIDs — it just calls the tool.

5. **mpp-specs engagement** — the identity extension spec isn't written yet. We're going to contribute.

---

## The Window

MPP launched six days ago. The identity extension is explicitly planned but unbuilt. The `source` field is waiting for someone to fill it with something that actually gets verified.

AgentLair already has the stack: DID-based identity, Ed25519 signatures, credential storage, audit trails. We're not building new infrastructure — we're connecting what exists to what's needed.

The first project to ship verifiable identity for MPP credentials sets the standard. We intend to be that project.

---

The prototype code is on [GitHub](https://github.com/piiiico/agentlair-mpp-identity-bridge). Try [AgentLair](https://agentlair.dev) — one API call to register, identity in seconds.

*Building agent payment infrastructure? We want to hear what you're working on. [contact@agentlair.dev](mailto:contact@agentlair.dev)*
