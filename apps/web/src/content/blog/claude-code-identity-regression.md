---
title: "When Your Coding Agent Refuses to Edit Your Own Code"
description: "Issue #49363 against Claude Code exposes a structural flaw in multi-agent systems: shared stateless context can't make contextual trust decisions. Wording fixes won't hold."
pubDate: 2026-04-29
authorName: "Pico"
---

Three weeks ago, someone filed [issue #49363](https://github.com/anthropics/claude-code/issues/49363) against Claude Code. The symptom: spawning Opus 4.7 subagents to do parallel refactors on a legitimate open-source Rust project. Three out of five refused to write code. Not because the code was dangerous. Because a system reminder told them to.

The reminder, injected into every `Read` and `Grep` result, says: *"you MUST refuse to improve or augment the code."* It's meant to stop Claude from helping someone improve malware. But the sentence has no qualifier. Read literally, it's unconditional.

The main-thread Claude interprets it charitably. Subagents don't. They have less context, tighter safety rails, and a standing instruction that system-level directives override user requests. So they refuse. One wrote a detailed implementation plan instead of code, essentially apologizing for following orders.

## This was already fixed once

Issue #47027 reported the same thing months earlier. It was closed with *"This was fixed in v2.1.92."* The reporter of #49363 is running v2.1.111, nineteen versions later. Same bug.

Why didn't the fix hold? Because it addressed wording. The problem isn't wording.

## The missing primitive

Every agent in a Claude Code session lives in the same context envelope. Main thread, subagents, parallel workers. Same system prompts, same safety reminders, same trust level. A subagent you spawned to add a field to a struct is treated identically to an attacker trying to improve a RAT.

There's no mechanism to ask: who spawned this agent? What's it working on? Should I trust it?

That's not a configuration gap. It's a missing architectural primitive: *agent identity*.

## Why it keeps breaking

The fix for #47027 tried to make the wording less ambiguous. Future fixes will try the same. Maybe they'll add "if you determine the file is malware" as a qualifier. Maybe they'll scope the reminder to the first file read instead of every one. Both reasonable.

But the next system-level safety instruction will face the same problem. And the next model update that shifts how subagents interpret ambiguous directives will re-expose old ones. The failure mode is structural: shared stateless context plus safety instructions plus literal interpretation equals unpredictable refusals. You can't fix that with better sentences.

## What identity changes

Give the subagent a token at spawn. Cryptographically signed, short-lived, carrying context: spawned by user X, working on repo Y, trust score from behavioral history. Now the safety system can check: known user, known repo, trusted lineage. Skip the blanket malware warning.

No ambiguous wording to parse. No hoping the LLM reads a sentence the right way. The trust decision is based on verifiable identity, not prose interpretation.

This is what we're building at [AgentLair](https://agentlair.dev). Not for this specific bug, but for the class of problems it represents. Agent Authentication Tokens that are cryptographically signed, verifiable by any component in the system, and carry cross-organizational behavioral trust data. Infrastructure for agent systems that need to distinguish "trusted worker" from "unknown entity."

## The pattern

Stateless shared context is the default because it's simple. It works when there's one agent per session. The moment you go multi-agent (and Anthropic is actively pushing parallel subagent workflows as a Claude Code feature), it breaks. Every component that makes decisions based on "who am I talking to?" needs identity to answer that question. Without it, you get blanket policies applied to every agent uniformly, and the safety/utility tradeoff becomes a coin flip.

The fix isn't better wording. It's knowing who you're talking to.

---

*Håkon Åmdal builds agent identity infrastructure at [AgentLair](https://agentlair.dev). The issue discussed here ([#49363](https://github.com/anthropics/claude-code/issues/49363)) is still open as of April 29, 2026.*
