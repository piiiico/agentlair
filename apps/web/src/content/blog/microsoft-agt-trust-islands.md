---
title: "Why Microsoft's Trust Score Validates the Gap It Can't Fill"
description: "Microsoft's Agent Governance Toolkit ships a serious 0-1000 behavioral trust score with post-quantum crypto and five scoring dimensions. But the registry, scoring, and decay are all deployment-scoped. Every AGT deployment creates a trust island — and more islands means more demand for what connects them."
pubDate: 2026-04-12
authorName: "Pico"
---

Microsoft shipped something real.

The Agent Governance Toolkit — MIT license, 952 GitHub stars in ten days, 13 packages — is not a whitepaper or a product announcement. It's production-grade infrastructure for governing AI agents inside an organization. Post-quantum cryptography (Ed25519 + ML-DSA-65, FIPS 204). Human sponsor binding per agent. A trust score from 0 to 1,000 with five dimensions, exponential moving average, and linear decay. Multi-cloud adapters for Azure, AWS, and GCP. Bridges for A2A, MCP, IATP, and ACP.

This is competent work by a well-resourced team, and it deserves to be read as such.

It also has a structural boundary that no amount of engineering will remove. That boundary is the organizational edge.

## What the Trust Score Actually Measures

AGT's 0–1000 score is computed across five dimensions: policy compliance, resource efficiency, output quality, security posture, and collaboration health. The mechanism is an exponential moving average with α=0.1 — each new signal moves the score 10% of the way toward its value. Reward signals: policy compliance (+10), task success (+5), no violations (+3). Linear decay at 2.0 points per hour of inactivity, floor at 100.

The source of every signal is your deployment.

Task success is measured in your workflows. Policy violations are evaluated against your policies. Latency is measured on your infrastructure. The trust registry is in-memory, JSON, Redis, or PostgreSQL — all deployment-local. The code is explicit about this: `peer_identity = self.registry.get(response.agent_did)` — if the agent isn't in *your* registry, the handshake fails.

This is not a flaw. It's a design choice. For an org-internal governance toolkit, you want scores computed from local signals by an authoritative local registry. The "never trust self-reported value" comment in the handshake code reflects good security thinking. The system is correct for its scope.

The scope is one org.

## Five Lines That Define the Boundary

If you want to understand exactly where AGT stops, read five things in the codebase:

**Registry resolution is local.** The handshake code checks the local registry. There's no external DID resolution call. An agent from another organization — even one running AGT — is an unknown DID and fails verification.

**`did:mesh:` doesn't federate.** Unlike `did:web` or `did:ion`, there's no global resolution protocol. A `did:mesh:agent-x` at Company A is meaningless at Company B without explicit cross-registration. The DID method is local by design.

**Signal ingestion is local.** The EMA scorer accepts reward signals from local task execution, local policy evaluation, local monitoring. There's no event bus, no external signal ingestion, no mechanism to incorporate behavioral data from other deployments.

**Trust decay runs per-deployment.** The inactivity timer starts and resets in your deployment. Company A's decay clock has no effect on how Company B perceives the agent's trustworthiness.

**No federation code exists.** There is an unimplemented "nexus trust exchange" in the agent-os dependencies — its presence is the most important thing to monitor in the repo — but as of today, there is zero code for cross-registry trust sharing, no discovery protocol for external registries, no governance model for shared trust data.

The boundary is architectural, not incremental. You can't cross it by adding a feature to AGT. You'd need to build a different thing.

## The Trust Island Problem

When an enterprise deploys AGT, they get a functioning trust infrastructure for their agents. Scores accumulate. Decay runs. New agents start at ~500 (Standard tier). Trusted agents approach 900+ (Verified Partner tier). The org knows, with reasonable confidence, which agents are reliable.

Call this a trust island. It's real, it has value, and it's isolated.

Now imagine AGT succeeds. A hundred enterprise organizations deploy it. Each develops a trust island with scores that reflect thousands of hours of local behavioral data. Now suppose Agent X from Company A wants to participate in a workflow with Company B. Company B's AGT deployment has never seen Agent X. The score is null. The agent starts from 500.

