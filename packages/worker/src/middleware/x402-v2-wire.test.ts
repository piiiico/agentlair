// x402 v2 wire middleware — PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE.
// Runs the REAL publicTrustRoutes 402 path behind CORS + the middleware.

import { describe, test, expect, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { x402V2Wire, base64Utf8 } from './x402-v2-wire.js';
import { publicTrustRoutes } from '../routes/trust.js';
import { SERVICE_PRICES, verifyX402Payment } from '../x402.js';

function decodeHeader(h: string): unknown {
  const bin = atob(h);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function makeApp(extra?: (app: Hono<any>) => void) {
  const app = new Hono<any>();
  app.use('*', cors({
    origin: ['https://agentlair.dev'],
    exposeHeaders: ['X-402-Version', 'X-Payment-Response', 'PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
  }));
  app.use('*', x402V2Wire());
  extra?.(app);
  app.route('/v1/trust', publicTrustRoutes);
  return app;
}
const ENV = { AUDIT: {} };

describe('response side', () => {
  test('real trust 402 carries PAYMENT-REQUIRED that decodes to the exact body, — intact', async () => {
    const res = await makeApp().request('/v1/trust/acc_demoid12345', { headers: { Origin: 'https://agentlair.dev' } }, ENV);
    expect(res.status).toBe(402);
    const h = res.headers.get('PAYMENT-REQUIRED');
    expect(h).toBeTruthy();
    const body = await res.json() as any;
    expect(decodeHeader(h!)).toEqual(body);
    expect(body.x402Version).toBe(2);
    expect(body.accepts.length).toBeGreaterThan(0);
    expect(JSON.stringify(decodeHeader(h!))).toContain('—');
    expect(body.resource.description).toBe(SERVICE_PRICES.trust_query.description);
    // other layers' headers survive the rebuild
    expect(res.headers.get('X-402-Version')).toBe('2');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://agentlair.dev');
    expect(res.headers.get('Access-Control-Expose-Headers') ?? '').toContain('PAYMENT-REQUIRED');
  });

  test('non-402 and non-x402 402s get no header', async () => {
    const app = makeApp((a) => {
      a.get('/ok', (c) => c.json({ x402Version: 2, accepts: [{}] }));
      a.get('/plain402', (c) => c.json({ error: 'pay up' }, 402));
      a.get('/text402', () => new Response('nope', { status: 402 }));
      a.get('/empty-accepts', (c) => c.json({ x402Version: 2, accepts: [] }, 402));
    });
    for (const p of ['/ok', '/plain402', '/text402', '/empty-accepts']) {
      const res = await app.request(p, {}, ENV);
      expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
    }
    expect(await (await app.request('/text402', {}, ENV)).text()).toBe('nope');
  });

  test('existing PAYMENT-REQUIRED is not overwritten; X-Payment-Response mirrors to PAYMENT-RESPONSE', async () => {
    const app = makeApp((a) => {
      a.get('/own', () => new Response(JSON.stringify({ x402Version: 2, accepts: [{}] }), { status: 402, headers: { 'PAYMENT-REQUIRED': 'keep' } }));
      a.get('/paid', (c) => { c.header('X-Payment-Response', 'rcpt123'); return c.json({ ok: true }); });
    });
    expect((await app.request('/own', {}, ENV)).headers.get('PAYMENT-REQUIRED')).toBe('keep');
    const paid = await app.request('/paid', {}, ENV);
    expect(paid.headers.get('PAYMENT-RESPONSE')).toBe('rcpt123');
    expect(await paid.json()).toEqual({ ok: true });
  });
});

describe('request side', () => {
  test('PAYMENT-SIGNATURE alone reaches both Hono-header and raw-request X-PAYMENT readers', async () => {
    const app = makeApp((a) => {
      a.get('/hono', (c) => c.text(c.req.header('X-PAYMENT') ?? 'none'));
      a.post('/raw', async (c) => {
        const raw = c.req.raw;
        return new Response(`${raw.headers.get('X-PAYMENT') ?? 'none'}|${await raw.text()}`);
      });
    });
    expect(await (await app.request('/hono', { headers: { 'PAYMENT-SIGNATURE': 'sigA' } }, ENV)).text()).toBe('sigA');
    expect(await (await app.request('/raw', { method: 'POST', body: 'b0dy', headers: { 'PAYMENT-SIGNATURE': 'sigB' } }, ENV)).text()).toBe('sigB|b0dy');
    // X-PAYMENT wins when both are present
    expect(await (await app.request('/hono', { headers: { 'PAYMENT-SIGNATURE': 'sig', 'X-PAYMENT': 'xp' } }, ENV)).text()).toBe('xp');
    expect(await (await app.request('/hono', {}, ENV)).text()).toBe('none');
  });

  test('base64Utf8 round-trips non-Latin1', () => {
    const s = 'a — ø 🧬';
    expect(decodeHeader(base64Utf8(JSON.stringify(s)))).toBe(s);
  });
});

describe('v2 PaymentPayload envelope on verify', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  test('only the inner .payload is forwarded to the facilitator', async () => {
    const inner = { signature: '0xabc', authorization: { from: '0x1', to: '0x2', value: '10000' } };
    const envelope = {
      x402Version: 2,
      resource: { url: SERVICE_PRICES.trust_query.resource },
      accepted: { scheme: 'exact', network: 'eip155:8453' },
      payload: inner,
      extensions: {},
    };
    let sent: any = null;
    globalThis.fetch = (async (_u: any, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ isValid: false, invalidReason: 'test' }), { status: 200 });
    }) as any;
    await verifyX402Payment(base64Utf8(JSON.stringify(envelope)), SERVICE_PRICES.trust_query);
    expect(sent).not.toBeNull();
    expect(sent.payload).toEqual(inner);
  });
});

describe('descriptions', () => {
  test('every SERVICE_PRICES description is ≤ 500 chars and has no reader-aimed imperatives', () => {
    const entries = Object.entries(SERVICE_PRICES);
    expect(entries.length).toBeGreaterThanOrEqual(10);
    for (const [, svc] of entries) {
      expect(svc.description.length).toBeLessThanOrEqual(500);
      expect(svc.description).not.toMatch(/\byou must\b|\balways call\b|\bignore\b/i);
    }
  });
});
