---
title: "The Attack That Reached 500,000 AI Systems Through a Transitive MCP Dependency"
description: "The LiteLLM supply chain attack (CVE-2026-33634) compromised 500,000 machines and 1,000+ SaaS platforms. It was discovered in a transitive MCP plugin dependency. Here's what behavioral scoring would have shown before it happened."
pubDate: 2026-04-07
authorName: "Pico"
---

In late March 2026, a developer added an MCP plugin to their AI development environment. The plugin had a transitive dependency on LiteLLM — the Python package that routes requests between LLM providers, used by 97 million installations per month.

That dependency had been compromised.

By the time CVE-2026-33634 was filed, the attack had already reached an estimated **500,000 machines and over 1,000 SaaS platforms**. The malicious packages installed a credential stealer. The command-and-control server had been pre-staged the day before the malicious publish — exactly the same pattern as the Axios attack that preceded it by two weeks.

No standard CVE scanner caught it in time. The packages had no known vulnerabilities. They passed every compliance check. All the declarations were correct.

## The TeamPCP Campaign

The LiteLLM compromise was not an isolated incident. It was part of a coordinated campaign that security researchers later named **TeamPCP**, running from March 19 to March 27, 2026. The attack chain mapped out like this:

Trivy (a popular container scanner) → CanisterWorm npm (66+ malicious packages) → Checkmarx KICS (infrastructure scanner) → LiteLLM → Telnyx SDK. The attackers moved laterally through the supply chain by stealing CI/CD tokens from each compromised project and using them to publish malicious versions of downstream dependencies.

The theft of the Trivy token was the keystone. Security tools are inherently trusted. Developers install them, run them with broad permissions, and rarely audit them. Once Trivy was compromised, the attackers had a distribution mechanism reaching every organization that used it in their pipeline — which is most of them.

The payload was credential theft: cloud provider keys, API tokens, database credentials, anything a developer machine or CI environment accumulates. The total claimed exfiltration was 300GB.

## Why AI Tooling Is Different

Most supply chain attacks target broadly-used utilities — request libraries, logging frameworks, build tools. TeamPCP went after AI tooling specifically. That choice was not accidental.

AI development environments have a distinctive security profile:

**They accumulate credentials densely.** A developer using LiteLLM probably has API keys for OpenAI, Anthropic, Cohere, Google, Mistral, and whatever other providers they're routing through. One credential stealer in one package reaches all of them.

**They're installed constantly.** AI tooling evolves fast. Developers update packages weekly — sometimes daily — to get access to new models, new features, new endpoints. Each update is an opportunity to deliver a malicious version.

**MCP plugins multiply the attack surface.** The LiteLLM compromise wasn't found because someone noticed LiteLLM acting strangely. It was found because someone noticed a *transitive dependency* of an MCP plugin acting strangely. MCP creates long dependency chains — tools, servers, plugins, each pulling in their own dependencies. An attacker who compromises one package in any of those chains reaches every developer who's added any MCP plugin that leads there.

## What CVE Scanners Don't See

The standard response to supply chain attacks is to run a CVE scanner. That response fails for a structural reason: CVE scanners check declarations.

A CVE is a disclosure. It exists after someone discovers a vulnerability, documents it, and publishes it. The LiteLLM attack happened before any CVE was filed. The malicious packages had no CVEs because they were brand new — fresh publishes with no history. They passed `npm audit`. They passed Snyk. They passed every scanner that works by checking whether a package appears on a list of known-bad packages.

Behavioral signals tell a different story.

Consider what you can observe about LiteLLM without any CVE data:

- **Single maintainer.** One person controls the entire PyPI package that 97 million machines install monthly. One stolen token, one credential compromise, one phishing email — and the entire distribution chain is in an attacker's hands.
- **2.5 years old.** A legitimate enough pedigree, but far shorter than the infrastructure-grade packages it's often treated as. `requests` is 14 years old. `boto3` is 10. LiteLLM is newer than the MacBook most developers are running it on.
- **Velocity mismatch.** 97 million monthly downloads on a package that 2.5 years ago didn't exist. The download curve is nearly vertical. That's a signal, not a red flag — but it means the vetting time the ecosystem normally provides hasn't happened yet.

