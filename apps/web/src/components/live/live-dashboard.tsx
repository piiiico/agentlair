// ─── Live Trust Dashboard ──────────────────────────────────────────────────────
//
// Public substrate-is-alive proof page. Polls four read-only public endpoints:
//   • GET /v1/scitt/corpus?order=desc&limit=50 — newest receipts (every 10s)
//   • GET /v1/trust/distribution                — score histogram (every 60s)
//   • GET /v1/stats/agents                      — total + 24h/7d deltas (every 60s)
//   • GET /v1/scitt/corpus/stats                — cumulative totals (once on mount)
//
// All endpoints are unauthenticated and return aggregate-only data — no per-agent
// fields leave the worker. Anonymity preserved by truncating account_id portions
// of issuer DIDs to the first 8 chars in the receipt feed.

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const API_BASE = 'https://agentlair.dev';

// ─── Types ────────────────────────────────────────────────────────────────────

type Receipt = {
  entry_id: string;
  issuer_did: string;
  issued_at: string;
  statement_type: string;
  leaf_index: number;
  tree_size: number;
  root_hash: string;
};

type CorpusResponse = {
  items: Receipt[];
  count: number;
  next_cursor: number | null;
  order: 'asc' | 'desc';
};

type DistributionResponse = {
  buckets: { range: string; count: number }[];
  total_agents_scored: number;
  avg_score: number | null;
  computed_at: string;
};

type AgentStatsResponse = {
  total: number;
  total_truncated?: boolean;
  last_24h: number | null;
  last_7d: number | null;
  computed_at: string;
  error?: string;
};

type CorpusStatsResponse = {
  total_receipts: number;
  unique_issuers: number;
  by_statement_type?: { statement_type: string; count: number }[];
  by_week?: { week: string; count: number }[];
};

type BccIssuance = {
  id: string;
  subject_did: string;
  evidence_type: string;
  issued_at: string;
};

