// ─── Utilities ────────────────────────────────────────────────────────────────

// ─── Verbose mode ─────────────────────────────────────────────────────────────
// Agents pass ?verbose=false to get minimal payloads (no human-readable strings).
// Default is verbose=true for backward compatibility.
// The outer fetch handler strips human fields from all JSON responses when verbose=false.
export function isVerbose(request: Request): boolean {
  try {
    return new URL(request.url).searchParams.get('verbose') !== 'false';
  } catch {
    return true;
  }
}

// Fields stripped from all JSON responses when ?verbose=false.
// These are human-readable guidance strings with no machine utility.
// Agents branch on `error` codes and numeric fields — not on prose text.
export const VERBOSE_ONLY_FIELDS = ['message', 'note', 'how_to_claim', 'hint', 'upgrade_hint', 'warning'];

export function nanoid(n: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function json(data: unknown, status?: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-PAYMENT',
      'Access-Control-Expose-Headers': 'X-402-Version, X-Payment-Response',
      'X-Powered-By': 'AgentLair',
      ...(extraHeaders || {}),
    },
  });
}

export function err(message: string, status?: number, code?: string): Response {
  return json({ error: code || 'error', message }, status || 400);
}

export function html(body: string, status?: number): Response {
  return new Response(body, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Powered-By': 'AgentLair',
    },
  });
}
