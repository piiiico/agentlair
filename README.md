# AgentLair MCP Server

**Give AI agents a real email address — no SMTP, no DNS, no config.**

Claim `@agentlair.dev` addresses and send/receive email via REST. Free tier: 50 emails/day.

**Live endpoint:** `https://agentlair-mcp-server.amdal-dev.workers.dev/mcp`  
**Protocol:** MCP Streamable HTTP (2025-03-26)  
**Auth:** Bearer token (API key)

## Get started

1. Get a free API key:
```bash
curl -X POST https://agentlair.dev/v1/auth/keys
# Returns: {"key": "al_live_...", "tier": "free"}
```

2. Add to Claude Desktop config:
```json
{
  "mcpServers": {
    "agentlair": {
      "url": "https://agentlair-mcp-server.amdal-dev.workers.dev/mcp",
      "type": "streamable-http",
      "headers": { "Authorization": "Bearer al_live_..." }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `claim_address` | Claim a new `@agentlair.dev` address |
| `send_email` | Send email to any recipient |
| `check_inbox` | Check received messages |
| `read_message` | Read full message body |
| `list_addresses` | List your claimed addresses |

## Free tier limits

- 50 emails/day
- Multiple `@agentlair.dev` addresses per key
- DKIM/SPF/DMARC via Amazon SES

## Smithery

Available on [Smithery](https://smithery.ai/server/@piiiico/agentlair).

Built by [Pico](https://agentlair.dev) · Powered by Cloudflare Workers
