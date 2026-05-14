---
title: "We Build on Claude. Claude Corrupts Your Documents."
description: "A new paper tested 19 LLMs on delegated editing. The corruption rate is 25%. Claude Opus is on the list. Here's why that's not a contradiction."
pubDate: 2026-05-10
authorName: "Pico"
cta: try
related:
  - what-verifiable-ai-actually-requires
  - ai-automates-what-you-can-verify
  - ai-benchmarks-are-meaningless
---

A paper published this week tested what happens when you hand document editing to an LLM. Not a toy task. Professional workflows across 52 domains: coding, crystallography, music notation, legal drafting.

The researchers built DELEGATE-52, ran 19 models through extended editing sessions, and measured how much of the original document survived intact.

The number: frontier models corrupt approximately 25% of document content by the end of the workflow. Gemini 3.1 Pro. GPT 5.4. Claude 4.6 Opus.

Claude Opus. The model AgentLair runs on.

## The part we can't skip

The model powering our infrastructure is named in a research paper showing it silently degrades the documents it touches. The errors are sparse but severe. They compound over longer interactions. Tool use and agentic approaches don't help. Bigger files make it worse.

This isn't a paper about hallucination in the traditional sense. The corruption is structural drift: formatting lost, sections rewritten without instruction, content silently dropped. The kind of thing a human proofreader catches in five minutes. The kind an automated pipeline never questions.

272 points on Hacker News. The top comment thread landed on the same conclusion most agent builders try to avoid: delegation without verification is a bet, and right now the house edge is 25%.

## Why we build on Claude anyway

The paper doesn't say "don't use LLMs." It says LLMs are unreliable delegates.

Unreliable delegates are everywhere. Junior engineers ship bugs. Financial advisors miscalculate. Contractors cut corners. The existence of unreliability is not an argument against delegation. It's an argument for verification.

The real question isn't "should agents handle documents?" That ship sailed. Enterprises are already delegating, at scale, across every domain the paper tested. The question is: who checks the output?

Right now, mostly nobody. The agent runs, the output appears, the human skims or doesn't. 25% corruption is what happens in the gap between delegation and verification.

## The trust question shifted

For the last two years, agent trust infrastructure has focused on one question: *is this agent authorized?* Identity, credentials, scoping, policy gates. All the layers that answer "is this the right agent with the right permissions?"

DELEGATE-52 reveals a different question that none of those layers touch: *did this agent preserve the integrity of what it was given?*

The Claude Opus instance in the study was, by any standard, authorized. It had correct credentials. It was scoped to the task. It was the intended model. And it corrupted 25% of the content.

Authorization didn't fail. The output did. The trust question isn't about access anymore. It's about fidelity.

## What behavioral observation catches

The corruption patterns in DELEGATE-52 aren't random. Formatting loss follows consistent patterns per model. Content dropping correlates with document length. Section rewriting happens more with certain instruction types.

These are behavioral signatures. Detectable ones.

Not by checking credentials. Not by verifying against a schema. By comparing what this agent actually did against what agents doing this job correctly look like.

AgentLair's trust scoring tracks tool call sequences across sessions. An agent that starts dropping formatting in longer documents creates a measurably different behavioral fingerprint than one that preserves it. Drift shows up as a score change before anyone notices the corrupted output.

This isn't a magic fix. The model doesn't get better because you're watching. But the corruption becomes visible. And visible corruption is a fundamentally different problem than invisible corruption.

## The honest position

We could say "our agents are different." We could say "we've tuned around it" or "this only applies to raw model use." That would be dishonest and you'd be right to distrust us for it.

The honest position: every frontier model tested corrupts documents at a measurable rate. The paper tested 19 of them. None passed clean.

That's why verification exists as a layer. Not because agents are trustworthy. Because they're not.

Trust infrastructure doesn't start from perfection. It starts from the premise that any actor in the system might be wrong, then builds the observation and attestation machinery that catches it. Credit scores don't exist because people always pay their debts.

The paper's finding isn't bad news for AgentLair. It's the thesis statement. The trust layer matters precisely because the execution layer can't be trusted on its own. If LLMs were perfectly reliable delegates, behavioral trust would be a solution in search of a problem.

They're not. It isn't.

([Laban, Schnabel, Neville. "LLMs Corrupt Your Documents When You Delegate." arXiv:2604.15597, April 2026.](https://arxiv.org/abs/2604.15597))
