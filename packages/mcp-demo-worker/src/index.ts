/**
 * AgentLair MCP Demo Worker — First Production-Attested MCP Server
 *
 * Serves as a BHC-S demo: POST /v1/trust/mcp/verify on agentlair.dev
 * returns verified=true when pointed at this worker.
 *
 * Routes:
 *   GET  /.well-known/agentlair-trust — BHC-S descriptor with attestation_token
 *   GET  /.well-known/jwks.json       — Proxy to agentlair.dev JWKS
 *   POST /mcp                         — JSON-RPC 2.0 MCP over HTTP
 *   GET  /agentlair/trust-attestation/:subject — Proxy to agentlair.dev attestation
 *   GET  /                            — Info endpoint
 */

import { Hono } from 'hono';
import { ed25519 } from '@noble/curves/ed25519.js';

// ─── Environment ──────────────────────────────────────────────────────────────

export interface Env {
  AUDIT_SIGNING_KEY: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVER_ID = 'agentlair_alias:mcp-demo';
const SERVER_URL = 'https://mcp-demo.agentlair.dev';
const ISSUER = 'https://agentlair.dev';

// ─── JWT / Ed25519 helpers ────────────────────────────────────────────────────

function b64urlEncode(input: Uint8Array | string): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Compute kid: first 8 chars of SHA-256 hex of the public key.
 * Matches the convention in packages/worker/src/jwt.ts computeKeyId().
 */
async function computeKid(publicKeyBytes: Uint8Array): Promise<string> {
  const buf = ArrayBuffer.prototype.slice.call(
    publicKeyBytes.buffer,
    publicKeyBytes.byteOffset,
    publicKeyBytes.byteOffset + publicKeyBytes.byteLength,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 8);
}

/**
 * Sign a BHC-S attestation JWT for this server.
 * Uses AUDIT_SIGNING_KEY (same key as agentlair.dev main worker).
 */
async function signBhcJwt(privateKeyB64: string): Promise<string> {
  const privKeyBytes = Uint8Array.from(atob(privateKeyB64), (c) =>
    c.charCodeAt(0),
  );
  const pubKeyBytes = ed25519.getPublicKey(privKeyBytes);
  const kid = await computeKid(pubKeyBytes);

  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(
    JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid }),
  );
  const payload = b64urlEncode(
    JSON.stringify({
      iss: ISSUER,
      sub: SERVER_ID,
      iat: now,
      exp: now + 3600,
      bhc_token_type: 'urn:agentlair:bhc-s:v1',
      server_url: SERVER_URL,
      bhc_score: null,
    }),
  );

  const sigInput = new TextEncoder().encode(`${header}.${payload}`);
  const sig = ed25519.sign(sigInput, privKeyBytes);
  return `${header}.${payload}.${b64urlEncode(sig)}`;
}

// ─── MCP Tool definitions ─────────────────────────────────────────────────────

const MCP_TOOLS = [
  {
    name: 'echo',
    description: 'Echo the message argument back',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to echo' },
      },
      required: ['message'],
    },
  },
  {
    name: 'time',
    description: 'Return current UTC ISO timestamp',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ping',
    description: 'Return "pong"',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ─── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// GET / — info endpoint
app.get('/', (c) => {
  return c.json({
    name: 'mcp-demo-attested',
    version: '0.1.0',
    description:
      'First production-attested MCP server — BHC-S demo',
    mcp_endpoint: '/mcp',
    attestation_descriptor: '/.well-known/agentlair-trust',
    verify_with: `POST https://agentlair.dev/v1/trust/mcp/verify -d {"url":"https://mcp-demo.agentlair.dev"}`,
  });
});

// GET /.well-known/agentlair-trust — BHC-S descriptor with attestation_token
app.get('/.well-known/agentlair-trust', async (c) => {
  const attestationToken = await signBhcJwt(c.env.AUDIT_SIGNING_KEY);

  const descriptor = {
    issuer: ISSUER,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    attestation_endpoint_template: `${ISSUER}/v1/trust/server/{server_id}`,
    supported_signals: [
      'consistency',
      'restraint',
      'transparency',
      'honesty',
    ],
    supported_subjects: ['agent', 'session'],
    supported_subject_id_forms: ['agentlair_alias', 'did_web'],
    signal_algorithm_version: 'trust-engine-v2.5',
    max_token_ttl_seconds: 3600,
    bhc_token_type: 'urn:agentlair:bhc-s:v1',
    spec_version: '0.1.0',
    documentation_url: 'https://agentlair.dev/docs/bhc-s',
    attestation_token: attestationToken,
  };

  c.header('Cache-Control', 'public, max-age=300');
  return c.json(descriptor);
});

// GET /.well-known/jwks.json — proxy to agentlair.dev
app.get('/.well-known/jwks.json', async (_c) => {
  const res = await fetch(`${ISSUER}/.well-known/jwks.json`, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// POST /mcp — JSON-RPC 2.0 MCP over HTTP
app.post('/mcp', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      },
      400,
    );
  }

  const id = body.id ?? null;
  const method = body.method as string;
  const params = (body.params ?? {}) as Record<string, unknown>;

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-demo-attested', version: '0.1.0' },
      },
    });
  }

  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS },
    });
  }

  if (method === 'tools/call') {
    const toolName = params.name as string;
    const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

    if (toolName === 'echo') {
      const message = toolArgs.message as string;
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: message }],
          isError: false,
        },
      });
    }

    if (toolName === 'time') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: new Date().toISOString() }],
          isError: false,
        },
      });
    }

    if (toolName === 'ping') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: 'pong' }],
          isError: false,
        },
      });
    }

    // Unknown tool
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      },
    });
  }

  // Unknown method
  return c.json(
    {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    },
    404,
  );
});

// GET /agentlair/trust-attestation/:subject — proxy to agentlair.dev attestation
app.get('/agentlair/trust-attestation/:subject', async (_c) => {
  const attestationUrl = `${ISSUER}/v1/trust/server/${SERVER_ID}`;
  const res = await fetch(attestationUrl, {
    cf: { cacheTtl: 900, cacheEverything: true },
  } as RequestInit);

  if (!res.ok) {
    return new Response(null, { status: res.status });
  }

  const body = await res.text();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=900',
    },
  });
});

export default app;
