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
import type { HonoEnv } from '../types.js';

export const publicStatsRoutes = new Hono<HonoEnv>();

// ─── GET /v1/stats/agents ─────────────────────────────────────────────────────
//
// Total registered agents + 24h and 7d deltas. Reads from materialized KV
// counters (O(1) — 33 subrequests regardless of account count):
//   stats:total                   — running total
//   stats:hourly:YYYY-MM-DDTHH    — registrations per UTC hour (last 24)
//   stats:daily:YYYY-MM-DD        — registrations per UTC day (last 8)
//
// Lazy fallback: if stats:total is missing or zero, falls back to a paginated
// account: list scan and persists the result. Cold-start is one-shot.
//
// Graceful: any KV failure returns zeros with `error: 'stats_unavailable'`.
// Never returns a 5xx — the dashboard must render.

publicStatsRoutes.get('/agents', async (c) => {
  const computed_at = new Date().toISOString();
  try {
    const now = new Date();

    // Build read keys for the last 24 hourly buckets and last 8 daily buckets
    const hourKeys: string[] = [];
    for (let i = 0; i < 24; i++) {
      const t = new Date(now.getTime() - i * 60 * 60 * 1000);
      hourKeys.push('stats:hourly:' + t.toISOString().slice(0, 13));
    }
    const dayKeys: string[] = [];
    for (let i = 0; i < 8; i++) {
      const t = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayKeys.push('stats:daily:' + t.toISOString().slice(0, 10));
    }

    // 33 subrequests — constant cost regardless of account count
    const [totalRaw, hourValues, dayValues] = await Promise.all([
      c.env.KEYS.get('stats:total'),
      Promise.all(hourKeys.map((k) => c.env.KEYS.get(k))),
      Promise.all(dayKeys.map((k) => c.env.KEYS.get(k))),
    ]);

    let total = parseInt(totalRaw ?? '', 10);
    if (!Number.isFinite(total) || total <= 0) {
      // Counter not yet initialized — fall back to paginated list of account: index.
      // Counts only (no dereference). Bounded by N/1000 subrequests.
      total = 0;
      let cursor: string | undefined = undefined;
      let pages = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page: { keys: { name: string }[]; list_complete: boolean; cursor?: string } =
          await c.env.KEYS.list({ prefix: 'account:', limit: 1000, cursor });
        total += page.keys.length;
        if (page.list_complete) break;
        cursor = page.cursor;
        pages++;
        if (pages > 100) break; // safety: hard cap at 100k accounts
      }
      // Persist for next request — turns the cold-start into a one-shot.
      // Best-effort: if put fails, fallback runs again next time.
      await c.env.KEYS.put('stats:total', String(total)).catch(() => {});
    }

    const last_24h = hourValues.reduce(
      (s, v) => s + (parseInt(v ?? '0', 10) || 0),
      0,
    );
    const last_7d = dayValues.reduce(
      (s, v) => s + (parseInt(v ?? '0', 10) || 0),
      0,
    );

    return json({ total, last_24h, last_7d, computed_at });
  } catch (e) {
    console.error('public stats/agents failed:', e instanceof Error ? e.message : String(e));
    return json({
      total: 0,
      last_24h: 0,
      last_7d: 0,
      computed_at,
      error: 'stats_unavailable',
    });
  }
});
