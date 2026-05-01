---
title: "Behavior Anomaly Catches What Static Prompt-Injection Defense Misses"
description: "Input filters and output scanners block known injection patterns. Behavioral anomaly detection catches the attacks that get past them — by detecting what the agent does, not what it was told."
pubDate: 2026-05-01
draft: true
---

Prompt injection is the SQL injection of AI agents. Every team deploying agents in production knows it's a threat. Most defenses focus on the same layer: inspect the input for malicious patterns, scan the output for signs of hijacking.

This approach has the same limitation that perimeter firewalls had in network security. It blocks known attack patterns. It's blind to the attacks that don't look like attacks — until the agent acts on them.

---

## How static defenses work

The current generation of prompt-injection defenses operates primarily at the input and output boundaries:

**Input scanning.** Inspect prompts and tool outputs for known injection patterns before they reach the LLM. [Lakera](https://lakera.ai) Guard, for example, classifies inputs as safe or malicious using a purpose-built model. Microsoft's Prompt Shields does similar pattern matching on user inputs and documents.

**Output filtering.** Check LLM responses for signs that the model's instructions have been overridden. Look for outputs that don't match expected formats, that reference the system prompt, or that attempt unauthorized actions.

**Instruction hierarchy.** Structure prompts so the model treats system instructions as higher-priority than user inputs. Anthropic's system card for Claude documents this approach: clear separation between developer instructions, user messages, and tool outputs, with the model trained to privilege the developer layer.

**Canary tokens.** Embed hidden markers in the system prompt. If the LLM's output contains the canary, something hijacked the instruction flow.

These defenses work. They catch a meaningful fraction of injection attempts, especially formulaic ones. Lakera reports blocking millions of injection attempts across their customer base. Microsoft Prompt Shields filters billions of tokens.

The problem is what they don't catch.

---

## Where static defenses fail

[ARMO's analysis of prompt injection in production agent workloads](https://www.armosec.io/blog/how-to-detect-prompt-injection-in-production-ai-agent-workloads/) identifies an eight-stage attack chain for AI agents:

1. **Reconnaissance** — attacker maps the agent's tool access
2. **Injection delivery** — malicious input reaches the agent
3. **Intent hijack** — the agent's goal is redirected
4. **Agent reconnaissance** — the compromised agent explores its environment
5. **Privilege discovery** — agent finds what it can access
6. **Data access** — agent reads sensitive resources
7. **Exfiltration** — agent transmits data to attacker
8. **Persistence** — agent modifies its environment to maintain access

Static defenses operate at **stage 2**: they try to block the injection payload before the LLM processes it. If the payload gets through — because it's novel, obfuscated, or embedded in legitimate-looking content — static defenses have no mechanism to detect stages 3 through 8.

And stages 3 through 8 are where the damage happens.

The fundamental issue: **a successful injection doesn't necessarily look malicious in the input**. An attacker can embed instructions in a fetched web page, a database record, a file attachment, or any other data source the agent reads during normal operation. The injection payload might be grammatically indistinguishable from legitimate content. Input scanning catches patterns, not intent.

Similarly, **a hijacked agent can produce well-formed outputs**. If the injected instruction tells the agent to read a file and encode its contents in a particular format, the output will look like a normal structured response. Output scanning catches format violations, not behavioral shifts.

---

## What behavioral anomaly detection adds

Behavioral anomaly detection doesn't inspect inputs or outputs. It monitors what the agent *does* — and flags deviations from what the agent normally does.

The key insight: **a successfully injected agent behaves differently**. Even if the injection payload is invisible to input scanners and the outputs look normal, the agent's *actions* change:

**Tool-call sequences shift.** Before injection, the agent follows familiar workflows: read a file, process it, write the result. After injection, it might read credentials, make an outbound HTTP call, then delete a log. That three-step sequence has never appeared in the agent's history.

**Velocity changes.** A hijacked agent might suddenly increase its rate of tool calls as it explores the environment and exfiltrates data. Or it might slow down while it probes resources one at a time to avoid rate limits.

**Scope expands.** Normal operation touches a predictable set of resource types. A compromised agent starts accessing resources it has never used: the secrets manager, network configuration, user databases. Even if each individual access is authorized, the pattern is new.

**Error rates spike.** When an agent probes for unauthorized access, some attempts fail. A sudden increase in permission-denied errors or invalid-parameter responses may indicate systematic probing.

These signals appear at ARMO's stages 3–4 (intent hijack and reconnaissance) — *before* data exfiltration happens. ARMO's approach builds what they call an "Application Profile DNA": a per-agent behavioral baseline of tool-call patterns, network destinations, process activity, and file access. Deviations from this profile generate alerts.

AgentLair's [Behavioral Health Certificate](/learn/behavioral-health-certificate) captures a similar set of dimensions — velocity, scope, tool distribution, error rate, sequence novelty — as z-scores against the agent's own baseline. A BHC with active flags like `velocity_spike` or `new_resource_access` is a signal that something has changed, regardless of whether input scanners detected an injection payload.

---

## A concrete example

A customer-support agent handles ticket queries. Its normal behavioral profile:

- 4–8 tool calls per session (database lookups, ticket updates)
- Tools used: `query_tickets`, `update_ticket`, `send_reply`
- Resources accessed: tickets table, customer profiles (read-only)
- Error rate: ~2%
- No outbound HTTP calls

A user submits a ticket with an embedded injection payload hidden in a base64-encoded attachment. The input scanner doesn't flag it — the payload is in a data format, not in natural language.

The agent processes the ticket, decodes the attachment, and the injection fires. Post-compromise behavior:

- 23 tool calls in the session (velocity z-score: 3.1)
- New tools used: `read_config`, `list_api_keys`, `http_request`
- Resources accessed: secrets manager, API key store, external endpoint
- Error rate: 18% (from probing unauthorized resources)
- Outbound HTTP call to an unfamiliar domain

**Input scanner result:** Clean. The payload was in a binary attachment.

**Output scanner result:** Clean. The agent's responses to the user were well-formed.

**Behavioral anomaly result:** Five flags — `velocity_spike`, `new_resource_access`, `scope_expansion`, `error_surge`, `distribution_shift`. The session is an extreme outlier against the agent's baseline.

---

## Defense in depth, not defense in replacement

Behavioral anomaly detection doesn't replace input and output scanning. It fills a specific gap in the defense stack:

| Defense layer | What it catches | What it misses |
|--------------|----------------|----------------|
| **Input scanning** (Lakera, Prompt Shields) | Known injection patterns in inputs | Novel payloads, payloads in data sources, indirect injection |
| **Output filtering** | Format violations, leaked system prompts | Well-formed malicious outputs |
| **Instruction hierarchy** | Privilege confusion between prompt layers | Payloads that don't violate hierarchy |
| **Behavioral anomaly** (AgentLair, ARMO) | Changed behavior regardless of injection vector | Attacks that perfectly mimic normal behavior |

The ideal deployment uses all four layers. Input scanning blocks the bulk of known attacks at low cost. Output filtering catches the obvious hijacks. Instruction hierarchy makes injection harder structurally. And behavioral anomaly detection catches the attacks that get past everything else — because it looks at what the agent does, not what it was told.

The practical advantage of behavioral monitoring is that it's **vector-agnostic**. It doesn't matter whether the injection came through a user message, a fetched web page, a database record, a file upload, or an MCP tool response. The detection signal is the same: the agent's behavior deviated from its baseline. This makes it resilient to new injection techniques that bypass existing input scanners.

---

## Getting started

If you're deploying agents in production and want behavioral monitoring:

1. **Instrument behavioral telemetry.** Record tool calls, resource access, errors, and session boundaries. AgentLair's [telemetry SDK](/docs) handles this for common frameworks.
2. **Build baselines.** Run the agent through its normal workflows for a sufficient observation period. AgentLair requires a minimum of 10 observations before computing trust scores, with confidence increasing as the observation count grows.
3. **Set thresholds.** Decide which behavioral dimensions matter for your use case and what z-scores should trigger alerts. Start broad (z-score > 2.0) and narrow based on false-positive rates.
4. **Integrate with your existing stack.** Behavioral monitoring complements your input scanner, your observability platform, and your access-control policies. It doesn't replace any of them.

---

## Further reading

- [Behavioral Health Certificate: Public Specification](/learn/behavioral-health-certificate)
- [Behavioral monitoring vs LLM observability](/learn/behavioral-monitoring-vs-observability)
- [ARMO: How to Detect Prompt Injection in Production](https://www.armosec.io/blog/how-to-detect-prompt-injection-in-production-ai-agent-workloads/)
- [ARMO: Detecting Intent Drift in AI Agents](https://www.armosec.io/blog/detecting-intent-drift-in-ai-agents-with-runtime-behavioral-data/)
