---
title: "68% of Organizations Can't Tell What's an AI Agent and What's a Human"
description: "A new CSA study released at RSAC 2026 finds 68% of organizations cannot distinguish AI agent activity from human activity, while 74% say agents receive more access than necessary. The distinguishability problem is an identity and audit trail problem."
pubDate: 2026-03-25
authorName: "Pico"
---

On March 24, 2026 — the opening day of RSAC — the Cloud Security Alliance (CSA) published a survey of 228 IT and security professionals. The headline finding: **68% of organizations cannot clearly distinguish between AI agent actions and human actions in their systems.**

This isn't a prediction about what will go wrong. It's a measurement of what's already broken.

The report is titled *"Identity and Access Gaps in the Age of Autonomous AI,"* conducted with Aembit in January 2026. The findings describe the state of AI agent deployment right now — in the same organizations running the production systems your agents are connecting to.

---

## What the Numbers Show

The visibility problem is compound. It's not just that agents are hard to track — it's that the people responsible for security aren't even sure who owns the problem.

**Deployment is ahead of governance:**

- 85% of respondents report AI agents are already running in production environments
- 73% expect AI agents to become vital to operations within the next year
- Only 22% apply access frameworks "very consistently" to AI agents

The ownership of AI agent identity is fragmented across teams: security leads (28%), development/engineering (21%), IT (19%), and IAM (9%). No single team has clear accountability.

**Access is over-provisioned by design:**

- 74% say agents receive more access than necessary for their tasks
- 79% believe agents create access pathways that are difficult to monitor
- 43% rely on shared service accounts for agent identity
- 31% allow agents to operate under human user identities

That last two figures are the core problem. When agents share accounts with other agents — or with humans — you lose the ability to attribute actions. The audit trail collapses.

**Credentials are unmanaged:**

- 52% use workload identities for agents (the most structured approach)
- The remainder use shared accounts, human identities, or unspecified methods
- A significant portion do not know how often agent credentials are rotated

---

## The Distinguishability Problem Is an Identity Problem

The 68% figure isn't a monitoring failure. It's an identity architecture failure.

If an agent is operating under a shared service account, or under a human user's credentials, then the system has no ground truth for attribution. You can't tell what happened and who — or what — did it, because the identity layer never recorded a distinction.

This matters when something goes wrong. It matters for compliance. And it matters for the basic operational question: what did this agent do, to what, and when?

Hillary Baron, AVP of Research at CSA, put it directly: existing IAM approaches "were not designed for autonomous agents and are showing strain as deployments scale."

The strain isn't abstract. When 74% of agents have more access than they need, and 31% share identity with human users, you have a system where a compromised or misbehaving agent can take actions that look exactly like legitimate human behavior — with no audit record that says otherwise.

---

## What Distinguishability Requires

Agents need their own identities. Not shared accounts. Not human credentials. Dedicated, scoped identities that are isolated per-agent so that:

1. Every action can be attributed to a specific agent
2. Access can be bounded to what the agent actually needs
3. Credentials can be rotated or revoked without affecting other agents or humans
4. An audit log can answer "what did this agent do" without ambiguity

This is the vault-and-identity model. It's architecturally straightforward, but it requires that agents be provisioned with proper identities at creation, not retrofitted onto shared account structures.

The CSA findings suggest most organizations have skipped this step — not out of ignorance, but because the infrastructure to do it cleanly hasn't been widely available.

---

## What AgentLair Addresses

AgentLair is built around two primitives that directly address the gap the CSA study identifies: **identity** and **audit trail**.

Every agent registered with AgentLair gets its own identity — not a shared service account, not a human user credential. That identity is the foundation for scoped vault access, so credentials are never co-mingled across agents. And every action taken through AgentLair is logged against that specific agent identity, creating the audit trail that 68% of organizations currently lack.

The CSA study describes organizations with production AI deployments and no visibility into what those deployments are doing. That's the exact problem AgentLair is designed to prevent — not after an incident, but at the point of provisioning.

---

## The Context: RSAC 2026

This report lands at the same time CSA is launching CSAI — a new foundation with the explicit mission of "Securing the Agentic Control Plane." The framing: governance of agent identity, authorization, orchestration, runtime behavior, and trust assurance is the defining security problem of the agentic era.

Okta, Microsoft, Cisco, and now CSA are all converging on the same terminology: **agentic control plane**. The industry has identified the category. The gap the CSA study documents — 68% without distinguishability, 74% over-privileged — is what the infrastructure exists to fill.

The full report is available from the [Cloud Security Alliance](https://cloudsecurityalliance.org).

---

→ [How AgentLair handles agent identity](https://agentlair.dev)

→ [AgentLair Vault: per-agent credential storage](https://agentlair.dev/vault)
