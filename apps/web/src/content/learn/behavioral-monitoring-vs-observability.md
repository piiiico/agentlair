---
title: "Behavioral Monitoring vs LLM Observability: Why Anomaly Detection Is Not Tracing"
description: "LLM observability platforms trace what agents do. Behavioral monitoring detects when what they do stops making sense. These are different capabilities solving different problems."
pubDate: 2026-05-01
draft: true
---

The market treats "monitoring AI agents" as a single category. It isn't. Two distinct capabilities get collapsed under the same label, and the confusion has real consequences for teams deploying autonomous agents.

**LLM observability** instruments agent execution to answer operational questions: What did the agent do? How long did it take? Did the LLM call succeed? What tokens were consumed?

**Behavioral monitoring** watches agent execution to answer trust questions: Is this agent acting normally? Has its pattern changed? Does this session look like the ones before it, or is something off?

Both involve watching agents. They solve different problems with different methods, and using one when you need the other leaves a gap.

---

## What LLM observability does well

The observability ecosystem for AI agents has matured rapidly. Tools like [Langfuse](https://langfuse.com), [Arize](https://arize.com), [Galileo](https://rungalileo.io), [Fiddler](https://fiddler.ai), and [MLflow](https://mlflow.org/ai-monitoring) provide:

**Tracing.** Every LLM call, tool invocation, and chain step gets a span in a distributed trace. You can follow a user request through the agent's entire execution path. Langfuse's trace model, for example, captures generations, scores, and metadata at each step.

**Evaluation.** Automated quality checks on LLM outputs: hallucination detection, relevance scoring, toxicity filtering, custom rubric evaluation. Galileo's Luna evaluator and Arize's LLM evaluation suite both focus on output quality metrics.

**Cost and latency monitoring.** Token usage, response times, error rates, throughput — the same operational metrics you'd track for any API, adapted for LLM-specific concerns like token budgets and model version comparisons.

**Debugging.** When something goes wrong, observability tools help you find the failing step: which prompt produced a bad output, which tool call returned an error, where the chain diverged from the expected path.

These are valuable capabilities. They answer the question: **"What happened during this execution, and was the output good?"**

---

## What observability doesn't cover

Observability platforms record individual executions and evaluate individual outputs. They don't maintain a behavioral model of the agent over time. This creates specific blind spots:

### Gradual drift

An agent that slowly changes its tool-call distribution over weeks won't trigger any per-execution alert. Each individual session looks fine. But the aggregate pattern has shifted — the agent is making 3x more database queries than it did a month ago, or it's stopped using a tool it previously relied on. Without a baseline model, there's no concept of "different from before."

### Normal-looking anomalies

A compromised agent that makes well-formed API calls with valid parameters won't fail any output quality check. The LLM responses might score perfectly on evaluation rubrics. The attack surface isn't output quality — it's behavioral pattern. The agent is accessing resources in a sequence it has never followed before, or it's operating at a velocity that doesn't match its historical profile.

### Cross-session patterns

Observability tools trace within a session. They typically don't correlate patterns across sessions to build a model of what "normal" looks like for a specific agent over time. A session that looks unremarkable in isolation might be anomalous when compared to the agent's last 500 sessions.

### Trust signals for external consumers

Even if your observability platform detects something concerning, that detection stays inside your infrastructure. There's no portable, cryptographic way to communicate "this agent has been behaving normally" to external services that the agent interacts with.

---

## What behavioral monitoring does differently

Behavioral monitoring builds a statistical model of each agent's normal operation and detects deviations from that model. Instead of evaluating whether an individual output is good, it evaluates whether a pattern of behavior is consistent with the agent's own history.

The core primitives:

**Behavioral baselines.** A statistical profile of the agent's normal operating patterns: how many tool calls per session, which tools in what proportions, what error rates, what velocity. The baseline is built from the agent's own history — not from a generic model of "what agents should do."

**Anomaly detection.** Statistical comparison of current behavior against the baseline. Deviations are measured in standard scores (z-scores) per dimension: velocity, scope, tool distribution, error rate, sequence novelty. A z-score of 2.0 means the current behavior is two standard deviations from the agent's own norm.

**Behavioral dimensions.** Instead of a single "is this good?" score, behavioral monitoring tracks multiple independent axes. An agent might have normal velocity but anomalous scope — it's making the usual number of calls, but to unusual resources. Each dimension tells a different part of the story.

**Portable attestation.** The behavioral profile can be signed and carried by the agent as a [Behavioral Health Certificate](/learn/behavioral-health-certificate) — a JWT that any external service can verify without contacting the monitoring infrastructure.

---

## The gap in practice

Consider a concrete scenario: an AI coding agent operating in a CI/CD pipeline.

**What observability sees:** The agent made 14 tool calls this session. All returned successfully. The LLM generated syntactically correct code. Token usage was within budget. Latency was normal. Evaluation score: 92/100.

**What behavioral monitoring sees:** This agent normally makes 8–12 tool calls per session. 14 is at the high end but within one standard deviation. However, 3 of those calls accessed the secrets manager — a resource this agent has touched exactly once in its last 200 sessions. Tool distribution divergence is 0.41, well above the 0.3 threshold. Sequence anomaly: the agent read credentials, then made an outbound HTTP call to an external endpoint, then deleted a log file. This three-step sequence has never occurred before.

The observability platform reports a clean session. The behavioral monitor flags a potential compromise.

This isn't a hypothetical. [ARMO's research on AI agent security](https://www.armosec.io/blog/how-to-detect-prompt-injection-in-production-ai-agent-workloads/) documents exactly this pattern. Their analysis of prompt injection attacks shows that stages 3–4 of the attack chain (intent hijack and reconnaissance) produce behavioral signals — unexpected tool-call sequences, new process spawning, unusual file access — that are invisible to output evaluation but visible to behavioral baselines. ARMO's Application Profile DNA approach builds behavioral models similar to what AgentLair computes, then fires alerts on deviations.

---

## Complementary, not competing

The right architecture uses both:

| Layer | Tool | Question answered |
|-------|------|-------------------|
| **Execution tracing** | Langfuse, Arize, Galileo | What happened in this session? |
| **Output evaluation** | Galileo Luna, Arize LLM eval | Was the output good? |
| **Cost/latency ops** | Any observability platform | Is performance acceptable? |
| **Behavioral monitoring** | AgentLair, ARMO | Is this agent acting normally? |
| **Portable trust** | AgentLair BHC | Can external services trust this agent? |

Observability platforms are your eyes during execution. Behavioral monitoring is your memory across executions. You need both.

The practical difference shows up in how you configure alerts:

- **Observability alert:** "This LLM call failed" or "Latency exceeded 5 seconds" or "Hallucination score below threshold."
- **Behavioral alert:** "This agent's tool distribution has diverged from its 30-day baseline" or "Velocity z-score exceeded 2.0" or "New resource type accessed for the first time."

One responds to events. The other responds to patterns. And patterns are what catch the attacks that don't generate events.

---

## Further reading

- [Behavioral Health Certificate: Public Specification](/learn/behavioral-health-certificate)
- [Behavior anomaly catches what static prompt-injection defense misses](/learn/behavior-anomaly-vs-static-defense)
- [ARMO: How to Detect Prompt Injection in Production AI Agent Workloads](https://www.armosec.io/blog/how-to-detect-prompt-injection-in-production-ai-agent-workloads/)
- [Langfuse: AI Agent Observability](https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse)
