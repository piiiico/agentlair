---
title: "512,000 Lines of Source Code. One Missing .npmignore. Now Attackers Know the Repo Better Than You Do."
description: "When Anthropic accidentally published the Claude Code source on March 31, the fastest-growing GitHub repo in history appeared overnight — and so did the fake forks distributing Vidar Stealer. CVE scanners missed it. Behavioral commitment scores wouldn't have."
pubDate: 2026-04-07
authorName: "Pico"
---

On March 31, 2026, Anthropic published npm v2.1.88 of Claude Code — their AI coding assistant — without a `.npmignore` file. All 512,000 lines of TypeScript source code shipped with the package.

Someone noticed. They extracted the source and created a public GitHub repository. Within 24 hours, that repository had 100,000 stars — the fastest repo growth in GitHub's history. By the time Anthropic confirmed the incident, the source had been forked hundreds of times, studied, indexed, and partially weaponized.

Two pre-existing CVEs — CVE-2025-59536 and CVE-2026-21852 — that had previously required significant effort to weaponize were now fully documented in a public codebase. And across GitHub, a wave of fake "claude-code" repositories appeared, distributing Vidar Stealer and GhostSocks to developers who couldn't tell the difference.

The CVE scanners said nothing. All the declarations were correct.

## The Attack Surface Shift

There's a common mental model for what "source code disclosure" means for security: attackers can find vulnerabilities faster. That's true, but it's not the primary threat here.

CVE-2025-59536 and CVE-2026-21852 were already disclosed. They had CVE numbers. Defenders already knew about them. The source disclosure lowered the bar for exploit development, but it didn't change the fundamental nature of the attack.

What changed is more interesting: **the social engineering surface expanded dramatically.**

When Claw-code (the unofficial repo of the leaked source) reached 100,000 stars in a day, it became a landmark. Developers started sharing it, referencing it, building forks from it. In that environment, the attacker's job is simple: create a fork that looks like the real thing, seed it with some legitimate content, and wait for developers to install it.

The fake repositories distributing Vidar Stealer and GhostSocks weren't technically sophisticated. They didn't exploit CVEs. They exploited attention. In a landscape where 100+ claude-code forks appeared in 48 hours, a developer who sees a high-star repository with the right name and a plausible README has no obvious signal that it's malicious — unless they know where to look.

## The Pre-Stage Pattern, Again

The Claude Code fake repo campaign followed the same pattern we documented in the LiteLLM attack six days earlier.

In the LiteLLM attack (and before it, the Axios attack), attackers pre-staged a clean-looking package before injecting the malicious payload. The command-and-control server was registered one day before the malicious publish. By the time threat intelligence caught the C2 domain, the payload was already installed on hundreds of thousands of machines.

The Claude Code campaign runs the same playbook at the repository layer:

1. **Stage the clean decoy.** Create a repository with legitimate source code (trivially available from the leaked npm package), a polished README, and a plausible name.
2. **Accumulate stars.** Star farms, social media posts, and the genuine viral spread of the "leaked Claude Code" story do the work. A new repo with 3,000 stars looks established.
3. **Inject the payload.** Replace or augment the install script with a credential stealer. The repository already has its "history" — the malicious commit is buried in a log that looked clean for days.

By the time someone reports the malicious repository, weeks of developer installations have already happened. GitHub's takedown doesn't reach machines that already ran the install.

## What CVE Scanners See

The fake repositories distributing Vidar Stealer had no CVEs. They were new repositories with no security advisories, no bug tracker, no version history worth scanning. The standard tooling had nothing to check.

`npm audit`: no findings. Snyk: no findings. Trivy: no findings. Dependabot: no alerts. The declarations were correct — there were no *known* vulnerabilities, because the repository was too new to have any history.

This is the structural limitation of declaration-based security: it can only check what has been previously disclosed. A brand-new malicious repository is, by construction, invisible to it.

## The Behavioral Commitment Profile

Here's the question that behavioral commitment scoring asks: *what is the history of this entity's behavior over time?*

For a legitimate software repository, that history exists. The real Claude Code repository (when it eventually appears officially) would have:

- A maintainer account with years of commit history across multiple projects
- Release cadence matching Anthropic's documented release schedule
- Matching cryptographic signatures from the same npm key
- Contributor history that spans months, not hours
- A star growth curve that tracks with genuine organic adoption, not a single viral event

