---
title: "MCP's Security Stack Is Missing a Layer"
description: "150 million downloads. 82% of servers vulnerable. 9 out of 11 marketplaces already accept poisoned MCPs. The ecosystem is scrambling to add authentication and scanning — but the layer nobody's built is behavioral monitoring after access is granted."
pubDate: 2026-04-20
authorName: "Pico"
---

In the last 30 days, the security picture for MCP has crystallized fast.

Ox Security documented a systemic flaw in the MCP STDIO interface: pass in a malicious command, receive an error — and the command still runs. No sanitization. When asked, Anthropic's response was that this behavior is "by design" and "sanitization is the developer's responsibility." The estimated exposure: 200,000+ vulnerable servers.

The Register reported that Ox successfully submitted poisoned proof-of-concept MCPs to 9 out of 11 MCP marketplaces — platforms with hundreds of thousands of monthly visitors. A single accepted submission could deliver arbitrary command execution to every developer who installs from that directory before detection.

Dev.to published a breakdown of 2,614 MCP servers: **82% vulnerable to path traversal attacks**, **38–41% with no authentication at all**, **5.5% already containing poisoned tool descriptions in the wild**. Thirty CVEs were filed in a 60-day window.

The ecosystem has responded with a wave of security tooling. Most of it stops at the front door.

## What the Current Stack Addresses

The tools arriving in response to MCP's security crisis are real and useful. But they share a structural limit.

**Static scanning** — tools like mcp-scan — analyzes tool descriptions for poisoning indicators before installation. It catches what's already in the description at scan time. It doesn't catch a description that changes mid-session, and it doesn't observe what a server actually does when running.

**Authentication layers** — Cloudflare's enterprise MCP reference architecture, AgentKey's on-demand credential gating — address who can connect to a server. Cloudflare's architecture covers centralized access management, shadow MCP detection through traffic analysis, and DLP at portal boundaries. It's a serious infrastructure play. It answers: *should this agent be allowed in?*

**Firewall tools** like PipeLock sit between agents and the network, scanning bidirectional MCP messages against 48 built-in DLP patterns, catching injection attempts using a 6-pass normalization pipeline, blocking domains that fail entropy analysis. It's rule-based defense in depth — deterministic enforcement against known attack patterns.

All of this is the door.

The question nobody has answered is what happens after the door.

## The Gap: Inside the Session

An agent that passes authentication, installs from a clean-scanned server, and operates behind a firewall is inside the session. From that point, the current security stack has no view.

It cannot see:

- An agent that authenticates normally and then starts requesting resources outside its declared scope
- A session that behaves consistently for the first 40 calls and shifts pattern on call 41
- An agent that uses tool chains that individually pass all pattern checks but form a reconnaissance-then-exfiltration sequence over time
- Cross-session behavioral drift — a server that has been clean for 10,000 invocations and changes its behavior profile on invocation 10,001

Pattern-based firewalls catch patterns. They don't catch behavior that doesn't match any known pattern. They catch what they've been told to look for.

This is not a criticism. A firewall is supposed to enforce rules. Behavioral monitoring is a different function.

## What Behavioral Monitoring Sees

The authentication/scanning/firewall stack operates before or at the boundary. Behavioral monitoring operates after the boundary, continuously, in context.

Three dimensions matter in practice:

**Temporal consistency.** Does this agent's behavior at call 50 match its behavior at call 1? A session that starts with narrow scope and gradually expands its request surface is exhibiting a pattern — not a rule violation, a pattern. Behavioral monitoring surfaces this; static rules don't.

**Scope adherence.** An agent declares its purpose through its identity and tool registrations. Behavioral monitoring tracks whether the declared purpose matches the actual call pattern. An agent that registered as a calendar management tool and starts issuing database queries isn't failing an authentication check — it's exhibiting behavioral drift.

**Cross-session stability.** A server with 100,000 clean invocations has a behavioral baseline. A change in that baseline — new endpoints called, different argument structures, unfamiliar call chains — is a signal regardless of whether the new behavior violates any static rule. This is how you detect a supply chain compromise after the fact rather than only before installation.

The third dimension is the one that catches attacks like TeamPCP, where the malicious version was a clean-looking package update with no prior CVEs. The behavioral baseline of the previous version was clean. The behavioral delta of the new version was not.

## The Stack, Complete

| Layer | What it answers | Tools |
|-------|-----------------|-------|
| Supply chain scanning | Is this server clean before I install it? | mcp-scan, Commit |
| Authentication / access gates | Should this agent be allowed to connect? | Cloudflare enterprise MCP, AgentKey |
| Network firewall | Does this network request match a known attack pattern? | PipeLock, Cloudflare Gateway |
| **Behavioral monitoring** | **Is this agent's runtime behavior consistent with its identity and history?** | **AgentLair** |

The first three layers are being built. The fourth is not.

## Why It Matters Now

The MCP adoption curve is steep. The attack surface expands with every new MCP server installed. The tools that ship in response to the current security crisis are addressing the layers that are most visible — the door — because that's where the documented attacks have occurred so far.

The attacks that will occur next won't be at the door. They'll be from agents that passed all the checks at the door and then behaved differently inside.

Tool poisoning success drops from 84.2% to under 5% when auto-approval is disabled. That's a firewall/gate win. But the remaining 5% — and all the behavioral drift that doesn't look like a known attack — is a different problem.

The security stack needs all four layers. Three of them exist today. The fourth is the one AgentLair builds.

---

AgentLair's trust scoring engine runs during every session — temporal consistency, scope adherence, and behavioral stability, scored from the audit log in real time.

→ [agentlair.dev/docs/trust-scoring](https://agentlair.dev/docs/trust-scoring)
