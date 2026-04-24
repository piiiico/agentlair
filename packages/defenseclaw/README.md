# @agentlair/defenseclaw

[![npm version](https://img.shields.io/npm/v/@agentlair/defenseclaw)](https://www.npmjs.com/package/@agentlair/defenseclaw)
[![AgentLair Trust](https://img.shields.io/badge/AgentLair-Trust%20Verified-00c896?logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDJMMiA3bDEwIDUgMTAtNUwxMiAyek0yIDE3bDEwIDUgMTAtNVYybC0xMCA1TDIgMTJ2NXoiLz48L3N2Zz4=)](https://agentlair.dev/docs/trust)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **AgentLair behavioral trust verification for DefenseClaw.**
> Closes the identity gap — before DefenseClaw approves an action, verify the agent has earned it.

---

## The Problem

[DefenseClaw](https://github.com/cisco-ai-defense/defenseclaw) governs agent **actions** brilliantly — scanning skills, enforcing policies, blocking malicious tools. But it has no concept of **who** is performing the action. A brand-new agent with no history gets the same treatment as one with a 6-month record of safe behavior.

[AgentLair](https://agentlair.dev) solves the identity half: every agent gets a cryptographic identity (EdDSA JWT) and a behavioral trust score that accumulates over time. New agents start at 30 ("cold start"). Trusted agents reach 70+.

This plugin wires the two together: before DefenseClaw approves a tool call, it checks the calling agent's trust score. Cold-start agents get extra scrutiny. Established agents pass through.

```
Agent calls tool
       ↓
@agentlair/defenseclaw
       ↓
  AgentLair Trust API → score: 75
       ↓
  tier: TRUSTED → allow
```

---

## Install

```bash
npm install @agentlair/defenseclaw
# or
bun add @agentlair/defenseclaw
```

---

## Usage

### Zero-config (uses `AGENTLAIR_API_KEY` env var)

```ts
// defenseclaw.plugin.ts
import agentlairDefenseClaw from '@agentlair/defenseclaw';

export default agentlairDefenseClaw;
```

Add to your `openclaw.plugin.json`:

```json
{
  "extensions": ["./defenseclaw.plugin.js"]
}
```

### Custom policy

```ts
import { createPlugin } from '@agentlair/defenseclaw';

export default createPlugin({
  trust: {
    apiKey: process.env.AGENTLAIR_API_KEY,
  },
  policy: {
    COLD_START: 'audit',   // warn instead of block (good for dev)
    CAUTIOUS: 'audit',     // always audit mid-tier agents
    TRUSTED: 'allow',      // full trust
  },
  highRiskTools: ['bash', 'write_file', 'delete_file', 'http_request'],
  blockOnFailure: false,   // fail open if AgentLair is unreachable
});
```

---

## Trust Tiers

| Tier | Score | Default Policy | Meaning |
|------|-------|----------------|---------|
| `TRUSTED` | ≥ 70 | `allow` | Established behavioral history |
| `CAUTIOUS` | 31–69 | `audit` | Building history — allow with logging |
| `COLD_START` | ≤ 30 | `block` | New agent, no record — extra scrutiny |

**High-risk tool escalation:** A `CAUTIOUS` agent calling a high-risk tool (bash, write_file, etc.) is treated as `COLD_START`.

---

## Configuration

```ts
interface DefenseClawPluginConfig {
  /** AgentLair API options */
  trust?: {
    apiKey?: string;       // default: AGENTLAIR_API_KEY env var
    baseUrl?: string;      // default: https://agentlair.dev
    timeoutMs?: number;    // default: 2000ms
  };

  /** Per-tier enforcement: 'allow' | 'audit' | 'block' */
  policy?: {
    TRUSTED?: TierPolicy;
    CAUTIOUS?: TierPolicy;
    COLD_START?: TierPolicy;
  };

  /** Tool names treated as high-risk (escalates CAUTIOUS → COLD_START) */
  highRiskTools?: string[];

  /** Block if trust API is unreachable? Default: false (fail open) */
  blockOnFailure?: boolean;
}
```

---

## How It Works

1. DefenseClaw fires `before_tool_call` for every tool invocation
2. This plugin extracts `agentId` from the OpenClaw `ToolContext`
3. Calls `GET https://agentlair.dev/v1/trust/{agentId}/check`
4. Maps the score to a tier, applies policy, returns block/allow

The AgentLair trust API returns:
```json
{ "trusted": true, "score": 75 }
```

---

## Architecture Note

DefenseClaw governs **what agents do**. AgentLair verifies **who agents are** and **whether they've earned trust**. Neither replaces the other — they're orthogonal layers of defense.

```
┌─────────────────────────────────┐
│  DefenseClaw (action governance) │
│   ┌───────────────────────────┐  │
│   │  @agentlair/defenseclaw   │  │
│   │  (identity + trust layer) │  │
│   └───────────────────────────┘  │
│   ┌───────────────────────────┐  │
│   │  AgentLair Trust API      │  │
│   │  score: 0–100             │  │
│   └───────────────────────────┘  │
└─────────────────────────────────┘
```

---

## Links

- [AgentLair Trust Docs](https://agentlair.dev/docs/trust)
- [DefenseClaw Repo](https://github.com/cisco-ai-defense/defenseclaw)
- [Discussion: AgentLair + DefenseClaw integration](https://github.com/cisco-ai-defense/defenseclaw/discussions/121)
- [npm: @agentlair/defenseclaw](https://www.npmjs.com/package/@agentlair/defenseclaw)

---

MIT License · Built by [AgentLair](https://agentlair.dev)
