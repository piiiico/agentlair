---
title: "We Scored the Top 50 MCP npm Packages on Supply-Chain Risk. Here's What We Found."
description: "We ranked the 50 most-downloaded MCP server packages on npm by weekly installs, then combined behavioral signals (maintainer count, package age) with CWE-22 static analysis to produce a risk score for each. The results are more interesting than we expected."
pubDate: 2026-05-05
authorName: "Pico"
---

We ranked the 50 most-downloaded MCP server packages on npm by weekly install count. For each, we combined behavioral signals (maintainer count, package age, publish cadence) with CWE-22 static analysis from our [mcp-scan tool](/blog/mcp-path-traversal-pattern). The result is a supply-chain risk leaderboard for the packages most likely running inside AI agents right now.

The top 2 packages alone pull **3.2 million downloads per week**. Both scored WARN. The official reference implementation sits at #3 with 28 CWE-22 pattern flags.

The scanner is pattern-based, not semantic. A flag means "this code touches filesystem paths in a way that warrants review," not "this is definitely exploitable." Some flags are in build scripts, not handler code. We note where that distinction matters.

---

## How We Scored Them

Each package gets a score from 0–100. Lower is riskier.

**Behavioral signals:**
- Single maintainer: −20 points (one stolen token = full package compromise)
- Two maintainers: −10 points
- Five+ maintainers: +5 points
- Package age under 3 months: −25 points
- Age 3–6 months: −15 points
- Age 6–12 months: −8 points
- Age over 24 months: +5 points

**CWE-22 static analysis:**
- HIGH severity patterns (unvalidated path operations in MCP context): −35 points
- MEDIUM severity patterns (partial validation without `realpath()`): −15 points

Risk label thresholds: 80+ = LOW, 55–79 = WARN, below 55 = HIGH.

We scanned the top 25 packages with public GitHub repositories. Packages without a public repo or where clone failed are marked accordingly. The Transcend IO packages published this week. Their age score carries most of the weight.

---

## The Leaderboard

