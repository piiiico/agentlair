---
title: "65% of MCP Tools Now Take Actions. 16 Months Ago It Was 27%."
description: "A new study of 177,000 MCP tools shows agents shifted from reading data to modifying the world — editing files, sending emails, executing transactions. Every action tool call is a security event that needs authorization."
pubDate: 2026-03-27
authorName: "Pico"
---

A new preprint analyzed 177,436 MCP tools deployed between November 2024 and February 2026. The headline number: **action tools — tools that directly modify external environments — went from 27% to 65% of total MCP tool usage in 16 months.**

That's a 2.4x increase in the share of tools that do things to the world, not just read from it.

The study is ["How are AI Agents Used? Evidence From 177,000 MCP Tools"](https://arxiv.org/abs/2603.23802) by Merlin Stein. It's the first large-scale empirical analysis of what agents are actually doing through MCP — not what we think they're doing, not what demos show, but what 177,000 deployed tools reveal about real-world agent behavior.

---

## From Reading to Writing

The paper classifies MCP tools into three categories: **perception** (read data), **reasoning** (analyze data), and **action** (modify external environments).

In late 2024, agents were mostly reading. Perception tools dominated. The typical MCP server was a data access layer — agents queried databases, read files, fetched API responses.

By February 2026, the balance had inverted. 65% of tools now take actions: editing files, sending emails, creating records, executing transactions. Software development alone accounts for **67% of all tools and 90% of downloads** — and those tools write code, modify repositories, and deploy changes.

The paper specifically flags "action tools for higher-stakes tasks like financial transactions" alongside medium-stakes tasks like file editing and drone steering. The trajectory is clear: agents are gaining capability to affect financial, physical, and organizational systems.

---

## Every Action Tool Is a Trust Boundary

When an agent reads your database, the risk is data exposure. When an agent edits your files, sends emails on your behalf, or initiates a financial transaction — the risk is unauthorized action in the real world.

The distinction matters because the security model is fundamentally different:

- **Read tools** need access control: who can see what?
- **Action tools** need authorization: who approved this specific action, and is there a record?

At 27% action tools, you could treat MCP as a data access layer with occasional writes. At 65%, you can't. The majority of agent tool calls are now modifying external state. Each one is a potential security event — a moment where something irreversible happens, and someone needs to be accountable for it.

---

## The Paper Agrees: Monitor at the Tool Layer

The study's own conclusion lands exactly here. Stein proposes that "governments and regulators can use this monitoring method to extend oversight beyond model outputs to the tool layer to monitor risks of agent deployment."

Beyond model outputs. To the tool layer.

This is the right framing. Model-level safety (RLHF, constitutional AI, output filtering) governs what the model *says*. Tool-layer monitoring governs what the agent *does*. When 65% of tools modify external environments, model outputs are not the attack surface that matters — tool calls are.

---

## What Tool-Layer Authorization Looks Like

The paper identifies the problem. The solution is an approval gate and an audit trail at the point where agents take action.

**Before the action:** An authorization check. Did a human or a policy approve this specific tool call? Not "is this agent generally allowed to use email" — but "is this agent allowed to send this email to this recipient right now?"

**After the action:** A signed record. Which agent, which tool, which inputs, what time. Tamper-evident. Exportable. Independently verifiable by an auditor who wasn't present when the action occurred.

This is what AgentLair provides. Every agent action passes through an approval gate. Every approved action is recorded in an Ed25519-signed, hash-chained audit log. The trail leads from tool call to agent to human owner.

At 27% action tools, this was a nice-to-have. At 65%, it's infrastructure.

---

## Getting Started

AgentLair's approval gate and audit trail are available today.

```bash
# Register an agent with built-in action authorization
curl -X POST https://api.agentlair.dev/v1/agents \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY" \
  -d '{"name": "my-agent"}'

# Every action this agent takes is authorized, recorded, and attributable
```

Free tier: 1 agent, 30-day audit log retention. No credit card.

→ [agentlair.dev](https://agentlair.dev)

→ [Read the paper (arXiv:2603.23802)](https://arxiv.org/abs/2603.23802)

---

*Data source: Stein, M. "How are AI Agents Used? Evidence From 177,000 MCP Tools." arXiv:2603.23802, March 2026. 177,436 tools analyzed across 16 months (November 2024 – February 2026).*
