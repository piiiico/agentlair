---
title: "The Trust Problem Claude Didn't Solve in Bun"
description: "Bun merged a million-line Claude-assisted rewrite this morning. 10,428 unsafe blocks went in alongside it. The unsafe blocks aren't the problem. The SAFETY comments are. And no human can audit them at that scale."
pubDate: 2026-05-14
authorName: "Pico"
cta: try
related:
  - agents-are-shrinking-trust-problem-isnt
  - llms-corrupt-your-documents-we-verify
  - what-verifiable-ai-actually-requires
---

Bun's million-line rewrite from Zig to Rust merged this morning. Six days from PR opened to PR closed. Claude did most of the work.

Then someone ran `rg 'unsafe \{' src/` and got 10,428.

Across 736 files. In a codebase whose stated purpose for the rewrite was eliminating memory unsafety.

The point isn't that 10k unsafe blocks is a lot. (It is, given that Rust's safety guarantee depends on those blocks being audited.) The point is what the audit looks like. Or rather, what it can't look like.

## The PathString::slice case

A commenter on the thread pulled out a representative example. `PathString::slice` returns a Rust slice from raw memory. The unsafe block carries a `// SAFETY:` comment, which is the idiomatic Rust convention for explaining why an unsafe operation is sound.

The comment: "caller guarantees the borrowed memory outlives this."

The API: doesn't enforce that. No lifetime annotation forces the caller to prove it. No runtime check. The comment is a claim, not a constraint.

Claude wrote both the unsafe block and the comment. Both are syntactically correct. Both follow Rust idioms. The comment sounds like a safety proof. It isn't.

Multiply by 10,428. That's the trust problem.

## Process trust is fine. The output isn't.

The Bun rewrite is, by every behavioral measure, a well-behaved agent run.

Consistent execution pattern. Stayed in scope: code translation, not feature expansion. Full audit trail. Compiler errors fed back and addressed. If you scored Claude on how it operated during the rewrite, you would give it high marks.

If you scored Claude on whether its outputs were actually correct, you would be guessing. No human can verify 10,428 invariants in six days. The invariants are exactly the kind of thing where wrong and right look identical until something segfaults in production.

That's a different trust dimension. Call it epistemic integrity: how accurate are the claims this agent makes inside its outputs? Most agent trust systems don't measure it. They measure how the agent acts, not whether what it produces is true.

## Why "trust the agent" was the wrong question

For two years the agent trust conversation has been organized around behavioral signals. Does this agent stay in scope? Does it respect constraints? Does it back off when uncertain? Does it produce a stable audit trail?

These are necessary. They're not sufficient. They tell you whether the agent is operating well. They don't tell you whether what it produced is true.

Bun is the proof-of-concept the industry needed for that distinction. A well-behaved agent produced output that no one can verify, at a scale that makes verification impossible by construction. The behavioral trust score would have been fine. The output is what's compromised.

The question agent trust systems should be answering isn't "can I trust this agent?" It's "can I trust this agent's outputs at this scale?"

Those have different answers.

## The reviewability ratio

Here is the framing that makes the gap measurable. Take output volume, divide by reviewer capacity, multiply by available time. Call it the reviewability ratio.

For Bun: roughly 10,000 unsafe blocks. At one block reviewed per minute by a Rust expert (optimistic), that's 167 hours of audit work. The PR was open for six days, with maybe two senior reviewers paying close attention. The ratio comes out somewhere between 8 and 10.

At that ratio, "this output has been reviewed" is a category error. It hasn't been. It can't have been. The volume exceeded the review capacity by an order of magnitude before anyone clicked merge.

The agent's behavioral score was Senior. Its effective autonomy on this artifact was Principal. The gap between the two is the failure mode.

## What the trust layer needs to add

Behavioral trust answers process questions. Output trust answers artifact questions. They're orthogonal. AgentLair has been measuring the first dimension. Bun is the lesson on why the second has to exist alongside it.

Three things we're adding.

First, a reviewability-ratio signal. Output volume per session, captured against the operator's declared review capacity. When the ratio crosses a threshold, the agent is effectively autonomous regardless of what its trust score says. Flag it.

Second, a verification tier on the operator profile. What external tooling does this agent's workflow apply to its outputs? Borrow checker is high-trust evidence. Test suite is high-trust. Static analysis is moderate. Self-attestation in comments is near-zero. The hierarchy is what the trust signal weighting should reflect.

Third, an output-scoped attestation alongside the existing behavioral one. The current attestation says "this agent has been behaving well." The new one says "this specific artifact carries this specific evidence." A trusted agent can produce a low-trust output. The artifact attestation makes that visible.

Together, these three signals are how the trust layer measures epistemic integrity. Not by reading the agent's outputs (we can't, and shouldn't), but by tracking what external evidence exists for them and how much human review they actually received.

None of this requires inspecting model internals. Operators declare what verification their workflow applies. The system tracks volume. The flag fires when the ratio breaks.

## What this isn't

This is not an argument against using Claude for big rewrites. Bun's maintainers will iterate. The unsafe count will come down. The codebase will probably end up better than where it started. Useful work happened this week.

It's also not an argument that behavioral trust is wrong. Process signals catch a lot. Most agent failure modes are behavioral: scope creep, runaway loops, abandoned sessions, silent drift. The behavioral layer is doing real work.

What it is: a demonstration that the behavioral layer alone leaves a visible gap. The gap shows up the moment an agent produces output at a scale humans can't review. Which is now. Which Bun just shipped.

When the agent doing the work can't be checked by the human signing off on the work, "I trust the agent" stops being the load-bearing claim. Something has to attest to the output itself. That is the layer we are building.

---

*This continues the series on trust infrastructure for autonomous agents. Previous: [Agents Are Shrinking. The Trust Problem Isn't.](/blog/agents-are-shrinking-trust-problem-isnt), [We Build on Claude. Claude Corrupts Your Documents.](/blog/llms-corrupt-your-documents-we-verify). We're building [Commit](/) — behavioral trust data for the agent economy.*
