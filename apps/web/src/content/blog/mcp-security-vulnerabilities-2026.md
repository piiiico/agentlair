---
title: "MCP Security Vulnerabilities in 2026: 40+ CVEs and Counting"
description: "A timeline of every major MCP vulnerability disclosed in 2026. From STDIO command injection to marketplace poisoning, the pattern is structural and the protocol's maintainers have declined to fix it."
pubDate: 2026-04-30
authorName: "Pico"
---

Between January and April 2026, researchers filed more than 40 CVEs against Model Context Protocol implementations. The vulnerabilities span every SDK language Anthropic ships: Python, TypeScript, Java, Rust. They affect Anthropic's own reference servers, third-party tools with 150 million combined downloads, and 9 out of 11 MCP marketplaces that accepted poisoned proof-of-concept submissions without detection.

This isn't a bad quarter. It's a pattern.

## Timeline

MCP vulnerabilities started surfacing in mid-2025, then accelerated sharply in early 2026.

**2025**

- **April:** WhatsApp tool poisoning attack demonstrated.
- **May:** GitHub MCP prompt injection disclosed.
- **June:** Asana cross-tenant data exposure. CVE-2025-49596 (MCP Inspector RCE, CVSS 9.4) published.
- **July:** CVE-2025-6514 (mcp-remote command injection, CVSS 9.6, 437,000+ downloads affected). CVE-2025-54136 (Cursor trust bypass via MCPoison).
- **August:** Filesystem MCP sandbox escape.
- **September:** Postmark supply chain attack.
- **October:** Smithery path traversal.

**January–February 2026:** 30+ CVEs filed in 60 days. This is the inflection point. Researchers started treating MCP as an attack surface category, not a one-off finding.

**January 20, 2026:** Three vulnerabilities disclosed in Anthropic's own mcp-server-git. Not a community fork. The reference implementation.

**April 2026:**

- Ox Security published a full advisory covering 10 high- and critical-severity CVEs rooted in a single architectural flaw: STDIO command injection.
- The Hacker News and The Register covered the story. Estimated exposure: 200,000 vulnerable servers. 150 million downloads across affected packages.
- Specific CVEs from the Ox advisory: CVE-2025-65720 (GPT Researcher), CVE-2026-30623 (LiteLLM, patched), CVE-2026-30624 (Agent Zero), CVE-2026-30618 (Fay Framework), CVE-2026-33224 (Bisheng, patched), CVE-2026-30617 (Langchain-Chatchat), CVE-2026-30625 (Upsonic), CVE-2026-30615 (Windsurf), CVE-2026-26015 (DocsGPT, patched), CVE-2026-40933 (Flowise).

Three out of ten patched. Seven still open at time of writing.

## Categories

The vulnerability breakdown across all 2026 filings:

| Category | Share |
|----------|-------|
| Shell/exec injection | 43% |
| Tooling infrastructure flaws | 20% |
| Authentication bypass | 13% |
| Path traversal | 10% |
| Other (SSRF, cross-tenant, supply chain) | 14% |

Shell injection dominates because MCP's STDIO transport spawns subprocesses by design. The protocol's architecture makes command execution the default interface between client and server. Every implementation inherits that surface.

## The STDIO Problem

The root cause behind the largest cluster of CVEs is straightforward: MCP uses STDIO as its primary transport. A client spawns an MCP server as a subprocess and communicates over stdin/stdout. The protocol doesn't sanitize what command gets spawned. Pass a malicious command string, and it executes. Even when it fails to create a valid STDIO server, the command already ran.

Ox Security identified four distinct attack vectors from this single flaw:

1. **Unauthenticated command injection** via crafted STDIO invocations.
2. **Command injection that bypasses developer hardening** (input validation, allowlists).
3. **Zero-click prompt injection** in AI IDEs. The user never approves anything.
4. **Marketplace poisoning.** Upload a malicious MCP to a directory. Wait for installs.

The researchers put it plainly: "one architectural decision propagated silently into every language, every downstream library, and every project."

## Anthropic's Position

Anthropic declined to modify the protocol architecture. Their response: the behavior is "expected." Sanitization is the developer's responsibility.

This is a coherent position if you think of MCP as a low-level plumbing specification. It's an incoherent position if you notice that 82% of 2,614 surveyed MCP implementations are vulnerable to path traversal, 38 to 41% ship without authentication, and 67% carry code injection risk. Developers aren't sanitizing. The "expected behavior" is producing a 43% shell injection rate across the ecosystem.

The protocol is a standard. Standards set defaults. These defaults are producing CVEs at a rate of roughly one every four days in 2026.

## What Scanning Catches (and What It Doesn't)

Static analysis and marketplace scanning catch known vulnerability patterns: SQL injection via string concatenation, hardcoded credentials, shell=True with user input. We ran our own scanner against 19 MCP servers in Q1 and filed advisories against three of them ([full report](/blog/state-of-mcp-security-q1-2026/)).

Scanning works for pattern-matching against known-bad constructs. It doesn't work for sequence-level attacks, where each individual tool call is authorized but the chain exfiltrates data. We documented a [concrete three-step scenario](/blog/mcp-action-chaining-the-attack-your-permissions-cant-see/) where filesystem read, LLM summarization, and error reporting combine into an exfiltration pipeline that passes every existing check.

That's the gap. Scanning catches bad code. It doesn't catch bad sequences. Behavioral monitoring after access is granted fills it: tracking what agents actually do across tool calls and flagging when the pattern diverges from baseline.

## What to Do

If you run MCP servers in production:

**Immediate.** Block public IP access. Run MCP-enabled services in sandboxed environments. Treat external MCP configuration as untrusted input. Only install from verified sources, and verify what "verified" means for your marketplace.

**Structural.** Add behavioral monitoring at the agent level. Not just "did this tool call pass authorization" but "does this sequence of calls match what this agent normally does." [AgentLair's trust scoring](/getting-started) builds behavioral baselines per agent session and flags divergence in real time. An interactive [demo](/demo) shows exactly how a trust score drops as an action-chaining attack unfolds.

The CVE count will keep climbing. The protocol's maintainers have stated their position. The infrastructure to monitor what happens after authorization is what's missing.
