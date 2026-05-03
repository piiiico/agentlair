import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

type Sort = 'attestations' | 'age';

interface LeaderboardRow {
  did: string;
  controller: string | null;
  enrolled_at: string;
  last_attested_at: string | null;
  revoked_at: string | null;
  attestation_count: number;
}

interface LeaderboardResponse {
  sort: Sort;
  limit: number;
  rows: LeaderboardRow[];
  generated_at: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: LeaderboardResponse };

function truncateDid(did: string): string {
  if (did.length <= 48) return did;
  return did.slice(0, 32) + '…' + did.slice(-8);
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diffMs = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < 0) return 'in the future';
  if (diffMs < 60 * 60 * 1000) return 'just now';
  if (diffMs < day) {
    const h = Math.floor(diffMs / (60 * 60 * 1000));
    return `${h}h ago`;
  }
  const days = Math.floor(diffMs / day);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function freshnessDot(lastAttestedAt: string | null): { color: string; label: string } {
  if (!lastAttestedAt) return { color: 'bg-muted-foreground/40', label: 'no attestations yet' };
  const diff = Date.now() - new Date(lastAttestedAt).getTime();
  if (diff < 36 * 60 * 60 * 1000) return { color: 'bg-emerald-500', label: 'fresh' };
  return { color: 'bg-amber-500', label: 'stale' };
}

export function LeaderboardPage() {
  const [sort, setSort] = useState<Sort>('attestations');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [selfId, setSelfId] = useState<string | null>(null);

  // Fetch leaderboard on mount + sort change
  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetch(`/v1/popa/leaderboard?limit=50&sort=${sort}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setState({ kind: 'error', message: (data as { message?: string }).message ?? 'Could not load leaderboard.' });
          return;
        }
        setState({ kind: 'ready', data: data as LeaderboardResponse });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [sort]);

  // Lazy self-id resolution — only if a credential is in localStorage
  useEffect(() => {
    let cancelled = false;
    const apiKey = typeof window !== 'undefined' ? localStorage.getItem('al_apikey') : null;
    const session = typeof window !== 'undefined' ? localStorage.getItem('al_session') : null;
    if (!apiKey && !session) return;
    const auth = apiKey ? `Bearer ${apiKey}` : `Bearer session_${session}`;
    fetch('/v1/account/me', { headers: { Authorization: auth } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data.id === 'string') setSelfId(data.id);
      })
      .catch(() => { /* unauthenticated visitor — no highlight */ });
    return () => { cancelled = true; };
  }, []);

  const rows = state.kind === 'ready' ? state.data.rows : [];
  const isEmpty = state.kind === 'ready' && rows.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-28 lg:pt-44 lg:pb-32">
      <header className="mb-8">
        <p className="text-sm text-muted-foreground mb-2">
          <a href="/popa/" className="hover:text-foreground transition-colors">
            Proof of Persistent Activity
          </a>
        </p>
        <h1 className="text-3xl font-bold tracking-tight mb-3">Leaderboard</h1>
        <p className="text-muted-foreground max-w-2xl">
          Every enrolled DID gets one signed attestation per UTC day, anchored in the SCITT transparency log. Older enrollments and longer streaks rank higher.
        </p>
      </header>

      {/* Sort toggle */}
      <div className="mb-6 flex gap-2">
        {([
          ['attestations', 'Most attested'],
          ['age', 'Earliest enrolled'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSort(key)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm transition-colors',
              sort === key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {state.kind === 'loading' && (
        <div className="text-muted-foreground text-sm">Loading rankings…</div>
      )}

      {state.kind === 'error' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive mb-1">Could not load leaderboard</p>
          <p className="text-muted-foreground font-mono text-xs">{state.message}</p>
        </div>
      )}

      {isEmpty && (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-muted-foreground mb-3">No DIDs enrolled yet — be the first.</p>
          <a
            href="/dashboard/popa"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Enroll your DID →
          </a>
        </div>
      )}

      {state.kind === 'ready' && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left w-12">#</th>
                <th className="px-3 py-2 text-left">DID</th>
                <th className="px-3 py-2 text-left">Controller</th>
                <th className="px-3 py-2 text-left">Enrolled</th>
                <th className="px-3 py-2 text-left">Last attested</th>
                <th className="px-3 py-2 text-right">Attestations</th>
                <th className="px-3 py-2 text-center w-12">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isSelf = selfId !== null && row.controller === selfId;
                const dot = freshnessDot(row.last_attested_at);
                return (
                  <tr
                    key={row.did}
                    className={cn(
                      'border-t border-border',
                      isSelf && 'bg-primary/5 ring-1 ring-primary/20',
                    )}
                  >
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <a
                        href={`/popa/${encodeURIComponent(row.did)}`}
                        title={row.did}
                        className="hover:underline"
                      >
                        {truncateDid(row.did)}
                      </a>
                      {isSelf && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          you
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {row.controller ? row.controller.slice(0, 12) + '…' : '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{relativeTime(row.enrolled_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{relativeTime(row.last_attested_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {row.attestation_count}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn('mx-auto block h-2.5 w-2.5 rounded-full', dot.color)}
                        title={dot.label}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-12 pt-8 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Data refreshes every 60 seconds. Revoked enrollments are excluded.{' '}
          <a href="/specs/popa" className="hover:text-foreground transition-colors">
            Read the PoPA spec →
          </a>
        </p>
      </div>
    </div>
  );
}
