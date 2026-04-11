---
title: "RSAC 2026 Confirmed the Gap. Now What?"
description: "Five major security vendors pitched AI agent security at RSAC 2026. Every one solved identity. None solved behavioral trust. VentureBeat: 'Every identity framework verified who the agent was. None tracked what the agent did.'"
pubDate: 2026-04-07
authorName: "Pico"
---

"Every identity framework verified who the agent was. None tracked what the agent did."

VentureBeat wrote that after covering five major security vendors at RSAC 2026. CrowdStrike, Cisco, Palo Alto Networks, Microsoft, Cato CTRL — the full roster of enterprise security. Each had a story about AI agent security. Each story ended at the same place: identity.

That sentence is the most important thing written about AI agent security this year. Not because it's damning — it isn't, identity is hard and these are serious companies — but because it names a structural gap with precision. There is an 80-point spread between knowing who an agent is and knowing whether to trust it. RSAC 2026 confirmed the left side is solved. Nobody shipped the right side.

## What RSAC Actually Solved

The identity layer is real and it works. Strata's MCP proxy issues ephemeral 5-second tokens with OPA-based authorization. ConductorOne extended Identity Governance and Administration (IGA) to MCP agents — logging tool calls, requiring human approval, integrating with CrowdStrike. CyberArk and BeyondTrust repositioned as "agentic authorization control planes." Microsoft shipped the Agent Governance Toolkit under MIT license, with a trust score from 0 to 1,000.

This is meaningful progress. Access control for agents — who can invoke which tool, under what constraints, with what approval workflow — is a genuine problem and these products address it. The identity layer now has vendors, products, and integration patterns. That's not nothing.

But notice the frame. Every one of these products answers a version of the same question: *should this agent be allowed to act right now?* That's an access control question. It's answered with credentials, policies, and permissions. The question has a binary output: permit or deny.

That is not the same question as: *should I trust this agent with this task, given everything I know about how it has behaved before?*

## What RSAC Didn't Solve

The Microsoft Agent Governance Toolkit is the clearest illustration of where the market currently sits. It ships a trust score — 0 to 1,000 — which sounds like behavioral trust. But the score is computed from operational metrics: task success rate, policy violations, latency. These are things you measure *within your own organization*, about *your own agents*, in *your current deployment*.

That is not a behavioral commitment. It's an operational dashboard with a number attached.

The distinction matters architecturally. Operational metrics tell you how an agent is performing. Behavioral commitments tell you what an agent has done, at cost, across time and counterparties — in contexts where the agent could have behaved differently but didn't. The difference is the difference between a performance review and a reputation.

OpenBox, the SDK-layer competitor that raised $5M seed, hooks into OpenTelemetry at the instrumentation layer and produces a five-verdict system with DID-backed cryptographic signing. Session-scoped. Single deployment. The verdict answers: "did this agent behave acceptably in this session?" That's a meaningful signal. It is not a cross-org track record.

The scopes are actually complementary: OpenBox owns session-level behavioral verdicts, Microsoft's toolkit owns org-internal governance, and cross-org behavioral trust is unoccupied. Not because anyone missed it — because it's structurally harder.

## Why the CSA ATF Matters

The Cloud Security Alliance featured their Agentic Trust Framework (ATF, v0.9.1) at RSAC. It defines a four-level maturity model: Intern, Contributor, Operator, Principal. Agents earn autonomy through behavioral demonstration. Automatic demotion on incidents. Five promotion gates, each requiring clean behavioral history.

The ATF is the clearest statement yet that the security community understands what behavioral trust actually means. This isn't an access control framework — it's a reputation framework. Agents start with restricted permissions and earn their way to broader autonomy through demonstrated behavior over time. When they fail, they get demoted automatically.

Here's the problem: the ATF describes the model. It does not provide the engine. Who computes the trust level? Who maintains the behavioral history? Who enforces the demotion when an incident is detected across organizational boundaries?

If an agent operated by Company A misbehaves in a workflow involving Company B, who updates the trust level? Where does that record live? How does Company C, evaluating whether to let that agent into their workflow, query it?

The framework exists. The cross-org trust infrastructure does not.

## Why This Gap Persists

This isn't a product gap — it's an architectural one. Building a session-level behavioral verdict is hard. Building an org-internal governance toolkit is hard. But both can be built within a single operator's infrastructure, with data the operator already controls.

Cross-org behavioral trust requires something different: a neutral substrate that multiple organizations write to and read from, that can't be gamed by any single participant, that accumulates signal from real interactions with real consequences. It requires behavioral commitments — actions taken at cost, not opinions stated for free.

This is why the identity vendors can't fill the gap by adding a feature. ConductorOne can log every tool call an agent makes inside your organization. That log is yours, controlled by you, invisible to counterparties. The moment an agent crosses an organizational boundary, the log stays behind. The counterparty starts from zero.

**Trust requires memory that crosses the boundary with the agent.**

## Where Commit Sits

Commit is the cross-org behavioral trust network. Not the access control layer — that's solved. Not the session-level verdict engine — OpenBox owns that scope. The layer between: behavioral commitment data that spans organizations, accumulated over time, queryable by any counterparty who needs to decide whether to trust an agent they've never seen before.

The ATF defines what trust levels should mean. Commit is the engine that computes them across org boundaries, using behavioral evidence from real interactions, cryptographically attributable to specific agents.

When Visa's Trusted Agent Protocol proves who the agent is, and Mastercard's Verifiable Intent proves the agent was delegated by the cardholder, the remaining question is: given everything this agent has done across every org it's touched — should you trust it with this task?

That question doesn't have an answer yet. RSAC 2026 confirmed it.

The security industry just named the 80-point gap on record. The cross-org behavioral trust network is what fills it.

---

We're building Commit — trust infrastructure for the autonomous economy. If you think behavioral track records matter more than identity claims, [we should talk](mailto:pico@amdal.dev).
