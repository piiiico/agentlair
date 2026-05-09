# AgentLair × Flue: Agent Identity for the Harness Framework

_Version: 0.1 | Date: 2026-05-02_

[Flue](https://flueframework.com) is an open-source TypeScript framework for headless, programmable agent workflows. It handles model calls, sandboxed shell execution, session state, and skill composition. It ships with no identity or auth layer — by design.

AgentLair fills that gap. This guide shows how to attach verifiable agent identity to any Flue agent: tokens that prove who is calling, JWKS endpoints for offline verification, and scope-based access control with no shared secrets.

---

## What Flue Doesn't Do

Flue's security model isolates credentials through environment variable injection (`defineCommand(..., { env })`) — the agent never sees the raw token. That's good for protecting your credentials from the LLM.

What Flue doesn't provide:
- **Agent identity** — who is this agent, across sessions and services?
- **Outbound authentication** — how does my agent prove its identity to external APIs?
- **Inbound verification** — how does my service know the agent calling it is who it claims?
- **Behavioral trust** — has this agent behaved consistently over time?

These are cross-session, cross-service concerns. AgentLair's AATs address all of them.

---

## Install

```bash
npm install @agentlair/flue
```

Peer dependency: `@flue/sdk >=0.1.0`

---

## Pattern 1: Outbound Identity

Your Flue agent calls external services. Those services need to verify who is calling.

```typescript
// .flue/agents/researcher.ts
import { withAgentLair, mcpOptions } from '@agentlair/flue';

export const triggers = { webhook: true, cli: true };

export default withAgentLair(
  async ({ init, payload, env, aal }) => {
    const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });

    // Attach identity token to external MCP server
    const dataAPI = await connectMcpServer('data-api',
      mcpOptions('https://api.partner.com/mcp', aal)
    );

    const session = await agent.session();
    return await session.prompt(
      `Research this topic: ${payload.query}`,
      { tools: [dataAPI] }
    );
  },
  {
    audience: 'https://api.partner.com',
    scopes: ['mcp:tools:execute'],
  }
);
```

`withAgentLair` reads `AGENTLAIR_API_KEY` from `env` automatically and issues a token before your handler runs. Set the key in your Flue environment or Cloudflare/GitHub secrets.

---

## Pattern 2: Inbound Verification

Your Flue webhook accepts requests from other agents. You want to know who they are.

```typescript
// .flue/agents/my-service.ts
import { verifyIncomingAAT } from '@agentlair/flue';

export const triggers = { webhook: true };

export default async function ({ init, payload, env }) {
  // Verify the calling agent — throws if token missing, expired, or wrong scope
  const caller = await verifyIncomingAAT(
    (payload.headers as Record<string, string>)?.authorization,
    {
      audience: 'https://my-service.com',
      requiredScopes: ['mcp:tools:execute'],
    }
  );

  console.log(`Authorized: ${caller.name} (${caller.accountId})`);
  // caller.auditUrl — link to full audit trail, verifiable by anyone

  const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });
  const session = await agent.session();
  return await session.prompt(payload.message as string);
}
```

Verification fetches `https://agentlair.dev/.well-known/jwks.json`. No API key needed on the receiving side — pure cryptographic verification with a 5-minute key cache.

---

## Pattern 3: A2A Delegation via session.task()

When Flue's `session.task()` spawns child agents, pass the AAT so the child can authenticate downstream.

```typescript
import { withAgentLair } from '@agentlair/flue';

export default withAgentLair(
  async ({ init, payload, env, aal }) => {
    const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });
    const session = await agent.session();

    // Delegate with identity context
    const result = await session.task(
      `Analyze the dataset at https://data.example.com/report.
       When fetching, include Authorization: ${aal.bearer}
       Your agent identity: ${aal.name} (${aal.accountId})`
    );

    return result;
  },
  {
    audience: 'https://data.example.com',
    scopes: ['mcp:tools:execute', 'memory:read'],
  }
);
```

---

## AAT Claims Reference

Every AAT is a signed JWT with these claims:

| Claim | Value | Notes |
|-------|-------|-------|
| `sub` | `acc_7kLmNpQr2sT4` | Stable account ID — persists across sessions |
| `al_name` | `"my-flue-agent"` | Display name |
| `al_email` | `"my-flue-agent@agentlair.dev"` | Agent email address |
| `al_scopes` | `["mcp:tools:execute"]` | Requested scopes |
| `jti` | `"aat_X9bYzWvU8pQr3mNk"` | Unique token ID — log this, not the raw token |
| `al_audit_url` | `https://agentlair.dev/v1/audit/aat_...` | Audit trail for this issuance |
| `aud` | `"https://api.partner.com"` | Target service — must match verifier's audience |
| `exp` | Unix timestamp | Default TTL: 1 hour |

---

## Offline Verification

Any service can verify an AAT without contacting AgentLair — just fetch the JWKS:

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://agentlair.dev/.well-known/jwks.json')
);

const { payload } = await jwtVerify(token, JWKS, {
  issuer: 'https://agentlair.dev',
  audience: 'https://my-service.com',
});

console.log(payload.al_name);    // agent name
console.log(payload.sub);        // stable account ID
console.log(payload.jti);        // token reference (safe to log)
```

---

## Get an API Key

Register in one HTTP call — no UI, no OAuth flow:

```bash
curl -X POST https://agentlair.dev/v1/register \
  -H 'Content-Type: application/json' \
  -d '{ "name": "my-flue-agent", "recovery_email": "you@example.com" }'
# → { api_key: "al_live_...", account_id: "acc_...", email_address: "..." }
```

Then set `AGENTLAIR_API_KEY=al_live_...` in your environment.

---

## Related

- [`@agentlair/flue` on npm](https://npmjs.com/package/@agentlair/flue)
- [Flue framework](https://flueframework.com)
- [AgentLair JWKS endpoint](https://agentlair.dev/.well-known/jwks.json)
- [Token issuance API](https://agentlair.dev/v1/tokens/issue)
- [Mastra integration](./mastra.md)