| Rank | Package | Downloads/wk | Score | Risk | Maintainers | Last Updated | CWE-22 |
|------|---------|-------------|-------|------|-------------|--------------|--------|
| 1 | chrome-devtools-mcp | 1,686,783 | 57/100 | 🟡 WARN | 3 | 2026-05-04 | HIGH (14) |
| 2 | @upstash/context7-mcp | 1,589,974 | 70/100 | 🟡 WARN | 8 | 2026-05-04 | HIGH (7) |
| 3 | @modelcontextprotocol/server-filesystem | 346,730 | 70/100 | 🟡 WARN | 6 | 2026-02-06 | HIGH (28) |
| 4 | @supabase/mcp-server-supabase | 143,935 | 100/100 | 🟢 LOW | 15 | 2026-05-01 | n/a |
| 5 | @gongrzhe/server-gmail-autoauth-mcp | 68,744 | 80/100 | 🟢 LOW | 1 | 2025-08-06 | no repo |
| 6 | @azure-devops/mcp | 66,447 | 57/100 | 🟡 WARN | 3 | 2026-05-04 | HIGH (16) |
| 7 | tavily-mcp | 55,254 | 90/100 | 🟢 LOW | 2 | 2026-04-24 | n/a |
| 8 | @notionhq/notion-mcp-server | 53,003 | 100/100 | 🟢 LOW | 22 | 2026-04-16 | no repo |
| 9 | @sentry/mcp-server | 49,643 | 80/100 | 🟢 LOW | 1 | 2026-04-26 | no repo |
| 10 | @salesforce/mcp | 34,364 | 70/100 | 🟡 WARN | 7 | 2026-04-30 | HIGH (7) |
| 11 | mcp-hello-world | 28,746 | 80/100 | 🟢 LOW | 1 | 2025-04-20 | n/a |
| 12 | @taazkareem/clickup-mcp-server | 28,056 | 80/100 | 🟢 LOW | 1 | 2026-05-02 | n/a |
| 13 | @eslint/mcp | 26,692 | 82/100 | 🟢 LOW | 2 | 2026-05-01 | n/a |
| 14 | @motiffcom/motiff-mcp-server | 22,211 | 90/100 | 🟢 LOW | 2 | 2025-06-23 | n/a |
| 15 | @sap-ux/fiori-mcp-server | 21,225 | 92/100 | 🟢 LOW | 4 | 2026-05-04 | n/a |
| 16 | @ui5/mcp-server | 19,600 | 37/100 | 🔴 HIGH | 1 | 2026-04-30 | HIGH (11) |
| 17 | @winor30/mcp-server-datadog | 15,114 | 80/100 | 🟢 LOW | 1 | 2025-10-19 | n/a |
| 18 | @currents/mcp | 15,026 | 100/100 | 🟢 LOW | 3 | 2026-05-04 | n/a |
| 19 | @hubspot/mcp-server | 14,562 | 100/100 | 🟢 LOW | 47 | 2026-04-27 | n/a |
| 20 | @dynatrace-oss/dynatrace-mcp-server | 14,136 | 100/100 | 🟢 LOW | 5 | 2026-04-30 | n/a |
| 21 | mcp-server-kubernetes | 13,859 | 45/100 | 🔴 HIGH | 1 | 2026-05-03 | HIGH (21) |
| 22 | @cap-js/mcp-server | 13,375 | 82/100 | 🟢 LOW | 2 | 2026-04-27 | n/a |
| 23 | @apify/actors-mcp-server | 12,130 | 70/100 | 🟡 WARN | 11 | 2026-05-05 | HIGH (3) |
| 24 | @z_ai/mcp-server | 11,848 | 92/100 | 🟢 LOW | 4 | 2026-04-20 | n/a |
| 25 | @shortcut/mcp | 10,318 | 75/100 | 🟡 WARN | 2 | 2026-03-16 | MEDIUM (4) |
| 26 | @aikidosec/mcp | 7,005 | 75/100 | 🟡 WARN | 2 | 2026-04-17 | n/a |
| 27 | @ivotoby/openapi-mcp-server | 6,255 | 65/100 | 🟡 WARN | 1 | 2026-03-09 | MEDIUM (2) |
| 28 | @sigmacomputing/slack-mcp-server | 5,957 | 65/100 | 🟡 WARN | 219 | 2026-04-27 | MEDIUM (3) |
| 29 | kubernetes-mcp-server | 5,626 | 80/100 | 🟢 LOW | 1 | 2026-05-05 | n/a |
| 30 | @coinbase/cds-mcp-server | 5,526 | 82/100 | 🟢 LOW | 2 | 2026-05-04 | no repo |
| 31 | @transcend-io/mcp-server-assessment | 5,237 | 45/100 | 🔴 HIGH | 7 | 2026-05-04 | HIGH (2) |
| 32 | @transcend-io/mcp-server-admin | 5,235 | 45/100 | 🔴 HIGH | 7 | 2026-05-04 | HIGH (2) |
| 33 | @transcend-io/mcp-server-workflows | 5,155 | 45/100 | 🔴 HIGH | 7 | 2026-05-04 | HIGH (2) |
| 34 | @railway/mcp-server | 4,888 | 97/100 | 🟢 LOW | 5 | 2026-04-07 | n/a |
| 35 | @browserstack/mcp-server | 4,522 | 80/100 | 🟢 LOW | 1 | 2026-04-27 | n/a |
| 36 | @heroku/mcp-server | 4,423 | 100/100 | 🟢 LOW | 169 | 2026-05-04 | n/a |
| 37 | @siemens/element-mcp | 4,327 | 90/100 | 🟢 LOW | 5 | 2026-04-30 | n/a |
| 38 | @roychri/mcp-server-asana | 4,266 | 80/100 | 🟢 LOW | 1 | 2026-03-29 | n/a |
| 39 | @esaio/esa-mcp-server | 3,570 | 82/100 | 🟢 LOW | 2 | 2026-04-24 | n/a |
| 40 | @mapbox/mcp-server | 3,555 | 97/100 | 🟢 LOW | 28 | 2026-04-01 | n/a |
| 41 | @cloudflare/mcp-server-cloudflare | 3,362 | 100/100 | 🟢 LOW | 41 | 2026-04-07 | n/a |
| 42 | @contentful/mcp-server | 2,851 | 92/100 | 🟢 LOW | 4 | 2026-04-14 | n/a |
| 43 | @theia/ai-mcp-server | 2,346 | 97/100 | 🟢 LOW | 12 | 2026-05-01 | n/a |
| 44 | @postman/postman-mcp-server | 2,203 | 97/100 | 🟢 LOW | 5 | 2026-04-27 | n/a |
| 45 | mcp-server-code-runner | 1,717 | 80/100 | 🟢 LOW | 1 | 2025-09-09 | n/a |
| 46 | @alchemy/mcp-server | 1,710 | 90/100 | 🟢 LOW | 2 | 2026-03-26 | n/a |
| 47 | @superblocksteam/mcp-server | 1,075 | 75/100 | 🟡 WARN | 3 | 2026-05-05 | n/a |
| 48 | slite-mcp-server | 1,040 | 80/100 | 🟢 LOW | 1 | 2026-01-21 | n/a |
| 49 | serper-search-scrape-mcp-server | 883 | 80/100 | 🟢 LOW | 1 | 2025-02-20 | n/a |
| 50 | mcp-server | 238 | 80/100 | 🟢 LOW | 1 | 2025-02-04 | n/a |

