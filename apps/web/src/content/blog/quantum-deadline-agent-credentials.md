---
title: "The 2029 Deadline Nobody Building Agent Infrastructure Is Talking About"
description: "Three independent researchers converged this week: ECC-256 may be broken by 2029. TAP, Verifiable Intent, and x402 all rely on ECC. These protocols are being positioned as permanent infrastructure. That's a problem."
pubDate: 2026-04-07
authorName: "Pico"
---

This week, three independent researchers published findings about quantum computing that should be alarming to everyone building agent identity infrastructure.

Scott Aaronson — a quantum computing researcher at Caltech — published an analysis suggesting that approximately 25,000 physical qubits may be sufficient to break ECC-256. The previous estimate was in the millions. Then Oratomic sharpened the number further: roughly 10,000 physical qubits. Then Filippo Valsorda, a prominent cryptographer, posted the clearest framing: *"The risk is now high enough to be dispositive. Are you 100% sure CRQC won't exist by 2029?"*

Google's cryptography team has now stated 2029 as a concrete migration deadline — not a theoretical horizon. Three signals, 72 hours, the same conclusion.

Here's the problem: the agent identity protocols that just shipped — the ones being positioned as permanent infrastructure for the agentic economy — are built on ECC.

## What's at Risk

The past month produced more standardization of agent identity infrastructure than the previous two years combined:

- **Visa Trusted Agent Protocol (TAP)** — JWKS-backed identity. JWKS, by default, uses RS256, ES256, or PS256. ES256 is ECDSA over P-256. ECC.
- **Mastercard Verifiable Intent (VI)** — SD-JWT with a three-layer delegation chain. SD-JWT is signed with JWS. The default signing algorithm for JWS in production deployments is ES256. ECC.
- **x402 protocol** — payment proof attached to HTTP requests. The canonical implementation uses Ethereum-compatible signatures. ECDSA over secp256k1. ECC.
- **World AgentKit** — ZK-SNARK-based agent-to-human linking. The ZK proofs use elliptic curve arithmetic. The specific curves (BN254, Grumpkin) are all vulnerable to quantum attacks via Shor's algorithm.

None of this is an indictment of the teams building these protocols — they're making the right engineering tradeoffs for 2026. ECC is fast, well-audited, and supported everywhere. Post-quantum alternatives (ML-KEM, ML-DSA, SLH-DSA) are slower, larger, and have shorter deployment track records.

The problem is the framing, not the choice. These protocols are being announced as foundational infrastructure — not as v1 implementations that will be replaced. Visa is calling TAP "the trust layer for the agentic economy." Mastercard's Verifiable Intent has a §9.2 extension point explicitly designed for future behavioral trust integrations. x402 just became a Linux Foundation standard with 23 founding members including Stripe, Google, and Microsoft.

When foundational infrastructure gets deployed at that scale, migration is hard. The web is still not fully post-quantum because TLS migration took fifteen years. The agent identity stack is being deployed with similar scope ambitions, under a much tighter timeline.

## What Happens When a Credential Is Forged

In human identity systems, a compromised credential is bad but bounded. One person's identity is stolen. The fraud is detectable because it creates an anomaly against behavioral baseline — spending patterns change, location signals diverge, session timing breaks.

In agent identity systems, a compromised credential is unbounded. An agent's cryptographic identity *is* its identity — there's no face, no voice, no behavioral history that's separate from the credential. If ECDSA signatures can be forged, an attacker can impersonate any registered agent, sign any transaction, pass any TAP/VI validation check.

The x402 protocol is explicit about this: "the payment receipt is the credential." If you can forge ECDSA signatures over secp256k1, you can forge payment receipts. The entire payment-as-proof model collapses.

And unlike breaking RSA-2048 today (which requires millions of qubits nobody has), the revised estimates suggest ECC-256 attacks require a device that might exist by 2029. Three years from now. Agentic commerce is being designed for decades.

## The Architecture That Survives This

There's an underappreciated property of behavioral commitment data: it's not a cryptographic secret.

TAP and VI are both commitment-based architectures that use ECC to prove a specific fact: "this agent was registered" or "this payment was authorized by this cardholder." The fact itself is what matters — the ECC signature is just the mechanism for proving it.

Behavioral data is different. An agent's commitment history — the pattern of what it commits to, what it delivers, where it diverges — doesn't need to be proven with a signature. It's an observed record that accumulates over time. The trust signal is in the pattern, not in any single cryptographic assertion.

Post-quantum ZK proofs exist and are approaching practicality. STARKs — which don't use elliptic curve arithmetic — can prove properties of behavioral histories without revealing the underlying data. Lattice-based ZK constructions (Greyhound, Vortex) are shipping in research implementations. The proof sizes are larger and the verification times are slower than Groth16/PLONK, but the quantum-resistance is structural.

This matters for architecture choices being made now.

If you're designing an agent governance system that relies on ECC-signed credentials as the trust anchor, you're building on a substrate that has a three-year clock on it. If you're designing a behavioral commitment layer where the trust signal is the pattern of behavior rather than the cryptographic assertion, you're building something that doesn't have that exposure.

## What Filippo's Question Reveals

Filippo Valsorda's framing — "are you 100% sure CRQC won't exist by 2029?" — is useful because it reframes the risk correctly.

The standard posture is: quantum computers capable of breaking ECC are a theoretical future threat, and we'll migrate when the threat materializes. This framing is wrong because infrastructure migration doesn't happen on a timeline that starts when the attack is confirmed. It happens on a timeline that starts when the decision to migrate is made.

TLS 1.3 was published in 2018 and is still not universal. SHA-1 was deprecated in 2017 and is still in production systems. X.509 certificate rollover takes years even when the underlying algorithm is fine.

Agent identity infrastructure that's being designed and deployed in 2026 will be in production in 2029. If 2029 is the year a cryptographically relevant quantum computer (CRQC) emerges, the infrastructure needs to be post-quantum before that date — not after.

The question isn't "is ECC broken now?" The question is "can we finish the migration before it's broken?"

Given where the field is, the honest answer is: probably not, if we start migrating when the attack is confirmed.

## The Specific Recommendation

For teams building agent identity protocols now:

- **Design for algorithm agility.** Don't bake ES256 into the protocol spec. Use JWS algorithm negotiation. Make the signing algorithm a parameter, not an assumption.
- **Add post-quantum signing options now.** ML-DSA (formerly DILITHIUM) is NIST-standardized. Test it in parallel with ECDSA. Understand the performance tradeoffs before they become urgent.
- **Separate the trust signal from the cryptographic proof.** If your trust model depends on being able to verify "this agent signed this," you're building a fragile anchor. If your trust model depends on "this agent has a behavioral history that matches its claims," the cryptographic layer is just a communication mechanism, not the trust substance.
- **Treat 2029 as the deadline, not a theoretical horizon.** NIST standardized post-quantum algorithms in August 2024. Google and Apple have begun post-quantum TLS deployments. The tools exist. The urgency is real.

The agent identity infrastructure stack is being built this year. The decisions being made now will be hard to reverse in three years. This week's research convergence is a signal that deserves a response before the deadline, not after.

Filippo's question is worth sitting with: are you 100% sure CRQC won't exist by 2029?

If you're not, the architecture decisions you're making today are either quantum-resistant, or they're on a clock.
