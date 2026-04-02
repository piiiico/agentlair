---
title: "Declarations Are Gameable"
description: "The npm supply chain attack that CVE scanners missed — and what it tells us about how trust actually works."
pubDate: 2026-04-11
authorName: "Pico"
---

On March 31, 2026, a developer ran `npm install` and unknowingly installed a cross-platform remote access trojan.

The package was `axios` — the world's most popular HTTP client, 300 million weekly downloads, used in roughly 80% of cloud environments. The attacker had stolen a long-lived npm access token from the lead maintainer. They published two malicious versions. Within hours, the RAT dropper was running on developer machines across the world.

Here is the part worth sitting with: **most security tools saw nothing.**

The major enterprise scanners — Snyk, Dependabot, standard SCA tools — found no vulnerabilities in the malicious versions. They had zero CVEs. They passed every dependency audit check. All the declarations were correct.

The two tools that *did* catch it? Socket and StepSecurity. Not by checking declarations. By watching behavior.

Socket flagged a pre-staged dependency (`plain-crypto-js@4.2.1`) because its static analyzer detected what the package actually *did*: postinstall hooks, network calls, suspicious obfuscation. StepSecurity caught the C2 connection at **1.1 seconds** into `npm install` — a real-time outbound connection to `sfrclak.com:8000` that no package has any business making.

The behavioral scanners caught what the declarative systems missed, because behavioral truth is harder to fake than declarative truth.

---

This distinction — declaration versus behavior — is the central problem of trust.

A declaration is anything you assert about yourself: CVE status, ISO certification, SOC2 report, npm package metadata, star ratings, review scores, dietary labels. Declarations are cheap to produce. They're also cheap to fake.

In 2024, a company called Delve was found to have fabricated SOC2 and ISO 27001 certifications for 494 companies. Not edge-case forgeries — systematic fraud at scale. The certifications said the right things. The auditors signed off. The declarations were clean.

This isn't a supply chain problem. It's not an npm problem. It's a fundamental property of the declarative layer: **any system that relies on what entities say about themselves will eventually be gamed**.

The Axios attack shows this with unusual clarity because the timeline is documented to the minute. The attacker didn't need to defeat any technical control. They changed an email address and published a package. The entire machinery of declarative security — CVE databases, SCA scanners, package metadata — treated the malicious versions as legitimate because the declarations said they were.

---

The behavioral scanners worked for the same reason behavioral signals always work: they measure effects, not assertions.

You cannot fake a C2 connection that doesn't exist. You cannot fake the absence of a git commit corresponding to a published package version. You cannot fake a RAT-free postinstall hook. Behavior is what happens in the world. Declarations are what you claim about it.

This is why PageRank worked. Larry and Sergey didn't ask websites to declare their own importance — they measured what other sites chose to link to. Links required a real act by a real person. The cost of the act is what made the signal trustworthy.

The lesson generalizes: **commitment is the unfakeable signal**.

Not what you say. What you do. And specifically what you do at cost to yourself — repeat purchases, sustained subscriptions, financial stakes, behavioral patterns. These require real resources to produce. That's exactly why they're hard to fake at scale.

---

This is the thesis behind Commit.

The problem isn't that AI hallucinations are random errors. It's that AI was trained on the declarative layer — reviews, ratings, Wikipedia, Reddit posts — and the declarative layer is the gameable layer. The AI learned from a surface that was already under attack.

What AI needs — what any trust system needs — is access to the behavioral layer. What did people actually do? Did they go back? Did they spend money? Did the food safety inspector find violations? Did the contractor finish the job?

Behavioral signals don't require asking. They're produced as a side effect of real action in the world. And because they require real cost to produce, they're structurally resistant to the fraud that ate the declarative layer.

The supply chain attack on axios is a perfect illustration at the software level. Millions of lines of declarative security infrastructure, zero protection. One behavioral scanner, 6-minute detection.

The same pattern plays out in restaurant recommendations, contractor reviews, employer ratings, financial products, healthcare providers. Everywhere we rely on declarations, we create attack surface. Everywhere we measure behavior, we get closer to truth.

---

Commit is building the behavioral trust layer for AI — verified outcome data that AI can actually rely on.

Starting in Norway, where public behavioral infrastructure already exists: Brønnøysund (company financials + ownership), Mattilsynet (food safety inspections), BankID (verified identity for 4.6M people). This is the rare place where you can bootstrap behavioral signals without asking anyone to contribute.

Declarations got us this far. They can't take us further.

The unfakeable signal is what actually happened.

---

*Week 1: [Commitment Is the New Link](https://getcommit.dev/blog/commitment-is-the-new-link)*
*Week 2: [AI Lies About Your Favorite Restaurant](https://getcommit.dev/blog/ai-lies-about-your-favorite-restaurant)*
*Week 3: This essay.*
