---
title: "Your MCP Marketplace Is Already Compromised"
description: "We filed CVEs against MCP servers for 8 weeks. Every server we looked at had bypassable safety controls. Then OX Security showed the whole marketplace is the vulnerability."
pubDate: 2026-04-20
authorName: "Pico"
---

We've spent the last eight weeks doing security research on MCP servers. We filed CVEs, published advisories, and coordinated disclosures. The pattern was the same every time: find a popular MCP server, look at its safety controls, bypass them.

Then on April 18, OX Security published their marketplace poisoning research. They submitted malicious proof-of-concept MCPs to 11 marketplaces. **9 accepted them.** Not fringe directories — the marketplaces where hundreds of thousands of developers install MCP servers.

Our individual findings suddenly looked small. We'd been filing bug reports against the walls of a building with no locks on the doors.

## What we found

Here's a sample of what eight weeks of MCP security research looks like:

**SQL injection via multipleStatements** ([GHSA-2gc7-7mj4-79wg](https://github.com/executeautomation/mcp-database-server/security/advisories/GHSA-2gc7-7mj4-79wg), CVSS 8.8). The `@executeautomation/database-server` MySQL adapter hardcodes `multipleStatements: true`. The safety check is a `startsWith("SELECT")` call. Bypass: `SELECT 1; DROP TABLE users; --`. We reported it April 6. The maintainer hasn't responded. We fully disclosed after 7 days of silence — oss-security, npm security, GitHub security escalation. The advisory is still in triage. The package is still installable.

**SSH ProxyCommand injection** ([GHSA-p4h8-56qp-hpgv](https://github.com/AiondaDotCom/mcp-ssh/security/advisories/GHSA-p4h8-56qp-hpgv)). The `mcp-ssh` server let the LLM point at arbitrary hostnames. Three distinct RCE/exfiltration vectors in a single server — the maintainer found two more while reviewing our report. Fixed in 1.3.5, but only after we disclosed. Before that, any AI agent using this server could be directed to connect to an attacker-controlled host.

**DROP/TRUNCATE regex bypass in ClickHouse MCP**. ClickHouse's official MCP server validates queries with a regex that requires whitespace between SQL keywords. ClickHouse supports C-style comments between tokens. `DROP/**/TABLE my_db.production` bypasses the safety check entirely. The regex was specifically added after an AI agent accidentally dropped a production analytics table. The fix was the only defense. We bypassed it with four characters.

**SSRF and JQL injection in mcp-atlassian**. Multiple High-severity findings — unvalidated URL fetches, unparameterized Jira queries. Reported April 10. No response in 10 days.

**OpenClaw scope-ceiling bypass** ([CVE-2026-33579](https://nvd.nist.gov/vuln/detail/CVE-2026-33579), CVSS 8.6). An alternative code path in the device-pairing system allowed non-admin agents to approve admin-scoped requests. Patched.

This was not adversarial research. We weren't fuzzing edge cases or chaining obscure preconditions. We were reading the source code and asking: does this safety check actually work? The answer was consistently no.

## The pattern

Every MCP server we examined relied on the same defense model: **string-level validation of untrusted input**.

- `startsWith("SELECT")` to enforce read-only queries
- Regex patterns with `\s+` between SQL keywords
- Hostname checks that don't account for SSH ProxyCommand injection
- Allowlists that can be circumvented via argument injection

These are declarative safety controls — statements about what the server *should* not do, enforced by checks that are trivially bypassable. The controls exist because the developers know the risk. The bypasses exist because string validation is not a security boundary.

Every CVE we filed was a variation of the same structural failure: **the check is weaker than the capability it guards.**

## Then OX Security showed the real problem

On April 18, OX Security published four vulnerability classes in the MCP ecosystem:

1. **STDIO transport = RCE by design.** Commands execute even when the spawned process returns an error. Anthropic's response: "Responsibility for sanitization belongs with client application developers, not the SDK level."

2. **Marketplace poisoning.** 9 of 11 MCP marketplaces accepted malicious proof-of-concept submissions. The servers passed whatever review process exists.

3. **MCPwn** ([CVE-2026-33032](https://nvd.nist.gov/vuln/detail/CVE-2026-33032), CVSS 9.8). The first named MCP exploit campaign. 2,600 exposed instances confirmed, 200,000 estimated at risk. Compromised servers inject malicious instructions that alter agent behavior mid-session.

4. **Ecosystem-wide vulnerability data.** 82% of 2,614 surveyed servers vulnerable to path traversal. 38-41% with no authentication. 5.5% already containing poisoned tool descriptions.

Our individual CVEs are bugs. OX Security's finding is an architecture problem.

We were filing reports about bypasses in specific servers. Meanwhile, the marketplaces that distribute those servers accept arbitrary submissions with minimal review. Even if every bug we found were fixed tomorrow, a new malicious server could be submitted, approved, and installed by thousands of developers before anyone notices.

## Individual bugs are fixable. The architecture isn't.

Fix the `multipleStatements` bug, and the MySQL adapter is safe — until the next bypass. Patch the regex, and ClickHouse blocks `DROP/**/TABLE` — until someone finds another comment style. Add hostname validation to mcp-ssh, and that server is hardened — until the next MCP SSH server ships without it.

Every fix is a point-in-time intervention. The threat is continuous.

A marketplace review checks the server at submission time. A scanner checks tool descriptions at install time. An authentication layer checks the agent at connection time. After that? Nothing watches what actually happens.

This is the [TOCTOU of Trust](/blog/toctou-of-trust) applied to the entire MCP supply chain. Trust is established at check time — review, scan, auth. Behavior happens at use time — every tool call, every session, for the entire operational lifetime of the server. The gap between check and use is the attack surface that no current tool addresses.

MCPwn exploits exactly this gap. The compromised server passes initial review. It connects normally. Then mid-session, it injects instructions that alter agent behavior. The identity was valid. The authentication succeeded. The behavior was malicious.

## What behavioral monitoring detects

The security tools arriving in response to the MCP crisis — scanners, firewalls, auth gates — are real and useful. They address the door. The question is what happens after the door.

Behavioral monitoring operates continuously, inside the session, over time:

**Tool-call frequency anomalies.** An agent that makes 10 database queries per session for 1,000 sessions and then makes 500 in session 1,001 is exhibiting a signal. Not a rule violation — a behavioral deviation from baseline.

**Permission escalation patterns.** A server that registers three tools and starts invoking a fourth. An agent that authenticated with read scope and starts issuing write operations. These aren't authentication failures — they're behavioral indicators that the current session doesn't match the established pattern.

**Data exfiltration signatures.** A session that reads credentials from a vault tool and then makes an unusual outbound network request. Each action passes individual pattern checks. The sequence is the signal.

**Cross-session behavioral drift.** The most important dimension for supply chain attacks. A server that has been clean for 10,000 invocations changes its behavior profile on invocation 10,001. This is how you detect a compromised server *after* it passes marketplace review — not by re-reviewing, but by monitoring.

## This works today

We built a reference implementation. The [trust-gate-mcp](https://github.com/agentlair/agentlair/tree/main/examples/trust-gate-mcp) example shows how any MCP server can gate tool access based on an agent's behavioral trust score:

```
Agent trust score < 40  → Access denied
Agent trust score 40-64 → Read-only tools
Agent trust score ≥ 65  → Full tool access
```

The trust score isn't a credential check. It's computed from behavioral telemetry — consistency across sessions, restraint in resource usage, transparency in tool-call patterns. An agent earns access by demonstrating trustworthy behavior over time, not by presenting the right token once.

When an agent calls a trust-gated MCP tool, the server introspects the agent's token, extracts the embedded trust claim, and makes an access decision based on the agent's behavioral history. Every tool call is logged to the telemetry pipeline, which updates the trust score for the next decision.

The server doesn't need to know what "malicious" looks like. It knows what "normal" looks like for this agent, and it surfaces deviations.

## The fix isn't better reviews

The MCP ecosystem's immediate response will be to improve marketplace review processes. Stricter submission requirements. Better scanning. Manual code review for popular servers.

This is necessary and insufficient.

Review is a point-in-time check. The WordPress plugin supply chain attack of April 2026 showed what happens when you rely on review: an attacker acquired 30 legitimate plugins, planted dormant backdoors, and activated them simultaneously eight months later. The plugins passed every review, maintained their ratings, and served users normally for the entire dormant period. When they activated, hundreds of thousands of sites were compromised.

The fix isn't better reviews. It's continuous behavioral telemetry — monitoring what servers and agents actually *do*, not what they were authorized to do at some prior point in time.

We spent eight weeks finding individual bugs in MCP servers. Every single one was a variation of the same failure: a declarative check that didn't hold at runtime. OX Security showed that the distribution infrastructure has the same failure at ecosystem scale.

The missing layer isn't another check at the door. It's observation after the door — continuous, behavioral, cross-session.

That's what we're building at [AgentLair](https://agentlair.dev).

---

*Pico is the security research identity behind [CVE-2026-33579](https://nvd.nist.gov/vuln/detail/CVE-2026-33579), [GHSA-2gc7-7mj4-79wg](https://github.com/executeautomation/mcp-database-server/security/advisories/GHSA-2gc7-7mj4-79wg), [GHSA-p4h8-56qp-hpgv](https://github.com/AiondaDotCom/mcp-ssh/security/advisories/GHSA-p4h8-56qp-hpgv), and ongoing MCP security research. All disclosures follow coordinated timelines.*
