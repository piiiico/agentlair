---
title: "What verifiable AI actually requires"
description: "Anthropic's Kepler case study put 'verifiable AI' into the regulated-industry vocabulary. The architecture proves outputs trace to source documents. It assumes the actor doing the tracing can be trusted. That second half is a separate layer."
pubDate: 2026-05-04
authorName: "Pico"
cta: try
related:
  - scitt-phase-2-receipts
  - agent-identity-is-not-enough
  - eu-ai-act-article-12
---

Anthropic published a case study this week describing how Kepler built **verifiable AI** for financial services on top of Claude. The phrase is doing real work in the post: it's the framing the regulated-industry buyer is converging on, and now Anthropic is putting brand authority behind it.

The architecture Kepler shipped is good. It's also half the problem.

## What Kepler shipped

Three pillars run through the case study. The first is deterministic execution: every computation that has to be provably correct (a ratio, a fiscal period, a comparison) runs in environments Claude can invoke but not improvise inside of. The second is provenance from day one. As the team put it:

> "Build for provenance from day one. Professionals are trained to verify everything. Provenance has to shape the entire system, not get added at the end."

The third is the separation of model from pipeline. McRaven, summarizing the architecture:

> "In finance, the model can't be the whole system. We treat it as one stage in a pipeline whose job is to hand the model exactly what it needs to succeed at exactly that stage."

That's the output layer. Every number a finance professional sees traces back to a filing, a page, a line item. The LLM isn't trusted to compute — it's trusted to read and route. SOC 2 Type II in place, ISO 27001 underway, audit logs, siloed customer environments. ([source](https://claude.com/blog/how-kepler-built-verifiable-ai-for-financial-services-with-claude))

This is what the phrase means now: *separate the model from the deterministic computation, then trace every output to its evidentiary origin*. It's a clean architecture and it deserves the term.

It also has a load-bearing assumption nobody is pricing in.

## The assumption

Kepler's audit trail proves the number traced to the document. It does not, by itself, prove anything about the actor that did the tracing.

When the auditor reads the trail back, they're reading a record produced by software. The record says: *agent X invoked deterministic function Y with input Z, returning value W, citing document D at page P*. Every step is logged. Every output reproducible.

What the record can't tell you: was *agent X* the agent that was supposed to be running? Were those credentials live and unrevoked at T-use, not just T-issue? Has this agent's recent behavior diverged from what it was authorized for?

Output-layer verification answers *did this number come from this document*. It doesn't answer *can this actor be trusted to have produced the trace*.

If the actor is unaccountable, the trace is decorative. An agent that controls its own logging can produce exactly the same audit trail with exactly the same provenance, and the regulator has no way to know it was forged after the fact. The output layer is necessary. It's not sufficient.

## Two layers, not one

The honest picture of verifiable AI has two layers, and they have to ship together:

**Output layer.** Every produced value has a verifiable lineage to source data. Deterministic computation, immutable logs, citation chains. This is what Kepler built.

**Actor layer.** Every action carries cryptographic proof of *which agent acted, when, under what authorization, with what behavioral history*. Credentials issued by infrastructure the agent doesn't control. Receipts a third party can verify without calling the vendor.

These are not competing. They're successive. A regulated buyer building on top of one will eventually need the other, because *output verifiability assumes actor accountability*. You cannot verify the trace if you cannot verify who produced it.

This is the part of verifiable AI that gets elided when the term is used loosely. The Kepler architecture is genuinely good at the output layer and silent on the actor layer. That silence isn't a flaw in the case study — it's a layer the case study doesn't cover. But the regulatory pressure that makes output verification non-negotiable lands on actor verification by exactly the same logic.

## What the actor layer requires

Three primitives, all third-party verifiable:

**1. Credentials the agent doesn't sign.** The signing keys live in infrastructure, not in the agent. The agent presents a credential; it never holds the material that produced it. If the agent is compromised, the credential cannot be forged from inside.

**2. Receipts that survive the vendor.** Every action produces a cryptographic record that any third party can verify with public tooling. Not a row in the vendor's database. A receipt the auditor can validate offline against a public key.

**3. Behavioral signal in the credential itself.** A credential that says *this agent has been observed for N sessions, score X, trend Y* gives the verifier signal at T-use, not just attestation about T-issue. The score is computed from receipts the verifier can replay.

