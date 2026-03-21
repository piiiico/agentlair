# AgentLair

Infrastructure for AI agent identity, communication, and capability exchange.

## Structure

```
packages/
  worker/          — Core API worker (Cloudflare Workers)
  sdk/             — @agentlair/sdk client library
  mcp-server/      — @agentlair/mcp MCP server
  vault-crypto/    — @agentlair/vault-crypto end-to-end encryption
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

## Workspaces

This is a Bun monorepo. Each package is independently publishable.
