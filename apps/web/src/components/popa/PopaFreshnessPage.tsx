import { useState, useEffect } from 'react';
import { verify, VerifyError } from '@agentlair/popa';
import type { AttestationResult } from '@agentlair/popa';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type PageState =
  | { status: 'loading' }
  | { status: 'fresh'; data: AttestationResult }
  | { status: 'stale'; data: AttestationResult }
  | { status: 'not_enrolled' }
  | { status: 'no_did' }
  | { status: 'error'; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDid(pathname: string): string | null {
  const match = pathname.match(/^\/popa\/(.+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

function streakLabel(days: number): string {
  if (days === 0) return '0 days';
  if (days === 1) return '1 day';
  return `${days} days`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'fresh' | 'stale' | 'not_enrolled' }) {
  const styles = {
    fresh: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    stale: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    not_enrolled: 'bg-secondary text-secondary-foreground border-border',
  };
  const labels = {
    fresh: '✓ Verified',
    stale: 'Stale',
    not_enrolled: 'Not enrolled',
  };
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium',
      styles[status],
    )}>
      {labels[status]}
    </span>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// ── Fresh / Stale view ────────────────────────────────────────────────────────

function DataView({ data, status }: { data: AttestationResult; status: 'fresh' | 'stale' }) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <StatusBadge status={status} />
          <p className="mt-3 text-sm text-muted-foreground">
            Last attested {formatDate(data.last_attestation_at)}
          </p>
        </div>
        {data.latest_scitt_entry && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">SCITT log</p>
            <p className="text-xs font-mono text-muted-foreground break-all max-w-xs">
              {data.latest_scitt_entry}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Current streak"
          value={streakLabel(data.streak_days)}
          sub="consecutive days"
        />
        <MetricCard
          label="Longest streak"
          value={streakLabel(data.longest_streak)}
          sub="all-time best"
        />
        <MetricCard
          label="Total attestations"
          value={data.total_attestations.toString()}
          sub="since genesis"
        />
        <MetricCard
          label="Gaps"
          value={data.gap_count.toString()}
          sub={data.gap_count === 1 ? 'missed day' : 'missed days'}
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Genesis:</span>{' '}
        {formatDate(data.genesis_at)}
        <span className="mx-3 text-border">·</span>
        <span className="font-medium text-foreground">Checked:</span>{' '}
        {formatDate(data.fetchedAt)}
      </div>
    </div>
  );
}

// ── Not-enrolled view ─────────────────────────────────────────────────────────

function NotEnrolledView({ did }: { did: string }) {
  // Distinguish AgentLair-issued DIDs (one-click enroll path via account UI)
  // from externally controlled did:web DIDs (need a controller field added
  // to the visitor's published did.json before the API will accept enrollment).
  const isAgentLairIssued = /^did:web:agentlair\.dev:agents:acc_[A-Za-z0-9_-]+$/.test(did);

  return (
    <div className="space-y-4">
      <StatusBadge status="not_enrolled" />
      <p className="text-muted-foreground">
        No attestations yet for this DID. Once enrolled, the daily PoPA cron
        emits one signed attestation per UTC day and anchors it in the SCITT
        transparency log — anyone can verify the streak from the chain alone.
      </p>

      {isAgentLairIssued ? (
        <>
          <p className="text-sm text-muted-foreground">
            This is an AgentLair-issued DID. Enroll it from your dashboard:
          </p>
          <a
            href="/dashboard/popa"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Enroll from dashboard →
          </a>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            To enroll an externally-hosted DID, add your AgentLair account DID
            to your DID document&apos;s <code className="font-mono text-xs">verificationMethod[].controller</code> field, then POST your AAT to the enrollment endpoint:
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs font-mono">
{`curl -X POST https://agentlair.dev/v1/popa/enroll \\
  -H "Authorization: Bearer $AGENTLAIR_AAT" \\
  -H "Content-Type: application/json" \\
  -d '{"agent_did":"${did}"}'`}
          </pre>
          <a
            href="/specs/popa#enrollment"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Read the enrollment spec →
          </a>
        </>
      )}

      <p className="text-xs text-muted-foreground break-all">
        DID: <span className="font-mono">{did}</span>
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PopaFreshnessPage() {
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [did, setDid] = useState<string | null>(null);

  useEffect(() => {
    const extracted = extractDid(window.location.pathname);
    if (!extracted) {
      setState({ status: 'no_did' });
      return;
    }
    setDid(extracted);

    let cancelled = false;
    verify({ did: extracted })
      .then((result) => {
        if (cancelled) return;
        setState({
          status: result.fresh ? 'fresh' : 'stale',
          data: result,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof VerifyError && err.code === 'no_attestation') {
          setState({ status: 'not_enrolled' });
        } else {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-28 lg:pt-44 lg:pb-32">
      {/* Header */}
      <header className="mb-8">
        <p className="text-sm text-muted-foreground mb-2">
          <a href="/specs/popa" className="hover:text-foreground transition-colors">
            Proof of Persistent Activity
          </a>
        </p>
        <h1 className="text-3xl font-bold tracking-tight mb-3">
          Freshness dashboard
        </h1>
        {did && (
          <p className="text-sm font-mono text-muted-foreground break-all">
            {did}
          </p>
        )}
      </header>

      {/* Content */}
      {state.status === 'loading' && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Checking attestations…
        </div>
      )}

      {state.status === 'no_did' && (
        <div className="space-y-3">
          <p className="text-muted-foreground">
            No DID specified. Try{' '}
            <a href="/popa/did:web:agentlair.dev" className="text-primary hover:underline">
              /popa/did:web:agentlair.dev
            </a>{' '}
            to see an example.
          </p>
        </div>
      )}

      {(state.status === 'fresh' || state.status === 'stale') && (
        <DataView data={state.data} status={state.status} />
      )}

      {state.status === 'not_enrolled' && did && (
        <NotEnrolledView did={did} />
      )}

      {state.status === 'error' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive mb-1">Could not fetch attestation data</p>
          <p className="text-muted-foreground font-mono text-xs">{state.message}</p>
        </div>
      )}

      {/* Footer note */}
      <div className="mt-12 pt-8 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Powered by{' '}
          <a href="https://agentlair.dev" className="hover:text-foreground transition-colors">
            AgentLair
          </a>{' '}
          ·{' '}
          <a href="/specs/popa" className="hover:text-foreground transition-colors">
            PoPA spec
          </a>{' '}
          ·{' '}
          <a
            href="https://www.npmjs.com/package/@agentlair/popa"
            className="hover:text-foreground transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            @agentlair/popa
          </a>
        </p>
      </div>
    </div>
  );
}