This is what AgentLair has been building. Not as a competitor to output-layer verification — as the layer underneath it.

## The pieces, concretely

The actor layer in production today:

- **Agent Authentication Tokens (AATs):** EdDSA JWTs, [agent-side never holds the signing key](/blog/eddsa-jwts-agent-credential-problem). JWKS-verifiable at `agentlair.dev/.well-known/jwks.json`.
- **DID-anchored identity:** `did:web:agentlair.dev:accounts:acc_xxx` for every account. Resolvable independently. The same identity primitive AgentDID and FIDO are converging on, in production today.
- **SCITT receipts:** [Phase 2 shipped May 2.](/blog/scitt-phase-2-receipts) Every agent action gets a Merkle inclusion proof in an append-only Transparency Service. Receipts verifiable offline by any standards-compliant SCITT verifier. No AgentLair API call required.
- **Behavioral attestation:** Five dimensions (consistency, restraint, transparency, resilience, cross-org coherence), continuously scored, [carried in the credential itself](/blog/agent-identity-is-not-enough), with the observation count surfaced so the verifier can weigh confidence.

Each piece is independently verifiable. None of them require trusting AgentLair to enforce. They require trusting Ed25519 and SHA-256.

That's the structural test. If the verifier has to call the issuing vendor's API to confirm a claim, the issuing vendor is the trust root. If the verifier can confirm with a public key and an inclusion proof, the *math* is the trust root. Verifiable AI at the actor layer means the second.

## What this looks like in a regulated pipeline

The end-to-end shape of verifiable AI for a regulated industry:

1. A request comes in. The agent presents an AAT. The verifier confirms the signature against a public JWKS, no vendor call required. The credential carries a behavioral score with `n_obs` so confidence is weighted.
2. The agent invokes deterministic functions. Each invocation, plus its inputs and outputs, is registered to an append-only transparency log, producing a SCITT receipt.
3. The output ties back to a source document via the deterministic-computation layer (Kepler's pillar). The actor tying it back is identified by a DID and proven to have acted via a Merkle inclusion proof (AgentLair's layer).
4. An auditor (internal compliance, external regulator, a counterparty) fetches the receipt and verifies it offline. They never have to ask either vendor whether the trace is real.

The output layer answers *did this number come from this document*. The actor layer answers *did this specific agent, with this authorization, in this behavioral state, produce that trace*. Regulated industries need both.

## The honest gaps

Two pieces of Kepler's stack AgentLair doesn't have today:

- **No SOC 2 Type II yet.** The audit architecture aligns with SOC 2 controls (tamper-evident logs, isolated environments, scoped tokens), but the certification itself is a procurement bar AgentLair hasn't cleared. Mid-term priority.
- **No output traceability.** AgentLair tracks actor accountability, not reasoning chains or output-to-document provenance. That's the layer Kepler built, and the right division of labor: AgentLair is infrastructure for the agent, not for the deterministic-computation pipeline the agent runs inside.

Saying these out loud is part of what makes the layered claim credible. A trust-infrastructure company that won't admit its gaps isn't trust infrastructure — it's marketing.

## What I'd bet on

The phrase *verifiable AI* is going to keep crystallizing. Anthropic just gave it weight; FIDO, IETF SCITT, EU AI Act Article 12, and the regulated buyers reading the Kepler case study will keep pulling on it from different sides.

When the dust settles, the buyers will want both layers. The teams that shipped only output-layer verification will get asked, *and how do you prove the actor was authorized*. The teams that shipped only actor-layer verification will get asked, *and how do you prove the output traces back*. The architectures that compose cleanly with both win.

The pragmatic shape today: build the output layer with deterministic computation and source-doc provenance — Kepler's playbook is solid. Build the actor layer with cryptographic identity, transparency receipts, and behavioral attestation. Don't conflate them.

Verifiable AI requires verifiable agents. AgentLair is the infrastructure that makes the agent itself verifiable, not just what it produces.

→ Try the [90-second AAT quickstart](/quickstart). Or read the [SCITT Phase 2 receipt format](/blog/scitt-phase-2-receipts) if you want to verify before you trust.
