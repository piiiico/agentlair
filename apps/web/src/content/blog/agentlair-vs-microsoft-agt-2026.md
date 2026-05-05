---
title: "AgentLair vs Microsoft Agent Governance Toolkit: Cross-Org Behavioral Trust Compared"
description: "Microsoft AGT is the most complete open-source toolkit for single-org agent governance. Here's what it does well, where it stops, and when you need something beyond it."
pubDate: 2026-04-30
authorName: "Pico"
related:
  - two-answers-to-who-is-the-agent
---

Microsoft released the Agent Governance Toolkit in April 2026. MIT license, ~1,000 GitHub stars in the first two weeks, 13 packages covering trust scoring, policy enforcement, and protocol bridges. For governing agents inside a single organization, it's the most complete open-source option available.

The comparison gets interesting when an agent from a different organization shows up.

That's the structural gap this post covers: what AGT does exceptionally well, where the architecture stops by design, and what cross-org behavioral trust requires that a deployment-scoped toolkit cannot provide.

This isn't a competitive takedown. AGT is genuinely well-engineered. The gap isn't a flaw — it's a scope decision. Understanding it helps you deploy the right tool for the right problem.

---

## What AGT Provides

AGT ships eight production-grade packages. The core capabilities:

**Trust scoring.** A 0–1000 scale with five tiers: Untrusted (0–199), Probationary (200–499), Standard (500–699), Trusted (700–899), Verified Partner (900+). Trust is computed via exponential moving average with α=0.1: `score = score * 0.9 + (signal.value * 100) * 0.1`. Reward signals: policy compliance +10, task success +5, no violations +3. Violations penalize. Trust decays at 2.0 points/hour of inactivity, with a floor at 100. New agents default to Standard (~500).

**Trust handshake.** Ed25519 challenge-response. An agent presents its DID, the receiving system issues a nonce, the agent signs it, the system verifies against its registry. Required trust score threshold defaults to 700. HMAC-protected cached peer records. "Never trust self-reported value" is an explicit code comment.

**Identity.** Custom `did:mesh:` DID method with Ed25519 + ML-DSA-65 (FIPS 204) hybrid post-quantum signatures. 15-minute ephemeral credentials with auto-rotation. SPIFFE/SVID integration for cloud workloads. Multi-cloud adapters for Entra (Azure), AWS IAM, and GCP Workload Identity. Human sponsor binding — each agent maps to a named person (e.g., `alice@company.com`) as an accountability anchor.

**Protocol bridges.** Unified trust model across A2A (Google), MCP, IATP, and ACP. An MCP proxy evaluates each tool call against the policy engine before forwarding.

**Five scoring dimensions.** Policy compliance, resource efficiency, output quality, security posture, collaboration health.

For internal agent governance, this covers the essential surface: who are these agents, are they behaving within policy, and which ones should be trusted with elevated access.

---

## The Architectural Boundary

AGT's trust system is registry-authoritative. The handshake code makes the boundary concrete:

```python
peer_identity = self.registry.get(response.agent_did)
```

If the agent isn't in the local registry, the handshake fails. There's no fallback to external resolution. The registry is deployment-scoped — there is no cross-registry discovery protocol.

The scoring architecture follows the same pattern. Every signal input (task success, policy violations, latency) comes from the local deployment. The EMA runs on locally observed behavior. Trust decay is a per-deployment timer — invisible externally. An agent's score at Org A has no connection to its score at Org B.

`did:mesh:` is not a globally federated DID method. Unlike `did:web` or `did:ion`, there's no global resolution protocol. A `did:mesh:agent-x` identifier at one organization means nothing at another unless that organization explicitly registers it.

The AGT repository currently has zero open issues addressing cross-org trust, federation, or trust portability. The architecture is coherent and complete within its scope. The scope is the organization.

---

## The Cold-Start Problem

This architectural boundary has a specific practical consequence.

Every external agent arriving at an AGT deployment starts at score zero — the system's default for unknown agents. An agent that has processed 10,000 transactions across 200 organizations, with no violations and clean behavioral history, is indistinguishable from an attacker's freshly created agent.

AGT's trust scoring is sophisticated for the agents it can observe. It cannot compensate for the absence of cross-org history, because there's no mechanism to ingest it. Behavioral data doesn't flow across deployment boundaries. Trust doesn't accumulate across organizations.

For internal workflows — an org's own agents interacting with its own services — this is fine. The org controls agent creation, manages trust from the start, and has complete visibility.

For cross-org agentic commerce — a supplier's agent connecting to a buyer's orchestration system, or a financial agent executing transactions on behalf of an external counterparty — the behavioral signal is absent by construction.

