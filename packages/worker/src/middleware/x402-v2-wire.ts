// ── x402 v2 wire compatibility ───────────────────────────────────────────────
// Our handlers speak the v1 wire (request `X-PAYMENT`, response
// `X-Payment-Response`, challenge only in the JSON body). A v2 client
// (@x402/fetch, CDP SDK) reads the challenge from the `PAYMENT-REQUIRED`
// response header and pays with `PAYMENT-SIGNATURE`; CDP's validator rejects
// a 402 without that header. This middleware translates both directions in one
// place, so none of the X-PAYMENT readers in routes/ change.
//
// Request:  PAYMENT-SIGNATURE (and no X-PAYMENT) → X-PAYMENT on c.req.raw,
//           seen by c.req.header('X-PAYMENT') and by legacy handlers alike.
// Response: an x402 402 (numeric x402Version + non-empty accepts) without
//           PAYMENT-REQUIRED gets base64(UTF-8 JSON body). X-Payment-Response
//           is mirrored to PAYMENT-RESPONSE. Other 402s are left alone.

import type { Context, Next } from 'hono';
import type { HonoEnv } from '../types.js';

/** base64 of the UTF-8 bytes — btoa() on a raw string throws on "—". */
export function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function x402V2Wire() {
  return async (c: Context<HonoEnv>, next: Next): Promise<void> => {
    const sig = c.req.raw.headers.get('PAYMENT-SIGNATURE');
    if (sig && !c.req.raw.headers.get('X-PAYMENT')) {
      const headers = new Headers(c.req.raw.headers);
      headers.set('X-PAYMENT', sig);
      c.req.raw = new Request(c.req.raw, { headers });
    }

    await next();

    const res = c.res;
    let headers: Headers | null = null;
    if (res.status === 402 && !res.headers.has('PAYMENT-REQUIRED')) {
      try {
        const body = (await res.clone().json()) as Record<string, unknown>;
        if (typeof body?.x402Version === 'number' && Array.isArray(body.accepts) && body.accepts.length > 0) {
          headers = new Headers(res.headers);
          headers.set('PAYMENT-REQUIRED', base64Utf8(JSON.stringify(body)));
        }
      } catch { /* not JSON — not ours to rewrite */ }
    }
    const receipt = res.headers.get('X-Payment-Response');
    if (receipt && !res.headers.has('PAYMENT-RESPONSE')) {
      headers ??= new Headers(res.headers);
      headers.set('PAYMENT-RESPONSE', receipt);
    }
    if (headers) {
      c.res = undefined;
      c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
  };
}
