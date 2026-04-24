---
title: "Adding Behavioral Trust to Microsoft Agent Framework Apps"
description: "Microsoft Agent Framework 1.0 ships MCP+A2A as dual-native protocols — tools and delegation out of the box. What's missing is the question every multi-agent system must answer: should this agent be allowed to do that? Here's how to add cross-org behavioral trust in three lines."
pubDate: 2026-04-23
authorName: "Pico"
draft: true
---

Microsoft Agent Framework 1.0 is the consolidation event the ecosystem needed. AutoGen's multi-agent orchestration merged with Semantic Kernel's plugin/filter pipeline, and both MCP (for tools) and A2A (for agent-to-agent delegation) ship as first-class protocols. Build an agent, give it tools via MCP, let it delegate to other agents via A2A. The plumbing works.

What doesn't ship is the answer to a question that gets harder as the system scales: _should this agent be allowed to do that?_

## Identity Is Necessary but Not Sufficient

The framework knows _who_ is calling. OAuth, API keys, A2A Agent Cards with authentication schemes — identity is handled. Microsoft's own Agent Governance Toolkit adds 0–1000 behavioral trust scoring with five dimensions and post-quantum crypto.

But AGT's trust score [resets to zero at the organizational edge](/blog/microsoft-agt-trust-islands). An agent with a perfect 950 score inside Company A is unknown at Company B. The `did:mesh:` method doesn't federate. The signal ingestion is deployment-local. The trust decay clock runs per-deployment.

This is correct for org-internal governance. It's structurally incomplete for multi-agent systems that span organizations — which is exactly what A2A enables.

The gap is specific: you can verify _who_ sent the request (L1–L3 identity), but you cannot verify _whether they've behaved well before_ (L5 behavioral trust). The [TOCTOU of Trust](/blog/toctou-of-trust) — the gap between trust verified at authorization time and behavior at runtime — remains open.

## Three Interception Points

`@agentlair/agent-framework` adds behavioral trust to Agent Framework apps at three points where trust decisions are made:

### 1. Tool Execution (Filter Pipeline)

The Agent Framework inherits Semantic Kernel's filter pipeline — every function invocation passes through registered filters before execution. A trust filter checks the calling agent's behavioral score and applies tier-based policy.

```typescript
import { createTrustFilter } from '@agentlair/agent-framework/filters';

kernel.addFilter('functionInvocation', createTrustFilter({
  apiKey: process.env.AGENTLAIR_API_KEY,
  minimumScore: 200,
  policy: {
    verified: 'allow',     // 800+: full access
    trusted: 'allow',      // 500-799: full access
    provisional: 'audit',  // 200-499: allow but log
    untrusted: 'block',    // 0-199: reject
  },
  highRiskTools: ['bash', 'deploy', 'send_email'],
}));
```

High-risk tools get special treatment: a `provisional` agent calling `bash` or `deploy` is escalated to `untrusted` enforcement. The score that's good enough for a web search isn't good enough for shell access.

### 2. A2A Delegation (Protocol-level)

When another agent sends work via A2A, verify their trust before accepting:

```typescript
import { createA2ATrustHandler } from '@agentlair/agent-framework/a2a';

const trust = createA2ATrustHandler({
  apiKey: process.env.AGENTLAIR_API_KEY,
  minimumScore: 300,
});

// In your A2A task handler
async function handleTask(request) {
  const decision = await trust.verifyIncoming({
    agentId: request.senderAgentId,
    taskId: request.taskId,
  });

  if (!decision.allowed) {
    return { status: 'failed', error: decision.reason };
  }

  // Accept and process the task
}
```

This also works outbound — verify your delegation target before sending sensitive work:

```typescript
const outbound = await trust.verifyOutgoing('target-agent-id');
if (!outbound.allowed) {
  // Find a more trusted agent, or escalate to human
}
```

### 3. Behavioral Telemetry (Runtime-level)

Trust scores are computed from behavioral data. No observation means no trust. The telemetry collector captures tool calls, MCP operations, and A2A interactions as behavioral events:

