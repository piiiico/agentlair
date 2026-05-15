---
title: "Claude 4.7 Acts Before Asking: Why Behavioral Monitoring Is Now Non-Optional"
description: "Anthropic's new system prompt for Opus 4.7 instructs the model to call tool_search and execute actions before asking clarifying questions. The human review window is gone. The only defense left is monitoring what agents do at runtime."
pubDate: 2026-04-20
authorName: "Pico"
---

On April 18, [Simon Willison published an analysis](https://simonwillison.net/2026/Apr/18/opus-system-prompt/) of Anthropic's updated system prompt for Claude Opus 4.7. It contained a new section — `<acting_vs_clarifying>` — that fundamentally changes how the model handles ambiguity.

The old behavior: ask before acting. The new behavior: act, using tools to resolve ambiguity, and only ask if no tool exists to answer the question.

For anyone building on AI agents, this is not a UX upgrade. It's a governance event.

## What the System Prompt Actually Says

The new `<acting_vs_clarifying>` section encodes three specific behaviors:

**Tool-first resolution.** When tools exist to resolve ambiguity — search, calendar access, file reads, location lookup — Claude is instructed to deploy them before asking the user. As the prompt states: "Acting with tools is preferred over asking the person to do the lookup themselves."

**Completion over abandonment.** Once started, the model commits to finishing rather than stopping to verify the interpretation was correct.

**Mandatory tool_search verification.** Before claiming inability to access information, Claude calls `tool_search` to confirm no relevant tool exists. The model can no longer say "I don't have access to that" without checking first.

The practical effect: when Claude receives an ambiguous instruction in an agentic context, it now reaches for tools immediately. The conversational pause that previously created a natural human review window — "Before I do this, did you mean X or Y?" — is gone by design.

## The Token Cost Clarification

[Willison also documented](https://simonwillison.net/2026/Apr/20/claude-token-counts/) a separate issue that compounds the governance problem: Opus 4.7's tokenizer change.

Anthropic stated the new tokenizer maps "the same input to more tokens — roughly 1.0–1.35×." The measured reality: 1.46× more tokens for system prompt text (7,335 tokens vs. 5,039 for the same content on Opus 4.6). Overall, Willison estimates Opus 4.7 will run approximately 40% more expensive in practice.

The combination is worth noting: a model that acts more aggressively, costs 40% more per token, and is deployed in systems where "act first" is now the default behavior.

## The Window That Closed

In prior agent architectures, there was a human review point built into the model's own behavior. Claude would pause, summarize its interpretation, and ask for confirmation. Developers relied on this — not as a feature they had to configure, but as something that happened naturally.

That pause was a last line of defense. When a user gave an instruction that would delete production data, or send an email to the wrong list, or call an external API with a destructive parameter — there was a moment where the model would surface its plan before executing it.

The new system prompt closes that window. Not as an edge case. As the stated default.

The HN thread (328 points, 184 comments) captured this clearly. Multiple developers reported Claude Code now commits to wrong refactors without asking, creating rework burdens. One practitioner: "I much prefer the agent to prompt me upfront to resolve that before it 'attempts' whatever it wants." Another framed it as a fundamental loss of control over where the interception point sits.

They're right. The interception point has moved.

## Where the Interception Point Went

Pre-4.7, the architecture looked like this:

```
User instruction → Model asks clarifying question → Human approves → Tool execution
```

Post-4.7, it looks like this:

```
User instruction → Tool execution → Human sees result
```

In the second architecture, by the time the human sees anything, the action has completed. For read-only operations, this is annoying. For write operations — file edits, API calls, database writes, email sends — it's a different problem category.

The only place to catch undesired behavior is now **during execution**, not before it.

This is not a solvable problem at the prompt layer. You can add instructions to your system prompt telling the model to ask before acting — but you're now fighting against Anthropic's system prompt, which instructs the same model to act before asking. The system prompt you write and the system prompt Anthropic ships are in direct conflict.

You can't win that fight with text.

## What Runtime Behavioral Monitoring Sees

If the interception point has moved to during execution, the question is what infrastructure exists to operate at that layer.

Static analysis doesn't help here. It evaluates what an agent might do before it runs. By the time 4.7 reaches for `tool_search` and finds a tool to execute, static analysis has already made its call.

Authentication and access gates don't help here. The model passed authentication when it connected. What it does with that access is a different function entirely.

What does help: **runtime behavioral monitoring** — a layer that observes tool calls as they occur, compares them against declared scope and historical patterns, and surfaces anomalies while execution is still in progress.

Three signals matter specifically in the post-4.7 context:

**Scope creep in real time.** When an agent calls a tool that lies outside its declared purpose — a calendar agent querying a database, a summarization agent making external HTTP requests — that's observable during the session. Not after.

**Ambiguity resolution paths.** Which tools did the agent reach for when given an ambiguous instruction? Did it search, then act, or act directly? The audit trail of tool calls preceding a consequential action is the evidence base for understanding what happened and why.

**Behavioral consistency against baseline.** A model that previously asked before acting and now doesn't is exhibiting behavioral drift. Drift from an established baseline is a machine-readable signal, regardless of whether it matches any predefined attack pattern.

These are the signals that existed before 4.7 as best practices. They're requirements now.

## The Governance Implication

Anthropic's change is rational from a user experience perspective. Most users don't want to be interviewed before every task. The friction of clarifying questions is real, and removing it produces faster, smoother interactions in the median case.

But AI governance doesn't operate on the median case. It operates on the tails — the ambiguous instruction that resolved incorrectly, the tool call that executed against the wrong resource, the action that completed while the human was still forming the follow-up question.

For production agent deployments — where agents make real decisions with real consequences — the system prompt change means behavioral monitoring has crossed from "useful" to "necessary." Not because the model is less capable. Because the model is more decisive, and decisiveness at the tool layer requires a corresponding layer of runtime oversight that the model's own behavior no longer provides.

The human review window that Anthropic just removed from the model's default behavior needs to exist somewhere in the stack. The question is whether you've built it before you need it.

---

AgentLair's cross-org behavioral monitoring layer operates during every agent session — tracking tool call sequences, flagging scope anomalies, and building behavioral baselines that surface drift as it occurs rather than after the fact.

→ [Get an API key at agentlair.dev](https://agentlair.dev) · [Documentation](https://agentlair.dev/docs)
