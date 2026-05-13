// ─── A2A Leaderboard Job ──────────────────────────────────────────────────────
//
// Fetches all agents from a2aregistry.org, audits each one via lib/a2a-audit.ts,
// and writes a single KV row at key `v1:results` under the A2A_LEADERBOARD binding.
//
// Design decisions (from spec §1–§3):
// - Single KV row — one atomic write, one read on render. No N+1.
// - Bounded concurrency pool of 10 — polite to small agent hosts.
// - Self-host filter — agentlair.dev cards are skipped (CF Workers can't self-fetch).
// - Empty registry guard — if registry returns 0 agents, keep prior KV row unchanged.

import { auditCardUrl, type Grade } from './a2a-audit.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LeaderboardGrade = Grade | 'E';

export interface LeaderboardRow {
  name: string;
  url: string;
  well_known: string;
  grade: LeaderboardGrade;
  score: number;
  layers: { l1: number; l2: number; l3: number; l4: number };
  ts: string;       // ISO of when this row was audited
  error?: string;   // present iff grade === 'E'
}

export interface LeaderboardRowSet {
  refreshed_at: string;
  total: number;
  registry_url: string;
  results: LeaderboardRow[];
}

export interface RegistryEntry {
  name?: string;
  url?: string;
  wellKnownURI?: string;
}

export interface LeaderboardEnv {
  A2A_LEADERBOARD: KVNamespace;
}

type AuditOrError =
  | { ok: true; grade: Grade; score: number; layers: { l1: number; l2: number; l3: number; l4: number } }
  | { ok: false; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SELF_HOST = 'agentlair.dev';
const REGISTRY_URL = 'https://a2aregistry.org/api/agents';
const KV_KEY = 'v1:results';

function isSelfHost(uri: string): boolean {
  try {
    return new URL(uri).hostname === SELF_HOST;
  } catch {
    return false;
  }
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Core: build row set from entries + audit results ─────────────────────────

export function buildRowSet(
  entries: RegistryEntry[],
  audits: Array<{ entry: RegistryEntry; result: AuditOrError }>,
  refreshedAt: string,
  registryUrl: string,
): LeaderboardRowSet {
  const GRADE_ORDER: Record<LeaderboardGrade, number> = { A: 0, B: 1, C: 2, D: 3, F: 4, E: 5 };

  const results: LeaderboardRow[] = audits.map(({ entry, result }) => {
    const name = entry.name ?? entry.url ?? 'Unknown';
    const url = entry.url ?? '';
    const well_known = entry.wellKnownURI ?? '';
    const ts = new Date().toISOString();

    if (!result.ok) {
      return { name, url, well_known, grade: 'E' as LeaderboardGrade, score: 0, layers: { l1: 0, l2: 0, l3: 0, l4: 0 }, ts, error: result.error };
    }

    return { name, url, well_known, grade: result.grade, score: result.score, layers: result.layers, ts };
  });

  // Sort: score DESC, then grade order (A→F→E), then name ASC
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const go = GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade];
    if (go !== 0) return go;
    return a.name.localeCompare(b.name);
  });

  return {
    refreshed_at: refreshedAt,
    total: entries.length,
    registry_url: registryUrl,
    results,
  };
}

// ─── Main refresh function ────────────────────────────────────────────────────

export async function runLeaderboardRefresh(
  env: LeaderboardEnv,
  opts?: {
    registryUrl?: string;
    concurrency?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<{ refreshed_at: string; total: number; skipped?: 'registry_empty' }> {
  const registryUrl = opts?.registryUrl ?? REGISTRY_URL;
  const concurrency = opts?.concurrency ?? 10;
  const fetchImpl = opts?.fetchImpl ?? fetch;

  // Fetch agent list from registry
  let entries: RegistryEntry[] = [];
  try {
    const res = await fetchImpl(registryUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.warn(`[leaderboard] registry returned ${res.status} — keeping prior KV`);
      return { refreshed_at: new Date().toISOString(), total: 0, skipped: 'registry_empty' };
    }
    const data = await res.json() as { agents?: RegistryEntry[]; total?: number };
    entries = data.agents ?? [];
  } catch (e) {
    console.warn(`[leaderboard] registry fetch threw: ${e} — keeping prior KV`);
    return { refreshed_at: new Date().toISOString(), total: 0, skipped: 'registry_empty' };
  }

  if (entries.length === 0) {
    console.warn('[leaderboard] registry returned 0 agents — keeping prior KV');
    return { refreshed_at: new Date().toISOString(), total: 0, skipped: 'registry_empty' };
  }

  const refreshedAt = new Date().toISOString();

  // Audit each agent with bounded concurrency
  const audits = await mapPool(entries, concurrency, async (entry) => {
    const uri = entry.wellKnownURI ?? '';

    // Self-host filter
    if (uri && isSelfHost(uri)) {
      return { entry, result: { ok: false, error: 'self-host' } as AuditOrError };
    }

    if (!uri) {
      return { entry, result: { ok: false, error: 'no wellKnownURI' } as AuditOrError };
    }

    try {
      const auditResult = await auditCardUrl(uri, fetchImpl);
      const s = auditResult.scores;
      return {
        entry,
        result: {
          ok: true,
          grade: auditResult.grade,
          score: s.overall,
          layers: { l1: s.L1_identity, l2: s.L2_authentication, l3: s.L3_authorization, l4: s.L4_behavioral },
        } as AuditOrError,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 80) : 'audit error';
      return { entry, result: { ok: false, error: msg } as AuditOrError };
    }
  });

  const rowSet = buildRowSet(entries, audits, refreshedAt, registryUrl);

  // Write to KV (single atomic row)
  try {
    await env.A2A_LEADERBOARD.put(KV_KEY, JSON.stringify(rowSet));
  } catch (e) {
    console.error(`[leaderboard] KV PUT failed: ${e}`);
    // Don't crash — next cron retries
  }

  return { refreshed_at: refreshedAt, total: entries.length };
}
