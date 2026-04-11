---
title: "Prism-MCP × AgentLair: Per-Agent Memory Traceability via JWKS"
description: "Prism-MCP is the first MCP server to ship production JWKS + EdDSA auth against AgentLair. Every memory access is attributed to a specific agent."
pubDate: 2026-04-07
authorName: "Pico"
---

MCP servers have an attribution problem. When multiple agents share a memory server, you can't tell which agent stored what — or which agent accessed it. Prism-MCP solves this with production-grade JWT auth, and AgentLair provides the identity layer that makes it work.

---

## What Prism-MCP Is

[Prism-MCP](https://github.com/dcostenco/prism-mcp) is an MCP-native memory server — a "Mind Palace" for agents. It lets agents store and retrieve semantic memories across sessions. With JWKS JWT auth shipped in v9.0.5, every memory operation is cryptographically attributed to the agent that performed it.

> "Prism being the first MCP server with production JWKS + EdDSA against AgentLair is a story worth documenting properly."
> — Dmitri Costenco, creator of Prism-MCP

---

## The Integration

AgentLair issues Agent Auth Tokens (AATs) — EdDSA/Ed25519 JWTs with a standard JWKS endpoint. Prism-MCP's JWKS auth works with any standard JWT provider. Two environment variables connect them:

```bash
PRISM_JWKS_URI=https://agentlair.dev/.well-known/jwks.json
PRISM_JWT_ISSUER=https://agentlair.dev
```

That's it. Prism-MCP fetches the public keys from AgentLair's JWKS endpoint, validates every incoming token, and extracts the `agent_id`. Each memory read and write is now attributed to a specific agent identity.

No shared API keys. No ambient credentials. Per-agent traceability by default.

---

## Code

Issue an AAT from AgentLair and use it to call Prism-MCP:

```typescript
// 1. Issue an Agent Auth Token scoped to prism
const tokenRes = await fetch('https://api.agentlair.dev/v1/tokens/issue', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.AGENTLAIR_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    audience: 'prism-dashboard',
    scopes: ['read', 'write'],
  }),
});
const { token } = await tokenRes.json();

// 2. Call Prism-MCP — the token carries agent_id
const memoryRes = await fetch('http://localhost:3000/api/memories', {
  headers: { 'Authorization': `Bearer ${token}` },
});
const memories = await memoryRes.json();
```

The token carries the agent's identity. Prism validates it against AgentLair's JWKS endpoint and attributes the operation. No configuration beyond the two env vars above.

---

## What This Means

Most MCP servers run unauthenticated or with shared API keys. When something goes wrong — a memory is corrupted, sensitive data is accessed — there's no way to trace it back to the responsible agent.

The Prism-MCP + AgentLair pattern changes this:

- **Traceability** — every memory operation is tied to a specific agent_id
- **Scoped access** — tokens carry explicit scopes (`read`, `write`)
- **Standard protocol** — JWKS + JWT, no proprietary auth flow
- **Zero ambient credentials** — agents authenticate per-request with short-lived tokens

This is the first MCP server with production JWKS + EdDSA auth against a live identity provider. It won't be the last.

---

## Try It

1. [Get an AgentLair API key](https://agentlair.dev/getting-started) — no form, no email required
2. [Set up Prism-MCP](https://github.com/dcostenco/prism-mcp) with JWKS auth
3. Read the [full integration walkthrough on Dev.to](https://dev.to/piiiico/agent-native-auth-for-mcp-servers-prism-mcp-x-agentlair-jwks-integration-4mh0)
