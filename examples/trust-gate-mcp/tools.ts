/**
 * Tool definitions for the AgentLair Trust Gate MCP server.
 *
 * Three tools with escalating privilege requirements:
 *
 *   read_file        — junior+ (score ~40+)  — read any file path
 *   execute_command  — senior+ (score ~65+)  — run shell commands
 *   access_vault     — senior+ (score ~65+)  — read secrets from vault
 *
 * Access control is enforced by trust-gate.ts before execution.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TrustLevel } from "./trust-gate.js";

// ─── Tool Schema Definitions ──────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "read_file",
    description:
      "Read the contents of a file. Requires junior trust level (score >= 40).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative file path to read.",
        },
        max_lines: {
          type: "number",
          description: "Maximum number of lines to return (default: 100).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "execute_command",
    description:
      "Execute a shell command and return stdout/stderr. Requires senior trust level (score >= 65).",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute.",
        },
        timeout_ms: {
          type: "number",
          description: "Maximum execution time in milliseconds (default: 5000, max: 30000).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "access_vault",
    description:
      "Retrieve a secret from the vault by key. Requires senior trust level (score >= 65).",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Vault secret key to retrieve.",
        },
      },
      required: ["key"],
    },
  },
] as const;

export type ToolName = "read_file" | "execute_command" | "access_vault";

// ─── Minimum Trust Requirements ───────────────────────────────────────────────

const TOOL_MIN_TRUST: Record<ToolName, TrustLevel> = {
  read_file: "junior",
  execute_command: "senior",
  access_vault: "senior",
};

export function getMinTrustForTool(toolName: ToolName): TrustLevel {
  return TOOL_MIN_TRUST[toolName] ?? "principal";
}

const ATF_LEVELS: TrustLevel[] = ["intern", "junior", "senior", "principal"];

function levelIndex(level: TrustLevel): number {
  return ATF_LEVELS.indexOf(level);
}

export function toolAllowedForTrustLevel(
  toolName: ToolName,
  trustLevel: TrustLevel
): boolean {
  const required = getMinTrustForTool(toolName);
  return levelIndex(trustLevel) >= levelIndex(required);
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

export type ToolResult = CallToolResult;

/**
 * read_file — reads a file and returns its contents.
 * In a real deployment you'd scope allowed paths (e.g., only /workspace/).
 */
export async function executeReadFile(args: {
  path: string;
  max_lines?: number;
}): Promise<ToolResult> {
  const { path, max_lines = 100 } = args;

  // Basic path sanitization — don't follow symlinks out of allowed areas
  const safePath = path.replace(/\.\./g, "").replace(/\/+/g, "/");

  try {
    const file = Bun.file(safePath);
    const exists = await file.exists();

    if (!exists) {
      return {
        content: [{ type: "text", text: `File not found: ${safePath}` }],
        isError: true,
      };
    }

    const text = await file.text();
    const lines = text.split("\n");
    const truncated = lines.length > max_lines;
    const output = lines.slice(0, max_lines).join("\n");

    return {
      content: [
        {
          type: "text",
          text: truncated
            ? `${output}\n\n... (truncated at ${max_lines} lines, file has ${lines.length} total)`
            : output,
        },
      ],
    };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Error reading file: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * execute_command — runs a shell command with timeout.
 * Dangerous in production — scope allowed commands appropriately.
 */
export async function executeCommand(args: {
  command: string;
  timeout_ms?: number;
}): Promise<ToolResult> {
  const { command, timeout_ms = 5000 } = args;
  const timeout = Math.min(timeout_ms, 30000);

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutHandle = setTimeout(() => {
      proc.kill();
    }, timeout);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    clearTimeout(timeoutHandle);
    await proc.exited;

    const exitCode = proc.exitCode;
    const output = [
      stdout && `stdout:\n${stdout}`,
      stderr && `stderr:\n${stderr}`,
      `exit code: ${exitCode}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      content: [{ type: "text", text: output || "(no output)" }],
      isError: (exitCode ?? 0) !== 0,
    };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Command execution error: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * access_vault — retrieves a secret from the vault.
 * Uses environment variables as a simple in-process vault demo.
 * In production, wire to your actual secret store (AgentLair vault, AWS SSM, etc.)
 */
export async function executeAccessVault(args: {
  key: string;
}): Promise<ToolResult> {
  const { key } = args;

  // Demo vault: read from VAULT_* environment variables
  // e.g., VAULT_DATABASE_URL, VAULT_API_KEY, etc.
  const envKey = `VAULT_${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const secret = process.env[envKey];

  if (!secret) {
    return {
      content: [
        {
          type: "text",
          text: `Vault key '${key}' not found. Demo vault reads from env vars with prefix VAULT_. Set VAULT_${key.toUpperCase()} to test.`,
        },
      ],
      isError: true,
    };
  }

  // Mask the secret in output (first 4 + last 4 chars visible)
  const masked =
    secret.length > 8
      ? `${secret.slice(0, 4)}${"*".repeat(secret.length - 8)}${secret.slice(-4)}`
      : "*".repeat(secret.length);

  return {
    content: [
      {
        type: "text",
        text: `Vault key '${key}': ${masked} (${secret.length} chars)`,
      },
    ],
  };
}
