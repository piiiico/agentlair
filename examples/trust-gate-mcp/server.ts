#!/usr/bin/env bun
/**
 * AgentLair Trust Gate MCP Server — Reference Implementation
 *
 * Demonstrates trust-gated tool access using AgentLair as the identity
 * and behavioral trust provider.
 *
 * HOW IT WORKS:
 *   1. Agent connects and calls a tool, passing its AAT in _meta.agentlair_token
 *   2. Server introspects the token at AgentLair (/v1/tokens/introspect)
 *   3. Server checks trust level (from embedded al_trust or /v1/trust/{id}/check)
 *   4. Access granted based on trust tier:
 *      - senior+  (score ≥ 65): read_file, execute_command, access_vault
 *      - junior+  (score ≥ 40): read_file only
 *      - intern   (score < 40): access denied
 *   5. Decision logged to AgentLair telemetry
 *
 * USAGE:
 *   AGENTLAIR_SERVER_KEY=al_live_... bun run server.ts
 *
 * AGENT USAGE (tool call example):
 *   {
 *     "name": "read_file",
 *     "arguments": { "path": "/workspace/README.md" },
 *     "_meta": { "agentlair_token": "eyJ..." }
 *   }
 *
 * Get an API key: POST https://agentlair.dev/v1/auth/keys
 * Docs: https://agentlair.dev/getting-started
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  verifyAndCheckTrust,
  logToolCall,
  type TrustLevel,
} from "./trust-gate.js";

import {
  TOOL_DEFINITIONS,
  toolAllowedForTrustLevel,
  executeReadFile,
  executeCommand,
  executeAccessVault,
  type ToolName,
  type ToolResult,
} from "./tools.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVER_NAME = "agentlair-trust-gate";
const SERVER_VERSION = "0.1.0";

function getServerApiKey(): string {
  const key = process.env.AGENTLAIR_SERVER_KEY;
  if (!key) {
    console.error(
      "[trust-gate] ERROR: AGENTLAIR_SERVER_KEY environment variable is required.\n" +
        "  Get a free key: POST https://agentlair.dev/v1/auth/keys\n" +
        "  Docs: https://agentlair.dev/getting-started\n" +
        "\n" +
        "  AGENTLAIR_SERVER_KEY=al_live_... bun run server.ts"
    );
    process.exit(1);
  }
  return key;
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    capabilities: { tools: {} },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOL_DEFINITIONS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const serverApiKey = getServerApiKey();
  const toolName = request.params.name as ToolName;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  // Extract AAT from _meta (RFC: https://spec.modelcontextprotocol.io/specification/draft/basic/utilities/meta/)
  const meta = request.params._meta as Record<string, unknown> | undefined;
  const bearerToken = meta?.agentlair_token as string | undefined;

  console.error(
    `[trust-gate] Tool call: ${toolName} | token: ${bearerToken ? "present" : "absent"}`
  );

  // ── Trust Gate ────────────────────────────────────────────────────────────

  const decision = await verifyAndCheckTrust(bearerToken, serverApiKey);

  // Log telemetry (fire-and-forget)
  logToolCall({
    serverApiKey,
    agentId: decision.agentId,
    toolName,
    trustLevel: decision.trustLevel,
    allowed: decision.allowed && toolAllowedForTrustLevel(toolName, decision.trustLevel),
  }).catch(() => {}); // suppress unhandled rejection

  // Reject if not even junior-level
  if (!decision.allowed) {
    console.error(
      `[trust-gate] DENIED ${toolName} for ${decision.agentId} (${decision.trustLevel}, score ${decision.trustScore})`
    );

    return {
      content: [
        {
          type: "text",
          text: formatDenied(toolName, decision.trustLevel, decision.trustScore, decision.reason),
        },
      ],
      isError: true,
    };
  }

  // Check per-tool trust requirement
  if (!toolAllowedForTrustLevel(toolName, decision.trustLevel)) {
    console.error(
      `[trust-gate] TOOL RESTRICTED ${toolName} for ${decision.agentId} (${decision.trustLevel})`
    );

    return {
      content: [
        {
          type: "text",
          text: formatToolRestricted(toolName, decision.trustLevel, decision.trustScore),
        },
      ],
      isError: true,
    };
  }

  console.error(
    `[trust-gate] ALLOWED ${toolName} for ${decision.agentId} (${decision.trustLevel}, score ${decision.trustScore})`
  );

  // ── Execute Tool ──────────────────────────────────────────────────────────

  let result: ToolResult;

  switch (toolName) {
    case "read_file":
      result = await executeReadFile(args as { path: string; max_lines?: number });
      break;

    case "execute_command":
      result = await executeCommand(args as { command: string; timeout_ms?: number });
      break;

    case "access_vault":
      result = await executeAccessVault(args as { key: string });
      break;

    default:
      result = {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }

  return result;
});

// ─── Format Helpers ───────────────────────────────────────────────────────────

function formatDenied(
  toolName: string,
  level: TrustLevel,
  score: number,
  reason?: string
): string {
  return [
    `🚫 Access Denied: ${toolName}`,
    "",
    `Your current trust level: ${level} (score: ${score}/100)`,
    "",
    reason ?? "Insufficient trust level.",
    "",
    "AgentLair Trust Tiers:",
    "  intern  (score <40)  — No tool access",
    "  junior  (score ≥40)  — read_file",
    "  senior  (score ≥65)  — read_file, execute_command, access_vault",
    "",
    "Build trust by using AgentLair consistently:",
    "  → https://agentlair.dev/trust",
  ].join("\n");
}

function formatToolRestricted(
  toolName: string,
  level: TrustLevel,
  score: number
): string {
  const toolRequirements: Record<string, string> = {
    read_file: "junior (score ≥40)",
    execute_command: "senior (score ≥65)",
    access_vault: "senior (score ≥65)",
  };

  const required = toolRequirements[toolName] ?? "senior";

  return [
    `🔒 Tool Restricted: ${toolName}`,
    "",
    `Your trust level: ${level} (score: ${score}/100)`,
    `Required for ${toolName}: ${required}`,
    "",
    "This tool requires elevated trust. Keep using AgentLair to build your trust score.",
    "→ https://agentlair.dev/trust",
  ].join("\n");
}

// ─── Start Server ─────────────────────────────────────────────────────────────

async function main() {
  // Validate API key at startup
  const key = getServerApiKey();
  console.error(
    `[trust-gate] Starting ${SERVER_NAME} v${SERVER_VERSION}`,
    `\n[trust-gate] AgentLair base: ${process.env.AGENTLAIR_BASE_URL ?? "https://agentlair.dev"}`,
    `\n[trust-gate] API key: ${key.slice(0, 12)}...`
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[trust-gate] Server ready. Waiting for connections...");
}

main().catch((e) => {
  console.error("[trust-gate] Fatal error:", e);
  process.exit(1);
});