```typescript
import { TelemetryCollector } from '@agentlair/agent-framework/telemetry';

const telemetry = new TelemetryCollector({
  apiKey: process.env.AGENTLAIR_API_KEY!,
  flushInterval: 5000,
});

// These fire-and-forget calls build your agent's trust profile
telemetry.recordToolCall('web_search', args, 'success', 120);
telemetry.recordA2ADelegation('partner-agent', 'Research task');
telemetry.recordMCPOperation('tool_call', 'brave-search', 'success', 450);
```

Events batch in memory and flush every 5 seconds. The timer is `unref`'d — it won't hold your process open. On shutdown, `await telemetry.shutdown()` drains the buffer.

## AGT Tells You If YOUR Agents Behave. AgentLair Tells You If THEIRS Do.

This isn't a competitive framing. It's an architectural one.

AGT is the best single-org governance toolkit available. Use it. Score your agents on policy compliance, resource efficiency, output quality, security posture, and collaboration health — inside your organization.

But when an agent from another org calls your A2A endpoint, AGT has no data. Their 950 score doesn't transfer. Their `did:mesh:` doesn't resolve in your registry. Their trust decay clock is running on their infrastructure, not yours.

AgentLair's score follows the agent. Built from cross-org behavioral telemetry — tool call patterns, delegation reliability, error rates, communication quality — the score is portable. An agent verified as `trusted` (500+) at Company A carries that score to Company B.

The two systems are complementary:

| | AGT (Single-Org) | AgentLair (Cross-Org) |
|---|---|---|
| **Scope** | Your deployment | Global |
| **Data source** | Your policies, your workflows | Cross-org behavioral telemetry |
| **Score portability** | None | Full |
| **Trust at org boundary** | Resets to zero | Continuous |
| **Best for** | Internal governance | External trust decisions |

## Progressive Adoption

You don't have to start with enforcement.

**Week 1:** Add `createTelemetryFilter()` — the observe-only filter that logs behavioral events without blocking anything. Zero risk, immediate telemetry.

```typescript
import { createTelemetryFilter } from '@agentlair/agent-framework/filters';
kernel.addFilter('functionInvocation', createTelemetryFilter({
  apiKey: process.env.AGENTLAIR_API_KEY,
}));
```

**Week 2:** Review the telemetry in your AgentLair dashboard. See which agents are calling which tools, how often, and with what results. Identify trust patterns.

**Week 3:** Switch to `createTrustFilter()` with a low `minimumScore`. Start gating.

**Week 4:** Add A2A trust verification. Gate delegations.

The trust data you collect in week 1 is the same data that feeds trust scores in week 4. There's no separate "training" phase — the observation IS the trust-building.

## What This Closes

The [TOCTOU of Trust](/blog/toctou-of-trust) exists because every L1–L3 solution verifies trust at authorization time but not at runtime. An agent that passed OAuth, held valid credentials, and matched the right scopes can still behave badly after verification.

Behavioral trust doesn't replace identity verification. It adds the runtime dimension that identity verification structurally can't provide. The filter pipeline checks trust on every function invocation — not once at session start, but continuously, with a score that updates as the agent acts.

With EU AI Act Article 12 enforcement arriving [August 2, 2026](/blog/eu-ai-act-agent-logging), the regulatory case for continuous behavioral monitoring is no longer theoretical. Tamper-evident logging, automatic audit trails, 6-month retention — these aren't nice-to-haves. They're mandatory for high-risk AI applications, with penalties up to 3% of global turnover.

## Get Started

```bash
npm install @agentlair/agent-framework
```

The package is zero-dependency (native `fetch` and `crypto`), works in Node 18+, Bun, and Deno, and duck-types all framework interfaces — no hard dependency on `@microsoft/agent-framework`.

Full documentation and source: [github.com/piiiico/agentlair](https://github.com/piiiico/agentlair)

---

_AgentLair is the cross-org behavioral trust layer for AI agents. [Create an account](https://agentlair.dev) — 3 lines, 45 seconds, free tier._
