#!/usr/bin/env node
/**
 * @agentlair/mcp-demo-attested
 *
 * Minimal reference MCP server demonstrating
 * @agentlair/mcp-trust-attestation. Exposes:
 *   - one `echo` MCP tool over stdio
 *   - the BHC-S descriptor + per-subject attestation routes over HTTP
 *     (mounted via the SDK middleware in three lines)
 *
 * Usage:
 *   npx @agentlair/mcp-demo-attested
 *
 * Env:
 *   ATTESTED_SERVER_ID   subject identifier (default: a demo url_sha256:... value)
 *   ATTESTED_HTTP_PORT   HTTP port for the attestation routes (default: 8787)
 */

import { Hono } from 'hono';
import {
  createAttestationMiddleware,
  buildServerCardExtension,
} from '@agentlair/mcp-trust-attestation';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { serve } from '@hono/node-server';

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVER_NAME = 'mcp-demo-attested';
const SERVER_VERSION = '0.1.0';
const SERVER_ID =
  process.env.ATTESTED_SERVER_ID ??
  'url_sha256:0000000000000000000000000000000000000000000000000000000000000000';
const HTTP_PORT = Number.parseInt(process.env.ATTESTED_HTTP_PORT ?? '8787', 10);

// ─── HTTP transport: BHC-S routes (3-LOC mount) ──────────────────────────────

const app = new Hono();
app.use('/.well-known/agentlair-trust', createAttestationMiddleware({ serverId: SERVER_ID }));
app.use('/agentlair/trust-attestation/:subject', createAttestationMiddleware({ serverId: SERVER_ID }));

app.get('/', (c) =>
  c.json({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    server_card_extension: buildServerCardExtension({ serverId: SERVER_ID }),
  }),
);

// ─── MCP transport: a single `echo` tool ─────────────────────────────────────

const mcpServer = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echo a message back. Useful for verifying the demo server is alive.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    },
  ],
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'echo') {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
      isError: true,
    };
  }
  const message = String((req.params.arguments ?? {}).message ?? '');
  return {
    content: [{ type: 'text', text: message }],
  };
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Boot the HTTP server (attestation surface) only when explicitly enabled or
  // when not being driven by an MCP client over stdio. We default to enabled
  // because this binary is a demo whose whole point is the HTTP surface.
  if (process.env.ATTESTED_DISABLE_HTTP !== '1') {
    try {
      serve({ fetch: app.fetch, port: HTTP_PORT });
      console.error(`[${SERVER_NAME}] attestation routes on http://localhost:${HTTP_PORT}`);
    } catch (err) {
      console.error(`[${SERVER_NAME}] HTTP boot failed:`, err);
    }
  }
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error(`[${SERVER_NAME}] MCP server connected over stdio`);
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});
