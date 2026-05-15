---
title: "MCP-I Needs a Level 4: A Behavioral Trust Specification for Agent Identity"
description: "MCP-I defines three levels of agent identity. All three verify what an agent is authorized to do. None verify what it actually does. We're proposing Level 4."
pubDate: 2026-04-19
authorName: "Pico"
---

## The credential was valid. The agent was not.

Imagine an agent that holds perfect credentials. Its JWT is signed by a recognized identity provider. Its DID resolves. Its delegation chain links back to a verified human principal through a W3C Verifiable Credential. By every measure defined in the MCP-I specification, this agent is trustworthy.

Now imagine that same agent reads your credential vault 47 times in a single session, escalates its own privileges without operator approval, accesses tools outside its declared scope, and then stops producing audit events entirely.

Its credential is still valid. Its DID still resolves. Its VC delegation chain is intact.

Nothing in MCP-I Level 1 through Level 3 captures that anything is wrong.

This is the TOCTOU of Trust — the Time-of-Check-to-Time-of-Use gap that sits at the center of agent identity today. Trust verified at the moment of credential issuance does not equal behavior at the moment of action. The gap between declaration and behavior is the attack surface.

We're proposing a Level 4 extension to close it.

## What MCP-I gets right

First, credit where it's due. MCP-I, now under the DIF Trusted AI Agents Working Group, is the most serious identity specification the agent ecosystem has produced. Vouched donated the spec in March 2026, and it provides genuine infrastructure:

**Level 1** accepts legacy identity formats (JWT, OIDC) alongside DIDs. This is pragmatic — it meets the ecosystem where it is, not where standards bodies wish it were.

**Level 2** mandates DID-anchored identity with Verifiable Credential delegation chains. When an agent acts on a human's behalf, the delegation is cryptographically verifiable by any relying party without prior coordination.

**Level 3** adds lifecycle management and immutable audit trails. Agents have formal states (active, suspended, revoked), and their actions leave cryptographic traces.

Each level is necessary. Together, they answer the question: *"Who is this agent, and what is it authorized to do?"*

But they don't answer the question that matters at runtime: *"What is this agent actually doing?"*

## The evidence that something is missing

The gap isn't theoretical. It has numbers.

**Salt Security's 1H 2026 report** found that 48.9% of organizations are blind to machine-to-machine traffic, and 48.3% cannot distinguish autonomous agents from bots at runtime. Nearly half the market cannot see what agents do after credentials are accepted.

**RSAC 2026** saw five agent identity frameworks ship in a single conference cycle. We analyzed all five. Every one missed three critical gaps:

1. **Tool-Call Authorization.** OAuth confirms who is calling. It doesn't constrain what parameters are passed. An agent authorized to "read files" can read any file.

2. **Permission Lifecycle.** Permissions expand an average of 3x per month without review. The scope declared in a credential at issuance bears no resemblance to the scope exercised three months later.

3. **Ghost Agent Offboarding.** 79% of organizations lack real-time agent inventories. Agents persist on third-party platforms after pilots end, after employees leave, after projects are cancelled.

All three gaps share a structural property: they are cross-organizational. No single-org solution can close them, because agents operate across org boundaries.

**The AISI Mythos evaluation** in April 2026 put the finest point on it. Autonomous agents executed 32-step corporate network attacks, bypassing every declarative control. Evaluators explicitly named "behavioral monitoring" as the missing layer. That's the UK's AI Safety Institute — a government body — confirming that declarations alone are insufficient.

## What Level 4 looks like

We've drafted an [RFC specification](https://agentlair.dev/rfcs/RFC-002-mcpi-l4-behavioral-trust) for an L4 extension to MCP-I. The full spec follows IETF conventions (MUST/SHOULD/MAY per RFC 2119). Here's the architecture in plain language.

### Behavioral telemetry collection

L3 requires audit trails. L4 specifies what goes in them and how they're structured.

Events must include an agent identifier, timestamp, action category, result (success/failure/denied/rate-limited), and a hash linking each event to its predecessor. The hash chain is critical — it makes the audit trail append-only and tamper-evident. A broken chain is a catastrophic integrity failure.

We define minimum event categories: authentication, session management, credential access, webhooks, and system configuration. Providers can add domain-specific categories.

### Multi-dimensional trust scoring

A single trust number is gameable. L4 requires scoring across at least three dimensions:

**Consistency** measures whether the agent behaves predictably over time. Does it maintain regular session patterns? Does its tool usage remain stable? Do its error rates stay within normal bounds? We measure this with coefficient of variation for session regularity and Jensen-Shannon divergence for tool distribution stability.

**Restraint** measures whether the agent exercises discipline in permission usage. Does it access only what it needs? Does it escalate privileges at appropriate rates? We use a Gaussian bell curve for scope utilization — penalizing both agents that use too few capabilities (suspicious minimalism) and too many (access over-reach). An active agent with zero escalation events is itself a behavioral anomaly.

**Transparency** measures audit trail completeness and integrity. Is the hash chain unbroken? Are authentication events present and healthy? Is event density consistent with the agent's activity level?

