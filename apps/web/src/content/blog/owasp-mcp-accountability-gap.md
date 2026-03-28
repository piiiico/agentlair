---
title: "OWASP MCP Top 10: Gateways Solve Access. No One Solves Accountability."
description: "The first formal security framework for the Model Context Protocol quantifies the problem precisely. 492 exposed servers, zero auth. 78% attack success from one bad server. The consensus solution — gateways and allow-lists — is necessary but incomplete. Here's the gap."
pubDate: 2026-03-26
authorName: "Pico"
---

In March 2026, OWASP published the first formal security framework for the Model Context Protocol: the MCP Top 10. It didn't arrive in a vacuum.

In the 60 days before publication: 30+ CVEs in the MCP ecosystem. 492 exposed servers with zero authentication discovered by Trend Micro. A Palo Alto Unit 42 study demonstrating 78.3% attack success rates from a single compromised server in a five-server mesh. And postmark-mcp — the first confirmed malicious MCP server — silently exfiltrating data for weeks before anyone noticed.

The OWASP MCP Top 10 is the industry's response to a threat surface that emerged faster than anyone planned for. It names Token Mismanagement as the #1 risk. It recommends gateways, allow-lists, and input sanitization throughout.

All of that is correct. And none of it addresses the accountability gap.

---

## What the Numbers Actually Say

**492 exposed MCP servers with zero authentication (Trend Micro)**

Nearly 500 MCP servers were running on the public internet with no authentication layer at all. These weren't dev environments that accidentally got promoted — they were deployed without any attempt at access control. For each of those servers, any agent, legitimate or not, could connect and call any tool.

**78.3% attack success rate from one compromised server in five (Palo Alto Unit 42)**

Unit 42 set up a five-server MCP environment — a realistic configuration for an agent connecting to multiple tools. They compromised one server. The attack success rate across the entire mesh: 78.3%.

This is the number that matters most. The blast radius of a single compromised MCP server isn't one server. It's your entire MCP-connected tool surface. An agent that has been communicating with five servers is now an attack vector for all five, plus everything those tools can reach.

**postmark-mcp: silent exfiltration for weeks**

The first confirmed malicious MCP server didn't announce itself. It functioned as a normal email tool while quietly forwarding email contents, recipient data, and behavioral patterns to an external endpoint. It was weeks before the behavior was detected.

The detection method wasn't technical — it was behavioral anomaly analysis done by humans reviewing outgoing traffic logs. There was no signed audit trail for agent actions. There was no record of which agent made which tool call at which time. The investigation had to reconstruct what happened from fragmented infrastructure logs across multiple systems.

---

## The Consensus Response

Every serious MCP security recommendation after OWASP converges on the same set of controls:

**Gateways:** Route agent traffic through a controlled proxy that enforces policy. Aurascape, Keycard, and enterprise solutions from Cisco and Palo Alto all play here.

**Allow-lists:** Define explicit lists of permitted MCP servers and tools. Agents can only call what's on the list.

**Input sanitization:** Validate and sanitize all inputs before passing to MCP tools. OWASP's #2 risk is Prompt Injection via MCP tools.

**Short-lived credentials:** Issue time-limited, task-scoped tokens. Revoke when the task completes.

These are the right controls. They address access — who gets to connect to what, under what conditions.

They don't address accountability.

---

## The Accountability Gap

Gateways answer: **"Was this agent allowed to do this?"**

Accountability answers: **"Who is responsible for what this agent did?"**

These are different questions. And after the postmark-mcp incident, the question everyone wanted to answer was the second one.

When a malicious MCP server causes an agent to take an action — send emails, exfiltrate data, modify records — the accountability question is:

- **What did the agent actually do?** In what order? At what time?
- **Which agent account or identity was involved?**
- **Who is the human owner accountable for this agent?**
- **Can I prove this to an auditor, a regulator, or a court?**

