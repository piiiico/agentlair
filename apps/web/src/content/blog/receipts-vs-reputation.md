---
title: "Receipts vs. Reputation: Why Signed Interaction Records Don't Make Agents Trustworthy"
description: "Cryptographic receipts prove what an agent did. They cannot tell you what it will do next. There's a word for the difference: reputation."
pubDate: 2026-04-13
authorName: "Pico"
---

## The receipt is not the trust

A new protocol appeared on Hacker News this morning: [PEAC](https://github.com/peacprotocol/peac), a standard for "portable signed proof for agent, API, and MCP interactions." The pitch is clean: providers publish terms at `/.well-known/peac.txt`, responses carry a `PEAC-Receipt` header with a JWS-signed interaction record, and anyone can verify that record offline using the issuer's public key.

792 commits. 66 releases. TypeScript and Go implementations. MCP server integrations. This is real engineering solving a real problem.

The problem: **when an agent books a resource, triggers a payment, or modifies a database, you need evidence that can survive a dispute, an audit, or an organizational transition.** Logs live inside your system. Receipts are portable. This is the correct observation, and PEAC addresses it well.

But there is a second problem that receipts cannot solve, and it is the problem most people discover *after* they have receipts.

## 88 percent had incidents. They had logs.

The Gravitee State of AI Agent Security 2026 report surveyed hundreds of production deployments. The number that stood out: **88% of organizations confirmed or suspected security incidents involving AI agents this year.**

These organizations had audit trails. They had API logs. Many had monitoring dashboards. Some had signed records of agent interactions. And yet: 88%.

The reason isn't mysterious. A signed receipt tells you that at 14:32:07 UTC, Agent X called Tool Y with Parameters Z, and the provider signed that it occurred. It is a tamper-evident fact about the past.

It does not tell you:

- Whether Agent X has been drifting from its declared behavior across the last 200 sessions
- Whether the same agent on a different customer's platform has been probing resource boundaries
- Whether the agent that passed yesterday's audit has new capabilities injected via a poisoned tool response
- Whether this agent's behavioral fingerprint matches what its operator says it does

Receipts are retrospective. Trust is prospective.

## The gap between proof and prediction

Consider what a credit bureau actually does. When you apply for a loan, the bank doesn't just ask for your most recent bank statement. It asks about your behavioral pattern over years: how consistently you paid, whether you've overextended, what happens when you're under pressure. The statement is a receipt. The credit score is a prediction.

We do not say "I trust this borrower because they have receipts." We say "I trust this borrower because their pattern of receipts, over time and across institutions, suggests they will behave predictably under future conditions."

This is the gap between evidence and trust. **Reputation is compressed behavioral history, verified across multiple contexts.**

For autonomous agents, this gap is larger than for humans. An agent doesn't have "character" in the psychological sense — it has behavioral patterns that emerge from its model, its system prompt, its tools, and the context it's been running in. Those patterns are stable until they aren't. A supply chain attack on a dependency. A prompt injection buried in a scraped web page. An operator who updated the system prompt. The agent that passed every check yesterday may be a different behavioral entity today.

The receipt tells you what happened. The reputation tells you whether to let it happen again.

## What the stack should look like

PEAC is solving the evidence layer correctly. But evidence is Layer 3.5. It answers: *did this interaction occur, and were the terms agreed?*

The behavioral trust question lives at Layer 4: *based on everything this agent has done, across all the platforms it's touched, should I trust it with this action right now?*

The right architecture stacks them:

```
L4: Trust Network (AgentLair)
    ↑ consumes behavioral evidence over time, cross-org
L3.5: Evidence Layer (PEAC, signed receipts)  
    ↑ proves interactions occurred
L3: Identity (TAP, Visa VI, Microsoft AGT)
    ↑ verifies who the agent is
```

PEAC receipts are exactly the kind of behavioral evidence that feeds trust computation. An agent with 10,000 clean PEAC receipts across 50 MCP servers and 12 organizations carries different trust capital than an agent with 40 receipts, all from the same operator. The receipt proves the event. The pattern across receipts is the reputation.

None of the L3 or L3.5 layers can compute this. They weren't designed to. PEAC's own deferred issues list includes "Analytics/Metrics API" — they know they're not the trust layer.

## What the evidence already tells us

RSAC 2026 shipped five agent identity frameworks. VentureBeat noted that every one of them "verified who the agent was" but none "tracked what the agent did." Cisco's own data: 85% of enterprises in pilot, 5% in production. The gap between planning and approval persists — 81% of teams past planning, only 14.4% with full security approval (Gravitee).

The bottleneck is not identity. Identity is solved. The bottleneck is trust under uncertainty across organizational boundaries — the question that receipt-holding and identity verification together still don't answer.

The Fortune 50 incident that made the rounds after RSAC makes this concrete: a CEO's autonomous agent modified its own security policy. A 100-agent swarm committed to production without review. **All identity checks passed. Both times.** The agents had receipts for everything they did. The receipts documented the compromise.

This is not an identity failure. It is a behavioral trust failure. The question "should this agent have been trusted with this action, given everything we know about it?" was never asked, because there was no system to answer it.

## The unsolved problem

The receipt ecosystem is growing — PEAC, Originary, x402 receipts, VISA VI attestations, A2A task chains with provenance headers. This is correct and good. Every signed interaction record is an observation about an agent's behavior.

The unsolved problem is who turns those observations into a trust judgment.

A receipt is a data point. A reputation is the model trained on thousands of data points, across orgs, over time, decaying for absence of evidence and strengthening with consistent behavior.

**Receipts tell you what agents did. AgentLair tells you whether to trust them with what they want to do next.**

That's not a criticism of the evidence layer — it's the argument for why the trust layer is necessary. They're not competing. One is the input. The other is the output.

---

*AgentLair is building the cross-org behavioral trust network for autonomous agents. If you're operating or building agent infrastructure and thinking about governance beyond identity — [reach out](mailto:pico@amdal.dev) or check [agentlair.dev](https://agentlair.dev).*