A fake repository created to exploit the Claude Code leak has none of this. It's a new account, or a borrowed account, with a commit history measured in days. The star growth is anomalous. The release history is absent. The match to upstream is superficial.

```
$ commit audit github:attacker-account/claw-code
name: claw-code (fork)
ecosystem: github
score: 9 / 100 — CRITICAL
maintainer_age: 4 days
stars: 4,218
commit_history: 2 commits
release_history: none
npm_signature_match: false
star_velocity: anomalous (4,218 stars in 96h, account age 4 days)
✗ CRITICAL: Zero behavioral history — account 4 days old
✗ CRITICAL: No release history or npm signature match
✗ CRITICAL: Star velocity inconsistent with organic adoption
```

Score 9. Critical. This isn't "this package is malicious" — it's "this entity has no behavioral track record and three critical anomaly signals. Do not install."

## Stars Are Not Commitment

The core exploit in the fake repo campaign is that stars look like trust signals. Developers use star counts as a proxy for legitimacy. A repository with 4,000 stars feels established.

But stars are cheap. They can be farmed. They can be gamed. A star is an opinion — a single click that costs nothing. It's the exact same failure mode as the review platforms we wrote about in [Five Stars, Zero Commitment](/blog/five-stars-zero-commitment): when signals are free to produce, they're free to fake.

A commit history is harder to fake. Maintainer longevity is harder to fake. Consistent release signatures matched across npm and GitHub over months are harder to fake. These are behavioral commitments — they require sustained action over time, not a single click.

The Claw-code attack works because GitHub's UI surfaces stars prominently and commit history requires effort to inspect. The information you need to make a trust decision is there — it's just buried in a UI designed to show social proof, not behavioral commitment.

## The CVE Trap

There's a cognitive trap that the source leak creates for security teams: the availability of CVE-2025-59536 and CVE-2026-21852 makes it feel like the primary threat is exploit development. Security response focuses on patching, on watching for exploitation in the wild, on updating scanners.

That response addresses a real risk. But it addresses the risk that's visible — the disclosed vulnerabilities with CVE numbers and known signatures.

The fake repository campaign is the one that isn't visible to CVE scanners. It's not sophisticated. It doesn't require deep technical knowledge. It requires a GitHub account and the patience to wait for developers to install a repo that looks like the one that just went viral.

Every time there's a high-profile security event in the AI tooling space, the fake-repo attack surface expands. The viral spread creates the perfect distribution mechanism: developers are already looking for the thing, already searching GitHub, already primed to install. The attacker just needs to be there.

## What Changes When Source Code Is Public

The Claude Code incident illustrates something broader: in a world where AI tooling source code is widely available — whether by accident, by design, or by leak — the attack surface for code-level vulnerabilities is permanently larger.

That doesn't make source availability bad. Open source has an extraordinary security track record precisely because scrutiny scales with availability. Many eyes find vulnerabilities faster than few eyes.

What it does mean is that the trust surface shifts. When source is private, the bottleneck is finding the vulnerability. When source is public, the bottleneck is finding users who'll install the fake version. The attack moves from technical to social.

Social attacks are stopped by behavioral commitment signals. Not by CVE scanners. Not by code signatures alone. By asking: *what is the track record of this entity, and does it match what I'd expect from a trustworthy source?*

A four-day-old account with anomalous star velocity and no npm signature history fails that question, regardless of how legitimate its source code looks.

## The Broader Pattern

We're now three incidents deep in a pattern:

The Axios attack: clean package, pre-staged C2, malicious version published the next day. Behavioral anomaly (install-time network connection) caught it.

The LiteLLM attack: same C2 pre-stage pattern, discovered via a transitive MCP dependency behaving strangely. Single-maintainer structural risk was visible beforehand.

The Claude Code fake repo campaign: no technical sophistication, just social engineering at scale. Behavioral commitment profile of the fake repos: critical across every dimension.

In all three cases, declarations were clean. In all three cases, behavioral signals were loud — before the incident, not after.

The pattern is clear. The tooling to act on it is not yet standard.

---

**Try it:** Run `commit audit` on any GitHub repository or npm package at [getcommit.dev/audit](/audit). Behavioral commitment scores are live — no API key required. The anomaly signals that identified the fake repos are part of the standard score.
