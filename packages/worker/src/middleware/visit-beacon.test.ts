import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { securityHeaders } from './security-headers.js';
import { visitBeacon, injectBeacon, headCloseIndex } from './visit-beacon.js';

const TRAP = '<script type="application/ld+json">{"a":"paste it between <head>...</head>"}</script>';
const PAGE = `<!doctype html><html><head><title>x</title>${TRAP}</head><body>hi</body></html>`;

function app() {
  const a = new Hono<any>();
  a.use('*', securityHeaders());
  a.use('*', visitBeacon());
  a.get('/', () => new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(PAGE.length), 'X-Powered-By': 'AgentLair' } }));
  a.get('/nohead', (c) => c.html('<p>fragment</p>'));
  a.get('/api', (c) => c.json({ ok: true, note: '</head>' }));
  return a;
}

const count = (s: string, n: string) => s.split(n).length - 1;

describe('visit beacon', () => {
  test('HTML: beacon exactly once, before the REAL </head> (not the JSON-LD literal)', async () => {
    const r = await app().request('/');
    const body = await r.text();
    expect(count(body, '/api/v1/visit')).toBe(1);
    const beaconAt = body.indexOf('/api/v1/visit');
    expect(beaconAt).toBeGreaterThan(body.indexOf(TRAP) + TRAP.length - 1);
    expect(beaconAt).toBeLessThan(body.lastIndexOf('</head>'));
    expect(body).toContain(TRAP); // JSON-LD intact
    expect(r.headers.get('Content-Length')).toBeNull(); // stale length dropped
    expect(r.headers.get('X-Powered-By')).toBe('AgentLair'); // other headers kept
  });
  test('JSON response untouched', async () => {
    const r = await app().request('/api');
    expect(await r.text()).not.toContain('/api/v1/visit');
  });
  test('HTML without </head> untouched', async () => {
    const r = await app().request('/nohead');
    expect(await r.text()).toBe('<p>fragment</p>');
  });
  test('idempotent', () => {
    const once = injectBeacon(PAGE)!;
    expect(injectBeacon(once)).toBeNull();
  });
  test('headCloseIndex skips script bodies', () => {
    expect(headCloseIndex(PAGE)).toBe(PAGE.lastIndexOf('</head>'));
  });
});

describe('CSP', () => {
  test('HTML CSP carries beacon + RUM origins', async () => {
    const csp = (await app().request('/')).headers.get('Content-Security-Policy')!;
    expect(csp).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com(;|\s)/);
    expect(csp).toMatch(/connect-src 'self' [^;]*https:\/\/poc-backend\.amdal-dev\.workers\.dev(;|\s|$)/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com(;|\s|$)/);
  });
  test('JSON CSP stays default-src none', async () => {
    expect((await app().request('/api')).headers.get('Content-Security-Policy')).toBe("default-src 'none'");
  });
});
