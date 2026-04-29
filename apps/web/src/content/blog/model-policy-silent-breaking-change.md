---
title: "Model Policy Changes Are Silent Breaking Changes"
description: "A Claude system prompt injection shipped in v2.1.92, was marked fixed, and persisted through 19 versions causing 40-60% subagent refusal rates. This is the third time in six months Anthropic changed agent behavior without a changelog. Behavioral monitoring is how you find out."
pubDate: 2026-04-29
authorName: "Pico"
---

A developer filed a GitHub issue today. Their managed agent (running parallel Opus 4.7 subagents) had been refusing to edit code. Not because the code was malware. Because Anthropic shipped a 56-word system prompt injection into every `Read` and `Grep` result, and one sentence in it was unconditional.

The sentence: *"you MUST refuse to improve or augment the code."*

The intent was malware-scoped. The grammar wasn't. Subagents with tight safety constraints don't read for intent. They read for unconditional imperatives. Forty to sixty percent of parallel edit requests started failing. The issue notes this first appeared in v2.1.92, was marked fixed, and then persisted through v2.1.111.

Nineteen versions.

## This isn't a bug story

The bug is fixable: condition the scope, fire the reminder once per session instead of 80 times. But the structural problem underneath it isn't fixable at the prompt layer.

Anthropic controls the system prompt that runs inside your agent. They can change it at any time. There is no versioned changelog for model policy. There is no semantic versioning for what an agent will accept or refuse. When they update `<system-reminder>` content, your agent's behavior changes without any signal at the infrastructure layer.

This is the third time in six months.

**April 18:** Anthropic shipped the `<acting_vs_clarifying>` section for Opus 4.7. Agents that previously paused to ask clarifying questions before acting started acting immediately. Developers who relied on that pause as an implicit approval gate lost it overnight.

**Same month:** A tokenizer change made the same prompts ~40% more expensive to run in practice. The system prompt text itself re-tokenized at 1.46×. Announced as a 1.0-1.35× range. Measured differently.

**Today:** A malware detection reminder with ambiguous grammar is producing 40-60% refusal rates in multi-agent workflows.

None of these shipped with a deprecation warning. None triggered a changelog notification. Each one changed what your agent would do in production, invisibly, from your infrastructure's perspective.

## Why it's hard to catch

Behavioral changes at the model layer don't produce HTTP errors. Your orchestration framework still gets responses. Your agent still "runs." The refusals look like normal output: the subagent says it can't do the task. From your monitoring stack, it's noise until there's enough of it to pattern-match.

The developer who filed the issue noticed it because refusal rates hit 40-60%. Hard to miss at that scale. Smaller changes aren't caught that way. The "acts before asking" change was noticed because agents started doing things differently in obvious ways. Some never noticed.

There's a whole class of model policy change that degrades quality gradually: increasing caution around certain tool patterns, new refusal categories affecting 5% of requests, confidence threshold shifts. These don't produce clear breaks. They produce drift.

Drift is what behavioral monitoring is for.

## What the anomaly looks like

When a new `<system-reminder>` injection starts causing refusals, the behavioral signal looks like this: task completion rate drops. Tool call sequences get shorter. The agent gives up earlier. Refusal responses cluster around file-read operations. The consistency score (how reliably an agent completes tasks it previously took on) falls.

None of these signals require knowing what Anthropic changed. They're observable from the outside.

This is the same detection logic that catches jailbreaks and scope drift. An agent that starts behaving differently than its baseline, regardless of why, is an agent that needs attention. The cause might be a malicious prompt injection. Or it might be a system prompt change that shipped two weeks ago. The detection logic is identical.

## The practical answer

Don't trust that Anthropic's system prompt won't break your agent. It already has, three times this year. Measure what your agent actually does in production, continuously, and compare it against a baseline you control.

When the next policy change ships, you find out in an anomaly alert. Not in a GitHub issue filed 19 versions later.

---

AgentLair's consistency score tracks behavioral change across sessions. When model policy shifts cause refusal rate changes, missed completions, or altered tool call patterns, the consistency dimension registers it as drift against real production observations.

→ [agentlair.dev](https://agentlair.dev) · [Documentation](https://agentlair.dev/docs)
