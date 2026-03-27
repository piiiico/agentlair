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
  };
}
