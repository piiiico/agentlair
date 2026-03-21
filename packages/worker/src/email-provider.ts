// ─── Email Provider Abstraction ──────────────────────────────────────────────
// Each provider implements: send(opts, env) → { provider_id }  (throws on failure)
// opts = { from, to[], subject, text?, html?, in_reply_to?, references? }

import type { Env } from './types.js';

const ResendProvider = {
  name: 'resend',
  isConfigured: (env: Env) => !!env.RESEND_API_KEY,
  async send(opts: any, env: Env) {
    // Build threading headers: In-Reply-To and (if provided) References
    let threadingHeaders: Record<string, string> | undefined;
    if (opts.in_reply_to) {
      threadingHeaders = { 'In-Reply-To': opts.in_reply_to };
      // Use caller-provided references if available, otherwise fall back to in_reply_to
      threadingHeaders['References'] = opts.references || opts.in_reply_to;
    }
    const payload = {
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.html ? { html: opts.html } : {}),
      ...(threadingHeaders ? { headers: threadingHeaders } : {}),
    };
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data: any = await resp.json();
    if (!resp.ok) throw new Error(data.message || data.error || 'Resend API error');
    return { provider_id: data.id };
  },
};

export function getEmailProvider(env: Env) {
  // Provider selection via EMAIL_PROVIDER env var. Default: resend.
  const selected = (env.EMAIL_PROVIDER || 'resend').toLowerCase();
  if (selected === 'resend' && ResendProvider.isConfigured(env)) return ResendProvider;
  // If RESEND_API_KEY set but no explicit provider, default to resend
  if (ResendProvider.isConfigured(env)) return ResendProvider;
  return null; // No provider configured
}

// ─── Turso HTTP Client (for shared_observations) ────────────────────────────
// Minimal Turso pipeline API client using fetch. Uses TURSO_URL + TURSO_AUTH_TOKEN
// env vars (set as CF Worker secrets). Scoped: only shared_observations table.

export async function tursoExecute(env: Env, sql: string, args: any[]) {
  if (!env.TURSO_URL || !env.TURSO_AUTH_TOKEN) {
    throw new Error('Turso not configured (missing TURSO_URL or TURSO_AUTH_TOKEN)');
  }
  // Convert libsql:// to https:// if needed
  const baseUrl = env.TURSO_URL.replace(/^libsql:\/\//, 'https://');
  const resp = await fetch(`${baseUrl}/v3/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.TURSO_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql, args: args.map(a => a === null || a === undefined ? { type: 'null' } : { type: 'text', value: String(a) }) } },
        { type: 'close' },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Turso error ${resp.status}: ${text}`);
  }
  const data: any = await resp.json();
  const result = data.results?.[0];
  if (result?.type === 'error') {
    throw new Error(`Turso SQL error: ${result.error?.message || JSON.stringify(result.error)}`);
  }
  // Extract rows as plain objects
  const execResult = result?.response?.result;
  if (!execResult) return { rows: [], affected: 0 };
  const cols = execResult.cols?.map((c: any) => c.name) || [];
  const rows = (execResult.rows || []).map((row: any) =>
    Object.fromEntries(cols.map((col: string, i: number) => [col, row[i]?.value ?? null]))
  );
  return { rows, affected: execResult.affected_row_count || 0 };
}
