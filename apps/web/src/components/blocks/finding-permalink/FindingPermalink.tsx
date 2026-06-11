'use client';

/**
 * FindingPermalink — client-rendered security finding card.
 *
 * Reads the JTI from window.location.pathname (/f/<jti>), fetches:
 *   1. GET /v1/findings/<jti>       — signed envelope + claims
 *   2. GET /v1/agents/<sub>/track_record — agent aggregate reputation
 *
 * Renders: finding details → outcome status → agent track record.
 * No auth required — both APIs are public reads.
 *
 * API JSON form: GET https://agentlair.dev/v1/findings/<jti>
 * (documented in page footer — programmatic callers should use that directly)
 */

import { useEffect, useState } from 'react';

const WORKER_BASE = 'https://agentlair.dev';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FindingClaims {
  sub: string; // agent_id
  aud: string; // audience
  iat: number; // submitted_at (unix seconds)
  jti: string;
  finding: {
    title: string;
    severity: string;
    target: string;
    evidence_hash: string;
    cwe?: string;
    evidence_url?: string;
  };
}

interface FindingEnvelope {
  jti: string;
  signed_jwt: string;
  claims: FindingClaims;
}

interface TrackRecord {
  agent_id: string;
  al_nid?: string;
  valid_rate: number;
  false_positive_rate: number;
  findings_submitted: number;
  findings_accepted: number;
  findings_rejected: number;
  avg_severity: number | null;
  last_updated: number;
  recent_audiences: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function severityBadge(sev: string): string {
  const s = sev.toUpperCase();
  if (s === 'CRITICAL') return 'bg-red-700 text-white';
  if (s === 'HIGH') return 'bg-red-500 text-white';
  if (s === 'MEDIUM') return 'bg-orange-400 text-white';
  if (s === 'LOW') return 'bg-yellow-400 text-black';
  return 'bg-gray-200 text-gray-700';
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <svg className="mr-2 h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      Loading finding…
    </div>
  );
}

function NotFound({ jti }: { jti: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
      <h1 className="mb-2 text-xl font-semibold text-red-700">Finding not found</h1>
      <p className="text-sm text-red-600">
        No signed finding exists for <code className="font-mono">{jti}</code>.
      </p>
      <a href="/" className="mt-4 inline-block text-sm underline text-red-700">← Back to AgentLair</a>
    </div>
  );
}

function TrackRecordBlock({ record }: { record: TrackRecord | null }) {
  if (!record) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-muted-foreground">
        Not yet attested by any program.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
      <h2 className="mb-4 text-base font-semibold">Agent Track Record</h2>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs text-muted-foreground">Valid rate</div>
          <div className="font-semibold">{pct(record.valid_rate)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">FP rate</div>
          <div className="font-semibold">{pct(record.false_positive_rate)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Submitted</div>
          <div className="font-semibold">{record.findings_submitted}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Accepted</div>
          <div className="font-semibold text-green-700">{record.findings_accepted}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Rejected</div>
          <div className="font-semibold text-red-600">{record.findings_rejected}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Avg severity</div>
          <div className="font-semibold">{record.avg_severity !== null ? record.avg_severity.toFixed(1) : '—'}</div>
        </div>
      </div>
      {record.recent_audiences.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1">Recent programs</div>
          <div className="flex flex-wrap gap-2">
            {record.recent_audiences.map((aud) => (
              <span key={aud} className="rounded bg-white border border-gray-200 px-2 py-0.5 text-xs font-mono">
                {aud.replace(/^https?:\/\//, '')}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 text-xs text-muted-foreground">
        Updated {fmt(record.last_updated)}
        {record.al_nid && (
          <span className="ml-2 font-mono">{record.al_nid.slice(0, 24)}…</span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FindingPermalink() {
  const [jti, setJti] = useState<string>('');
  const [finding, setFinding] = useState<FindingEnvelope | null>(null);
  const [trackRecord, setTrackRecord] = useState<TrackRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const raw = window.location.pathname.replace(/^\/f\//, '').trim();
    setJti(raw);

    if (!raw) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const findingRes = await fetch(`${WORKER_BASE}/v1/findings/${encodeURIComponent(raw)}`);
        if (!findingRes.ok) {
          if (!cancelled) { setNotFound(true); setLoading(false); }
          return;
        }
        const envelope = await findingRes.json() as FindingEnvelope;
        if (!cancelled) setFinding(envelope);

        // Fetch track_record in parallel (or after — agentId is in claims.sub)
        const agentId = envelope.claims?.sub;
        if (agentId) {
          try {
            const trRes = await fetch(`${WORKER_BASE}/v1/agents/${encodeURIComponent(agentId)}/track_record`);
            if (trRes.ok && !cancelled) {
              setTrackRecord(await trRes.json() as TrackRecord);
            }
          } catch {
            // Non-fatal — track record section shows "not yet attested"
          }
        }
      } catch {
        if (!cancelled) { setNotFound(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <LoadingSpinner />;
  if (notFound || !finding) return <NotFound jti={jti} />;

  const { claims } = finding;
  const f = claims.finding;

  return (
    <div className="mx-auto max-w-2xl px-4 pt-28 pb-16">
      {/* Header */}
      <div className="mb-6 flex items-start gap-3">
        <span className={`mt-0.5 rounded px-2 py-0.5 text-xs font-bold uppercase ${severityBadge(f.severity)}`}>
          {f.severity}
        </span>
        <h1 className="text-xl font-semibold leading-snug">{f.title}</h1>
      </div>

      {/* Finding details */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <dl className="space-y-3 text-sm">
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-muted-foreground">JTI</dt>
            <dd className="font-mono text-xs break-all">{finding.jti}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-muted-foreground">Target</dt>
            <dd className="font-mono text-xs break-all">{f.target}</dd>
          </div>
          {f.cwe && (
            <div className="flex gap-2">
              <dt className="w-36 shrink-0 text-muted-foreground">CWE</dt>
              <dd>{f.cwe}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-muted-foreground">Audience</dt>
            <dd className="font-mono text-xs">{claims.aud}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-muted-foreground">Submitted</dt>
            <dd>{fmt(claims.iat)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-muted-foreground">Evidence hash</dt>
            <dd className="font-mono text-xs break-all">{f.evidence_hash}</dd>
          </div>
          {f.evidence_url && (
            <div className="flex gap-2">
              <dt className="w-36 shrink-0 text-muted-foreground">Evidence URL</dt>
              <dd className="font-mono text-xs break-all">{f.evidence_url}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="w-36 shrink-0 text-muted-foreground">Agent</dt>
            <dd className="font-mono text-xs break-all">{claims.sub}</dd>
          </div>
        </dl>
      </div>

      {/* Track record */}
      <TrackRecordBlock record={trackRecord} />

      {/* Footer note */}
      <p className="mt-8 text-xs text-muted-foreground">
        This permalink is HTML-only — for humans.{' '}
        Programmatic callers: <code className="font-mono">GET /v1/findings/{jti}</code>
        {' '}returns the JSON envelope.{' '}
        <a href="https://agentlair.dev" className="underline">AgentLair</a>
      </p>
    </div>
  );
}
