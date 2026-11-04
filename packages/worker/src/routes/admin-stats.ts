// ─── Admin: accounts created per day (count-only) ─────────────────────────────
//
// GET /v1/admin/stats/accounts-per-day?days=N[&cursor=C]   (Bearer ADMIN_KEY)
//
// Accounts live in KV (account:<id> → key hash, key:<hash> → account JSON), not
// in a DB, and there are thousands of them — one request cannot dereference
// them all inside the Workers subrequest cap. So this route scans ONE page of
// the account: index (PAGE_SIZE keys) and returns per-day counts for that page
// plus a cursor; the caller loops until `complete: true` and sums by day.
//
// Output is counts only — no emails, no ids, no names leave the worker.
//
// created_outside excludes INTERNAL accounts (isInternalAccount below):
//   - email/operator_email on a domain we operate (INTERNAL_EMAIL_DOMAINS) —
//     the same '@agentlair.dev' internal-sender rule the inbound email handler
//     uses (index.ts isInternalSender), widened to our other operator domains;
//   - name matching INTERNAL_NAME_RE — the live-API test suite registers
//     `integration-test-<run>` / `integration-test-alt-<run>` (src/api.test.ts).
// Anything else counts as outside, including Sybil bursts: those are real
// outside actors, not ours.

import { Hono } from 'hono';
import { json, err } from '../utils.js';
import type { HonoEnv } from '../types.js';

export const INTERNAL_EMAIL_DOMAINS = ['agentlair.dev', 'amdal.dev', 'synligdigital.no'];
export const INTERNAL_NAME_RE = /^(integration-test|smoke-test|e2e-test|dogfood)(-|_|$)/i;
export const PAGE_SIZE = 400;
const MAX_DAYS = 90;

export function isInternalAccount(acct: { email?: unknown; operator_email?: unknown; name?: unknown }): boolean {
  for (const e of [acct.email, acct.operator_email]) {
    if (typeof e !== 'string') continue;
    const domain = e.toLowerCase().trim().split('@')[1] || '';
    if (INTERNAL_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return true;
  }
  return typeof acct.name === 'string' && INTERNAL_NAME_RE.test(acct.name);
}

export const adminStatsRoutes = new Hono<HonoEnv>();

adminStatsRoutes.get('/accounts-per-day', async (c) => {
  const adminKey = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!c.env.ADMIN_KEY || !adminKey || adminKey !== c.env.ADMIN_KEY) {
    return err('Unauthorized. Admin key required.', 401, 'admin_unauthorized');
  }
  const daysRaw = parseInt(c.req.query('days') || '30', 10);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), MAX_DAYS) : 30;
  const cursor = c.req.query('cursor') || undefined;

  // Day buckets oldest→newest, UTC, including today.
  const now = Date.now();
  const buckets = new Map<string, { day: string; created: number; created_outside: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    buckets.set(day, { day, created: 0, created_outside: 0 });
  }

  const page = await c.env.KEYS.list({ prefix: 'account:', limit: PAGE_SIZE, cursor });
  // account:<id> is the index; account:<id>:keys etc. are sub-records — skip them.
  const indexKeys = page.keys.map((k) => k.name).filter((n) => n.split(':').length === 2);
  const hashes = await Promise.all(indexKeys.map((n) => c.env.KEYS.get(n)));
  const records = await Promise.all(hashes.map((h) => (h ? c.env.KEYS.get('key:' + h) : null)));

  let scanned = 0, unreadable = 0;
  for (const raw of records) {
    if (!raw) { unreadable++; continue; }
    let acct: Record<string, unknown>;
    try { acct = JSON.parse(raw); } catch { unreadable++; continue; }
    scanned++;
    const day = typeof acct.created_at === 'string' ? acct.created_at.slice(0, 10) : '';
    const b = buckets.get(day);
    if (!b) continue;
    b.created++;
    if (!isInternalAccount(acct)) b.created_outside++;
  }

  return json({
    days: [...buckets.values()],
    scanned,
    unreadable,
    cursor: page.list_complete ? null : (page as { cursor?: string }).cursor ?? null,
    complete: page.list_complete,
    internal_rule: { email_domains: INTERNAL_EMAIL_DOMAINS, name_pattern: INTERNAL_NAME_RE.source },
  });
});