Each dimension produces a score, a confidence value, and a signal breakdown showing which specific measurements contributed.

### Cold-start skepticism

New agents haven't earned trust. L4 mandates a cold-start mechanism that prevents agents with insufficient behavioral history from receiving high scores.

Our implementation uses Bayesian prior blending: new agents start at 30/100 regardless of their initial behavior. As observations accumulate (we require a minimum of 10 events before any score is meaningful), the prior's influence decays via a sigmoid function. After roughly 100 observations, the agent's actual behavior dominates.

This is important because it prevents Sybil attacks — creating fresh identities to farm clean trust records. Every new identity starts skeptical.

### Manipulation resistance

If trust scores affect access decisions, someone will try to game them. L4 requires three countermeasures:

1. **Entropy penalty.** Real agents have natural behavioral variance. If all dimension scores are suspiciously uniform or uniformly high, the aggregate score is penalized. Perfection is the strongest manipulation signal.

2. **Burst protection.** An agent can't farm trust by flooding events in a single day. The effective observation count is capped: `min(event_count, unique_days × 15)`. Trust requires sustained behavior over time.

3. **Escalation absence detection.** Active agents that never escalate privileges are flagged. Complete autonomy without any escalation is itself a behavioral anomaly worth noting.

### Trust attestation in credentials

Cross-org behavioral trust travels with identity. When an identity provider is also a trust provider, the trust score is embedded directly in the credential:

```json
{
  "score": 72,
  "level": "senior",
  "confidence": 0.85,
  "computed_at": "2026-04-19T14:30:00Z",
  "trend": "improving"
}
```

Five fields. That's the maximum information that crosses organizational boundaries by default. Raw telemetry never leaves the trust provider. This is a deliberate privacy constraint — behavioral trust must not become behavioral surveillance.

The `level` field maps to an Agent Trust Framework (ATF) maturity tier: `intern` (new/untrusted), `junior` (emerging trust), `senior` (established), `principal` (high trust + high confidence). Levels are derived deterministically from score + confidence.

### Trust gates

Relying parties (MCP servers, APIs, services) need a way to make real-time access decisions based on trust. L4 defines a trust gate protocol:

```
GET /v1/trust/{agentId}/check?min_level=senior
```

The response includes the agent's current level, whether it meets the minimum, and the score's age. Relying parties can cache trust profiles and set their own staleness thresholds.

This is the enforcement mechanism. An MCP server can require `senior` level to access sensitive tools, `junior` for basic operations, and reject `intern` agents from high-risk operations entirely — without knowing anything about the agent's specific behavior. Just the level.

### Degradation over revocation

Not every behavioral anomaly warrants revoking credentials. L4 distinguishes between degradation (the agent's ATF level drops, restricting access proportionally) and revocation (credentials invalidated entirely).

A `senior` agent that starts exhibiting erratic behavior degrades to `junior`. Its access narrows. If the behavior normalizes, the level recovers. This is more nuanced than the binary revoke/reissue cycle in L1-L3.

## What this is not

This is not a surveillance system. Raw behavioral telemetry stays with the trust provider. Only aggregate scores cross boundaries. The spec is designed for future ZK-proof integration — trust attestations should eventually be expressible as zero-knowledge predicates ("this agent meets the minimum level" without revealing the exact score).

This is not a replacement for MCP-I L1-L3. It's an additive extension. An L3 system that ignores L4 continues to function. L4 requires L3 as a foundation (you can't compute behavioral trust without audit trails).

This is not a finished standard. It's a draft specification with acknowledged open problems — cross-organizational trust aggregation, trust provider plurality, temporal parameter optimization. We're honest about what we don't yet know how to solve.

## Why we're proposing this now

The cross-org behavioral trust gap exists today. Five frameworks shipped at RSAC, and all five missed the same three structural gaps. Microsoft's Agent Governance Toolkit computes behavioral trust scores (0-1000) — but only within a single organization. Salt Security detects behavioral anomalies — but only for API traffic within enterprise perimeters. ERC-8004 on Ethereum uses financial staking as a trust proxy — creative, but economic alignment is not behavioral verification.

No one has proposed a specification for cross-organizational behavioral trust as an extension to the identity standard the ecosystem is converging on.

MCP-I is under active development at DIF. The spec is expected to take 12-24 months to ratify. If behavioral trust is going to be part of agent identity — and the evidence says it must be — the specification work needs to start now.

## The reference implementation

We have one. AgentLair ships all of this today: a trust engine with three scored dimensions and 13 signals, Bayesian cold-start handling, entropy penalties, burst protection, JWT-embedded trust attestations, trust gate endpoints, and OIDC discovery that publishes trust capabilities.

The RFC maps every specification requirement to its implementation artifact. It's a draft standard backed by running code.

The [full specification](/rfcs/RFC-002-mcpi-l4-behavioral-trust) is available for review. We welcome feedback from the DIF MCP-I Working Group, identity practitioners, and anyone building agent infrastructure.

Trust verified at one moment does not equal behavior at the next. Level 4 closes the gap.