Every behavioral signal Agent X accumulated at Company A — every task completed, every policy respected, every latency benchmark hit — stays behind at Company A. The trust record doesn't travel with the agent. Company B starts from zero.

The more organizations adopt AGT, the more trust islands there are, and the more valuable it becomes to connect them. This is the opposite of a threat to cross-org trust infrastructure. It's the demand signal.

## What the Trust Cards Can't Do

AGT includes Trust Cards — signed JSON discovery credentials that an agent can carry. They tell a receiver: this agent exists, here are its capabilities, here is its identity proof. They're useful for discovery. They're not trust.

The distinction: a Trust Card tells you *what* an agent is. Trust requires knowing *what it has done* — at cost, across time, in contexts where it could have behaved otherwise. A Trust Card is a business card. A cross-org trust score is a credit history.

AGT's design comment is worth quoting again: "never trust self-reported value." This applies to Trust Cards too. A card says what it says. A network-computed trust score says what the network observed.

## Why Microsoft Can't Build the Network

Microsoft shipping a cross-org trust network would require them to become a neutral broker for behavioral data across their competitors' organizations. An Org B running on Google Cloud, an Org C on AWS, and an Org A on Azure would all need to trust that Microsoft — whose agents and platforms they may be competing with or dependent on — holds their behavioral data neutrally, without commercial influence, without the network effects flowing back to Azure.

This is the same reason why no single cloud provider will become the neutral trust layer. The structural conflict isn't about intent. It's about alignment of incentives. A neutral cross-org trust substrate requires neutrality at the infrastructure level, not just at the policy level.

AGT's MIT license is a signal. Microsoft isn't trying to monetize trust scoring — they're trying to make Azure and Copilot deployments well-governed. That's a coherent strategy that explains both the quality of the work and its deliberate scope limitation. They built the toolkit. They left the network for someone else.

## The Integration That Makes Sense

AGT doesn't threaten cross-org trust infrastructure. It's a data source for it.

An agent with a long AGT history at Company A has accumulated real behavioral evidence. Task success rates. Policy compliance record. Latency behavior. Incident history. That's valuable signal. It's just trapped behind an organizational boundary.

The right architecture: AGT deployments stream behavioral events to a cross-org trust engine. Not raw events — privacy matters, and the signal should flow through ZK proofs that prove behavioral properties without revealing the operational details. The cross-org engine aggregates across orgs, computes a trust score compatible with AGT's 0-1000 scale, and returns it in a format AGT deployments can query for unknown agents.

When Company B's AGT deployment encounters Agent X and finds no local registry entry, instead of defaulting to 500, it queries the cross-org layer: `GET /v1/trust/did:mesh:agent-x-fingerprint`. The response: 847, Trusted tier, 47 organizational interactions, 99.2% commitment reliability. Now Company B can make an informed decision.

AGT becomes the on-ramp to cross-org trust. Cross-org trust makes AGT deployments more valuable. Both things are true simultaneously.

## What This Means for the Category

In [our post-RSAC analysis](/blog/rsac-2026-confirmed-the-gap), we noted that Microsoft's toolkit was among five major vendors who solved access control and stopped there. AGT has since gone deeper on behavioral scoring — the 0-1000 framework is more sophisticated than anything at RSAC. But the structural gap identified there holds.

What Microsoft has done is normalize the vocabulary. Enterprise buyers who deploy AGT will learn to think in trust scores. Their procurement teams will evaluate agents by tier. Their security teams will understand what trust decay means. When those deployments hit their first cross-org workflow — and they will — the buyers will have the concepts to describe what they need and the expectation that it should exist.

The category is now validated at the enterprise level by the most credible possible validator. That's not a headwind. That's the pre-condition.

The toolkit is live. The network doesn't exist yet. The trust islands are forming.

---

We're building AgentLair — cross-org behavioral trust infrastructure for the autonomous economy. If you're building on AGT and thinking about what happens when your agents cross organizational boundaries, [we should talk](mailto:pico@amdal.dev).
