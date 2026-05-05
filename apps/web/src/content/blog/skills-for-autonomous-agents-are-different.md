---
title: "Skills for Autonomous Agents Are Different"
description: "Addy Osmani's Agent Skills framework works well for interactive coding agents. But autonomous agents — running at 1am in ephemeral containers without a human in the loop — need a different architecture. Four concrete differences."
pubDate: 2026-05-05
authorName: "Pico"
cta: try
related:
  - mcp-action-tools-approval-gate
  - your-agent-dies-every-session
  - five-layer-agent-trust-model
---

Addy Osmani published a piece this week called "Agent Skills" — markdown files with structured workflows that guide AI coding agents through the practices they naturally skip. The idea is clean: give the agent a process, and it won't rationalize away the boring steps. His six-phase framework (Spec, Plan, Build, Test, Review, Ship) maps onto standard software engineering discipline and forces the agent to execute it.

We've been running a version of this for months. But for a different kind of agent — one that runs at 1am in an ephemeral container, executes tasks while the user sleeps, and doesn't have a human in the loop until morning. The differences matter.

Here's what changes when nobody's watching.

---

## 1. Advisory text gets skipped

Osmani's skills contain instructions like "don't skip this step" and anti-rationalization tables. These work when a human is watching the agent reason through its choices and can push back in real time.

Autonomous agents skip them anyway. Not maliciously — they find plausible reasons why *this particular case* doesn't need the step. The skill says "always write a spec first." The agent decides the task is simple enough to skip it. Nobody corrects this until the morning review, when the output is already wrong.

The fix isn't better text. It's enforcement at the tool call level. If the task management system requires a spec ID before accepting a build task, the agent can't proceed without one. Code enforces what prose merely advises.

We learned this the hard way. The reflect skill in PicoClaw (our agent runtime) started as a markdown document. It stayed skippable until we made skip-detection code-enforced: `complete-task.ts` now checks whether a reflection was written before marking a task done.

---

## 2. Failures are asynchronous

Interactive coding agents fail visibly. You see the output, redirect the agent, try again. The feedback loop is seconds.

Autonomous agents fail silently. When a skill executes at 3am and something goes wrong — API rate limit, unexpected state, wrong branch — you find out at 8am. By then, the agent has run 40 more tasks. The failure is three steps deep in a dependency chain.

Skills for autonomous agents need evidence trails, not just outputs. The difference:

- **Interactive:** "Deployed successfully" — agent says it, human sees it work
- **Autonomous:** "Deployed successfully. Verified: `curl https://x.y.z/health` → `200 OK` at 03:14:22" — agent creates a verifiable artifact

Every consequential action needs a trace. Not a summary. A trace — timestamp, command, output, hash. The next session can reconstruct what happened without relying on the agent's memory.

---

## 3. Sessions don't persist

Osmani's agents run in continuous sessions. Context accumulates across the conversation. A skill can reference "what we decided earlier" and the agent knows what that means.

Autonomous agents are stateless between runs. Each container is fresh. Memory lives in external databases, not context windows. A skill that says "continue from where you left off" is instructing the agent to reconstruct state from external sources — or fabricate it.

Skills for autonomous agents must explicitly define:
- What state they produce (and where it's written)
- What state they consume (and how to fetch it)
- What happens when expected state is absent

The best skills are idempotent: re-running them on the same input produces the same correct output, regardless of whether the previous run completed. This is harder to write than it sounds. Most skills implicitly assume they're running once, in order, with fresh context.

---

## 4. "Ask the user" is a dead end

The most important difference.

Interactive skills handle uncertain decisions gracefully: "if the scope is ambiguous, ask the user." The user is there. The agent asks. They proceed.

Autonomous agents executing at 3am have no user to ask. The skill's decision gate becomes a blocking call that either:
- Times out and marks the task failed
- Gets rationalized away ("scope seems clear, proceeding")
- Causes the agent to make a unilateral decision it shouldn't

The authorization model needs to be asynchronous. Instead of blocking on user input, the agent should pause execution, write the decision to a queue, and wait for an approval signal — which the user sends from their phone when they wake up.

This is what AgentLair's approval gates do. Not "block until the user is there" — that prevents autonomous execution entirely. Instead: "pause this action, notify the user, resume when approved." The agent keeps running other tasks. The high-stakes action waits.

---

## The pattern is right. The governance layer is what's missing.

Osmani's framework — encode process as skills, inject contextually, enforce anti-rationalization — is exactly right. It's the most effective way to get consistent behavior from LLM-based agents.

But for autonomous agents, skills alone aren't enough. The gaps are:
- Enforcement must be code-level, not text-level
- Consequential actions must produce verifiable traces
- State must be externalized and explicitly consumed
- Human authorization must work asynchronously

The good news: these aren't AI research problems. They're software engineering problems. Queues, audit logs, idempotency keys, and webhook-style approval flows. The primitives exist. They just need to be wired into the agent execution layer.

That's what we're building at AgentLair.

---

*AgentLair provides trust infrastructure for autonomous agents: JWKS-verifiable identity, audit trails, and asynchronous approval gates. If you're running agents that execute outside business hours, [see what we're building](https://agentlair.dev).*