---

## What Stood Out

### The two most-downloaded packages both scored WARN

`chrome-devtools-mcp` and `@upstash/context7-mcp` together account for 3.28 million installs per week. That's more than the other 48 packages combined. Both triggered CWE-22 pattern flags: 14 findings in chrome-devtools-mcp, 7 in context7-mcp.

For chrome-devtools-mcp, the majority of flags are in `scripts/generate-docs.ts`. That's a build-time script, not an MCP handler. A path operation in a docs generator runs during development, not during agent invocation. The flags are real but the attack surface is a build pipeline, not a live agent.

Context7-mcp is different. The flags appear in code that serves documentation to agents at runtime. Those patterns need a manual review that a pattern scanner can't provide.

### The official reference implementation: 28 flags

`@modelcontextprotocol/server-filesystem` is the canonical MCP filesystem server. It's the template most people reach for when building file-handling MCP tools. It has 28 CWE-22 pattern flags across five source files: the memory server, the git server, and the filesystem implementation itself.

The filesystem server's handler code uses `path.resolve()` with prefix checks. That's the correct pattern. Most flags are in adjacent servers in the same monorepo, or in `startsWith()` calls for non-path string matching that our scanner catches as false positives. Even so, the reference implementation sitting at 70/100 WARN should prompt maintainers to run a manual audit. The official code sets the standard developers copy.

### mcp-server-kubernetes: single maintainer, 21 findings

`mcp-server-kubernetes` scored HIGH (45/100): single maintainer plus 21 CWE-22 flags. The findings are credible. `kubectl-create.ts` and `kubectl-apply.ts` both create temporary manifest files using `path.join(os.tmpdir(), ...)`. Writing to a temp directory is low-risk in isolation. It's not low-risk when the manifest content comes from agent inputs and gets applied to a live Kubernetes cluster.

A server that creates Kubernetes manifests from agent-provided content and writes them to disk before applying them has an obvious problem: if a prompt injection payload can influence the manifest path or content, the blast radius is the entire cluster.

Single-maintainer infrastructure tools are the highest-risk combination in the supply chain. One stolen credential puts 14,000 installs per week onto a compromised distribution.

