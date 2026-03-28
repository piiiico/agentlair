#!/usr/bin/env node
/**
 * @agentlair/mcp — AgentLair MCP Server (stdio)
 *
 * Exposes AgentLair email and vault capabilities as MCP tools.
 * Works with Claude Code, Cursor, Windsurf, Google ADK, and any MCP client.
 *
 * Usage (add to your MCP client config):
 * {
 *   "mcpServers": {
 *     "agentlair": {
 *       "command": "npx",
 *       "args": ["@agentlair/mcp@latest"],
 *       "env": { "AGENTLAIR_API_KEY": "al_..." }
 *     }
 *   }
 * }
 *
 * Get a free API key: POST https://agentlair.dev/v1/auth/keys
 * Docs: https://agentlair.dev/getting-started
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const AGENTLAIR_BASE = "https://agentlair.dev";
const SERVER_NAME = "agentlair";
const SERVER_VERSION = "1.1.1";

// ─── API Client ───────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.AGENTLAIR_API_KEY;
  if (!key) {
    throw new Error(
      "AGENTLAIR_API_KEY environment variable is required.\n" +
        "Get a free key: POST https://agentlair.dev/v1/auth/keys\n" +
        "Docs: https://agentlair.dev/getting-started"
    );
  }
  return key;
}

async function agentlairRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const apiKey = getApiKey();

  const url = `${AGENTLAIR_BASE}${path}`;
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": `@agentlair/mcp/${SERVER_VERSION}`,
    },
  };

  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = await res.json() as any;

  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`AgentLair API error: ${msg}`);
  }

  return data as T;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  // ── Email Tools ─────────────────────────────────────────────────────────────
  {
    name: "claim_address",
    description:
      "Claim a new @agentlair.dev email address for your agent. No DNS or SMTP setup required. Free tier: up to 3 addresses.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description:
            'Full address to claim, e.g. "my-agent@agentlair.dev". Must end in @agentlair.dev.',
        },
      },
      required: ["address"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email from an @agentlair.dev address you own to any recipient. No SMTP setup needed.",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description:
            "Sender address — must be a claimed @agentlair.dev address (e.g. my-agent@agentlair.dev)",
        },
        to: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
          description: "Recipient address or array of addresses",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        text: {
          type: "string",
          description: "Plain text body",
        },
        html: {
          type: "string",
          description: "Optional HTML body (supplement to text)",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "Optional CC addresses",
        },
        in_reply_to: {
          type: "string",
          description: "Message-ID to reply to (for email threading)",
        },
      },
      required: ["from", "to", "subject"],
    },
  },
  {
    name: "check_inbox",
    description:
      "Check the inbox for an @agentlair.dev address. Returns recent messages with sender, subject, and received time.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The @agentlair.dev address to check",
        },
        limit: {
          type: "number",
          description: "Max messages to return (default: 10, max: 50)",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "read_message",
    description:
      "Read the full content of a specific email message, including the body. Use message IDs from check_inbox.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The @agentlair.dev address that received the message",
        },
        message_id: {
          type: "string",
          description: "Message ID from check_inbox results",
        },
      },
      required: ["address", "message_id"],
    },
  },
  {
    name: "list_addresses",
    description: "List all @agentlair.dev addresses claimed on your account.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // ── Vault Tools ─────────────────────────────────────────────────────────────
  {
    name: "vault_put",
    description:
      "Store a value in the AgentLair Vault. Use this to persist API keys, secrets, or any data your agent needs across sessions. Best practice: encrypt sensitive data client-side before storing (the server stores whatever you send).",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Vault key name (1-128 chars, alphanumeric + _ - .). Examples: 'openai-key', 'session_token', 'config.json'",
        },
        value: {
          type: "string",
          description:
            "Value to store. For secrets: encrypt first, then store the ciphertext.",
        },
        metadata: {
          type: "object",
          description:
            "Optional JSON metadata (labels, timestamps, etc.) — never encrypted",
        },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "vault_get",
    description:
      "Retrieve a stored value from the AgentLair Vault by key name.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Vault key name to retrieve",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "vault_list",
    description:
      "List all keys stored in your AgentLair Vault (metadata only, values not returned).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "vault_delete",
    description: "Delete a key and all its versions from the AgentLair Vault.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Vault key name to delete",
        },
      },
      required: ["key"],
    },
  },

  // ── Calendar Tools ───────────────────────────────────────────────────────────
  {
    name: "calendar_create_event",
    description:
      "Create a calendar event on your AgentLair calendar. Events are published via iCal feed for human subscription (Google Calendar, Apple Calendar, Outlook).",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Event title / summary (required)",
        },
        start: {
          type: "string",
          description:
            'Event start time in ISO 8601 format. Date-only ("2026-03-20") or datetime ("2026-03-20T14:00:00Z")',
        },
        end: {
          type: "string",
          description:
            'Event end time in ISO 8601 format. Date-only ("2026-03-21") or datetime ("2026-03-20T15:00:00Z")',
        },
        description: {
          type: "string",
          description: "Optional event description / notes",
        },
        location: {
          type: "string",
          description: "Optional event location (address, URL, or room name)",
        },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of attendee email addresses",
        },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "calendar_list_events",
    description:
      "List events on your AgentLair calendar. Optionally filter by date range.",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description:
            'Optional start of date range filter (ISO 8601, e.g. "2026-03-01")',
        },
        to: {
          type: "string",
          description:
            'Optional end of date range filter (ISO 8601, e.g. "2026-03-31")',
        },
      },
      required: [],
    },
  },
  {
    name: "calendar_delete_event",
    description:
      "Delete an event from your AgentLair calendar by event ID. Use calendar_list_events to find event IDs.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Event ID to delete (e.g. evt_abc123...)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "calendar_get_feed",
    description:
      "Get the public iCal subscription URL for your AgentLair calendar. Share this URL with calendar apps (Google Calendar, Apple Calendar, Outlook) so humans can subscribe and see agent-created events.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    // ── Email ──────────────────────────────────────────────────────────────────

    case "claim_address": {
      const { address } = args as { address: string };
      if (!address || !address.endsWith("@agentlair.dev")) {
        throw new Error("address must end in @agentlair.dev");
      }
      const result = await agentlairRequest("POST", "/v1/email/claim", {
        address,
      });
      return JSON.stringify(result, null, 2);
    }

    case "send_email": {
      const { from, to, subject, text, html, cc, in_reply_to } = args as {
        from: string;
        to: string | string[];
        subject: string;
        text?: string;
        html?: string;
        cc?: string[];
        in_reply_to?: string;
      };

      if (!text && !html) {
        throw new Error("Either text or html body is required");
      }

      const result = await agentlairRequest("POST", "/v1/email/send", {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        ...(text && { text }),
        ...(html && { html }),
        ...(cc && { cc }),
        ...(in_reply_to && { in_reply_to }),
      });
      return JSON.stringify(result, null, 2);
    }

    case "check_inbox": {
      const { address, limit } = args as { address: string; limit?: number };
      const params = new URLSearchParams({ address });
      if (limit) params.set("limit", String(limit));
      const result = await agentlairRequest(
        "GET",
        `/v1/email/inbox?${params}`
      );
      return JSON.stringify(result, null, 2);
    }

    case "read_message": {
      const { address, message_id } = args as {
        address: string;
        message_id: string;
      };
      const encodedId = encodeURIComponent(message_id);
      const result = await agentlairRequest(
        "GET",
        `/v1/email/inbox?address=${encodeURIComponent(address)}&message_id=${encodedId}`
      );
      return JSON.stringify(result, null, 2);
    }

    case "list_addresses": {
      const result = await agentlairRequest("GET", "/v1/email/addresses");
      return JSON.stringify(result, null, 2);
    }

    // ── Vault ──────────────────────────────────────────────────────────────────

    case "vault_put": {
      const { key, value, metadata } = args as {
        key: string;
        value: string;
        metadata?: Record<string, unknown>;
      };
      const body: Record<string, unknown> = { ciphertext: value };
      if (metadata) body.metadata = metadata;
      const result = await agentlairRequest(
        "PUT",
        `/v1/vault/${encodeURIComponent(key)}`,
        body
      );
      return JSON.stringify(result, null, 2);
    }

    case "vault_get": {
      const { key } = args as { key: string };
      const result = await agentlairRequest(
        "GET",
        `/v1/vault/${encodeURIComponent(key)}`
      );
      return JSON.stringify(result, null, 2);
    }

    case "vault_list": {
      const result = await agentlairRequest("GET", "/v1/vault");
      return JSON.stringify(result, null, 2);
    }

    case "vault_delete": {
      const { key } = args as { key: string };
      const result = await agentlairRequest(
        "DELETE",
        `/v1/vault/${encodeURIComponent(key)}`
      );
      return JSON.stringify(result, null, 2);
    }

    // ── Calendar ───────────────────────────────────────────────────────────────

    case "calendar_create_event": {
      const { summary, start, end, description, location, attendees } = args as {
        summary: string;
        start: string;
        end: string;
        description?: string;
        location?: string;
        attendees?: string[];
      };
      const body: Record<string, unknown> = { summary, start, end };
      if (description) body.description = description;
      if (location) body.location = location;
      if (attendees) body.attendees = attendees;
      const result = await agentlairRequest("POST", "/v1/calendar/events", body);
      return JSON.stringify(result, null, 2);
    }

    case "calendar_list_events": {
      const { from, to } = args as { from?: string; to?: string };
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const query = params.toString();
      const result = await agentlairRequest(
        "GET",
        `/v1/calendar/events${query ? `?${query}` : ""}`
      );
      return JSON.stringify(result, null, 2);
    }

    case "calendar_delete_event": {
      const { id } = args as { id: string };
      const result = await agentlairRequest(
        "DELETE",
        `/v1/calendar/events/${encodeURIComponent(id)}`
      );
      return JSON.stringify(result, null, 2);
    }

    case "calendar_get_feed": {
      const result = await agentlairRequest("GET", "/v1/calendar/feed");
      return JSON.stringify(result, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    const result = await handleTool(name, args as Record<string, unknown>);
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers communicate via stdio — don't write to stdout
  process.stderr.write(`${SERVER_NAME} MCP server v${SERVER_VERSION} started\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
