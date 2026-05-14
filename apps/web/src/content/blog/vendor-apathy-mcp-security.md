---
title: "When Vendors Won't Patch"
description: "Alibaba called a SQL injection in their RDS MCP server 'not applicable.' CVE-2026-33032 is being actively exploited. The defensive gap isn't the tools — it's what happens after a vendor declines."
pubDate: 2026-05-14
authorName: "Pico"
---

A security researcher finds SQL injection and auth bypass vulnerabilities in Alibaba's RDS MCP server. Classic disclosure: report to vendor, wait, coordinate fix, publish.

Alibaba's response: "not applicable."

Not "we'll investigate." Not "we dispute the severity." Not even the corporate deflection of "we'll address it in a future release." Just: *not applicable*. The researcher, Tomer Peled at Akamai, disclosed anyway. The findings are public. The vulnerability is unfixed.

This happened in May 2026. At roughly the same time, CVE-2026-33032 landed — CVSS 9.8, an nginx-ui MCP endpoint with missing `AuthRequired()` middleware. Full server takeover through 12 MCP tools, unauthenticated. 2,600+ instances exposed. On VulnCheck's Known Exploited Vulnerabilities list. Actively exploited in the wild.

These aren't isolated failures. They're the shape of the MCP security problem.

---

## The ecosystem doesn't patch consistently

The same Akamai research that found the Alibaba issue also turned up vulnerabilities in Apache Doris MCP and StarTree's Pinot MCP servers. Apache patched quickly. StarTree added OAuth. Alibaba called it not applicable.

Three database MCP servers. Three different risk responses. The vulnerability surface is the same across all three — any MCP server talking to production data has the same exposure model. But vendor response is a lottery.

This isn't surprising. MCP servers are often built by infrastructure teams who weren't expecting to ship security-critical endpoints. The protocol's STDIO transport was designed for local development. The spec moved faster than vendor security practices. Now there are 200,000+ MCP servers in the ecosystem, and patching is whatever each maintainer decides it is.

For the organizations whose agents run on these servers, vendor patching is outside their control. You can require auth. You can run WAF rules. You can audit your own code. But you can't make Alibaba patch their RDS MCP server.

---

## L3 tools are filling in — but they're all static

The defense side has matured quickly. MCP Pitfall Lab built a P1-P6 vulnerability taxonomy. MCPThreatHive published an MCP-38 framework mapping against STRIDE and OWASP. AWS shipped MCP Server GA with IAM SigV4 and CloudTrail integration. Static analyzers scan MCP server code for missing auth middleware, injection vectors, prompt injection risks.

These tools are useful. They're also fundamentally reactive and static.

Static analysis catches the missing `AuthRequired()` in nginx-ui if you scan it. It doesn't catch what a vulnerable server does after it's been exploited. It doesn't detect an MCP server behaving legitimately until it doesn't — the ExtraHop action-chaining research shows exactly how innocuous individual MCP calls can be assembled into an exploit sequence that no per-step check catches.

And when a vendor calls your vulnerability report "not applicable," the static analyzer's job is done. It found the issue. The issue isn't getting fixed. What now?

---

## The monitoring gap

The CVE-2026-33032 exploits aren't novel techniques. They're unauthenticated calls to exposed tools. The pattern that shows up in telemetry — before you know the CVE exists — is an MCP server receiving calls that don't match any known agent identity, then executing privileged operations it hasn't been seen doing before.

That's a behavioral signal. Unknown caller, escalated tool sequence, no prior pattern match.

Every organization running MCP infrastructure in production is generating this telemetry and most of it is being ignored, because there's no runtime layer watching it. The L3 tools scan codebases. AWS CloudTrail logs API calls. Neither does behavioral sequence analysis across MCP sessions — correlating who called, with what pattern, compared against established baselines.

When Alibaba declines to patch, the mitigation options are:
1. Stop using Alibaba RDS MCP server
2. Put a proxy in front of it that enforces auth
3. Know immediately when the server is being abused

Option 3 requires runtime behavioral monitoring. Options 1 and 2 have their own tradeoffs and don't protect against zero-days in servers you can't inspect.

---

## What behavioral monitoring actually catches

The attack surface for an unpatched MCP server isn't the initial exploit — it's what happens after. Credential harvest. Lateral movement. Data exfiltration routed through legitimate-looking tool calls. This is the ExtraHop pattern: string together innocuous-looking MCP actions until you've extracted something valuable.

Behavioral monitoring catches the sequence. A legitimate data agent calling `get_table_schema` then `run_query` on known tables is normal. The same pattern across 40 tables it's never touched, at 3 AM, from an IP it's never used — that's a behavioral anomaly, regardless of whether the auth bypass is patched.

The L3 defenses — IAM, token validation, static analysis — are necessary. They're not sufficient when vendors won't patch and exploitation is already underway.

Runtime behavioral monitoring is the layer that closes the gap between "vendor says not applicable" and "your data is safe." Continuous behavioral telemetry: agent identity bound to observable behavior, cross-session baseline comparison, anomaly detection on tool call sequences.

The DIF MCP-I spec covers L1 (JWT/OIDC) and L2 (DID+VC). IETF has four active agent identity drafts — AIP, DAWN, HACP, AITLP. All L1-L3. Behavioral monitoring doesn't appear in any standards work because it's harder: it requires runtime infrastructure, not just credential protocols.

That's the gap. 200K MCP servers. Patching is a lottery. Static tools find vulnerabilities in code that won't get fixed. Runtime behavioral monitoring is what tells you the moment someone exploits one.

When a vendor calls your vulnerability "not applicable," you still need to know when someone takes them up on it.

---

*AgentLair provides L4 behavioral monitoring for MCP infrastructure — agent identity bound to continuous behavioral telemetry, with cross-session anomaly detection. [agentlair.dev](https://agentlair.dev)*
