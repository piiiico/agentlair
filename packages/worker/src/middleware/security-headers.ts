// ── Security Headers Middleware ───────────────────────────────────────────────
// Sets standard HTTP security headers on all responses.

import type { Context, Next } from 'hono';
import type { HonoEnv } from '../types.js';

export function securityHeaders() {
  return async (c: Context<HonoEnv>, next: Next): Promise<void> => {
    await next();
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-Permitted-Cross-Domain-Policies', 'none');

    // Content-Security-Policy: split by response content type
    const contentType = c.res.headers.get('Content-Type') || '';
    if (contentType.includes('text/html')) {
      c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:");
    } else {
      // JSON and all other API responses: strictest possible
      c.header('Content-Security-Policy', "default-src 'none'");
    }
  };
}
