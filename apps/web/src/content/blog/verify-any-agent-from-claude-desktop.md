---
title: "Verify any agent from Claude Desktop in three lines of config"
description: "@agentlair/mcp-server shipped to npm. Drop a config snippet into Claude Desktop, restart, and your assistant gets five tools to verify other agents directly."
pubDate: 2026-05-04
authorName: "Pico"
cta: try
related:
  - eddsa-jwts-agent-credential-problem
  - what-verifiable-ai-actually-requires
  - mcp-security-identity-gap
---

The agent-trust pattern that's been live at agentlair.dev had one rough edge. To verify another agent, you had to write an HTTP client. The verification logic ran in a worker. The consumer had to glue it in.

That's now an `npx` command.

`@agentlair/mcp-server` shipped to npm today. It's a Model Context Protocol server. Any MCP client (Claude Desktop, Cursor, Cline, Smithery) pulls it in and gains five tools that talk to AgentLair's verification endpoints directly.

The agent verifies the agent.

## Three lines of config

Open `claude_desktop_config.json`. On macOS that's `~/Library/Application Support/Claude/claude_desktop_config.json`. Add:

```json
{
  "mcpServers": {
    "agentlair": {
      "command": "npx",
      "args": ["-y", "@agentlair/mcp-server"]
    }
  }
}
```

Restart Claude Desktop. Five new tools show up in the MCP panel. Type into chat: *"verify the agent acc_qgdxSULsXsmtHklZ for me."* Claude calls `verify_agent`, gets a score, and renders it.

That's the install. No SDK to import. No auth wiring. No keys to rotate.

## What's in the surface

Five tools, all built straight on top of HTTPS endpoints that have been live since the AgentLair worker went up.

`verify_agent` returns the full behavioral trust profile for an agent ID. Score 0 to 100, ATF level (intern, junior, senior, principal), per-dimension breakdown across consistency, restraint, transparency. Use it before delegating, paying, or extending capability.

`check_trust_gate` is the fast-path version. *Does this agent meet the senior threshold?* Yes or no, with the score attached. Cheaper than the full profile when all you need is the gate decision.

`get_popa` returns the Proof of Persistent Activity record for any DID. Streak in days, longest streak ever, total attestations, latest SCITT transparency-log entry. PoPA is the bond-of-presence: an agent attesting today is operationally alive today.

`get_popa_leaderboard` ranks DIDs by attestation count. Discoverability for the long-track-record agents.

`lookup_audit_token` resolves an AAT (Agent Authentication Token) by its `jti`. Was it issued? Is it active? Has it been revoked? Useful when one agent presents a token to another and the receiver wants to verify it before honouring it.

## Pricing surfaces in the conversation

Two of those tools (`verify_agent`, `check_trust_gate`) are x402-gated at 0.01 USDC per call for anonymous traffic. `lookup_audit_token` is 0.001. `get_popa` and `get_popa_leaderboard` are free.

If you don't set `AGENTLAIR_AAT`, paid tools don't error. They return a structured 402 response that the LLM can render:

```
Payment required: 10000 of asset 0x833589fCD6...02913 on eip155:8453
                  → 0x90EE1Ebc...B4AC.

Resource: https://agentlair.dev/v1/trust
Description: AgentLair trust score query, 0.01 USDC per lookup.
```

The LLM decides what to do next. Ask the user. Fall back to a free PoPA tool. Or, if it has an x402 wallet wired up, pay and retry. Price becomes a first-class output, not a `try { ... } catch (PaymentRequired)` that aborts the conversation.

To skip payment entirely, get an AAT from /quickstart and add it:

```json
{
  "mcpServers": {
    "agentlair": {
      "command": "npx",
      "args": ["-y", "@agentlair/mcp-server"],
      "env": {
        "AGENTLAIR_AAT": "your-token-here"
      }
    }
  }
}
```

Now `verify_agent` and `check_trust_gate` are free against your own AgentLair account.

## Why expose this as MCP

The MCP ecosystem has a discovery problem (you find servers by browsing registries) and a verification problem (the registry can't tell you which servers are trustworthy). The first is a marketplace question. The second is a trust-infrastructure question, and it's the one this package answers.

If verifying another agent requires writing an HTTP client, only the platforms that already care will integrate. If verifying another agent is `npx -y @agentlair/mcp-server`, the platforms that don't yet care can still delegate the question to their LLM. The model has the tool. It can choose to use it.

Trust as a tool call is where this has to land for it to be the default.

## Try it

Quick smoke test:

```bash
npx -y @agentlair/mcp-server
# stderr: "@agentlair/mcp-server v0.1.0 running on stdio"
# Ctrl-C to quit.
```

Then drop the config snippet into Claude Desktop and restart.

Free PoPA lookups need no setup. Try `get_popa did="did:web:agentlair.dev"` after install. The leaderboard works the same way.

Then point it at an agent and let your assistant decide whether to trust it.

Source is at [github.com/piiiico/agentlair-primitives](https://github.com/piiiico/agentlair-primitives). Issues welcome.
