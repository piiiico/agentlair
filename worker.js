/**
 * AgentLair MCP Server — Cloudflare Worker
 *
 * Implements MCP (Model Context Protocol) Streamable HTTP transport.
 * Exposes AgentLair email capabilities to AI agents — no SMTP required.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST /mcp
 * Auth: Bearer token via Authorization header OR ?apiKey= query param
 *
 * Get your free API key: POST https://agentlair.dev/v1/auth/keys
 *
 * Tools:
 *   send_email        — Send email from an @agentlair.dev address
 *   check_inbox       — Check inbox for an @agentlair.dev address
 *   read_message      — Read full content of a message
 *   list_addresses    — List your claimed @agentlair.dev addresses
 *   claim_address     — Claim a new @agentlair.dev address
 *
 * MCP Spec: https://spec.modelcontextprotocol.io/
 * AgentLair: https://agentlair.dev
 */

const AGENTLAIR_BASE = "https://agentlair.dev";
const SERVER_NAME = "agentlair-email";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2025-03-26";

// ─── CORS Headers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Accept, Authorization",
  "Access-Control-Max-Age": "86400",
};

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "send_email",
    description: "Send an email from your AgentLair address (@agentlair.dev) to any recipient. No SMTP or DNS setup needed.",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Sender address — must be an @agentlair.dev address you own (e.g. mybot@agentlair.dev)"
        },
        to: {
          type: "array",
          items: { type: "string" },
          description: "Array of recipient email addresses"
        },
        subject: {
          type: "string",
          description: "Email subject line"
        },
        text: {
          type: "string",
          description: "Plain text body of the email"
        },
        html: {
          type: "string",
          description: "Optional HTML body (supplement to text)"
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "Optional CC recipient addresses"
        }
      },
      required: ["from", "to", "subject", "text"]
    }
  },
  {
    name: "check_inbox",
    description: "Check the inbox for an @agentlair.dev email address. Returns recent messages with sender, subject, and received time.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The @agentlair.dev address to check (e.g. mybot@agentlair.dev)"
        },
        limit: {
          type: "number",
          description: "Max number of messages to return (default: 10, max: 50)"
        }
      },
      required: ["address"]
    }
  },
  {
    name: "read_message",
    description: "Read the full content of a specific email message, including the body text.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The message_id from check_inbox (angle brackets will be stripped automatically)"
        },
        address: {
          type: "string",
          description: "The @agentlair.dev address this message was delivered to"
        }
      },
      required: ["message_id", "address"]
    }
  },
  {
    name: "list_addresses",
    description: "List all @agentlair.dev email addresses associated with your API key.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "claim_address",
    description: "Claim a new @agentlair.dev email address for your agent. Free tier supports multiple addresses.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The address to claim (must end in @agentlair.dev, e.g. mybot@agentlair.dev)"
        }
      },
      required: ["address"]
    }
  }
];

// ─── Auth Extraction ──────────────────────────────────────────────────────────

function extractApiKey(req) {
  // 1. Authorization: Bearer {key}
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  // 2. ?apiKey= query param (used by Smithery)
  const url = new URL(req.url);
  const qk = url.searchParams.get("apiKey") || url.searchParams.get("api_key");
  if (qk) return qk.trim();
  return null;
}

// ─── AgentLair API Helpers ────────────────────────────────────────────────────

