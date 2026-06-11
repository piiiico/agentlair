import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { OPENAPI_SPEC } from './openapi.js';

function makeApp() {
  const app = new Hono();

  app.get('/openapi.json', () =>
    new Response(JSON.stringify(OPENAPI_SPEC), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'X-Powered-By': 'AgentLair',
      },
    })
  );

  app.get('/.well-known/x402', () =>
    new Response(JSON.stringify({
      protocol: 'x402',
      version: 2,
      resources: [
        'https://agentlair.dev/v1/audit/aat_demo1234567890ab',
        'https://agentlair.dev/v1/agents/acc_demoid12345/memory-trust',
        'https://agentlair.dev/a2a-audit/run',
      ],
      openapi: 'https://agentlair.dev/api',
      bazaar: 'https://agentlair.dev/.well-known/bazaar.json',
      agents: 'https://agentlair.dev/.well-known/agents.json',
      facilitator: 'https://facilitator.ultravioletadao.xyz',
      network: 'eip155:8453',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      asset_symbol: 'USDC',
      pay_to: '0x90EE1EbcCFA2021711C595E1410e22401570B4AC',
      docs: 'https://agentlair.dev/docs',
      discovery_note: 'AgentLair publishes paid endpoints in /.well-known/bazaar.json. The full OpenAPI 3.1 spec at /api documents the x402 flow.',
    }, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'X-Powered-By': 'AgentLair',
      },
    })
  );

  return app;
}

describe('openapi.json alias', () => {
  test('GET /openapi.json returns 200 + OpenAPI 3.1 JSON', async () => {
    const app = makeApp();
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json() as { openapi: string };
    expect(body.openapi).toBe('3.1.0');
  });
});

describe('.well-known/x402 modern shape', () => {
  test('GET /.well-known/x402 returns resources array (length >= 1)', async () => {
    const app = makeApp();
    const res = await app.request('/.well-known/x402');
    expect(res.status).toBe(200);
    const body = await res.json() as { resources: unknown[] };
    expect(Array.isArray(body.resources)).toBe(true);
    expect(body.resources.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /.well-known/x402 preserves legacy fields', async () => {
    const app = makeApp();
    const res = await app.request('/.well-known/x402');
    const body = await res.json() as Record<string, unknown>;
    expect(body.protocol).toBe('x402');
    expect(body.openapi).toBe('https://agentlair.dev/api');
    expect(body.pay_to).toBe('0x90EE1EbcCFA2021711C595E1410e22401570B4AC');
  });
});
