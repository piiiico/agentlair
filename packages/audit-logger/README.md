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

## Two-receipt AAR (recommended)

The standard `auditLog()` emits a single post-action record. For tamper-evidence and pre-authorization anchoring, use `beginAction` / `endAction` to emit **two chained receipts** per tool call — one before execution begins, one terminal receipt when the attempt closes.

```typescript
import { AuditLogger } from '@agentlair/audit-logger';

const logger = new AuditLogger({
  actorId: 'agent-researcher',
  hmacSecret: process.env.AUDIT_HMAC_SECRET, // optional signing key
});

// 1. Emit the pre-action receipt BEFORE execution begins.
//    expiresAt is authority data — covered by previousReceiptHash,
//    so tampering with the deadline after signing breaks the chain.
const preAction = await logger.beginAction({
  toolName: 'web_search',
  toolCallId: 'call-abc123',
  input: { query: 'latest AI agent frameworks' },
  approvalDecision: 'approved',     // from preflight_trust_check
  policyRef: 'trust-check:xyz-789', // link to the trust check result
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

// 2. Execute the tool
const startedAt = new Date();
let output: unknown;
let error: Error | undefined;
try {
  output = await webSearch({ query: 'latest AI agent frameworks' });
} catch (err) {
  error = err as Error;
} finally {
  const endedAt = new Date();

  // 3. Seal the attempt with a terminal receipt.
  //    phase defaults to "executed"; pass "failed" / "denied" / "expired" / "cancelled"
  //    when the attempt closes without successful execution.
  await logger.endAction({
    preAction,
    phase: error ? 'failed' : 'executed',
    startedAt,
    endedAt,
    output, // undefined on error
    error,  // undefined on success
  });
}
```

### Why two receipts?

A single post-action log proves nothing about intent — a compromised agent can construct a plausible receipt for an action it never authorized. The pre-action receipt is signed and chained **before** execution begins. To forge it, an adversary must predict the future or have already compromised the signing key.

| Receipt              | Phase            | What it proves                                                |
|----------------------|------------------|---------------------------------------------------------------|
| `AARPreAction`       | Before execution | Input digest, authorization decision, deadline, chain position |
| `AARTerminalReceipt` | Attempt closed   | Terminal phase, link back to pre-action, result/error digest  |

**Every `beginAction` closes exactly once.** A denied or expired attempt is first-class evidence, not an absence — the chain detects omissions.

### Terminal phase enum

`endAction({ phase })` accepts one of:

| Phase       | Meaning                                                                  |
|-------------|--------------------------------------------------------------------------|
| `executed`  | Tool ran to completion. `resultDigest` carries the output hash.          |
| `failed`    | Tool ran but threw. `errorClass` / `errorDigest` carry the failure.      |
| `denied`    | Policy refused before execution. No `executionStartedAt`.                |
| `expired`   | Authority window elapsed before completion. `terminalAt >= expiresAt`.   |
| `cancelled` | Caller withdrew the attempt before completion.                           |

**Sign-time invariants enforced at `endAction()`:**

- `phase: 'executed'` over `approvalDecision: 'denied'` throws. Executed-over-denied is structurally impossible to mint.
- `phase: 'executed'` whose `executionEndedAt > preAction.expiresAt` throws (v0.4). The logger refuses to claim authorized execution past the deadline.

### Chain mechanics

Each receipt includes a `previousReceiptHash` (SHA-256 of the canonical-JSON prior receipt payload). The chain grows linearly:

```
AARPreAction (tool 1)        → previousReceiptHash = undefined (chain start)
AARTerminalReceipt (tool 1)  → previousReceiptHash = hash(AARPreAction tool 1)
AARPreAction (tool 2)        → previousReceiptHash = hash(terminal of tool 1)
AARTerminalReceipt (tool 2)  → previousReceiptHash = hash(AARPreAction tool 2)
```

Denied, expired, and cancelled terminals participate in the chain just like executed ones — omitting any of them breaks the successor's hash and is detectable by any verifier.

---

## Lightweight logging

For simple use cases, `auditLog()` emits a single post-action record with no configuration required:

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

`createAuditLogger` binds the agent name so you don't repeat it on every call:

