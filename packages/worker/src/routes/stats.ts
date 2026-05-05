// ─── Public Stats Routes ──────────────────────────────────────────────────────
//
// Public, unauthenticated aggregate substrate health stats. Designed for the
// live trust dashboard at agentlair.dev/live. No per-account fields leave the
// worker — only counts and time-bucketed deltas.
//
// Endpoints:
//   GET /v1/stats/agents — { total, last_24h, last_7d, computed_at }
//
// Mounted in index.ts BEFORE the /v1/* auth middleware so anonymous browsers
// can hit it.

import { Hono } from 'hono';
import { json } from '../utils.js';
import type { HonoEnv, Account } from '../types.js';

export const publicStatsRoutes = new Hono<HonoEnv>();

// ─── GET /v1/stats/agents ─────────────────────────────────────────────────────
//
// Total registered agents + 24h and 7d deltas. Reads from the KEYS KV
// namespace using the `account:<id>` index. For each entry, fetches the
// underlying account record by its key hash to derive `created_at`.
//
// Cost: O(N) KV reads where N = total accounts. With ~17 accounts today this
// is cheap; capped at 1000 (single KV list page) to bound worst-case latency.
// Above 1000 we report total=">=1000" and skip deltas — explicit signal that
// this endpoint needs an aggregation upgrade once we cross the threshold.
//
// Graceful: any KV failure returns zeros with `error: 'stats_unavailable'`.
// Never returns a 5xx — the dashboard must render.

publicStatsRoutes.get('/agents', async (c) => {
  const computed_at = new Date().toISOString();
  const empty = {
    total: 0,
    last_24h: 0,
    last_7d: 0,
    computed_at,
    error: 'stats_unavailable' as string | undefined,
  };

  try {
    // List the `account:<id>` index — each entry maps to a key hash.
    const list = await c.env.KEYS.list({ prefix: 'account:', limit: 1000 });
    const total = list.keys.length;

    // If we hit the page cap, we may have undercounted. Be honest about it
    // by returning a sentinel rather than a wrong delta.
    if (list.list_complete === false) {
      return json({
        total: list.keys.length,
        total_truncated: true,
        last_24h: null,
        last_7d: null,
        computed_at,
      });
    }

    if (total === 0) {
      return json({ total: 0, last_24h: 0, last_7d: 0, computed_at });
    }

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const cut24 = now - day;
    const cut7d = now - 7 * day;

    let last_24h = 0;
    let last_7d = 0;

    // Fetch each account record (key:<hash>) and parse created_at.
    // Concurrency: KV runs in workers — fan out with Promise.all in batches
    // of 50 so we don't exceed the 50-subrequest soft limit per request.
    const indexEntries = list.keys.map((k) => k.name); // ['account:acc_xyz', ...]
    const BATCH = 50;
    for (let i = 0; i < indexEntries.length; i += BATCH) {
      const batch = indexEntries.slice(i, i + BATCH);
      const hashes = await Promise.all(batch.map((k) => c.env.KEYS.get(k)));
      const accounts = await Promise.all(
        hashes.map((h) => (h ? c.env.KEYS.get('key:' + h, 'json') : null)),
      );
      for (const raw of accounts) {
        const acct = raw as Account | null;
        if (!acct) continue;
        const createdAt = typeof acct.created_at === 'string' ? acct.created_at : null;
        if (!createdAt) continue;
        const t = Date.parse(createdAt);
        if (isNaN(t)) continue;
        if (t >= cut24) last_24h++;
        if (t >= cut7d) last_7d++;
      }
    }

    return json({
      total,
      last_24h,
      last_7d,
      computed_at,
    });
  } catch (e) {
    console.error('public stats/agents failed:', e instanceof Error ? e.message : String(e));
    return json(empty);
  }
});