## The Commit Audit

Here's what Commit's behavioral scorer returns for the LiteLLM npm package today:

```
$ commit audit litellm
name: litellm
ecosystem: npm
score: 46 / 100 — WARN
maintainers: 1
age: 2.5 years
weekly downloads: 10,773 (npm)
trend: growing
⚠ WARN: Single maintainer on high-growth package
```

Score 46. WARN. Single maintainer. This is not a "this package is malicious" verdict — it's a "this package has structural risk factors that should inform your trust decision."

For a package installed by 500,000 machines that serves as the LLM routing layer for thousands of AI products, a WARN on single-maintainer dependency should trigger a conversation. Not a block — a conversation. "We depend heavily on this package. It has one maintainer. What's our contingency if that maintainer is compromised?"

That conversation didn't happen at most of the companies that were affected by TeamPCP. Because nothing in their toolchain surfaces it.

## The Pattern Is the Pre-Stage

The most technically interesting aspect of the LiteLLM attack — and the Axios attack two weeks earlier — is the C2 pre-staging pattern.

In both cases, attackers registered the command-and-control domain **one day before** publishing the malicious package. This is not accidental. Pre-staging the C2 is specifically designed to defeat reactive defenses. By the time a threat intelligence feed picks up the malicious domain, the packages are already installed on hundreds of thousands of machines and calling home.

This pattern is reproducible, detectable, and predictable — but not by CVE scanners. Detecting it requires watching:

- New network connections to domains with no history
- Behavioral anomalies in package execution (unexpected outbound traffic at install time)
- Version publish velocity (clean package → malicious version within 24h of token compromise)

StepSecurity caught the Axios attack by watching outbound connections in real time during `npm install`. The C2 connection happened at 1.1 seconds. Behavioral telemetry, not declarations.

## What This Means for MCP

The MCP ecosystem has a supply chain problem that isn't widely acknowledged yet.

When you add an MCP server to your AI development environment, you're adding a dependency tree. That tree includes every npm or PyPI package the server depends on, every package those packages depend on, and every package those depend on. For a non-trivial MCP server, that tree has hundreds of nodes.

The LiteLLM discovery happened because a developer noticed their MCP plugin pulling in a LiteLLM version they didn't recognize. They went looking. Most developers don't go looking.

The right response is not to stop using MCP. The right response is to treat MCP servers with the same supply chain scrutiny you'd apply to any other infrastructure dependency — which means behavioral scoring, not just vulnerability scanning.

A plugin that routes your LLM calls is making outbound connections to external services. A plugin that reads your codebase has access to your source. A plugin that manages your calendar has access to your schedule. The permissions are high; the vetting is low; the dependency trees are opaque.

This is solvable. But it requires shifting from "does this package have CVEs?" to "what is the behavioral commitment profile of the maintainer, and what structural risks does this dependency introduce?"

## The Deeper Problem

TeamPCP is not an AI problem or an MCP problem. It's a trust problem.

The open source ecosystem runs on a convention: when you install a package, you're extending trust to its maintainer. For most packages, that trust is well-calibrated. The maintainer of `chalk` — 400 million weekly downloads — has a 12-year behavioral record. The trust is earned, visible, measurable.

The trust extended to a single-maintainer package that's 2.5 years old and growing explosively is a different kind of trust. It's trust in a person, not in a record. And a person can be phished. A person can be pressured. A token can be stolen.

The behavioral commitment score doesn't tell you a package is safe. It tells you what kind of trust you're extending and whether your trust is calibrated to the actual risk. That's the signal that was missing before TeamPCP. It's still missing at most organizations.

---

**Try it:** Run `commit audit litellm axios chalk lodash` or paste your `requirements.txt` into [getcommit.dev/audit](/audit). The behavioral scores are live. No API key required.
