/**
 * mcp-demo-worker — Unit Tests
 *
 * Uses bun:test. A deterministic Ed25519 test key is generated once per suite.
 * Tests invoke the Hono app directly via app.fetch() with mock env.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519.js';
import app from './index.js';

// ─── Test key setup ───────────────────────────────────────────────────────────

// Deterministic 32-byte seed for testing
const TEST_SEED = new Uint8Array(32).fill(0x42);
const TEST_PRIVATE_KEY_B64 = btoa(String.fromCharCode(...TEST_SEED));
const TEST_PUBLIC_KEY = ed25519.getPublicKey(TEST_SEED);

const mockEnv = {
  AUDIT_SIGNING_KEY: TEST_PRIVATE_KEY_B64,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function req(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const url = `https://mcp-demo.agentlair.dev${path}`;
  const request = new Request(url, init);
  const response = await app.fetch(request, mockEnv, {} as ExecutionContext);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body, headers: response.headers };
}

function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const binary = atob(b64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /.well-known/agentlair-trust', () => {
  let body: Record<string, unknown>;
  let status: number;
  let headers: Headers;

  beforeAll(async () => {
    const r = await req('/.well-known/agentlair-trust');
    status = r.status;
    body = r.body as Record<string, unknown>;
    headers = r.headers;
  });

  // Test 1
  test('returns 200 with Content-Type application/json', () => {
    expect(status).toBe(200);
    expect(headers.get('content-type')).toContain('application/json');
  });

  // Test 2
  test('descriptor has all required BHC-S fields', () => {
    expect(body).toHaveProperty('issuer', 'https://agentlair.dev');
    expect(body).toHaveProperty('jwks_uri', 'https://agentlair.dev/.well-known/jwks.json');
    expect(body).toHaveProperty('attestation_endpoint_template');
    expect(body).toHaveProperty('bhc_token_type', 'urn:agentlair:bhc-s:v1');
    expect(body).toHaveProperty('spec_version', '0.1.0');
  });

  // Test 3
  test('descriptor has non-empty attestation_token string field', () => {
    expect(typeof body.attestation_token).toBe('string');
    expect((body.attestation_token as string).length).toBeGreaterThan(0);
  });

  // Test 4
  test('attestation_token is a 3-part JWT (header.payload.signature)', () => {
    const token = body.attestation_token as string;
    const parts = token.split('.');
    expect(parts.length).toBe(3);
    // Each part should be non-empty base64url
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
    }
  });

  // Test 5
  test('JWT payload has correct iss, sub, and exp > iat', () => {
    const token = body.attestation_token as string;
    const parts = token.split('.');
    const payloadBytes = b64urlDecode(parts[1]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      iss: string;
      sub: string;
      iat: number;
      exp: number;
    };
    expect(payload.iss).toBe('https://agentlair.dev');
    expect(payload.sub).toBe('agentlair_alias:mcp-demo');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});

describe('POST /mcp — initialize', () => {
  // Test 6
  test('initialize returns 200 with result.capabilities.tools', async () => {
    const r = await req('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
      }),
    });
    expect(r.status).toBe(200);
    const body = r.body as { result: { capabilities: { tools: object } } };
    expect(body.result).toBeDefined();
    expect(body.result.capabilities).toBeDefined();
    expect(body.result.capabilities.tools).toBeDefined();
  });
});

describe('POST /mcp — tools/list', () => {
  // Test 7
  test('tools/list returns all 3 tools: echo, time, ping', async () => {
    const r = await req('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    expect(r.status).toBe(200);
    const body = r.body as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain('echo');
    expect(names).toContain('time');
    expect(names).toContain('ping');
  });
});

describe('POST /mcp — tools/call', () => {
  // Test 8
  test('tools/call echo returns the input message', async () => {
    const r = await req('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'echo', arguments: { message: 'hello' } },
      }),
    });
    expect(r.status).toBe(200);
    const body = r.body as {
      result: { content: Array<{ type: string; text: string }>; isError: boolean };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].text).toBe('hello');
  });

  // Test 9
  test('tools/call time returns an ISO date string', async () => {
    const r = await req('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'time', arguments: {} },
      }),
    });
    expect(r.status).toBe(200);
    const body = r.body as {
      result: { content: Array<{ type: string; text: string }>; isError: boolean };
    };
    expect(body.result.isError).toBe(false);
    const iso = body.result.content[0].text;
    // ISO 8601 pattern: YYYY-MM-DDTHH:MM:SS.sssZ
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('tools/call ping returns "pong"', async () => {
    const r = await req('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'ping', arguments: {} },
      }),
    });
    expect(r.status).toBe(200);
    const body = r.body as {
      result: { content: Array<{ type: string; text: string }>; isError: boolean };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].text).toBe('pong');
  });
});

describe('GET /', () => {
  // Test 10
  test('returns 200 with mcp_endpoint and verify_with fields', async () => {
    const r = await req('/');
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body).toHaveProperty('mcp_endpoint', '/mcp');
    expect(body).toHaveProperty('verify_with');
    expect(typeof body.verify_with).toBe('string');
  });
});
