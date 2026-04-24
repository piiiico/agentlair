# AgentLair Trust Gate MCP Server

Reference implementation demonstrating AgentLair trust-gated tool access.

**The point:** Any MCP server can use AgentLair as a behavioral trust provider — no shared secrets, no per-org configuration. Just verify the AAT and check the trust score.

## What It Does

Three tools with escalating privilege requirements:

| Tool | Required Trust | Score |
|------|---------------|-------|
| `read_file` | junior | ≥ 40 |
| `execute_command` | senior | ≥ 65 |
| `access_vault` | senior | ≥ 65 |

On every tool call, the server:
1. Introspects the caller's AAT at `agentlair.dev/v1/tokens/introspect`
2. Checks trust level (from embedded `al_trust` claim or live API)
3. Grants or denies access based on trust tier
4. Logs the decision as telemetry to AgentLair

## Quick Start

```bash
# Get an API key
curl -X POST https://agentlair.dev/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "trust-gate-server"}'

# Start the server
AGENTLAIR_SERVER_KEY=al_live_... bun run server.ts
```

## Agent Usage

Agents include their AAT in `_meta.agentlair_token`:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "read_file",
    "arguments": { "path": "/workspace/README.md" },
    "_meta": {
      "agentlair_token": "eyJ..."
    }
  }
}
```

Agents get their AAT via `POST https://agentlair.dev/v1/tokens/issue`.

## Architecture

```
Agent                    Trust Gate MCP Server           AgentLair IdP
  |                              |                             |
  |-- tools/call + AAT -------->|                             |
  |                              |                             |
  |                              |-- introspect(AAT) -------->|
  |                              |<-- { active, sub, al_trust }|
  |                              |                             |
  |                              |-- trust/check (if needed) ->|
  |                              |<-- { level, score } --------|
  |                              |                             |
  |                              | [apply access control]      |
  |                              |                             |
  |                              |-- telemetry event -------->|
  |                              |                             |
  |<-- tool result or denied ----|                             |
```

## Files

- `server.ts` — Main MCP server with trust gate integration
- `trust-gate.ts` — AgentLair introspection + trust check + telemetry
- `tools.ts` — Tool definitions and implementations

## Trust Tiers

Defined by [AgentLair ATF (Agent Trust Framework)](https://agentlair.dev):

| Level | Score | Description |
|-------|-------|-------------|
| intern | 0–39 | Default for new agents |
| junior | 40–64 | Standard tool access |
| senior | 65–84 | Privileged operations |
| principal | 85–100 | Administrative actions |

Trust is computed from behavioral telemetry across three dimensions:
- **Consistency** (35%): Session regularity, error rate stability
- **Restraint** (43%): Scope utilization, credential access patterns
- **Transparency** (21%): Audit chain integrity, auth hygiene

## MCP Client Config

```json
{
  "mcpServers": {
    "trust-gate": {
      "command": "bun",
      "args": ["run", "/path/to/trust-gate-mcp/server.ts"],
      "env": {
        "AGENTLAIR_SERVER_KEY": "al_live_..."
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTLAIR_SERVER_KEY` | Yes | AgentLair API key for the server (not the agent) |
| `AGENTLAIR_BASE_URL` | No | Override AgentLair base URL (default: `https://agentlair.dev`) |
| `VAULT_*` | No | Demo vault entries (e.g., `VAULT_DATABASE_URL=postgres://...`) |

## Security Notes

- **Audience binding:** AATs are bound to a specific audience URL. In production, verify `aud` matches your server's URL.
- **TOCTOU:** Embedded `al_trust` is a snapshot at token issuance. For time-sensitive operations, force real-time trust check via the API.
- **Path sanitization:** `read_file` does basic `..` removal but is not a security boundary. Scope allowed paths in production.
- **Command execution:** `execute_command` is a demo — in production, use allowlists or sandboxes.

## Why This Matters

MCP has no built-in identity or trust. Any agent can connect to any MCP server with any capability. This reference shows the AgentLair pattern:

1. **No bilateral trust agreements** — any server trusts the JWKS endpoint
2. **Behavioral trust, not just identity** — "is this agent trustworthy?" not just "who is this agent?"
3. **Cross-org portability** — trust built anywhere aggregates everywhere
4. **Zero cold-start for established agents** — bring your trust score to new servers

→ [AgentLair Docs](https://agentlair.dev/getting-started) · [RFC-001: AgentLair IdP](../../../rfcs/RFC-001-identity-provider.md)