```typescript
import { createAuditLogger } from '@agentlair/audit-logger';

const log = createAuditLogger('inventory-agent');

await log({ action: 'check_stock', tool: 'db_query', input: { sku: 'ABC-123' } });
await log({ action: 'reorder', output: { orderId: 'PO-9999' } });
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

### `auditLog(entry, opts?)` — module-level convenience

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

### `AuditLogger` class

For AAR split (beginAction/endAction) and HMAC signing, instantiate directly:

```typescript
const logger = new AuditLogger({
  actorId: string;        // Agent identity (used as 'sub' in receipts)
  hmacSecret?: string;    // Optional: HMAC-SHA256 key for receipt signing
  apiKey?: string;        // Optional: AgentLair API key (or set AGENTLAIR_API_KEY)
  silent?: boolean;       // Optional: suppress transport (testing)
});
```

### `logger.beginAction(opts)` → `Promise<AARPreAction>`

Emits a signed, chained pre-action receipt. Call **before** tool execution.

| Field              | Type                                          | Required | Description                                                  |
|--------------------|-----------------------------------------------|----------|--------------------------------------------------------------|
| `toolName`         | `string`                                      | ✓        | Name of the tool being called                                |
| `toolCallId`       | `string`                                      | ✓        | Framework-assigned call ID                                   |
| `input`            | `unknown`                                     | ✓        | Input (SHA-256 digested, not stored raw)                     |
| `approvalDecision` | `'approved' \| 'denied' \| 'conditional'`     | —        | From preflight_trust_check                                   |
| `policyRef`        | `string`                                      | —        | Link to the trust check result ID                            |
| `decidedBy`        | `string`                                      | —        | Identity who approved (for human-gated tools)                |
| `sessionId`        | `string`                                      | —        | Session context                                              |
| `expiresAt`        | `string \| Date`                              | —        | ISO 8601 deadline (v0.4). Covered by `previousReceiptHash`. |

### `logger.endAction(opts)` → `Promise<AARTerminalReceipt>`

Seals the attempt with a terminal receipt. Call exactly once per `beginAction`.

| Field            | Type                                                                    | Required | Description                                                                          |
|------------------|-------------------------------------------------------------------------|----------|--------------------------------------------------------------------------------------|
| `preAction`      | `AARPreAction`                                                          | ✓        | The receipt returned by `beginAction`                                                |
| `phase`          | `'executed' \| 'failed' \| 'denied' \| 'expired' \| 'cancelled'`       | —        | Defaults to `'executed'`. See Terminal phase enum above.                             |
| `startedAt`      | `Date`                                                                  | —        | When execution began. Omit for `denied` / `expired` / `cancelled`.                   |
| `endedAt`        | `Date`                                                                  | —        | When execution ended. Sign-time check: `executed` throws if `endedAt > expiresAt`.  |
| `terminalAt`     | `Date`                                                                  | —        | Observation time of attempt close. Defaults to `now`.                               |
| `terminalReason` | `string`                                                                | —        | Human-readable explanation (`'policy_deadline'`, `'user_cancel'`, ...).              |
| `output`         | `unknown`                                                               | —        | Tool output (SHA-256 digested). Only for `executed`.                                 |
| `error`          | `Error`                                                                 | —        | Error from failed execution. Only for `failed`.                                      |

**Returns:** `AARTerminalReceipt` with `resultDigest` (executed), `errorClass` / `errorDigest` (failed), `previousReceiptHash` linking back to the pre-action, and a signed `terminalAt` timestamp.

### `configureLogger(options)` — configure module-level defaults

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

---

## Framework adapters

### LangChain.js

```typescript
import { AgentAuditCallback } from '@agentlair/audit-logger/langchain';
import { LLMChain } from 'langchain/chains';
import { ChatOpenAI } from 'langchain/chat_models/openai';

const llm = new ChatOpenAI();
const chain = new LLMChain({
  llm,
  prompt,
  callbacks: [new AgentAuditCallback('my-langchain-agent')],
});

await chain.call({ question: 'What is 2+2?' });
// Automatically logs: llm_start, llm_end, tool_start, tool_end, chain_start, chain_end
```

### Anthropic / Claude SDK

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { wrapAnthropicClient } from '@agentlair/audit-logger/anthropic';

const client = wrapAnthropicClient(new Anthropic(), 'researcher');

// Use exactly like the normal client — all calls are logged
const msg = await client.messages.create({
  model: 'claude-opus-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Explain AgentLair in one sentence.' }],
});
```

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

## Querying stored audit logs

When `AGENTLAIR_API_KEY` is set, audit entries are stored as Observations under the `audit-log` topic in AgentLair:

```typescript
import { AgentLair } from '@agentlair/sdk';

const lair = new AgentLair(process.env.AGENTLAIR_API_KEY!);
const { observations } = await lair.observations.read({
  topic: 'audit-log',
  limit: 50,
});
```

---

## Local-only vs hosted AgentLair

The library is fully usable without an API key — `auditLog`, `beginAction`, and `endAction` write to console and any custom sinks you wire up. That's the right setup for development, single-process agents, and anyone who already has their own log pipeline.

You'd want the hosted side once any of these become real:

| Need                                                  | What the hosted side gives you                                                                                |
|-------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| Retention beyond your own log lifetime                | Persistent storage. Starter: 1 year of audit log retention. Enterprise: up to 7 years.                        |
| Querying across many runs / machines                  | Single endpoint to read filtered receipts (`topic: 'audit-log'`), not log-grep across boxes.                  |
| EU AI Act Article 12 (automatic recording, queryable) | Tamper-evident Ed25519-signed hash chain stored independent of the agent's control boundary.                  |
| Showing receipts to a third party                     | Public verification of chain + signature without exposing your infra.                                         |

Pricing — Free (1k verifications/month, 7-day history) · Starter $29/mo (50k verifications, 1-year audit log retention) · Pro $149/mo (500k verifications, 90-day history). Full table at [agentlair.dev/pricing](https://agentlair.dev/pricing).

Get an API key at [agentlair.dev/register](https://agentlair.dev/register) — no credit card. Then:

```bash
export AGENTLAIR_API_KEY=al_live_...
```

The same `beginAction` / `endAction` calls now also ship to the hosted side. Nothing else changes.

---

## License

MIT © [AgentLair](https://agentlair.dev)