async function agentlairFetch(path, apiKey, options = {}) {
  const url = `${AGENTLAIR_BASE}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { ok: resp.ok, status: resp.status, data };
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function toolSendEmail(args, apiKey) {
  const { from, to, subject, text, html, cc } = args;
  if (!from || !to || !subject || !text) {
    return { error: "Missing required fields: from, to, subject, text" };
  }

  const body = { from, to, subject, text };
  if (html) body.html = html;
  if (cc) body.cc = cc;

  const { ok, status, data } = await agentlairFetch("/v1/email/send", apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!ok) {
    return `Error sending email (HTTP ${status}): ${JSON.stringify(data)}`;
  }

  const remaining = data.rate_limit?.daily_remaining ?? "unknown";
  return `✅ Email sent successfully!\nMessage ID: ${data.id}\nStatus: ${data.status}\nSent at: ${data.sent_at}\nDaily sends remaining: ${remaining}`;
}

async function toolCheckInbox(args, apiKey) {
  const { address, limit = 10 } = args;
  if (!address) return "Error: address is required";

  const qs = new URLSearchParams({ address, limit: String(limit) });
  const { ok, status, data } = await agentlairFetch(`/v1/email/inbox?${qs}`, apiKey);

  if (!ok) {
    return `Error checking inbox (HTTP ${status}): ${JSON.stringify(data)}`;
  }

  const messages = data.messages || [];
  if (messages.length === 0) {
    return `📭 Inbox empty for ${address}`;
  }

  let out = `📬 Inbox for ${address} — ${data.count ?? messages.length} message(s):\n\n`;
  for (const msg of messages) {
    const read = msg.read ? "✓" : "●";
    out += `${read} From: ${msg.from}\n`;
    out += `  Subject: ${msg.subject}\n`;
    out += `  Received: ${msg.received_at}\n`;
    out += `  ID: ${msg.message_id}\n\n`;
  }
  out += `Use read_message to get full content of any message.`;
  return out;
}

async function toolReadMessage(args, apiKey) {
  const { message_id, address } = args;
  if (!message_id || !address) return "Error: message_id and address are required";

  // Strip angle brackets from message_id if present
  const cleanId = message_id.replace(/^<|>$/g, "");
  const encodedId = encodeURIComponent(cleanId);
  const qs = new URLSearchParams({ address });

  const { ok, status, data } = await agentlairFetch(
    `/v1/email/messages/${encodedId}?${qs}`,
    apiKey
  );

  if (!ok) {
    return `Error reading message (HTTP ${status}): ${JSON.stringify(data)}`;
  }

  let out = `📧 Message\n`;
  out += `From: ${data.from}\n`;
  out += `To: ${data.to}\n`;
  out += `Subject: ${data.subject}\n`;
  out += `Date: ${data.date_header || data.received_at}\n`;
  out += `Read: ${data.read ? "Yes" : "No"}\n\n`;
  out += `─────────────────────────────\n`;
  out += data.body || data.text || "(no body)";
  return out;
}

async function toolListAddresses(args, apiKey) {
  const { ok, status, data } = await agentlairFetch("/v1/email/addresses", apiKey);

  if (!ok) {
    return `Error listing addresses (HTTP ${status}): ${JSON.stringify(data)}`;
  }

  const addresses = data.addresses || data || [];
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return `No addresses found. Use claim_address to create one (e.g. mybot@agentlair.dev).`;
  }

  let out = `📮 Your @agentlair.dev addresses (${addresses.length}):\n\n`;
  for (const addr of addresses) {
    const a = typeof addr === "string" ? addr : addr.address || JSON.stringify(addr);
    out += `  • ${a}\n`;
  }
  return out;
}

async function toolClaimAddress(args, apiKey) {
  const { address } = args;
  if (!address) return "Error: address is required";
  if (!address.endsWith("@agentlair.dev")) {
    return `Error: Address must end in @agentlair.dev (got: ${address})`;
  }

  const { ok, status, data } = await agentlairFetch("/v1/email/claim", apiKey, {
    method: "POST",
    body: JSON.stringify({ address }),
  });

  if (!ok) {
    return `Error claiming address (HTTP ${status}): ${JSON.stringify(data)}`;
  }

  if (data.already_owned) {
    return `ℹ️ Address ${address} is already claimed by your account.`;
  }
  if (data.claimed) {
    return `✅ Successfully claimed ${address}!\nYou can now send and receive email at this address.`;
  }
  return `Response: ${JSON.stringify(data)}`;
}

// ─── MCP Handler ─────────────────────────────────────────────────────────────

async function handleMcp(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { jsonrpc, id, method, params } = body;

  if (jsonrpc !== "2.0") {
    return jsonRpcError(id, -32600, "Invalid Request: jsonrpc must be '2.0'");
  }

  // Notifications — no response
  if (method?.startsWith?.("notifications/")) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  switch (method) {
    case "initialize": {
      return jsonRpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
        instructions: "AgentLair Email MCP server. Gives AI agents email capability with no SMTP setup. Use claim_address to get an @agentlair.dev address, then send and receive email. Requires an AgentLair API key — get one free at https://agentlair.dev"
      });
    }

    case "ping": {
      return jsonRpcOk(id, {});
    }

    case "tools/list": {
      return jsonRpcOk(id, { tools: TOOLS });
    }

    case "resources/list": {
      return jsonRpcOk(id, { resources: [] });
    }

    case "prompts/list": {
      return jsonRpcOk(id, { prompts: [] });
    }

    case "tools/call": {
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (!toolName) return jsonRpcError(id, -32602, "Invalid params: missing 'name'");

      // Extract API key
      const apiKey = extractApiKey(req);
      if (!apiKey) {
        return jsonRpcOk(id, {
          content: [{
            type: "text",
            text: "Error: AgentLair API key required. Pass it via Authorization: Bearer {key} header or ?apiKey= query param. Get a free key: POST https://agentlair.dev/v1/auth/keys"
          }],
          isError: true
        });
      }

      try {
        let result;
        switch (toolName) {
          case "send_email":
            result = await toolSendEmail(args, apiKey);
            break;
          case "check_inbox":
            result = await toolCheckInbox(args, apiKey);
            break;
          case "read_message":
            result = await toolReadMessage(args, apiKey);
            break;
          case "list_addresses":
            result = await toolListAddresses(args, apiKey);
            break;
          case "claim_address":
            result = await toolClaimAddress(args, apiKey);
            break;
          default:
            return jsonRpcOk(id, {
              content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
              isError: true
            });
        }

        return jsonRpcOk(id, {
          content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }]
        });

      } catch (e) {
        return jsonRpcOk(id, {
          content: [{ type: "text", text: `Tool error: ${e.message}` }],
          isError: true
        });
      }
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── JSON-RPC Helpers ─────────────────────────────────────────────────────────

function jsonRpcOk(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

function jsonRpcError(id, code, message) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0", id,
    error: { code, message }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

// ─── Main Worker ──────────────────────────────────────────────────────────────

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health / root
    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(JSON.stringify({
        ok: true,
        name: SERVER_NAME,
        version: SERVER_VERSION,
        protocol: "MCP Streamable HTTP",
        protocolVersion: PROTOCOL_VERSION,
        endpoint: "/mcp",
        tools: TOOLS.map(t => t.name),
        auth: "Bearer token via Authorization header or ?apiKey= query param",
        getApiKey: "POST https://agentlair.dev/v1/auth/keys",
        learnMore: "https://agentlair.dev",
        smithery: "https://smithery.ai/server/@piiiico/agentlair"
      }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    // Agent card (A2A discovery)
    if (url.pathname === "/.well-known/agent-card.json") {
      return new Response(JSON.stringify({
        name: "AgentLair Email",
        description: "Email capability for AI agents — no SMTP setup. Send and receive @agentlair.dev email via REST.",
        url: "https://agentlair-mcp-server.amdal-dev.workers.dev/mcp",
        version: SERVER_VERSION,
        capabilities: {
          mcp: { endpoint: "/mcp", transport: "streamable-http" }
        }
      }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      if (req.method !== "POST") {
        return new Response("Method Not Allowed — use POST /mcp", {
          status: 405,
          headers: CORS_HEADERS
        });
      }
      return handleMcp(req);
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }
};