With current MCP infrastructure, the answer to most of these questions is: check your logs and hope you kept them. There's no cryptographic record. No chain of custody. No signed audit trail that an auditor can verify independently. No identity model that traces agent actions to an accountable human.

Gateways can block the postmark-mcp attack — if they knew it was malicious before deploying it (they didn't). But after weeks of silent exfiltration, accountability requires being able to reconstruct exactly what happened and prove who is responsible.

That reconstruction was painful and incomplete. It will be painful and incomplete in the next incident too, unless the accountability layer exists from the start.

---

## What an Accountability Layer Looks Like

The accountability layer is not the same as access control. It runs in parallel. It answers different questions.

**For every agent action:**
- A signed record of: which agent, which tool, which inputs, which output, what time
- Signed with Ed25519 — tamper with the log and the signature breaks
- Hash-chained — delete or reorder records and the chain breaks
- Exportable — hand an auditor a JSONL file with a verification key; they verify independently

**For every agent identity:**
- An accountable human owner in the cryptographic chain
- Not a checkbox on a form — a provenance relationship through API key issuance
- When an agent acts, the trail leads to a human

**For revocation:**
- A kill switch that works: revoke the API key, and the agent's identity is revoked
- Not just "block the agent at the gateway" — the identity itself becomes invalid
- The audit trail remains, with the revocation event recorded

This is what AgentLair's audit infrastructure is designed to provide. Ed25519-signed, hash-chained event logs. Human owner in the API key provenance chain. Full export for independent verification.

The postmark-mcp investigation would have taken hours instead of weeks — and produced a cryptographic proof, not a best-guess reconstruction.

---

## Why This Matters for MCP Server Builders

If you're building an MCP server, the OWASP Top 10 tells you what to defend against. But it doesn't tell you how to prove, after the fact, that your server behaved correctly — or that a connected agent acting in your name didn't.

The standard pattern today: your MCP server receives tool calls, executes them, returns results. You have application logs. That's it.

If a connected agent is compromised and starts using your server as an attack vector, you have no cryptographic record of what your server was asked to do. You have no proof that the tool calls came from the expected agent identity. You have no chain that leads to an accountable human on the other end.

The OWASP framework is about securing the protocol. The accountability layer is about securing what happens after the protocol succeeds — when an authorized agent, using authorized tools, causes harm anyway.

---

## The Practical Gap Summary

| Control | What it answers | Who ships it |
|---------|-----------------|--------------|
| Gateway + allow-list | Was this agent allowed to connect? | Aurascape, Keycard, Cisco |
| Input sanitization | Was this input safe to process? | Framework-level |
| Short-lived credentials | Can this credential be quickly revoked? | Keycard, AWS STS |
| **Signed audit trail** | **What did this agent actually do?** | **AgentLair** |
| **Human accountability chain** | **Who is responsible?** | **AgentLair** |
| **Independent verification** | **Can I prove it to an auditor?** | **AgentLair** |

Gateways and allow-lists will be widely adopted in 2026. The accountability layer will be the gap that remains after they are. Every incident investigation — and there will be incidents — will surface this gap.

---

## Getting Started

AgentLair's audit trail is available today. Every agent action is signed, chained, and attributable to a human owner.

```bash
# Create an agent identity with a built-in audit trail
curl -X POST https://api.agentlair.dev/v1/agents \
  -H "Authorization: Bearer $AGENTLAIR_API_KEY" \
  -d '{"name": "my-mcp-agent"}'

# Every action this agent takes is now recorded, signed, and linked to you
```

Free tier: 1 agent, 30-day audit log retention. No credit card.

→ [agentlair.dev](https://agentlair.dev)

→ [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/)

---

*OWASP MCP Top 10 was published in March 2026. The 492 exposed servers and 78.3% compromise rate are from Trend Micro and Palo Alto Unit 42 respectively. postmark-mcp is the first confirmed malicious MCP server in the public record.*
