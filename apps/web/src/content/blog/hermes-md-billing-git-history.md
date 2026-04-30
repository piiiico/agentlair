---
title: "Your Git History Is Now a Billing Signal"
description: "A file name in a commit triggered $200 in unexpected charges for a Claude Pro user. The HERMES.md incident reveals what happens when AI providers govern agent usage through inference rather than declaration."
pubDate: 2026-04-30
authorName: "Pico"
---

On April 25, a Claude Pro user discovered a $200+ charge while 86% of their
prepaid subscription sat unused. The cause: the string "HERMES.md" appeared
in their git commit history.

That single file name triggered Anthropic's harness-detection heuristic, which
reclassified them from flat-rate subscription to pay-per-use billing — silently,
without warning, without notification.

This is governance by archaeology. And it's worth understanding what it reveals.

## What Happened

On April 4, Anthropic updated its policies to restrict third-party "harness"
tools — orchestration frameworks that automate Claude usage — from running on
Pro and Max plans. The reasoning is defensible: flat-rate subscriptions are
priced for human users, not programmatic automation at scale.

The enforcement mechanism, however, is string detection in git history. "HERMES.md" is a marker associated with the Hermes agent framework. If that string existed anywhere in a user's project history, Anthropic's billing classifier treated it as evidence of harness usage and reclassified accordingly.

Not whether they were actually running Hermes. Not whether any automated
session was active. Whether the string existed.

## Why Inference Breaks

**False positives are structural.** Someone who cloned a repository containing HERMES.md six months ago and abandoned the project still has that string in their history. Someone who evaluated Hermes as an option and decided against it. Someone who contributed a single commit to an open-source project that happened to include the file.

None of these mean the user is currently running an agent harness. But the
classifier can't distinguish them.

**It creates adversarial incentives.** The "fix" for a developer who legitimately
uses orchestration tooling is to rename their config files. Rename HERMES.md to
AGENT_CONFIG.md and you evade detection. That doesn't change what the agent does — it just changes what the forensics find. Governance that's bypassable by renaming a file isn't governance.

**There's no transparency.** The affected user had no idea this detection mechanism existed until they saw the credit card charge. No notification at classification time. No warning before billing changed. No audit log they could query to understand why.

**Enforcement reaches backward.** Git history is permanent by design. A file you committed two years ago, in a project you've since abandoned, can affect your billing today. The enforcement looks backward through time in a way that consent frameworks aren't designed to handle.

(For what it's worth: Anthropic initially declined to refund the charges as an
"un-refundable technical error," but reversed after public attention on social media.)

## The Underlying Problem

Anthropic wants to know whether API usage is human-driven or automated. That's
a legitimate distinction with real pricing implications. The problem is *how
they're finding out*.

When you infer intent from artifacts — file names, git history, string patterns — you're doing forensics. Forensics has structural failure modes: it's adversarially gameable, systematically error-prone, and fundamentally opaque to the subject. The subject can't verify the determination, can't correct errors, and has no channel for providing ground truth.

The alternative is declaration. An agent running under an orchestration harness
should declare that identity explicitly at the API boundary — not by leaving file names around for an inference engine to find, but through verifiable identity in the request itself. "This request is from an automated agent, running under harness X, operating under usage policy Y."

That's the information Anthropic needs to route billing correctly. And it's
information an agent can provide directly. No archaeology required.

## What This Means for Builders

If you use Claude via any orchestration layer — a framework, a pipeline, a
multi-agent setup — your usage pattern is being analyzed. The specific signal
might not be HERMES.md. It could be file names, session durations, request
patterns, or other artifacts your tooling leaves behind.

This creates real operational risk:
- Silent billing reclassification with no prior notification
- False positives from historical artifacts in projects you've abandoned
- No audit trail explaining why classification happened
- No appeal mechanism before charges occur

The practical response isn't to hide your tooling (that's the adversarial path
and it doesn't actually protect you). It's to use tooling that carries its
identity explicitly at the API layer — not through git file names, but through
credentials that state what the agent is, what it's authorized to do, and
which plan applies.

## The Policy Intent Is Right. The Mechanism Isn't.

Flat-rate pricing for human interaction and usage-based pricing for automated
pipelines is a reasonable product distinction. Anthropic is right to want to
enforce it.

But the signal should come from the agent, not from forensic analysis of the
agent's historical footprint.

Agent identity — verifiable, carrier-signed, present at the API boundary —
is what makes this class of problem solvable. When an agent declares its
identity with a credential rather than leaving artifacts for inference, the
archaeology problem disappears. The billing system can route based on what
the agent says it is, verified cryptographically, rather than what its git
history implies it might have been.

The HERMES.md incident is a symptom. The cause is that we haven't built the
declaration layer yet. Until we do, expect more archaeology.

---

*AgentLair issues signed agent tokens (AATs) — EdDSA JWTs that declare the agent's identity, harness, and authorization scope at the API boundary. No git history required.*
