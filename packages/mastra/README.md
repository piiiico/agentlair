# @agentlair/mastra

AgentLair integration for [Mastra](https://mastra.ai) — agent identity verification, behavioral trust scoring, and trust-gated tool execution.

## Install

```bash
npm install @agentlair/mastra
# peer dependencies
npm install @mastra/core zod
```

## Quick Start

```typescript
import { AgentLairAuth } from '@agentlair/mastra/auth';
import { createAgentLairTools } from '@agentlair/mastra/tools';
import { trustGated } from '@agentlair/mastra/middleware';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';

// 1. Auth — verify agent identity tokens (EdDSA/Ed25519 via JWKS)
const auth = new AgentLairAuth({
  apiKey: process.env.AGENTLAIR_API_KEY,
  audience: 'https://my-service.com',
  fetchTrustScore: true,
});

// 2. Tools — expose trust scoring + email to your agents
const tools = createAgentLairTools({
  apiKey: process.env.AGENTLAIR_API_KEY,
});

// 3. Trust-gate sensitive tools
const safeDeploy = trustGated(myDeployTool, {
  apiKey: process.env.AGENTLAIR_API_KEY,
  minimumScore: 700,
  requiredTier: 'trusted',
});

// 4. Wire into Mastra
const agent = new Agent({
  id: 'my-agent',
  tools: { ...tools, safeDeploy },
});

const mastra = new Mastra({
  agents: { myAgent: agent },
  server: { middleware: [auth.middleware()] },
});
```

## Features

### Agent Identity (`@agentlair/mastra/auth`)

Verify EdDSA-signed Agent Authentication Tokens (AATs) against AgentLair's JWKS endpoint.

```typescript
import { AgentLairAuth } from '@agentlair/mastra/auth';

const auth = new AgentLairAuth({
  audience: 'https://my-service.com',
  fetchTrustScore: true,
  minimumTrustScore: 500, // reject agents below this score
});

// Verify a token directly
const agent = await auth.authenticate('Bearer eyJ...');
console.log(agent.accountId, agent.name, agent.scopes);

// Use as Mastra middleware
const mastra = new Mastra({
  server: {
    middleware: [auth.middleware('/api/*')],
  },
});
```

### Trust Scoring Tools (`@agentlair/mastra/tools`)

Six tools your agents can use for identity, trust, and communication:

| Tool | Description |
|------|-------------|
| `agentlair-verify-agent` | Verify an agent's identity token |
| `agentlair-trust-score` | Look up behavioral trust score (0-1000) |
| `agentlair-trust-gate` | Check if agent meets a trust threshold |
| `agentlair-record-observation` | Record behavioral observations |
| `agentlair-send-email` | Send email from @agentlair.dev |
| `agentlair-check-inbox` | Check email inbox |

```typescript
import { createAgentLairTools } from '@agentlair/mastra/tools';

// Include all tools
const allTools = createAgentLairTools({ apiKey: process.env.AGENTLAIR_API_KEY });

// Or select categories
const trustOnly = createAgentLairTools({
  apiKey: process.env.AGENTLAIR_API_KEY,
  includeCommunication: false,
  includeIdentity: false,
});
```

### Trust-Gated Execution (`@agentlair/mastra/middleware`)

Wrap any Mastra tool to require a minimum trust score before execution:

```typescript
import { trustGated, trustGateAll } from '@agentlair/mastra/middleware';

// Gate a single tool
const safeTool = trustGated(dangerousTool, {
  apiKey: process.env.AGENTLAIR_API_KEY,
  minimumScore: 700,
  requiredTier: 'trusted',
  requiredScopes: ['write:data'],
});

// Gate all tools at once
const safeTools = trustGateAll(myTools, {
  apiKey: process.env.AGENTLAIR_API_KEY,
  minimumScore: 500,
});

// Custom gate logic
const customGated = trustGated(tool, {
  gate: (agent) => agent.name === 'known-partner-agent',
});
```

## Trust Score Breakdown

Scores range 0-1000 across four categories (250 each):

| Category | What it measures |
|----------|-----------------|
| **Behavioral** | Adherence to declared behavior patterns |
| **Consistency** | Stability of actions over time |
| **Reputation** | Quality of interactions with other agents |
| **Transparency** | Audit trail completeness |

Trust tiers: `untrusted` (0-249) → `provisional` (250-499) → `trusted` (500-749) → `verified` (750-1000)

## API Reference

### `AgentLairAuth`

| Method | Description |
|--------|-------------|
| `authenticate(token)` | Verify AAT, return `VerifiedAgent` |
| `hasScope(agent, scope)` | Check if agent has a scope |
| `meetsTrustTier(agent, tier)` | Check minimum trust tier |
| `getTrustScore(agentId)` | Fetch trust score from API |
| `middleware(path?)` | Create Hono-compatible middleware |
| `clearCache()` | Clear JWKS key cache |

### `createAgentLairTools(options)`

Returns `Record<string, ToolAction>` compatible with Mastra's agent `tools` config.

### `trustGated(tool, options)` / `trustGateAll(tools, options)`

Wraps tool execution with trust checks. Options:

| Option | Default | Description |
|--------|---------|-------------|
| `minimumScore` | 500 | Required trust score (0-1000) |
| `requiredTier` | - | Required trust tier |
| `requiredScopes` | - | Required JWT scopes |
| `gate` | - | Custom gate function |
| `onDenied` | `'throw'` | `'throw'` or `'return-error'` |

## License

MIT