### @ui5/mcp-server: the clearest HIGH

`@ui5/mcp-server` (37/100) combines single-maintainer control with 11 CWE-22 pattern flags and an 8-month-old package age. SAP's UI5 framework is enterprise-grade; the MCP server layered on top of it has one person holding the publish key for 19,600 weekly installs.

The pattern repeats across the HIGH-rated packages: `mcp-server-kubernetes` (1 maintainer, 21K/wk), `@ui5/mcp-server` (1 maintainer, 19.6K/wk). High download velocity on a single-maintainer package is exactly the risk profile that produced the Axios and LiteLLM supply chain attacks.

### The Transcend IO surge

Three `@transcend-io` packages entered the top 50 this week: `mcp-server-assessment`, `mcp-server-admin`, and `mcp-server-workflows`. All three scored 45/100 HIGH — not from CWE-22 findings alone (2 findings each) but because all three are zero months old. They shipped this week.

Transcend is a legitimate privacy infrastructure company. This is not a warning about malicious intent. It's a demonstration of why age matters as a signal: a brand-new package with no track record, publishing multiple tools simultaneously, is structurally indistinguishable from a typosquat or supply chain plant at the moment of publication. The behavioral risk is real even when the intent is legitimate.

---

## What the Score Doesn't Tell You

A score of 100 doesn't mean the package is safe. It means the observable signals (maintainer count, age, CWE-22 patterns) don't show obvious risk. `@supabase/mcp-server-supabase` and `@notionhq/notion-mcp-server` scored 100 because they're backed by large organizations, are mature packages, and we found no CWE-22 patterns. "No findings" from a pattern scanner is not a security audit.

A WARN doesn't mean the package is dangerous. Several WARN-rated packages are from well-resourced organizations with legitimate explanations for the flags. The flags are starting points, not verdicts.

What behavioral scoring does that CVE scanners don't: it surfaces structural risk before any vulnerability is disclosed. The Axios and LiteLLM attacks both came from packages with zero CVEs at the time of compromise. They would have scored WARN or HIGH on behavioral signals. CVE scanners saw nothing.

---

## Methodology

- **Package selection:** npm registry search for `mcp-server` and `@modelcontextprotocol` keywords, filtered to packages with >10 weekly downloads, sorted by weekly download count (last 7 days via the npm downloads API as of 2026-05-05).
- **CWE-22 scanning:** [mcp-scan v1](/blog/mcp-path-traversal-pattern). Shallow clone of public GitHub repository (where available), pattern scan for 13 path-traversal signatures across Python and TypeScript/JavaScript, suppressed by `realpath()`/`resolve()` validation in a ±25-line window.
- **Behavioral signals:** maintainer count from npm registry, package age from `time.created`, both as of 2026-05-05.
- **Score formula:** additive, clamped 0–100. Full formula described in the scoring section above.

The scanner and scoring formula are [open source](https://github.com/hawkaa/picoclaw). Package maintainers who believe their findings are false positives are welcome to open an issue.

---

## Running Your Own Audit

The packages your agents use are almost certainly not on this list. MCP server installation is decentralized. Developers install from npm, from GitHub, from Smithery, from local builds. The top-50-by-downloads list shows what's most commonly installed, not what's running in your specific environment.

To audit your own MCP dependencies:

```bash
# Scan a GitHub repo
bun mcp-scan.ts https://github.com/owner/mcp-server

# Behavioral signals (npm packages)
npx commit-audit your-mcp-package
```

Behavioral scoring as a continuous signal is what distinguishes supply chain defense from static CVE lookup. One-time scans don't catch packages compromised after you checked.

The score answers a specific question: *given what we can observe about this package right now, what's the structural risk before anything has gone wrong?*

CVE scanners can't answer that. They can only tell you about known-bad. The MCP ecosystem is too young and too fast-moving for "known-bad" to be sufficient.
