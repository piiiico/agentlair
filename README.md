# AgentLair

Give your AI agent an email address, encrypted vault, and a behavioral trust score — one API, no OAuth required.

[![npm: @agentlair/mcp](https://img.shields.io/npm/v/@agentlair/mcp?label=%40agentlair%2Fmcp)](https://www.npmjs.com/package/@agentlair/mcp)
[![npm: @agentlair/sdk](https://img.shields.io/npm/v/@agentlair/sdk?label=%40agentlair%2Fsdk)](https://www.npmjs.com/package/@agentlair/sdk)

| Capability     | Description |
|----------------|-------------|
| Email          | Send and receive at `@agentlair.dev`. No OAuth, no human approval required. |
| Vault          | Encrypted credential storage. Client-side AES-GCM — the server stores ciphertext only. |
| Audit Trail    | Every action logged with Ed25519 signatures. Tamper-evident, independently verifiable. |
| Trust Scoring  | Behavioral score (0–100) derived from observed actions — consistency, restraint, transparency. |
| MCP Server     | All capabilities available as MCP tools in Claude Code, Cursor, or any MCP client. |
| Pods           | Namespace isolation for multi-agent or multi-tenant deployments. |

## Try it in 30 seconds

No signup. See what a live trust score response looks like:

```bash
# Healthy agent — high trust (score 84, principal level)
curl https://agentlair.dev/v1/demo
```

```json
{
  "agentId": "acc_demo_healthy_XXXXXXXXXX",
  "score": 84,
  "confidence": 0.91,
  "atfLevel": "principal",
  "trend": "stable",
  "dimensions": {
    "consistency":   { "score": 0.82 },
    "restraint":     { "score": 0.87 },
    "transparency":  { "score": 0.80 }
  },
  "observationCount": 1847
}
```

```bash
# Suspicious agent — score 31, declining trend
curl 'https://agentlair.dev/v1/demo?scenario=suspicious'

# New agent — only 11 observations, wide confidence interval
curl 'https://agentlair.dev/v1/demo?scenario=new'
```

Rate limited to 10 requests/minute per IP. Response shape matches the live `/v1/trust/:agentId` endpoint.

**Full interactive demo** — register a real agent, submit observations, get a live trust score (curl + jq, ~60 seconds):

```bash
curl -sL https://raw.githubusercontent.com/piiiico/agentlair/main/examples/quickstart.sh | bash
```

## Register an agent

```bash
curl -X POST https://agentlair.dev/v1/auth/agent-register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-research-agent"}'
```

```json
{
  "api_key": "al_live_...",
  "account_id": "acc_...",
  "email_address": "my-research-agent@agentlair.dev",
  "tier": "free",
  "limits": { "emails_per_day": 10, "requests_per_day": 100 },
  "warning": "Save your API key — it will not be shown again."
}
```

From here, the agent authenticates with `api_key` to send email, store credentials, and emit signed audit events.

## MCP server

```bash
npx @agentlair/mcp@latest
```

Adds 9 tools to your MCP client: agent registration, email send/receive, vault store/get, audit event emission, and trust score queries.

## SDK

```bash
npm install @agentlair/sdk
```

TypeScript client for the AgentLair API. See [agentlair.dev/getting-started](https://agentlair.dev/getting-started).

## Free tier

- 10 emails/day
- 100 API requests/day
- 10 email addresses

Pro: $5/stack/month for higher limits.

## Architecture

- **API**: Cloudflare Workers — edge-deployed, low latency
- **State**: Cloudflare KV
- **Vault encryption**: Client-side AES-GCM via `@agentlair/vault-crypto`. The server stores ciphertext only — no plaintext credentials at rest.
- **Audit trail**: Ed25519-signed event chains. Each event is independently verifiable without trusting the server.

We've been running our own agent infrastructure on AgentLair in production. Notes on what broke and what we learned building behavioral trust scoring: [agentlair.dev/blog/from-0-to-41-building-behavioral-trust-in-production](https://agentlair.dev/blog/from-0-to-41-building-behavioral-trust-in-production)

## Documentation

[agentlair.dev/getting-started](https://agentlair.dev/getting-started)

## Repository structure

```
packages/
  worker/          — Core API worker (Cloudflare Workers)
  sdk/             — @agentlair/sdk client library
  mcp-server/      — @agentlair/mcp MCP server
  vault-crypto/    — @agentlair/vault-crypto end-to-end encryption
  verify/          — @agentlair/verify AAT token verification
  email-worker/    — Email processing worker

apps/
  dashboard/       — Agent dashboard UI
  email-channel/   — Email MCP channel
```

## Development

```bash
bun install        # install all dependencies
bun run typecheck  # type-check all packages
```

## License

MIT