type BccListResponse = {
  items: BccIssuance[];
  count: number;
  next_cursor: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return '…';
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function shortIssuer(did: string): string {
  // Format: did:web:agentlair.dev:agents:acc_<base>
  const last = did.split(':').pop() ?? '';
  if (last.startsWith('acc_')) {
    const tail = last.slice(4);
    return tail.length > 8 ? tail.slice(0, 8) : tail;
  }
  return last.slice(0, 8) || '????????';
}

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(API_BASE + path, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json() as Promise<T>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LiveDashboard() {
  const [now, setNow] = useState(Date.now());
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [dist, setDist] = useState<DistributionResponse | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStatsResponse | null>(null);
  const [corpusStats, setCorpusStats] = useState<CorpusStatsResponse | null>(null);
  const [lastSuccess, setLastSuccess] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ corpus?: string; dist?: string; agents?: string; cstats?: string }>({});
  const [bccIssuances, setBccIssuances] = useState<BccIssuance[]>([]);
  const [errors_bcc, setErrorsBcc] = useState<string | null>(null);
  const newIds = useRef<Set<string>>(new Set());
  const seenIds = useRef<Set<string>>(new Set());

  // Tick the clock for relative-time labels.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll receipts every 10s.
  useEffect(() => {
    let alive = true;
    const fetchReceipts = async () => {
      try {
        const data = await jget<CorpusResponse>('/v1/scitt/corpus?order=desc&limit=50');
        if (!alive) return;
        const incoming = data.items || [];
        // Mark new ones (not seen before) for fade-in animation.
        const fresh = new Set<string>();
        for (const r of incoming) {
          if (!seenIds.current.has(r.entry_id)) fresh.add(r.entry_id);
        }
        newIds.current = fresh;
        for (const r of incoming) seenIds.current.add(r.entry_id);
        setReceipts(incoming);
        setLastSuccess(Date.now());
        setErrors((e) => ({ ...e, corpus: undefined }));
      } catch (e) {
        if (!alive) return;
        setErrors((p) => ({ ...p, corpus: (e as Error).message }));
      }
    };
    fetchReceipts();
    const id = setInterval(fetchReceipts, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Poll distribution every 60s.
  useEffect(() => {
    let alive = true;
    const f = async () => {
      try {
        const data = await jget<DistributionResponse>('/v1/trust/distribution');
        if (!alive) return;
        setDist(data);
        setLastSuccess(Date.now());
        setErrors((e) => ({ ...e, dist: undefined }));
      } catch (e) {
        if (!alive) return;
        setErrors((p) => ({ ...p, dist: (e as Error).message }));
      }
    };
    f();
    const id = setInterval(f, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Poll agent stats every 60s.
  useEffect(() => {
    let alive = true;
    const f = async () => {
      try {
        const data = await jget<AgentStatsResponse>('/v1/stats/agents');
        if (!alive) return;
        setAgentStats(data);
        setLastSuccess(Date.now());
        setErrors((e) => ({ ...e, agents: undefined }));
      } catch (e) {
        if (!alive) return;
        setErrors((p) => ({ ...p, agents: (e as Error).message }));
      }
    };
    f();
    const id = setInterval(f, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // One-shot corpus stats.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await jget<CorpusStatsResponse>('/v1/scitt/corpus/stats');
        if (!alive) return;
        setCorpusStats(data);
        setLastSuccess(Date.now());
        setErrors((e) => ({ ...e, cstats: undefined }));
      } catch (e) {
        if (!alive) return;
        setErrors((p) => ({ ...p, cstats: (e as Error).message }));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // One-shot BCC issuances fetch.
  useEffect(() => {
    let alive = true;
    jget<BccListResponse>('/v1/bcc/list?limit=5')
      .then((data) => { if (alive) setBccIssuances(data.items); })
      .catch(() => { if (alive) setErrorsBcc('Failed to load BCC issuances.'); });
    return () => { alive = false; };
  }, []);

  // "Live" pulse: green if any fetch succeeded in last 30s.
  const isLive = lastSuccess !== null && now - lastSuccess < 30000;

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 lg:py-24">
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-3">
          <span
            className={cn(
              'inline-block h-2.5 w-2.5 rounded-full',
              isLive ? 'bg-emerald-500 animate-pulse' : 'bg-red-500',
            )}
            aria-label={isLive ? 'live' : 'stale'}
          />
          <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
            {isLive ? 'live' : 'reconnecting…'}
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">The substrate is alive.</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Last 50 SCITT receipts as they're issued. Real agents, real signatures, real Merkle tree.
          Every receipt verifiable against the public JWKS at{' '}
          <a className="underline underline-offset-2" href="https://agentlair.dev/.well-known/jwks.json">
            agentlair.dev/.well-known/jwks.json
          </a>
          .
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Section A — Receipt feed (left, full height) */}
        <section className="lg:row-span-2 rounded-lg border bg-card p-5">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-mono uppercase tracking-wide text-muted-foreground">
              Recent receipts
            </h2>
            <span className="text-xs text-muted-foreground">
              {receipts ? `${receipts.length} shown` : 'loading…'}
            </span>
          </header>
          <div className="h-[480px] overflow-y-auto pr-2">
            {errors.corpus && !receipts ? (
              <div className="text-sm text-red-600 dark:text-red-400">{errors.corpus}</div>
            ) : !receipts ? (
              <div className="text-sm text-muted-foreground">Loading receipts…</div>
            ) : receipts.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No receipts issued yet. Be the first to{' '}
                <a className="underline underline-offset-2" href="/getting-started">
                  register an agent
                </a>
                .
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {receipts.map((r) => (
                  <li
                    key={r.entry_id}
                    className={cn(
                      'py-2 text-sm grid grid-cols-[5.5rem_5.5rem_1fr_3rem] gap-3 items-center',
                      newIds.current.has(r.entry_id) && 'animate-in fade-in duration-700',
                    )}
                  >
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {relativeTime(r.issued_at, now)}
                    </span>
                    <span className="font-mono text-xs">{shortIssuer(r.issuer_did)}</span>
                    <span className="font-mono text-xs truncate" title={r.statement_type}>
                      {r.statement_type}
                    </span>
                    <a
                      className="text-xs font-mono text-muted-foreground hover:text-foreground underline-offset-2 hover:underline justify-self-end"
                      href={`/v1/scitt/corpus/${r.entry_id}`}
                      title={`Leaf ${r.leaf_index}`}
                    >
                      #{r.leaf_index}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Section B — Trust distribution (top-right) */}
        <section className="rounded-lg border bg-card p-5">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-mono uppercase tracking-wide text-muted-foreground">
              Trust score distribution
            </h2>
            {dist && dist.avg_score !== null && (
              <span className="text-xs text-muted-foreground">
                avg <span className="font-mono text-foreground">{dist.avg_score}</span>
              </span>
            )}
          </header>
          {!dist ? (
            <div className="text-sm text-muted-foreground">Loading distribution…</div>
          ) : (
            <DistributionChart dist={dist} />
          )}
        </section>

        {/* Recent BCC issuances */}
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Recent BCC Issuances
          </h2>
          {errors_bcc ? (
            <div className="text-sm text-red-600 dark:text-red-400">{errors_bcc}</div>
          ) : bccIssuances.length === 0 ? (
            <div className="text-sm text-muted-foreground">No issuances yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left pb-2 font-normal">Subject</th>
                  <th className="text-left pb-2 font-normal">Type</th>
                  <th className="text-right pb-2 font-normal">Issued</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bccIssuances.slice(0, 5).map((b) => (
                  <tr key={b.id}>
                    <td className="py-1.5 font-mono truncate max-w-[160px]">{shortIssuer(b.subject_did)}</td>
                    <td className="py-1.5 capitalize">{b.evidence_type}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{relativeTime(b.issued_at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Section C — Agent counter + Section D — Substrate health (bottom-right) */}
        <section className="rounded-lg border bg-card p-5">
          <header className="mb-4">
            <h2 className="text-sm font-mono uppercase tracking-wide text-muted-foreground">
              Substrate
            </h2>
          </header>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Stat
              label="agents registered"
              value={agentStats ? formatTotal(agentStats) : '…'}
              sub={
                agentStats && agentStats.last_24h !== null
                  ? `+${agentStats.last_24h} · 24h`
                  : null
              }
            />
            <Stat
              label="receipts issued"
              value={corpusStats ? corpusStats.total_receipts.toLocaleString() : '…'}
              sub={corpusStats ? `${corpusStats.unique_issuers} issuers` : null}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="agents · 7d"
              value={
                agentStats && agentStats.last_7d !== null ? `+${agentStats.last_7d}` : '…'
              }
              sub={null}
            />
            <Stat
              label="busiest week"
              value={busiestWeek(corpusStats) ?? '…'}
              sub={busiestWeekCount(corpusStats)}
            />
          </div>
        </section>
      </div>

      <footer className="mt-12 text-xs text-muted-foreground">
        <p>
          Privacy: agent identifiers are truncated to the first 8 chars of the account hash.
          No emails, receipt content, or scopes are exposed by these endpoints. Every value above
          comes from public APIs:{' '}
          <a className="underline underline-offset-2" href="/api">
            /api
          </a>
          .
        </p>
      </footer>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string | null;
}) {
  return (
    <div>
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function DistributionChart({ dist }: { dist: DistributionResponse }) {
  const max = Math.max(1, ...dist.buckets.map((b) => b.count));
  return (
    <div className="space-y-2">
      {dist.buckets.map((b) => {
        const pct = (b.count / max) * 100;
        return (
          <div key={b.range} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground">{b.range}</span>
            <div className="h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: pct + '%', transition: 'width 600ms ease' }}
                aria-label={`${b.count} agents in ${b.range}`}
              />
            </div>
            <span className="text-xs font-mono tabular-nums text-right">{b.count}</span>
          </div>
        );
      })}
      <div className="pt-2 text-xs text-muted-foreground">
        {dist.total_agents_scored} agents scored
      </div>
    </div>
  );
}

function formatTotal(s: AgentStatsResponse): string {
  if (s.total_truncated) return `≥${s.total.toLocaleString()}`;
  return s.total.toLocaleString();
}

function busiestWeek(c: CorpusStatsResponse | null): string | null {
  if (!c?.by_week || c.by_week.length === 0) return null;
  // by_week is returned DESC by the worker (LIMIT 52 ORDER BY week DESC).
  // Pick the absolute max count regardless of recency.
  const top = [...c.by_week].sort((a, b) => b.count - a.count)[0];
  if (!top) return null;
  return top.week;
}

function busiestWeekCount(c: CorpusStatsResponse | null): string | null {
  if (!c?.by_week || c.by_week.length === 0) return null;
  const top = [...c.by_week].sort((a, b) => b.count - a.count)[0];
  if (!top) return null;
  return `${top.count} receipts`;
}
