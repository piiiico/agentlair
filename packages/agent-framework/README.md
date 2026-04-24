# @agentlair/agent-framework

Behavioral trust middleware for [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) apps. Gates tool execution and A2A delegations based on cross-organizational trust scores from [AgentLair](https://agentlair.dev).

## Why

Microsoft Agent Framework 1.0 ships with MCP for tools and A2A for agent-to-agent communication. It does not ship with behavioral trust — the question isn't _who_ is calling your agent, but _should you trust them based on what they've done before?_

Microsoft's AGT answers this within a single organization. AgentLair answers it across organizations — trust scores that follow agents wherever they go.

## Install

```bash
npm install @agentlair/agent-framework
```

## Quick Start

```typescript
import {
  createTrustFilter,
  TelemetryCollector,
  createA2ATrustHandler,
} from '@agentlair/agent-framework';

// 1. Gate tool calls by trust score
const trustFilter = createTrustFilter({
  apiKey: process.env.AGENTLAIR_API_KEY,
  minimumScore: 200,
});
kernel.addFilter('functionInvocation', trustFilter);

// 2. Collect behavioral telemetry
const telemetry = new TelemetryCollector({
  apiKey: process.env.AGENTLAIR_API_KEY!,
});

// 3. Verify A2A delegations
const a2aTrust = createA2ATrustHandler({
  apiKey: process.env.AGENTLAIR_API_KEY,
  minimumScore: 300,
});
```

## Three Integration Layers

### 1. Function Invocation Filters

Gate tool execution in the kernel's filter pipeline. Every MCP tool call, native function, and plugin operation passes through the filter.

```typescript
import { createTrustFilter } from '@agentlair/agent-framework/filters';

// Block untrusted agents, audit provisional ones
const filter = createTrustFilter({
  apiKey: process.env.AGENTLAIR_API_KEY,
  minimumScore: 200,
  policy: {
    verified: 'allow',
    trusted: 'allow',
    provisional: 'audit',   // Log but allow
    untrusted: 'block',      // Reject execution
  },
  highRiskTools: ['bash', 'write_file', 'send_email', 'deploy'],
});

kernel.addFilter('functionInvocation', filter);
```

**Telemetry-only mode** — observe without blocking:

```typescript
import { createTelemetryFilter } from '@agentlair/agent-framework/filters';

// Log everything, block nothing (safe first step)
kernel.addFilter('functionInvocation', createTelemetryFilter({
  apiKey: process.env.AGENTLAIR_API_KEY,
}));
```

### 2. Behavioral Telemetry

Collect tool calls, MCP operations, and A2A interactions as behavioral events. Batched and non-blocking.

```typescript
import { TelemetryCollector } from '@agentlair/agent-framework/telemetry';

const telemetry = new TelemetryCollector({
  apiKey: process.env.AGENTLAIR_API_KEY!,
  flushInterval: 5000,    // Batch flush every 5s
  maxBufferSize: 100,     // Force flush at 100 events
});

// Record events
telemetry.recordToolCall('web_search', { query: 'test' }, 'success', 120);
telemetry.recordMCPOperation('tool_call', 'brave-search', 'success', 450);
telemetry.recordA2ADelegation('agent-456', 'Research competitors');
telemetry.recordSession('session_start');

// On shutdown
await telemetry.shutdown();
```

### 3. A2A Trust Verification

Verify agent identity and trust before accepting delegated tasks or sending work to other agents.

```typescript
import { createA2ATrustHandler, enrichAgentCard }
  from '@agentlair/agent-framework/a2a';

const trust = createA2ATrustHandler({
  apiKey: process.env.AGENTLAIR_API_KEY,
  minimumScore: 300,
});

// Before accepting an incoming task
const decision = await trust.verifyIncoming({
  agentId: 'agent_abc123',
  taskId: 'task-789',
  description: 'Research market data',
});

if (!decision.allowed) {
  return { error: decision.reason };
}

// Before delegating to another agent
const outbound = await trust.verifyOutgoing('agent_xyz789');
if (!outbound.allowed) {
  // Find a more trusted agent
}

// Publish your Agent Card with trust metadata
const card = enrichAgentCard(baseCard, {
  agentId: 'my-agent-id',
  auditUrl: 'https://agentlair.dev/audit/my-agent-id',
});
```

## Trust Tiers

| Tier | Score | Default Policy | Meaning |
|------|-------|----------------|---------|
| `verified` | 800+ | allow | Extensive, consistent behavioral history |
| `trusted` | 500–799 | allow | Established positive track record |
| `provisional` | 200–499 | audit | Building history — permit with logging |
| `untrusted` | 0–199 | block | New or flagged — deny by default |

High-risk tools (bash, deploy, send_email, etc.) escalate `provisional` agents to `untrusted` enforcement.

## Progressive Adoption

1. **Day 1:** Add `createTelemetryFilter()` — observe everything, block nothing
2. **Week 1:** Review telemetry, identify trust patterns
3. **Week 2:** Switch to `createTrustFilter({ minimumScore: 200 })` — start gating
4. **Week 3:** Add `createA2ATrustHandler()` — gate A2A delegations
5. **Ongoing:** Tune policies per tier, adjust high-risk tool lists

## Configuration Reference

### `createTrustFilter(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | — | AgentLair API key |
| `baseUrl` | `string` | `https://agentlair.dev` | API base URL |
| `minimumScore` | `number` | `0` | Minimum trust score for execution |
| `requiredTier` | `TrustTier` | — | Required tier (overrides score) |
| `highRiskTools` | `string[]` | [see defaults] | Tools that escalate provisional agents |
| `blockOnFailure` | `boolean` | `false` | Block if trust API unreachable |
| `emitTelemetry` | `boolean` | `true` | Emit events to AgentLair |
| `extractAgentId` | `function` | — | Custom agent ID extraction |
| `policy` | `TrustPolicyMap` | see tiers | Per-tier policy overrides |
| `timeout` | `number` | `2000` | API timeout (ms) |

### `TelemetryCollector(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | AgentLair API key |
| `flushInterval` | `number` | `5000` | Batch interval (ms) |
| `maxBufferSize` | `number` | `100` | Buffer limit before force-flush |
| `sessionId` | `string` | auto | Session grouping ID |

### `createA2ATrustHandler(options)`

Same options as `createTrustFilter` plus `policy` overrides.

## How It Works

```
Your Agent Framework App
         │
    ┌────▼────┐
    │ Filter  │──── Trust score check (cached 60s)
    │ Pipeline│──── Policy enforcement (allow/audit/block)
    └────┬────┘
         │
    ┌────▼────┐
    │ Tool    │──── Execute function
    │ Call    │
    └────┬────┘
         │
    ┌────▼────────┐
    │ Telemetry   │──── Behavioral event (fire-and-forget)
    │ Collector   │──── Batch → AgentLair /v1/events
    └─────────────┘
         │
    ┌────▼────┐
    │AgentLair│──── Trust score updated
    │ Engine  │──── Score available to all consumers
    └─────────┘
```

## Related Packages

- [`@agentlair/sdk`](https://npmjs.com/package/@agentlair/sdk) — Core AgentLair client
- [`@agentlair/verify`](https://npmjs.com/package/@agentlair/verify) — AAT verification middleware
- [`@agentlair/mastra`](https://npmjs.com/package/@agentlair/mastra) — Mastra framework integration
- [`@agentlair/defenseclaw`](https://npmjs.com/package/@agentlair/defenseclaw) — OpenClaw plugin

## License

MIT
