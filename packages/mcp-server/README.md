# @agentlair/mcp

**Give your AI agent a real email address, persistent vault, and calendar — accessible directly from Claude Code, Cursor, Windsurf, or any MCP client.**

[![npm version](https://img.shields.io/npm/v/@agentlair/mcp)](https://www.npmjs.com/package/@agentlair/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What it does

AgentLair MCP gives any MCP-compatible agent runtime access to:

| Tool | What it does |
|------|-------------|
| `claim_address` | Claim a `@agentlair.dev` email address for your agent |
| `send_email` | Send email from your agent to anyone |
| `check_inbox` | Check incoming messages |
| `read_message` | Read the full body of a specific email |
| `list_addresses` | List all claimed addresses on your account |
| `vault_put` | Store a secret or value that persists across sessions |
| `vault_get` | Retrieve a stored value by key |
| `vault_list` | List all vault keys (names only — values stay encrypted) |
| `vault_delete` | Delete a vault key |
| `calendar_create_event` | Create a calendar event (iCal-subscribable by humans) |
| `calendar_list_events` | List upcoming events |
| `calendar_delete_event` | Delete an event |
| `calendar_get_feed` | Get the iCal subscription URL for calendar apps |

No SMTP. No IMAP. No AWS SES setup. Just an API key.

---

## Quick start

### 1. Get an API key

```bash
curl -s -X POST https://agentlair.dev/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"label": "my-mcp-key"}' | jq .
```

Or visit [agentlair.dev](https://agentlair.dev) to sign up.

### 2. Add to your MCP client

#### Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "agentlair": {
      "command": "npx",
      "args": ["@agentlair/mcp@latest"],
      "env": {
        "AGENTLAIR_API_KEY": "al_your_key_here"
      }
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "agentlair": {
      "command": "npx",
      "args": ["@agentlair/mcp@latest"],
      "env": {
        "AGENTLAIR_API_KEY": "al_your_key_here"
      }
    }
  }
}
```

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "agentlair": {
      "command": "npx",
      "args": ["@agentlair/mcp@latest"],
      "env": {
        "AGENTLAIR_API_KEY": "al_your_key_here"
      }
    }
  }
}
```

---

## Usage examples

Once configured, just ask your agent naturally:

```
Claim the email address assistant@agentlair.dev for me.
```

```
Send an email to hello@example.com from assistant@agentlair.dev
saying "Your report is ready." with subject "Report"
```

```
Check the inbox for assistant@agentlair.dev
```

```
Store my OpenAI key in the vault with key "openai-api-key"
```

```
Get the value stored under "openai-api-key" from the vault
```

```
Create a calendar event "Team sync" on 2026-04-01 from 10:00 to 11:00
and give me the subscription URL so I can add it to Google Calendar
```

---

## Tools reference

### Email

#### `claim_address`
Claim a `@agentlair.dev` email address.

```json
{
  "address": "my-agent@agentlair.dev"
}
```

#### `send_email`
Send an email from a claimed address.

```json
{
  "from": "my-agent@agentlair.dev",
  "to": ["recipient@example.com"],
  "subject": "Hello from Claude",
  "text": "This email was sent by an AI agent."
}
```

Optional: `html`, `cc`, `in_reply_to` (for threading).

#### `check_inbox`
Check incoming messages.

```json
{
  "address": "my-agent@agentlair.dev",
  "limit": 10
}
```

#### `read_message`
Read the full body of a message.

```json
{
  "address": "my-agent@agentlair.dev",
  "message_id": "<abc123@mail.example.com>"
}
```

#### `list_addresses`
List all claimed addresses on your account. No parameters required.

---

### Vault

#### `vault_put`
Store any value that persists across agent sessions.

```json
{
  "key": "openai-api-key",
  "value": "sk-..."
}
```

> **Security note:** The vault stores whatever you send. For sensitive secrets, encrypt client-side before storing and decrypt after retrieval. Use [`@agentlair/vault-crypto`](https://www.npmjs.com/package/@agentlair/vault-crypto) for a simple AES-GCM wrapper.

#### `vault_get`
Retrieve a stored value.

```json
{
  "key": "openai-api-key"
}
```

#### `vault_list`
List all vault keys (names and metadata only — values never returned in listing).

#### `vault_delete`
Delete a vault key permanently.

```json
{
  "key": "openai-api-key"
}
```

---

### Calendar

#### `calendar_create_event`
Create an event on your agent's calendar.

```json
{
  "summary": "Sprint planning",
  "start": "2026-04-07T09:00:00Z",
  "end": "2026-04-07T10:00:00Z",
  "description": "Quarterly sprint kickoff",
  "location": "https://meet.example.com/room",
  "attendees": ["team@example.com"]
}
```

#### `calendar_list_events`
List events, optionally filtered by date range.

```json
{
  "from": "2026-04-01",
  "to": "2026-04-30"
}
```

#### `calendar_delete_event`
Delete an event by ID.

#### `calendar_get_feed`
Get the public iCal URL. Paste into Google Calendar, Apple Calendar, or Outlook to subscribe.

---

## Free tier limits

| Resource | Free |
|----------|------|
| Email addresses | 3 |
| Emails sent/day | 50 |
| Vault keys | 10 |
| Vault key size | 16 KB |

---

## Running directly (without npx)

```bash
npm install -g @agentlair/mcp
AGENTLAIR_API_KEY=al_your_key agentlair-mcp
```

Or with Bun:

```bash
bun run src/index.ts
```

---

## License

MIT © [AgentLair](https://agentlair.dev)
