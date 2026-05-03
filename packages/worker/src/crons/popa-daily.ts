/**
 * PoPA Daily Cron — emits one Proof-of-Presence attestation per
 * enabled subscriber, for the previous UTC day.
 *
 * Fired by the `0 0 * * *` cron trigger registered in wrangler.toml.
 * Wired into the worker's `scheduled()` handler in src/index.ts.
 *
 * One row per subscriber per UTC day. Idempotent: a duplicate run for
 * the same window is a no-op (the emitter does its own SELECT 1 check).
 *
 * Errors emitting for one subscriber do NOT halt iteration — the cron
 * collects them and logs a summary for observability.
 */

import type { Env } from '../types.js';
import { emitAttestation } from '../lib/popa-emitter.js';

export interface PoPADailySummary {
  emitted: number;
  skipped: number;
  errors: Array<{ did: string; reason: string }>;
}

export async function runPoPADaily(env: Env): Promise<PoPADailySummary> {
  if (!env.AUDIT || !env.AUDIT_SIGNING_KEY || !env.TRANSPARENCY_SERVICE) {
    return {
      emitted: 0,
      skipped: 0,
      errors: [{ did: '*', reason: 'missing_bindings' }],
    };
  }

  // Window: previous UTC midnight → current UTC midnight (24h, exclusive end)
  const now = new Date();
  const windowEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  );
  const windowStart = new Date(windowEnd.getTime() - 86_400_000);

  let subs: { results?: { agent_did: string }[] };
  try {
    // PoPA v2: also skip revoked rows. revoked_at IS NULL is forward-compatible
    // with v1 rows where the column does not yet exist (SQLite returns NULL).
    subs = await env.AUDIT
      .prepare('SELECT agent_did FROM popa_subscribers WHERE enabled = 1 AND revoked_at IS NULL')
      .all<{ agent_did: string }>();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { emitted: 0, skipped: 0, errors: [{ did: '*', reason: 'subscribers_query: ' + reason.slice(0, 200) }] };
  }

  const summary: PoPADailySummary = { emitted: 0, skipped: 0, errors: [] };
  for (const row of subs.results ?? []) {
    const r = await emitAttestation(env, row.agent_did, windowStart, windowEnd);
    if (r.status === 'emitted') summary.emitted++;
    else if (r.status === 'skipped') summary.skipped++;
    else summary.errors.push({ did: row.agent_did, reason: r.reason ?? 'unknown' });
  }

  console.log('[popa-daily]', JSON.stringify(summary));
  return summary;
}