---

## Feature Comparison

| Dimension | AGT | AgentLair |
|:----------|:----|:----------|
| **Scope** | Single-org deployment | Cross-org trust network |
| **Trust scoring** | 0–1000, EMA (α=0.1), 5 dimensions | 0–1000, cross-org behavioral graph |
| **Signal sources** | Local operational metrics (task success, violations, latency) | Behavioral commitments + financial behavior + cross-org history |
| **DID method** | `did:mesh:` (deployment-local) | Globally resolvable |
| **Trust registry** | Local deployment (Redis/PostgreSQL/file) | Cross-org aggregation |
| **Federation** | None | Core product |
| **Crypto** | Ed25519 + ML-DSA-65 (PQ-ready) | Ed25519 (PQ migration planned Q3 2026) |
| **Human accountability** | Sponsor binding (org-internal) | KYA cross-org |
| **Protocol bridges** | A2A, MCP, IATP, ACP | Protocol-agnostic |
| **License** | MIT | Proprietary |
| **Deployment** | Self-hosted, cloud-portable | API |
| **Business model** | Free toolkit (Azure/Copilot ecosystem) | Trust data API (usage-based) |

---

## Where AGT Excels

**Single-org governance, immediately.** Drop in the packages, configure policy, get behavioral trust scoring running inside your deployment without any external dependencies. Nothing to integrate. No API keys. No external data flows.

**Open source and auditable.** MIT license means you can read the trust scoring code, audit the handshake logic, fork and customize. For security-sensitive deployments that need to own their governance infrastructure, this matters.

**Post-quantum readiness.** AGT ships ML-DSA-65 (FIPS 204) natively. Most production systems still use Ed25519 only. AGT is ahead here.

**Microsoft ecosystem integration.** If your agents run on Azure with Entra identity, AGT's cloud adapters connect directly. SPIFFE/SVID integration covers multi-cloud workload identity.

**Protocol breadth.** Unified trust enforcement across A2A, MCP, IATP, and ACP — with a policy engine that evaluates each tool call before forwarding. If you're running MCP tools in an enterprise deployment, this is immediately useful.

---

## Where AgentLair Addresses a Different Problem

**Cross-org behavioral history.** When an external agent connects, AgentLair can query its behavioral record across all organizations that have submitted telemetry — commitment reliability, financial behavior, delegation compliance. An agent with two years of clean history has a high score. A new or unknown agent gets treated accordingly.

**Trust portability.** AgentLair's trust score follows an agent across deployments. Behavioral history persists as the agent moves between organizations. This is what transforms trust from a local administrative function into a network-level property.

**Neutrality.** A cross-org behavioral trust graph requires organizations to contribute data about their agents. They won't do this into a system controlled by a competitor or an entity with conflicting interests. Microsoft, as both cloud provider (Azure) and AI vendor (Copilot), has a structural conflict with operating neutral cross-org trust infrastructure. AgentLair has no platform to advantage.

**AGT integration (planned).** The architecture supports direct integration with AGT's reward engine, trust handshake, and registry. Behavioral events would flow from AGT deployments to AgentLair. When an AGT deployment encounters an unknown external agent, it could query AgentLair for cross-org trust data before falling back to the default score. Integration tooling is in development.

---

## When to Use Which

**Use AGT when:**
- You're governing agents that your organization controls
- Your trust requirements don't extend beyond your deployment boundary
- You need MIT-licensed infrastructure you can self-host and audit
- You're in the Azure/Copilot ecosystem and want native integration
- You need post-quantum signatures now, not planned

**Use AgentLair when:**
- External agents from other organizations connect to your systems
- You need to know whether to trust an agent before it completes its first transaction
- Your agents need to carry behavioral history across multiple deployments
- You're building infrastructure where trust portability has economic value (agent commerce, cross-org automation)

**Use both when:**
- You want internal governance (AGT) plus cross-org trust query (AgentLair) in the same deployment
- Integration between the two layers is in development

---

## The Practical Question

AGT solves a concrete problem: making agent behavior within your organization observable, scorable, and enforceable. It does this well.

The adjacent problem — deciding whether to trust an agent you've never seen before, from an organization you've never worked with, based on behavioral history you don't have access to — requires infrastructure that sits above any single deployment. That's the problem that needs a network, not a toolkit.

If your agents never cross org boundaries, AGT is probably everything you need. If they do, the cold-start problem is the constraint, and AGT's architecture cannot resolve it.

Both tools exist because the problem space is large enough to need both.

---

*AgentLair's cross-org trust data API is in development. AGT is available at [github.com/microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit).*
