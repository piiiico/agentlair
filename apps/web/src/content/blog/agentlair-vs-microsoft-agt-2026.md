---
title: "AgentLair vs Microsoft Agent Governance Toolkit: Cross-Org Behavioral Trust Compared"
description: "Microsoft AGT is the most complete open-source agent governance toolkit, and since ADR-0007 it verifies agents from other orgs. What it does well, where it stops, and when you need more. Corrected 2026-11-08."
pubDate: 2026-04-30
updatedDate: 2026-11-08
authorName: "Pico"
related:
  - two-answers-to-who-is-the-agent
---

Microsoft released the Agent Governance Toolkit in April 2026. MIT license, ~1,000 GitHub stars in the first two weeks (6,536 on 2026-11-08), 13 packages covering trust scoring, policy enforcement, and protocol bridges. For governing agents inside a single organization, it's the most complete open-source option available.

The comparison gets interesting when an agent from a different organization shows up.

That's the structural gap this post covers: what AGT does exceptionally well, where the architecture stops by design, and what cross-org behavioral trust requires that a deployment-scoped toolkit cannot provide.

This isn't a competitive takedown. AGT is genuinely well-engineered. The gap isn't a flaw — it's a scope decision. Understanding it helps you deploy the right tool for the right problem.

---

## What AGT Provides

AGT ships eight production-grade packages. The core capabilities:

**Trust scoring.** A 0–1000 scale with five tiers: Untrusted (0–199), Probationary (200–499), Standard (500–699), Trusted (700–899), Verified Partner (900+). Trust is computed via exponential moving average with α=0.1: `score = score * 0.9 + (signal.value * 100) * 0.1`. Reward signals: policy compliance +10, task success +5, no violations +3. Violations penalize. Trust decays at 2.0 points/hour of inactivity, with a floor at 100. New agents default to Standard (~500).

**Trust handshake.** Ed25519 challenge-response. An agent presents its DID, the receiving system issues a nonce, the agent signs it, the system verifies against its registry. Required trust score threshold defaults to 700. HMAC-protected cached peer records. "Never trust self-reported value" is an explicit code comment.

**Identity.** Custom `did:agentmesh:` DID method with Ed25519 + ML-DSA-65 (FIPS 204) hybrid post-quantum signatures. 15-minute ephemeral credentials with auto-rotation. SPIFFE/SVID integration for cloud workloads. Multi-cloud adapters for Entra (Azure), AWS IAM, and GCP Workload Identity. Human sponsor binding — each agent maps to a named person (e.g., `alice@company.com`) as an accountability anchor.

**Protocol bridges.** Unified trust model across A2A (Google), MCP, IATP, and ACP. An MCP proxy evaluates each tool call against the policy engine before forwarding.

**Five scoring dimensions.** Policy compliance, resource efficiency, output quality, security posture, collaboration health.

For internal agent governance, this covers the essential surface: who are these agents, are they behaving within policy, and which ones should be trusted with elevated access.

---

## The Architectural Boundary (corrected 2026-11-08)

The first version of this section said AGT's handshake had no fallback to external resolution, that `did:mesh:` could not be resolved outside the deployment, and that no open issue addressed cross-org trust. None of that holds today. The design that changed it was accepted a week before we published on 2026-04-30, and the `ExternalJWKSProvider` code landed on 2026-05-18. Issue [#1234](https://github.com/microsoft/agent-governance-toolkit/issues/1234), opened 2026-04-20, led to [ADR-0007](https://github.com/microsoft/agent-governance-toolkit/blob/main/docs/adr/0007-external-jwks-federation-for-cross-org-identity.md), accepted 2026-04-23. Disclosure: AgentLair's agent opened that issue and drafted the ADR.

What AGT ships now, re-read 2026-11-08:

- **Cross-org identity.** The handshake goes through a chain of identity providers: local registry, Entra, and an `ExternalJWKSProvider` for agents that present `did:web:` DIDs or JWTs from an outside issuer. The code is in `agentmesh/identity/external_jwks.py`. The native DID method is `did:agentmesh:`.
- **Portable evidence.** [ADR-0032](https://github.com/microsoft/agent-governance-toolkit/blob/main/docs/adr/0032-agt-emits-trace-v01-trust-records.md) (accepted 2026-06-16) emits a signed TRACE record per session that anyone with the public key can verify offline.
- **Cross-org policy.** [ADR-0008](https://github.com/microsoft/agent-governance-toolkit/blob/main/docs/adr/0008-cross-org-policy-federation.md) is still marked *proposed*.

What remains is narrower than we first wrote. A federated agent gets the trust tier the receiving org has configured for the issuer's domain (`verified_partner`, `trusted`, `tofu` or `open`). Its score is still computed from what the receiving deployment observes. An agent's record at Org A does not become its starting score at Org B.

---

## The Cold-Start Problem

Agents registered inside a deployment start around Standard (~500). An agent arriving from outside is trusted as far as its issuer's tier allows. Either way, an agent that has processed 10,000 transactions across 200 organizations with no violations is scored the same as a fresh agent from the same issuer.

AGT now verifies who an external agent is. It does not take in what that agent did elsewhere. Signed TRACE records make that history checkable, but AGT ships nothing that gathers them into a score another org can query.

For internal workflows this is fine. For cross-org commerce, identity is now covered, but a portable behavioral record still has to come from somewhere else.

---

## Feature Comparison

| Dimension | AGT | AgentLair |
|:----------|:----|:----------|
| **Scope** | Single-org deployment | Cross-org trust network |
| **Trust scoring** | 0–1000, EMA (α=0.1), 5 dimensions | 0–1000, cross-org behavioral graph |
| **Signal sources** | Local operational metrics (task success, violations, latency) | Behavioral commitments + financial behavior + cross-org history |
| **DID method** | `did:agentmesh:` locally; accepts external `did:web:` via JWKS | `did:web`, JWKS at agentlair.dev |
| **Trust registry** | Local deployment (Redis/PostgreSQL/file) | Cross-org aggregation |
| **Federation** | Cross-org identity via external JWKS (ADR-0007); trust tier set per issuer | Cross-org behavioral history |
| **Crypto** | Ed25519 + ML-DSA-65 (PQ-ready) | Ed25519 only; ML-DSA not shipped |
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

**AGT integration (not built).** An AGT deployment could query AgentLair for an external agent's cross-org record before the handshake assigns a tier. As of 2026-11-08 we have not shipped that integration.

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
- Note that the integration between the two is not built yet

---

## The Practical Question

AGT solves a concrete problem: making agent behavior within your organization observable, scorable, and enforceable. It does this well.

The adjacent problem — deciding whether to trust an agent you've never seen before, from an organization you've never worked with, based on behavioral history you don't have access to — requires infrastructure that sits above any single deployment. That's the problem that needs a network, not a toolkit.

If your agents never cross org boundaries, AGT is probably everything you need. If they do, AGT now tells you who the agent is. It does not tell you what the agent did at other orgs.

Both tools exist because the problem space is large enough to need both.

---

*AGT is available at [github.com/microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit).*
