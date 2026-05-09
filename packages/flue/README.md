# @agentlair/flue

AgentLair integration for [Flue](https://flueframework.com) — agent identity, JWKS-verified authentication, and trust-gated MCP connections.

Flue ships with no identity or auth layer by design. AgentLair fills that gap: each agent session gets a cryptographically signed identity token (AAT), verifiable by any service that accepts JWKS-backed Ed25519 JWTs — no shared secrets, no trust negotiation.

## Install

```bash
npm install @agentlair/flue
# peer dependency
npm install @flue/sdk
```

## Quick Start

Wrap your agent handler with `withAgentLair`. Your handler receives `aal` — a live token plus decoded claims — ready to attach to any outbound call.

```typescript
// .flue/agents/my-agent.ts
import { withAgentLair, mcpOptions } from '@agentlair/flue';
import type { FlueContext } from '@agentlair/flue';

export const triggers = { webhook: true };

export default withAgentLair(
  async ({ init, payload, env, aal }) => {
    const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });

    // Attach AAT to any outbound MCP server call
    const partnerTools = await connectMcpServer(
      'partner',
      mcpOptions('https://api.partner.com/mcp', aal),
    );

    const session = await agent.session();
    return await session.prompt(payload.message as string, {
      tools: [partnerTools],
    });
  },
  {
    audience: 'https://my-service.com',
    scopes: ['mcp:tools:execute', 'email:send'],
  },
);
```

Set `AGENTLAIR_API_KEY` in your Flue environment. The wrapper reads it automatically.

## Three Patterns

### 1. Outbound identity — your agent calls external services

Use `withAgentLair` to get a token at session start, then attach it to MCP servers, webhooks, or any HTTP call.

```typescript
import { withAgentLair, mcpOptions } from '@agentlair/flue';

export default withAgentLair(
  async ({ init, payload, env, aal }) => {
    // aal.token    — raw JWT
    // aal.bearer   — "Bearer eyJ..." string for Authorization header
    // aal.name     — agent display name
    // aal.accountId — stable account ID (persists across sessions)
    // aal.scopes   — granted scopes
    // aal.auditUrl — link to full audit trail for this token

    // MCP connection with AAT auth
    const tools = await connectMcpServer('data-api', mcpOptions(
      'https://data.example.com/mcp',
      aal,
    ));

    // Direct HTTP call with AAT auth
    const response = await fetch('https://api.example.com/data', {
      headers: { Authorization: aal.bearer },
    });

    const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });
    const session = await agent.session();
    return await session.prompt(payload.message as string, { tools: [tools] });
  },
  {
    audience: 'https://data.example.com',
    scopes: ['mcp:tools:execute'],
  },
);
```

### 2. Inbound auth — your Flue webhook verifies callers

Services built on Flue can require callers to prove their identity before executing.

```typescript
// .flue/agents/my-service.ts
import { verifyIncomingAAT } from '@agentlair/flue';

export const triggers = { webhook: true };

export default async function ({ init, payload, env }: FlueContext) {
  // Verify the calling agent's identity — throws if invalid
  const caller = await verifyIncomingAAT(
    (payload.headers as Record<string, string>)?.authorization,
    {
      audience: 'https://my-service.com',
      requiredScopes: ['mcp:tools:execute'],
    },
  );

  // caller.accountId — stable identity across sessions
  // caller.name      — human-readable name
  // caller.tokenRef  — unique token ID (safe to log)
  // caller.auditUrl  — link to caller's audit trail
  console.log(`Request from ${caller.name} (${caller.accountId})`);

  const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });
  const session = await agent.session();
  return await session.prompt(payload.message as string);
}
```

Verification uses `https://agentlair.dev/.well-known/jwks.json` — no API key required on the receiving side.

### 3. A2A trust — session.task() with identity

When Flue's `session.task()` delegates to child agents, pass the AAT so the child can prove identity downstream.

```typescript
import { withAgentLair } from '@agentlair/flue';

export default withAgentLair(
  async ({ init, payload, env, aal }) => {
    const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });
    const session = await agent.session();

    // Spawn a child task — pass the AAT in the prompt context
    const result = await session.task(
      `Research this topic: ${payload.query}
       Your identity token: ${aal.token}
       Attach it as 'Authorization: Bearer <token>' when calling external APIs.`,
    );

    return result;
  },
  {
    audience: 'https://my-service.com',
    scopes: ['mcp:tools:execute', 'memory:write'],
  },
);
```

## Token Lifecycle

AATs expire (default: 1 hour). For long-running agents, refresh before reuse:

```typescript
import { withAgentLair, issueAAT, isAATValid } from '@agentlair/flue';

// Manual refresh pattern
export default withAgentLair(
  async ({ init, payload, env, aal }) => {
    const issueOptions = {
      apiKey: env.AGENTLAIR_API_KEY!,
      audience: 'https://my-service.com',
    };

    // Refresh if within 60 seconds of expiry
    if (!isAATValid(aal, 60)) {
      aal = await issueAAT(issueOptions);
    }

    // ... use aal
  },
  { audience: 'https://my-service.com' },
);
```

## Environment Setup

In `.flue/agents/<your-agent>.ts`, AgentLair credentials come in via `env`:

```typescript
// .flue/commands.ts (if using defineCommand pattern)
export const agentlair = defineCommand('agentlair-cli', {
  env: {
    AGENTLAIR_API_KEY: process.env.AGENTLAIR_API_KEY,
  },
});
```

Or set `AGENTLAIR_API_KEY` in your deployment environment (Cloudflare secrets, GitHub Actions secrets, etc.).

## What's an AAT?

An Agent Authentication Token is an EdDSA-signed JWT issued by AgentLair:

```
{
  "iss": "https://agentlair.dev",
  "sub": "acc_7kLmNpQr2sT4",          // stable agent identity
  "aud": "https://my-service.com",
  "exp": 1716000000,
  "jti": "aat_X9bYzWvU8pQr3mNk",      // unique token ID (safe to log)
  "al_name": "my-flue-agent",
  "al_email": "my-flue-agent@agentlair.dev",
  "al_scopes": ["mcp:tools:execute", "email:send"],
  "al_audit_url": "https://agentlair.dev/v1/audit/aat_X9bYzWvU8pQr3mNk"
}
```

Any service can verify it offline using `https://agentlair.dev/.well-known/jwks.json`.

**Never log the raw token.** Log `jti` instead — it uniquely identifies this issuance in the audit trail.

## Get an API Key

Register at [agentlair.dev](https://agentlair.dev):

```bash
curl -X POST https://agentlair.dev/v1/register \
  -H 'Content-Type: application/json' \
  -d '{ "name": "my-flue-agent", "recovery_email": "you@example.com" }'
```

Returns `{ api_key, account_id, email_address }` — your agent's permanent identity.

## Related Packages

- [`@agentlair/sdk`](https://npmjs.com/package/@agentlair/sdk) — Full AgentLair client (email, vault, SCITT, sessions)
- [`@agentlair/verify`](https://npmjs.com/package/@agentlair/verify) — Lightweight AAT verification only
- [`@agentlair/mastra`](https://npmjs.com/package/@agentlair/mastra) — Mastra framework integration

## License

MIT
