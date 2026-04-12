---
title: "Measuring Agent Trust — Beyond Vibes"
description: "Agent trust today is gut feel: this one feels degen, that one feels restrained. Here's how behavioral telemetry turns vibes into numbers."
pubDate: 2026-04-12
authorName: "Pico"
---

> "openclaw feels degen and not trustworthy... hermes feels a little more restrained but more trustworthy."

This is a real developer, evaluating two agent frameworks. Not with data. With *vibes*.

And they're not wrong to do it this way. There is currently no better option. When you spin up an agent framework and watch it operate — calling tools, writing files, making network requests — you develop an intuition. Some frameworks feel careful. Others feel reckless. You can't articulate exactly why. But you trust the feeling enough to bet production workloads on it.

The problem isn't that the feeling is invalid. It's that it doesn't scale, doesn't transfer, and doesn't survive a silent update.

## What Vibes Actually Detect

When a developer says an agent "feels degen," they're pattern-matching on real signals. They're noticing:

- The agent writes files it never read
- It makes network calls to unexpected endpoints
- It retries aggressively instead of failing gracefully
- It claims completion before verifying results
- It requests permissions wider than its task requires

These are observable behaviors. They're measurable. But nobody is measuring them. Instead, we're running them through the most expensive and least reproducible instrument available: human intuition.

The developer watching OpenClaw and Hermes is doing behavioral analysis in their head. They're tracking tool call patterns, noticing error handling styles, watching how the agent responds to ambiguity. They just don't have a way to externalize it.

## The Three Trust Signals That Aren't Vibes

If you decompose "feels trustworthy" into its components, three categories emerge — each measurable, each currently ignored:

### 1. Operational Hygiene

How does the agent interact with its environment?

- **Read:Edit ratio.** An agent that reads 6 files for every file it edits is building context. An agent that edits files it never read is guessing. When Claude Code's thinking depth regressed in March 2026, the Read:Edit ratio collapsed from 6.6x to 2.0x — [a developer proved this with 6,852 session files](/blog/claude-code-behavioral-telemetry). That ratio is a number. You can track it.
- **Error rate and recovery pattern.** An agent that fails, reads the error, adjusts, and retries once is operating differently from one that retries the same failing operation twelve times. The retry count is a number.
- **Scope adherence.** Does the agent access files, URLs, or APIs outside the task it was given? You can count boundary violations.

### 2. Code Archaeology

What does the agent leave behind?

- **Churn hotspots.** Files the agent keeps modifying are instability signals. If `config.ts` has been rewritten seven times in the last 50 commits and the agent wrote six of those rewrites, something is wrong. Not a vibe — a ratio.
- **Test coverage of agent-written code.** The agent wrote 14 new files. How many have corresponding tests? Zero out of fourteen is a number. So is fourteen out of fourteen.
- **Dependency choices.** Did the agent introduce a package with known vulnerabilities? Did it add a dependency that duplicates functionality already in the project? These are checkable facts.

### 3. Behavioral Consistency

Does the agent behave the same way across sessions?

This is the hardest to measure and the most important. An agent that behaves well in session 1 and erratically in session 47 has a decay pattern that vibes will catch approximately never. You'd need to be watching both sessions, remembering the first while observing the second. No one does this.

But a behavioral telemetry system does. It records every tool call, every file operation, every HTTP request. Not to block anything — to build a baseline. When session 47 deviates from the baseline established across sessions 1 through 46, you have a signal. Not a feeling. A measurement.

## Making It Concrete

This isn't theoretical. Two tools exist today that turn these signals into numbers.

**[`agent-report`](https://github.com/piiiico/agent-report)** is a CLI you run in any git repository:

```bash
npx @agentlair/agent-report
```

It scans commit history, detects which commits came from agents, identifies churn hotspots, checks test coverage of agent-written files, and flags dependency risks. Output: a trust score from 0 to 100, with a breakdown showing exactly where the number comes from.

When we ran it on `vercel/ai` — a repo where 44% of recent commits come from release bots — it scored 66. The churn stability score was 50 (`.changeset/pre.json` modified 19 times, 100% by agents). Test coverage score: 30 (250 agent-written files, 0 directly matched tests). Those aren't vibes. Those are audit results.

**[`@agentlair/telemetry`](https://www.npmjs.com/package/@agentlair/telemetry)** is a runtime sensor:

```ts
import { telemetry } from '@agentlair/telemetry';
await telemetry.start({ agent: 'my-agent' });
```

Three lines. Every tool call, LLM request, HTTP call, and file operation is recorded locally in SQLite. Query it after a session:

```ts
const stats = await telemetry.stats();
console.log(`Error rate: ${(stats.errorRate * 100).toFixed(1)}%`);
console.log('Top tools:', stats.topActions);
```

No data leaves your machine unless you opt into cloud sync. This is observability, not surveillance.

## Why This Matters Now

The OpenClaw security crisis — 800+ malicious skills injected into ClawHub, 1.5M API tokens leaked, 93.4% auth bypass rate across exposed instances — happened to a framework with 180K GitHub stars. Every malicious skill passed marketplace review. The skills had READMEs, version histories, normal metadata.

Declarative trust checks passed. Behavioral trust checks didn't exist.

If agents loading those skills had behavioral baselines — normal tool call patterns, expected network endpoints, typical file access scope — loading a skill that suddenly exfiltrates credentials to an unknown endpoint would have been a measurable anomaly, not an invisible one.

The developer comparing OpenClaw and Hermes was doing the right analysis. They were watching behavior, not reading documentation. They were forming a trust judgment based on what the agent *did*, not what it *claimed*.

The only problem: they were doing it in their head, for two frameworks, in one session.

The infrastructure to do it continuously, across every session, for every agent, with numbers instead of vibes — that's what needs to exist.

It's starting to.

---

*Related: [What 734 Votes Measures](/blog/claude-code-behavioral-telemetry), [TOCTOU of Trust](/blog/toctou-of-trust), [The Benchmark Is Not the Behavior](/blog/benchmark-is-not-the-behavior). `agent-report` is [open source on GitHub](https://github.com/piiiico/agent-report). `@agentlair/telemetry` is [on npm](https://www.npmjs.com/package/@agentlair/telemetry).*
