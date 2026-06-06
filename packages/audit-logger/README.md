# @agentlair/audit-logger

A lightweight, framework-agnostic agent action logger. Log locally by default. Connect to [AgentLair](https://agentlair.dev) for persistent, queryable audit trails.

Zero runtime dependencies. Works in Node ≥ 18, Bun, Deno, and modern browsers.

---

## Install

```bash
npm install @agentlair/audit-logger
# or
bun add @agentlair/audit-logger
```

---

## Quick start

```typescript
import { auditLog } from '@agentlair/audit-logger';

// Logs to console — no config needed
await auditLog({
  agent: 'my-agent',
  action: 'tool_call',
  tool: 'web_search',
  input: 'latest AI news',
  output: results,
});
```

**Output:**
```
[audit 14:32:01] my-agent → tool_call [web_search]
```

---

## Connect to AgentLair

Set `AGENTLAIR_API_KEY` to ship audit logs to AgentLair for persistent storage and querying.

```bash
export AGENTLAIR_API_KEY=aal_...
```

That's it. All `auditLog()` calls will now also POST to AgentLair asynchronously (non-blocking, fire-and-forget).

Get a free API key at [agentlair.dev](https://agentlair.dev).

---

## API

### `auditLog(entry)` — module-level convenience

```typescript
await auditLog({
  agent: string;        // Name/ID of the agent
  action: string;       // Action category (e.g. "tool_call", "llm_response", "decision")
  tool?: string;        // Tool name, if this is a tool call
  input?: unknown;      // Input to the tool or LLM
  output?: unknown;     // Output from the tool or LLM
  timestamp?: string;   // ISO 8601 — defaults to now
  metadata?: Record<string, unknown>;  // Any additional context
});
```

### `configureLogger(options)` — configure defaults

```typescript
import { configureLogger } from '@agentlair/audit-logger';

configureLogger({
  apiKey: 'aal_...',    // or set AGENTLAIR_API_KEY
  console: true,        // write to console (default: true)
  silent: false,        // suppress all output (useful in tests)
  sinks: [              // custom sinks
    { write(entry) { myDb.insert(entry); } }
  ],
});
```

### `AuditLogger` — class-based API

```typescript
import { AuditLogger } from '@agentlair/audit-logger';

const logger = new AuditLogger({ apiKey: process.env.AGENTLAIR_API_KEY });

await logger.log({ agent: 'my-agent', action: 'tool_call', tool: 'search', input: q });
await logger.logAll([entry1, entry2, entry3]);
```

---

## Framework adapters

### LangChain.js

```typescript
import { AgentExecutor } from 'langchain/agents';
import { AuditLoggerCallbackHandler } from '@agentlair/audit-logger/langchain';

const handler = new AuditLoggerCallbackHandler({ agentName: 'my-agent' });
const executor = new AgentExecutor({ agent, tools, callbacks: [handler] });

// All tool calls and LLM invocations are now logged
const result = await executor.invoke({ input: 'What is AgentLair?' });
```

Captured events: `handleToolStart`, `handleToolEnd`, `handleToolError`, `handleLLMStart`, `handleLLMEnd`, `handleChainStart`, `handleChainEnd`.

### Anthropic / Claude SDK

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { wrapAnthropicClient } from '@agentlair/audit-logger/anthropic';

const client = new Anthropic();
const audited = wrapAnthropicClient(client, { agentName: 'researcher' });

// Use exactly like normal client
const msg = await audited.messages.create({
  model: 'claude-opus-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Explain AgentLair in one sentence.' }],
});
```

Logged: request params summary + response usage (input/output tokens, stop reason).

---

## Custom sinks

Implement the `AuditSink` interface to write to any backend:

```typescript
import type { AuditSink, ResolvedAuditEntry } from '@agentlair/audit-logger';

const postgresSink: AuditSink = {
  async write(entry: ResolvedAuditEntry) {
    await db.insert('audit_log', entry);
  },
};

const logger = new AuditLogger({ sinks: [postgresSink], console: false });
```

---

## AgentLair storage

When `AGENTLAIR_API_KEY` is set, audit entries are stored as Observations under the `audit-log` topic. You can query them using the AgentLair SDK:

```typescript
import { AgentLair } from '@agentlair/sdk';

const lair = new AgentLair(process.env.AGENTLAIR_API_KEY!);
const { observations } = await lair.observations.read({
  topic: 'audit-log',
  limit: 50,
});
```

---

## Denied call flow

When a tool call is blocked by policy before execution, record the denial using `phase: 'denied'`. The terminal receipt participates in the hash chain just like any executed receipt.

```typescript
// beginAction records the pre-action with the policy decision
const preAction = await logger.beginAction({
  toolName: 'delete_file',
  toolCallId: 'call-004',
  input: { path: '/important.txt' },
  approvalDecision: 'denied',
  decidedBy: 'policy-engine',
});

// endAction records the denial in the terminal receipt
const terminal = await logger.endAction({
  preAction,
  phase: 'denied',
  terminalReason: 'Policy: production files protected',
});

// terminal.phase === 'denied'
// terminal.terminalAt === ISO timestamp
// No executionStartedAt, executionEndedAt, resultDigest, errorClass
```

Attempting to call `endAction` with `phase: 'executed'` on a denied pre-action will throw at sign time.

---

## License

MIT © [AgentLair](https://agentlair.dev)
