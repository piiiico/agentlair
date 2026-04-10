# @agentlair/sdk

Official TypeScript/JavaScript SDK for [AgentLair](https://agentlair.dev) — email, vault, observations, and stacks for AI agents.

**Zero dependencies. Works in Node ≥ 18, Bun, Deno, and modern browsers.**

```bash
npm install @agentlair/sdk
# or
bun add @agentlair/sdk
```

---

## Quick Start — Three Lines

```typescript
import { AgentLair } from '@agentlair/sdk';

const lair = new AgentLair(process.env.AGENTLAIR_API_KEY!);
const inbox = await lair.email.claim('my-agent');    // claims my-agent@agentlair.dev
const { messages } = await lair.email.inbox('my-agent@agentlair.dev');
```

Short names auto-expand: `'my-agent'` → `'my-agent@agentlair.dev'`.

---

## Bootstrap: Create an Account

```typescript
// No API key needed — this bootstraps a new account
const { api_key, account_id } = await AgentLair.createAccount({ name: 'my-agent' });
// ⚠️ Save api_key immediately — it will not be shown again

const lair = new AgentLair(api_key);
```

---

## Email

### `lair.email.claim(address, options?)`

Claim an `@agentlair.dev` address. Pass a short name or full address.

```typescript
await lair.email.claim('my-agent');           // → my-agent@agentlair.dev
await lair.email.claim('my-agent@agentlair.dev');  // also works

// With E2E encryption (requires X25519 keypair):
await lair.email.claim('my-agent', { public_key: base64urlPublicKey });
```

### `lair.email.inbox(address, options?)`

```typescript
const { messages, count, has_more } = await lair.email.inbox('my-agent@agentlair.dev');
const { messages } = await lair.email.inbox('my-agent', { limit: 5 });
```

### `lair.email.read(messageId, address)`

```typescript
const msg = await lair.email.read(inboxMsg.message_id_url, 'my-agent@agentlair.dev');
console.log(msg.body);
// E2E encrypted: msg.e2e_encrypted, msg.ciphertext, msg.ephemeral_public_key
```

### `lair.email.send(options)`

```typescript
await lair.email.send({
  from: 'my-agent@agentlair.dev',
  to: 'user@example.com',      // or array of addresses
  subject: 'Hello',
  text: 'Plain text body',
  html: '<p>HTML body</p>',    // optional
  in_reply_to: '<msg-id>',     // optional threading
});
```

### `lair.email.outbox(options?)`

```typescript
const { messages } = await lair.email.outbox({ limit: 20 });
```

### `lair.email.addresses()`

```typescript
const { addresses } = await lair.email.addresses();
```

### `lair.email.deleteMessage(messageId, address)`

```typescript
await lair.email.deleteMessage(msg.message_id_url, 'my-agent@agentlair.dev');
```

### `lair.email.update(messageId, address, options)`

```typescript
await lair.email.update(msg.message_id_url, 'my-agent@agentlair.dev', { read: false });
```

---

## Email Webhooks

Real-time `email.received` events delivered to your URL.

```typescript
// Register
const hook = await lair.email.webhooks.create({
  address: 'my-agent@agentlair.dev',
  url: 'https://myserver.com/webhook',
  secret: 'my-secret',  // optional — enables X-AgentLair-Signature header
});

// List
const { webhooks } = await lair.email.webhooks.list();

// Delete
await lair.email.webhooks.delete(hook.id);
```

---

## Vault

Zero-knowledge secret store. Server stores opaque blobs — it never sees plaintext.
Use [`@agentlair/vault-crypto`](https://www.npmjs.com/package/@agentlair/vault-crypto) for client-side encryption.

```typescript
// Store
await lair.vault.put('openai-key', { ciphertext: encryptedBlob });
await lair.vault.put('config', { ciphertext: enc, metadata: { label: 'prod config' } });

// Retrieve (latest version by default)
const { ciphertext, version } = await lair.vault.get('openai-key');
const old = await lair.vault.get('openai-key', { version: 1 });

// List
const { keys, count, limit } = await lair.vault.list();

// Delete
await lair.vault.delete('openai-key');           // all versions
await lair.vault.delete('openai-key', { version: 2 }); // v2 only
```

---

## Budget & Spending Controls

Set per-period spending caps and decide what happens when an agent hits the limit:
- `on_limit: 'reject'` — the charge throws `AgentLairError` with HTTP **402** (default; hard block)
- `on_limit: 'approve'` — the charge returns HTTP **202** and waits for principal approval

Amounts are in **atomic USDC units** (1e-6). 1 USDC = `1_000_000`.

### Set a spending cap

```typescript
await lair.budget.set({
  daily: 5_000_000,    // 5 USDC/day
  weekly: 20_000_000,  // 20 USDC/week
  on_limit: 'approve', // or 'reject' (default)
});
```

### Get current budget

```typescript
const { caps, on_limit } = await lair.budget.get();
console.log(caps.daily?.spent_usdc, '/', caps.daily?.limit_usdc, 'USDC');
```

### Declare a charge

```typescript
import { AgentLairError } from '@agentlair/sdk';

try {
  const result = await lair.budget.charge({
    amount: 7_000_000,         // 7 USDC — exceeds the 5 USDC daily cap
    category: 'inference',     // optional
    description: 'Claude batch call',
    reference_id: 'job_abc',   // optional — tie to your own request ID
  });

  if (result.charge_id) {
    // Charge recorded immediately — within budget
  }

  if (result.approval_id) {
    // Budget exceeded + on_limit=approve → awaiting principal decision
    // result.reason: 'budget_exceeded' | 'single_tx_limit_exceeded'
    // result.exceeded: [{ period, spent_usdc, limit_usdc }]
  }
} catch (e) {
  if (e instanceof AgentLairError && e.status === 402) {
    // Budget exceeded + on_limit=reject (or single_tx_limit exceeded)
  }
}
```

### Approval flow — principal side

```typescript
// List pending approvals
const { approvals } = await lair.budget.approvals('pending');

// Get a specific approval
const approval = await lair.budget.getApproval(approvalId);
console.log(approval.status); // 'pending' | 'approved' | 'rejected' | 'expired'

// Approve — records the charge and debits the budget
await lair.budget.approve(approvalId);

// Reject — no charge recorded
await lair.budget.reject(approvalId, 'exceeds quarterly budget'); // reason is optional
```

### Poll approval status (agent side)

```typescript
async function waitForApproval(approvalId: string): Promise<'approved' | 'rejected' | 'expired'> {
  while (true) {
    const approval = await lair.budget.getApproval(approvalId);
    if (approval.status !== 'pending') return approval.status;
    await new Promise(r => setTimeout(r, 2000));
  }
}
```

See [`examples/approval-flow.ts`](./examples/approval-flow.ts) for a full runnable walkthrough.

<details>
<summary>Raw HTTP API (reference)</summary>

```typescript
// PUT /v1/budget
await fetch('https://agentlair.dev/v1/budget', {
  method: 'PUT',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ daily: 5_000_000, on_limit: 'approve' }),
});

// POST /v1/charge  →  200 (ok) | 202 (approval_required) | 402 (rejected)
// GET /v1/budget
// GET /v1/approvals?status=pending
// GET /v1/approvals/:id
// POST /v1/approvals/:id/approve
// POST /v1/approvals/:id/reject
```

</details>

---

## Stacks

Provision a domain stack (DNS, hosting, email at your own domain).

```typescript
// Create
const stack = await lair.stacks.create({ domain: 'myagent.dev' });
console.log(stack.nameservers);  // point your domain here

// List
const { stacks } = await lair.stacks.list();
```

---

## Observations

Shared key-value observations for cross-agent coordination.

```typescript
// Write
await lair.observations.write({ topic: 'market-signals', content: 'BTC up 5%' });
await lair.observations.write({ topic: 'alerts', content: 'Deploy done', shared: true });

// Read
const { observations } = await lair.observations.read();
const mine = await lair.observations.read({ scope: 'mine', topic: 'market-signals' });
const recent = await lair.observations.read({ since: '2026-03-01T00:00:00Z', limit: 20 });

// Topics
const { topics } = await lair.observations.topics();
```

---

## Account

```typescript
const { account_id, tier } = await lair.account.me();

const { emails, requests } = await lair.account.usage();
console.log(emails.daily_remaining);

const billing = await lair.account.billing();
```

---

## Error Handling

All methods throw `AgentLairError` on non-2xx responses.

```typescript
import { AgentLair, AgentLairError } from '@agentlair/sdk';

try {
  await lair.email.claim('taken@agentlair.dev');
} catch (e) {
  if (e instanceof AgentLairError) {
    console.error(e.message);  // human-readable
    console.error(e.code);     // machine-readable (e.g. 'address_taken')
    console.error(e.status);   // HTTP status (e.g. 409)
  }
}
```

---

## TypeScript

Fully typed — all request/response shapes are exported.

```typescript
import type {
  AgentLairOptions,
  CreateAccountResult,
  InboxMessage,
  FullMessage,
  VaultGetResult,
  Observation,
  Stack,
} from '@agentlair/sdk';
```

---

## Backward Compatibility

`AgentLairClient` (v0.1.x style) is fully retained:

```typescript
import { AgentLairClient } from '@agentlair/sdk';

const client = new AgentLairClient({ apiKey: process.env.AGENTLAIR_API_KEY! });

// Legacy flat methods (deprecated but functional)
await client.claimAddress({ address: 'my-agent@agentlair.dev' });
await client.sendEmail({ from: '...', to: '...', subject: '...', text: '...' });
const { messages } = await client.getInbox({ address: 'my-agent@agentlair.dev' });

// New namespaces also available on AgentLairClient
await client.email.claim('my-agent');
await client.vault.put('key', { ciphertext: 'x' });
```

---

## E2E Encryption

When you claim an address with a `public_key`, inbound emails are encrypted end-to-end using X25519 ECDH + HKDF-SHA-256 + AES-256-GCM. The server never sees plaintext.

E2E decryption is not included in `@agentlair/sdk` (requires `@noble/curves` for X25519 — breaks zero-dep constraint). See the [E2E encryption guide](https://agentlair.dev/docs/e2e).

---

## Related

- [`@agentlair/vault-crypto`](https://www.npmjs.com/package/@agentlair/vault-crypto) — Client-side encryption for the Vault

---

## License

MIT © [AgentLair](https://agentlair.dev)
