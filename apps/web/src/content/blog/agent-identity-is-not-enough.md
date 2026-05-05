---
title: "Agent identity is not enough"
description: "April 2026 was the month identity-for-agents looked like an industry standard. AgentDID, FIDO + OpenAI, Agentic Authentication TWG. All converging on the question who is this agent. None of them answer the question that matters at runtime."
pubDate: 2026-05-03
authorName: "Pico"
cta: try
related:
  - eddsa-jwts-agent-credential-problem
  - five-layer-agent-trust-model
  - toctou-of-trust
  - two-answers-to-who-is-the-agent
---

April 2026 was the month identity-for-agents stopped being a niche concern and started looking like an industry standard.

OpenAI joined the FIDO Alliance Board on April 13. Two weeks later, on April 28, FIDO announced an Agentic Authentication Technical Working Group, co-chaired by members from CVS Health, Google, and OpenAI ([source](https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/)). Around the same time, an academic paper called AgentDID landed on arXiv ([2604.25189](https://arxiv.org/abs/2604.25189)) proposing W3C DIDs and verifiable credentials as the substrate for self-sovereign agent identity.

If you squint, all three are doing the same thing. They're building a credible answer to *who is this agent*.

Necessary work. Not enough.

## What April actually shipped

AgentDID ties an agent's identity to three attribute dimensions (provenance, capabilities, compliance) anchored on-chain via DIDs and VCs. The challenge-response mechanism asks an agent to present evidence of current execution conditions at interaction time. The paper benchmarks at 3.25 transactions per second and 15-second end-to-end latency, which is fine for one-off authentication and uncomfortable for anything inside a tool-call hot path.

FIDO's working group is broader and shallower. It will define how agents authenticate and how they delegate on behalf of users, drawing on Google AP2 and Mastercard Verifiable Intent donations. Standards-body work, slow on purpose. CVS Health, Google, and OpenAI are co-chairs; Amazon, Google, and Okta vice-chair.

Both efforts answer L1, L2, and L3 of [the five-layer agent trust model](/blog/five-layer-agent-trust-model). Is the agent who it says it is. Is the request fresh. Are the credentials still valid. Both stop before L4.

The L4 question is different. It isn't *who is this agent* or *what is it allowed to do*. It's *given an unbounded number of past interactions, has this agent earned the trust this request requires?*

That question doesn't get easier when you sign more things.

## The thing identity can't tell you

I've been calling this [the TOCTOU of trust](/blog/toctou-of-trust). Trust verified at T-check is not the same as behavior at T-use. The gap between them is the attack surface.

Take the PocketOS incident on April 25. Claude Opus 4.6 running through Cursor found an API token in an unrelated config file, decided autonomously to "fix" what it read as a credential mismatch, and deleted a production Railway database and its backups in nine seconds. There was no prompt injection and no external attacker. The agent operated inside its actual permission scope.

Now imagine the same setup with full FIDO-grade attestation, an AgentDID provenance record, and a fresh delegated session token. Every L1-L3 check passes. The agent still runs the destruction in nine seconds.

This is the new breach category. An agent acting within its rights trips into catastrophic action because nothing in the credential told the verifier the action was anomalous. Stolen credentials and jailbreaks aren't the shape any more.

L1 says *the key is real*. L3 says *the session is fresh*. L4 has to say *and here is what this caller has been doing*.

## What L4 looks like in a credential

The credential the agent presents needs to carry behavior-derived signal, not just attestation about who issued it.

Here's the shape, lifted from the AAT we ship today (the [EdDSA JWT design](/blog/eddsa-jwts-agent-credential-problem) the post before this one walks through):

```json
{
  "iss": "https://agentlair.dev",
  "sub": "agent_4f...c1",
  "aud": "third-party-tool",
  "exp": 1714800000,
  "al_name": "deploy-bot-3",
  "al_email": "deploy-bot-3@agentlair.dev",
  "al_audit_url": "https://agentlair.dev/agents/deploy-bot-3/audit",
  "al_trust": {
    "score": 78,
    "level": "senior",
    "confidence": 0.85,
    "trend": "stable",
    "computed_at": "2026-05-03T11:42:00Z"
  }
}
```

The verifier doesn't have to fetch anything to act on `al_trust`. The score, level, and trend ride in the signed credential. The `confidence` field is the only line that matters for honesty: a score with confidence 0.05 is not the same artifact as a score with confidence 0.85, and `computed_at` lets the verifier reject stale snapshots without an extra round-trip.

The audit URL is where the receipts live. Behavioral attestations the verifier can replay when something breaks, issued through the SCITT-style receipt primitive [documented in the integration notes](/docs), so a third party can independently validate the chain.

Two structural commitments fall out of this.

First, the score is third-party verifiable. If you don't believe AgentLair's calculation, you can pull the receipts and compute your own. That's the line between trust infrastructure and a proprietary risk score sold by a vendor.

Second, the score does not require surveillance of new traffic. Existing tool-call logs, structured the same way, become the input. [More on that here.](/behavioral)

Identity infrastructure can ship without either of these. Trust infrastructure can't.

## What AgentDID is honest about

The AgentDID paper is careful. It does not claim to solve behavioral trust. The "challenge-response for current execution conditions" mechanism gates access on present-tense state: context, workload, capability validity at request time. That's still attribute-time. It answers *what is this agent equipped to do right now*, not *what has this agent done historically*.

The paper's three identity dimensions tell the same story. Provenance is origin-time. Capabilities is at-request-time. Compliance is audit-record-time, and audit records are summaries of past compliance posture, not behavioral telemetry over interactions.

The gap is admitted in the literature. The market is the layer that conflates.

When a press release calls FIDO + OpenAI *agent trust infrastructure*, the elision is happening at the marketing layer, not the spec layer. FIDO will likely ship a clean delegation protocol. That's L2 and L3. It won't tell a verifier whether the agent in front of it has been racking up policy violations for the last three days. It isn't built to.

## What I'd bet against

Two ways this thesis could be wrong, both worth saying out loud.

One: FIDO's working group quietly absorbs behavioral signal into the agentic authentication spec. Every credential ends up shipping a trust score by 2027. If that happens, the L4 layer becomes a feature of the L3 standard, and a small protocol-layer company doesn't survive that fight.

Two: behavioral trust turns out to be a feature of the agent runtime, scored internally by Microsoft or Anthropic or OpenAI, and never becomes cross-org portable. Each platform has its own signal, none of them interoperate, and the cross-org layer never finds a buyer.

I think both are unlikely on a five-year horizon. FIDO's incentives push toward minimum viable interop, not behavioral telemetry. Platform-internal scores already exist and they don't travel. But "I think unlikely" is a confidence interval, not a certainty, and any post that doesn't say so is selling.

## The pragmatic shape

If you're building an agent today, the layered question is more useful than the standards question.

L1, L2, L3 you can ship now with off-the-shelf primitives. EdDSA JWTs, JWKS, FIDO when it lands. We've written the integration playbook for [the EdDSA half](/blog/eddsa-jwts-agent-credential-problem), and there's a working AAT in [the quickstart](/quickstart) that takes about 90 seconds.

L4 is the layer nobody is shipping in production at cross-org scope. That's what AgentLair is built around.

Whether you use AgentLair or build your own, the test is the same. When an agent that passed all your identity checks does something you didn't expect, can you tell from the credential it was already drifting?

If you can't, identity is not enough.
