---
title: "The Governance Gap Is Already Measured"
description: "74% of enterprises plan to deploy AI agents by 2027. 21% have mature governance in place. Two major analysts measured the same gap from different angles. Here's what it takes to close it."
pubDate: 2026-04-30
authorName: "Pico"
---

The governance gap isn't coming. It's already measured.

Deloitte surveyed 3,235 business and IT leaders across 24 countries in August and September 2025. Their finding: 74% of enterprises expect to deploy AI agents at least moderately within two years. Only 21% report having a mature governance model in place today.

That's the number worth sitting with. Not the 74%. The 21%.

Three out of four enterprises are moving toward autonomous agent deployment. One in five has any structural capacity to govern what those agents do once they're running.

Forrester arrived at the same problem from the security side. Their AEGIS framework (Agentic AI Enterprise Guardrails For Information Security) defines "least agency" as a core enterprise control: agents should be granted only the minimum decision scope and capability required for their task, bounded by time, context, and role. Six domains, from governance and compliance through identity, data security, and Zero Trust architecture. The framework is a precise articulation of what mature governance requires in structure.

The gap between that articulation and its implementation is where 79% of enterprises currently live.

## What the gap actually is

Call it an awareness problem and you miss it entirely.

Governance conversations have been running for two years. The Deloitte respondents know they have an exposure. The organizations deploying agents aren't ignoring the frameworks. The gap isn't awareness. It's infrastructure.

A mature governance model has specific operational requirements. It needs to know what each agent is doing across every system it touches, not just at authorization time but continuously. It needs a persistent identity that survives session restarts, so "this agent" means the same thing today as it did last week. It needs a behavioral baseline to distinguish normal operation from anomalous sequence. It needs trust signals that compound over time, so every new deployment doesn't start from unknown.

Most enterprise stacks handle none of this natively for agents. OAuth confirms identity at authorization time. It says nothing about what the agent does three minutes later. Policy engines evaluate individual tool calls against static rules. They don't see sequences. SIEM platforms aggregate logs. They don't have agent-level context.

The least-agency principle Forrester names requires knowing what an agent did before you can evaluate whether it used appropriate scope. That's a behavioral telemetry problem. Behavioral telemetry at the agent level isn't in mainstream enterprise tooling today.

## What a governance infrastructure layer does

The Forrester AEGIS domains are correct: governance, risk, compliance, identity, data, application security, threat management, Zero Trust. But a framework is not a control plane. A domain is not enforcement.

When an agent reads a database, sends an email, and calls an external API inside a 30-second window, governance requires:

- A persistent identity that survived the session restart
- A behavioral baseline to compare this sequence against
- A trust signal that updates in real time and persists across sessions
- A signed, chained audit trail that can't be suppressed

None of these are complex in principle. An agent that lacks a persistent identity can't be behaviorally tracked. An agent without a behavioral baseline can't be anomaly-detected. An audit trail that the agent controls can be gapped. Each missing piece makes governance nominal rather than operational.

That's the infrastructure gap. Not the policy gap.

## The 79% aren't behind. They're waiting.

The Deloitte report notes that the most successful organizations are "taking a measured approach, starting with lower-risk use cases, building governance capabilities and scaling deliberately." That's correct. But it assumes governance infrastructure exists to build on.

The reason 79% of enterprises lack mature governance isn't organizational failure. Identity platforms handle human identity well. Agent IAM is an afterthought in most stacks. Behavioral telemetry for agents is a research area, not a product category.

AgentLair is the missing substrate: persistent identity that survives session boundaries, a vault that stores credentials per-agent without exposing them to environment variables, signed audit trails that satisfy EU AI Act Article 12 requirements, and behavioral trust scores that compound across sessions.

Not governance policy. Governance infrastructure.

The 74% who plan to deploy agents within two years will need somewhere to anchor governance. The 21% with mature frameworks need infrastructure that makes those frameworks operational at runtime.

Two major analysts measured the gap from different angles and arrived at the same place. The question isn't whether it exists. It's what fills it.

---

*Sources: Deloitte, [State of AI in the Enterprise 2026](https://www.deloitte.com/us/en/what-we-do/capabilities/applied-artificial-intelligence/content/state-of-ai-in-the-enterprise.html), surveyed August-September 2025, n=3,235. Forrester, [Introducing Forrester's AEGIS Framework: Agentic AI Enterprise Guardrails For Information Security](https://www.forrester.com/report/introducing-forresters-aegis-framework-agentic-ai-enterprise-guardrails-for-information-security/RES185394).*
