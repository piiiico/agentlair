/**
 * /verify-receipt — interactive SCITT receipt verifier.
 *
 * Two input modes:
 *   1. Entry ID lookup     → GET /v1/scitt/corpus/:entry_id
 *   2. Paste raw COSE_Sign1 → POST /v1/scitt/verify
 *
 * Both render a unified breakdown:
 *   - Signer (issuer + JWKS chain)
 *   - Statement type + content type
 *   - Decoded claim payload
 *   - Signature validity (server result + client re-verify with WebCrypto)
 *   - Merkle proof position (only for entry-id lookups)
 *
 * The client re-verifies the Ed25519 signature locally against the live
 * JWKS. The server's verification is convenience; the browser's is proof.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

const API_BASE = 'https://agentlair.dev';

// ── Types matching the worker response ──────────────────────────────────────

interface ServerVerification {
  valid: boolean;
  reason: string;
  matched_kid: string | null;
  jwks_url: string | null;
}

interface DecodedClaim {
  alg: string | null;
  content_type: string | null;
  kid: string | null;
  issuer: string | null;
  subject: string | null;
  issued_at: string | null;
  statement_type: string;
  payload: unknown;
  payload_is_json?: boolean;
}

interface ReceiptMetadata {
  leaf_index: number;
  tree_size: number;
  root_hash: string;
  registered_at: string;
  receipt_url: string;
}

interface CorpusEntryResponse {
  entry_id: string;
  bytes_archived: boolean;
  bytes_archived_reason?: string;
  signed_statement_b64: string | null;
  signing_input_b64: string | null;
  protected_b64: string | null;
  payload_b64: string | null;
  signature_b64: string | null;
  claim: DecodedClaim | null;
  verification: ServerVerification;
  receipt: ReceiptMetadata;
}

interface VerifyResponse {
  valid: boolean;
  verification: ServerVerification;
  claim: DecodedClaim;
  components: {
    protected_b64: string;
    payload_b64: string | null;
    signature_b64: string;
    signing_input_b64: string;
  };
}

interface DemoResponse {
  demo: true;
  signed_statement_b64: string;
  claim: DecodedClaim;
  verification: ServerVerification;
  components: {
    protected_b64: string;
    payload_b64: string | null;
    signature_b64: string;
    signing_input_b64: string;
  };
  note: string;
}

// ── Unified display state ───────────────────────────────────────────────────

interface VerifierState {
  source: 'corpus' | 'paste' | 'demo' | null;
  entry_id?: string;
  bytes_archived?: boolean;
  bytes_archived_reason?: string;
  signed_statement_b64?: string;
  signing_input_b64?: string | null;
  signature_b64?: string | null;
  payload_b64?: string | null;
  protected_b64?: string | null;
  claim: DecodedClaim | null;
  serverVerification: ServerVerification | null;
  /** Browser re-verification result (Web Crypto Ed25519) */
  clientVerification: {
    status: 'idle' | 'pending' | 'ok' | 'fail' | 'unsupported' | 'error';
    matched_kid?: string;
    message?: string;
  };
  receipt: ReceiptMetadata | null;
}

const initialState: VerifierState = {
  source: null,
  claim: null,
  serverVerification: null,
  clientVerification: { status: 'idle' },
  receipt: null,
};

// ── Encoding helpers ────────────────────────────────────────────────────────

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToBytes(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  return b64ToBytes(b64);
}

// ── Client-side signature verification ──────────────────────────────────────
//
// Uses Web Crypto Ed25519 (Chrome 113+, Firefox 130+, Safari 17+).
// Falls back to "unsupported" on browsers without Ed25519 support so the
// page still renders rather than appearing broken.

async function clientReverify(
  signingInputB64: string,
  signatureB64: string,
  jwksUrl: string,
  preferKid?: string,
): Promise<VerifierState['clientVerification']> {
  let jwks: { keys?: Array<{ kid?: string; kty?: string; crv?: string; x?: string }> };
  try {
    const r = await fetch(jwksUrl);
    if (!r.ok) {
      return { status: 'error', message: `JWKS HTTP ${r.status}` };
    }
    jwks = await r.json();
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }

  const ed25519Keys = (jwks.keys ?? []).filter(
    (k) => k.kty === 'OKP' && k.crv === 'Ed25519' && typeof k.x === 'string',
  );

  let candidates = ed25519Keys;
  if (preferKid) {
    const matched = ed25519Keys.filter((k) => k.kid === preferKid);
    if (matched.length > 0) candidates = matched;
  }

  if (candidates.length === 0) {
    return { status: 'fail', message: 'No matching Ed25519 key in published JWKS' };
  }

  const data = b64ToBytes(signingInputB64);
  const sig = b64ToBytes(signatureB64);

  for (const k of candidates) {
    if (!k.x) continue;
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        k,
        { name: 'Ed25519' } as Algorithm,
        false,
        ['verify'],
      );
      const valid = await crypto.subtle.verify(
        { name: 'Ed25519' } as Algorithm,
        key,
        sig,
        data,
      );
      if (valid) {
        return { status: 'ok', matched_kid: k.kid };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Ed25519|Unrecognized/.test(msg)) {
        return {
          status: 'unsupported',
          message: 'This browser does not support Web Crypto Ed25519. Server verification is reported above.',
        };
      }
      // Try the next candidate
    }
  }

  return { status: 'fail', message: 'Signature does not match any published Ed25519 key' };
}

// ── Card chrome ─────────────────────────────────────────────────────────────

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'na';

function toneStyles(tone: Tone): string {
  switch (tone) {
    case 'ok':
      return 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10';
    case 'warn':
      return 'border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10';
    case 'bad':
      return 'border-destructive/30 bg-destructive/5';
    case 'na':
      return 'border-border bg-muted/20 opacity-70';
    default:
      return 'border-border bg-card';
  }
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const styles: Record<Tone, string> = {
    ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    bad: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    na: 'bg-secondary text-secondary-foreground',
    neutral: 'bg-secondary text-secondary-foreground',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', styles[tone])}>
      {children}
    </span>
  );
}

function Card({
  index,
  title,
  tone,
  status,
  children,
  testId,
}: {
  index: number;
  title: string;
  tone: Tone;
  status: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section
      data-card={testId}
      className={cn('rounded-lg border p-4 sm:p-5 transition-colors', toneStyles(tone))}
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-mono uppercase tracking-wide text-muted-foreground">
          {String(index).padStart(2, '0')} · {title}
        </h2>
        <Pill tone={tone}>{status}</Pill>
      </header>
      <div className="text-sm">{children}</div>
    </section>
  );
}

function KV({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className={cn('break-all text-sm', mono && 'font-mono text-xs')}>{v}</div>
    </div>
  );
}

// ── Tab switcher ────────────────────────────────────────────────────────────

type Tab = 'entry' | 'paste';

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      )}
    >
      {children}
    </button>
  );
}

// ── Main widget ─────────────────────────────────────────────────────────────

export function VerifyReceipt() {
  const [tab, setTab] = useState<Tab>('entry');
  const [entryInput, setEntryInput] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const [running, setRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [state, setState] = useState<VerifierState>(initialState);
  const [latestKnownEntry, setLatestKnownEntry] = useState<string | null>(null);

  // On mount, fetch the most recent live PoPA attestation so the sample
  // button can prefill it. Best-effort — silently skips on failure.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/v1/popa/${encodeURIComponent('did:web:agentlair.dev')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { latest_scitt_entry?: string } | null) => {
        if (cancelled) return;
        if (data?.latest_scitt_entry) {
          setLatestKnownEntry(data.latest_scitt_entry);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Display: derive tones from server + client status ──────────────────────

  const sigTone: Tone = useMemo(() => {
    if (!state.serverVerification && state.clientVerification.status === 'idle') return 'neutral';
    const serverOk = state.serverVerification?.valid === true;
    const clientStatus = state.clientVerification.status;

    if (serverOk && clientStatus === 'ok') return 'ok';
    if (serverOk && clientStatus === 'unsupported') return 'ok';
    if (serverOk && clientStatus === 'idle') return 'neutral';
    if (serverOk && clientStatus === 'pending') return 'neutral';
    if (state.serverVerification?.valid === false) return 'bad';
    if (clientStatus === 'fail') return 'bad';
    return 'warn';
  }, [state.serverVerification, state.clientVerification]);

  const sigStatus = useMemo(() => {
    if (state.clientVerification.status === 'pending') return 'verifying';
    if (state.serverVerification?.valid && state.clientVerification.status === 'ok') return 'verified';
    if (state.serverVerification?.valid && state.clientVerification.status === 'unsupported') return 'server-only';
    if (state.serverVerification?.valid) return 'server ok';
    if (state.serverVerification && state.serverVerification.valid === false) return state.serverVerification.reason;
    return 'pending';
  }, [state.serverVerification, state.clientVerification]);

  const claimTone: Tone = state.claim ? 'ok' : 'neutral';
  const receiptTone: Tone = state.receipt ? 'ok' : 'na';
  const inputTone: Tone = state.source ? 'ok' : 'neutral';

  // ── Result handlers ────────────────────────────────────────────────────────

  const applyEntryResponse = useCallback(async (data: CorpusEntryResponse) => {
    const next: VerifierState = {
      source: 'corpus',
      entry_id: data.entry_id,
      bytes_archived: data.bytes_archived,
      bytes_archived_reason: data.bytes_archived_reason,
      signed_statement_b64: data.signed_statement_b64 ?? undefined,
      signing_input_b64: data.signing_input_b64,
      signature_b64: data.signature_b64,
      payload_b64: data.payload_b64,
      protected_b64: data.protected_b64,
      claim: data.claim,
      serverVerification: data.verification,
      clientVerification: { status: 'idle' },
      receipt: data.receipt,
    };
    setState(next);

    if (data.verification.valid && data.signing_input_b64 && data.signature_b64 && data.verification.jwks_url) {
      setState((s) => ({ ...s, clientVerification: { status: 'pending' } }));
      const result = await clientReverify(
        data.signing_input_b64,
        data.signature_b64,
        data.verification.jwks_url,
        data.claim?.kid ?? data.verification.matched_kid ?? undefined,
      );
      setState((s) => ({ ...s, clientVerification: result }));
    }
  }, []);

  const applyVerifyResponse = useCallback(async (data: VerifyResponse, source: 'paste' | 'demo' = 'paste', signedB64?: string) => {
    const next: VerifierState = {
      source,
      bytes_archived: true,
      signed_statement_b64: signedB64,
      signing_input_b64: data.components.signing_input_b64,
      signature_b64: data.components.signature_b64,
      payload_b64: data.components.payload_b64,
      protected_b64: data.components.protected_b64,
      claim: data.claim,
      serverVerification: data.verification,
      clientVerification: { status: 'idle' },
      receipt: null,
    };
    setState(next);

    if (data.verification.jwks_url && data.components.signing_input_b64 && data.components.signature_b64) {
      setState((s) => ({ ...s, clientVerification: { status: 'pending' } }));
      const result = await clientReverify(
        data.components.signing_input_b64,
        data.components.signature_b64,
        data.verification.jwks_url,
        data.claim.kid ?? data.verification.matched_kid ?? undefined,
      );
      setState((s) => ({ ...s, clientVerification: result }));
    }
  }, []);

  // ── Action handlers ────────────────────────────────────────────────────────

  const submitEntry = useCallback(async (rawInput: string) => {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setErrorMessage('Enter a SCITT entry ID (e.g. popa_5nJkiDL8Mu9Ph2Zy or scitt:popa_xxx).');
      return;
    }
    setRunning(true);
    setErrorMessage(null);
    try {
      const id = trimmed.startsWith('scitt:') ? trimmed.slice('scitt:'.length) : trimmed;
      const r = await fetch(`${API_BASE}/v1/scitt/corpus/${encodeURIComponent(id)}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({ message: r.statusText }));
        throw new Error(body.message || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as CorpusEntryResponse;
      await applyEntryResponse(data);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setState(initialState);
    } finally {
      setRunning(false);
    }
  }, [applyEntryResponse]);

  const submitPaste = useCallback(async (rawInput: string) => {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setErrorMessage('Paste a base64-encoded COSE_Sign1 envelope.');
      return;
    }
    setRunning(true);
    setErrorMessage(null);
    try {
      const r = await fetch(`${API_BASE}/v1/scitt/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signed_statement: trimmed }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ message: r.statusText }));
        throw new Error(body.message || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as VerifyResponse;
      await applyVerifyResponse(data, 'paste', trimmed);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setState(initialState);
    } finally {
      setRunning(false);
    }
  }, [applyVerifyResponse]);

  const useSampleEntry = useCallback(() => {
    if (!latestKnownEntry) {
      setErrorMessage('Latest entry not loaded yet. Try in a moment, or paste your own.');
      return;
    }
    setEntryInput(latestKnownEntry);
    submitEntry(latestKnownEntry);
  }, [latestKnownEntry, submitEntry]);

  const useDemoStatement = useCallback(async () => {
    setRunning(true);
    setErrorMessage(null);
    try {
      const r = await fetch(`${API_BASE}/v1/scitt/demo-attestation`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as DemoResponse;
      setPasteInput(data.signed_statement_b64);
      setTab('paste');
      // Reuse the verify endpoint output shape — applyVerifyResponse handles it
      await applyVerifyResponse(
        {
          valid: data.verification.valid,
          verification: data.verification,
          claim: data.claim,
          components: data.components,
        },
        'demo',
        data.signed_statement_b64,
      );
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [applyVerifyResponse]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const inputStatus = state.source ? state.source : 'waiting';
  const claimStatus = state.claim?.statement_type ?? 'pending';
  const receiptStatus = state.receipt ? `leaf ${state.receipt.leaf_index} / tree ${state.receipt.tree_size}` : 'n/a';

  return (
    <div className="mx-auto max-w-3xl px-4 py-28 lg:pt-44 lg:pb-32 space-y-6">
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground font-mono">/verify-receipt</p>
        <h1 className="text-3xl font-bold tracking-tight">Verify a SCITT receipt</h1>
        <p className="text-muted-foreground">
          Paste a SCITT entry ID or a raw COSE_Sign1 envelope. The page resolves the
          claim, parses the signed payload, and verifies the Ed25519 signature against
          the issuer's published JWKS — first server-side, then again in your browser.
        </p>
      </header>

      <div className="flex gap-2">
        <TabButton active={tab === 'entry'} onClick={() => setTab('entry')}>
          By entry ID
        </TabButton>
        <TabButton active={tab === 'paste'} onClick={() => setTab('paste')}>
          Paste COSE_Sign1
        </TabButton>
      </div>

      {tab === 'entry' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitEntry(entryInput);
          }}
          className="space-y-3"
        >
          <label htmlFor="entry-input" className="block text-xs uppercase tracking-wide text-muted-foreground">
            SCITT entry ID
          </label>
          <input
            id="entry-input"
            name="entry_id"
            value={entryInput}
            onChange={(e) => setEntryInput(e.target.value)}
            placeholder="popa_5nJkiDL8Mu9Ph2Zy   or   scitt:popa_xxx"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full rounded-md border border-border bg-background p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={running || !entryInput.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {running ? 'Verifying…' : 'Verify entry'}
            </button>
            <button
              type="button"
              onClick={useSampleEntry}
              disabled={running || !latestKnownEntry}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              title={latestKnownEntry ? `Use ${latestKnownEntry}` : 'Loading latest entry…'}
            >
              Try latest live PoPA attestation
            </button>
          </div>
        </form>
      )}

      {tab === 'paste' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPaste(pasteInput);
          }}
          className="space-y-3"
        >
          <label htmlFor="paste-input" className="block text-xs uppercase tracking-wide text-muted-foreground">
            COSE_Sign1 (base64)
          </label>
          <textarea
            id="paste-input"
            name="cose_sign1"
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
            placeholder="0oRYJaQBJwM..."
            rows={5}
            spellCheck={false}
            className="w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={running || !pasteInput.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {running ? 'Verifying…' : 'Verify statement'}
            </button>
            <button
              type="button"
              onClick={useDemoStatement}
              disabled={running}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              Use a demo statement
            </button>
          </div>
        </form>
      )}

      {errorMessage && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <div className="space-y-4" data-cards-root>
        {/* 1. INPUT */}
        <Card index={1} title="Input" tone={inputTone} status={inputStatus} testId="input">
          {state.source ? (
            <div>
              <KV k="Source" v={state.source === 'corpus' ? 'live SCITT corpus entry' : state.source === 'demo' ? 'demo statement (worker-generated)' : 'pasted COSE_Sign1'} />
              {state.entry_id && <KV k="Entry ID" v={state.entry_id} mono />}
              {typeof state.bytes_archived === 'boolean' && (
                <KV
                  k="Bytes"
                  v={state.bytes_archived ? 'archived' : 'not archived (legacy entry)'}
                />
              )}
              {state.bytes_archived === false && state.bytes_archived_reason && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {state.bytes_archived_reason}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Submit an entry ID or paste a COSE_Sign1 above.</p>
          )}
        </Card>

        {/* 2. CLAIM */}
        <Card index={2} title="Claim" tone={claimTone} status={claimStatus} testId="claim">
          {state.claim ? (
            <div>
              <KV k="Statement type" v={state.claim.statement_type} mono />
              {state.claim.content_type && <KV k="Content type" v={state.claim.content_type} mono />}
              {state.claim.alg && <KV k="Algorithm" v={state.claim.alg} mono />}
              {state.claim.issuer && <KV k="Issuer" v={state.claim.issuer} mono />}
              {state.claim.subject && <KV k="Subject" v={state.claim.subject} mono />}
              {state.claim.kid && <KV k="Key ID" v={state.claim.kid} mono />}
              {state.claim.issued_at && (
                <KV k="Issued (CWT)" v={new Date(state.claim.issued_at).toLocaleString()} />
              )}
              {state.claim.payload != null && (
                <details className="mt-3">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                    View payload
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs font-mono">
{typeof state.claim.payload === 'string'
  ? state.claim.payload
  : JSON.stringify(state.claim.payload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No claim yet — verify a statement above.</p>
          )}
        </Card>

        {/* 3. SIGNATURE */}
        <Card index={3} title="Signature" tone={sigTone} status={sigStatus} testId="signature">
          {!state.serverVerification && state.clientVerification.status === 'idle' && (
            <p className="text-muted-foreground">Pending verification.</p>
          )}
          {state.serverVerification && (
            <div>
              <KV
                k="Server result"
                v={
                  state.serverVerification.valid ? (
                    <span className="text-emerald-700 dark:text-emerald-400">✓ valid · {state.serverVerification.reason}</span>
                  ) : (
                    <span className="text-destructive">✗ invalid · {state.serverVerification.reason}</span>
                  )
                }
              />
              {state.serverVerification.matched_kid && (
                <KV k="Matched kid" v={state.serverVerification.matched_kid} mono />
              )}
              {state.serverVerification.jwks_url && (
                <KV
                  k="JWKS"
                  v={
                    <a
                      className="underline"
                      href={state.serverVerification.jwks_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {state.serverVerification.jwks_url}
                    </a>
                  }
                  mono
                />
              )}

              <div className="mt-3 border-t border-border pt-3">
                <KV
                  k="Browser re-verify"
                  v={
                    state.clientVerification.status === 'idle' ? (
                      <span className="text-muted-foreground">not run</span>
                    ) : state.clientVerification.status === 'pending' ? (
                      <span className="text-muted-foreground">verifying with Web Crypto…</span>
                    ) : state.clientVerification.status === 'ok' ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        ✓ verified locally · Web Crypto Ed25519
                        {state.clientVerification.matched_kid ? ` · kid=${state.clientVerification.matched_kid}` : ''}
                      </span>
                    ) : state.clientVerification.status === 'fail' ? (
                      <span className="text-destructive">✗ {state.clientVerification.message}</span>
                    ) : state.clientVerification.status === 'unsupported' ? (
                      <span className="text-amber-700 dark:text-amber-400">browser lacks Ed25519 — server result above</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">{state.clientVerification.message}</span>
                    )
                  }
                />
              </div>
            </div>
          )}
        </Card>

        {/* 4. RECEIPT */}
        <Card index={4} title="Receipt (Merkle proof)" tone={receiptTone} status={receiptStatus} testId="receipt">
          {state.receipt ? (
            <div>
              <KV k="Leaf index" v={String(state.receipt.leaf_index)} mono />
              <KV k="Tree size" v={String(state.receipt.tree_size)} mono />
              <KV k="Root hash" v={state.receipt.root_hash} mono />
              <KV k="Registered" v={new Date(state.receipt.registered_at).toLocaleString()} />
              <KV
                k="Receipt URL"
                v={
                  <a className="underline" href={state.receipt.receipt_url} target="_blank" rel="noreferrer">
                    {state.receipt.receipt_url}
                  </a>
                }
                mono
              />
            </div>
          ) : (
            <p className="text-muted-foreground">
              N/A — the pasted statement is not registered in the AgentLair transparency log
              (or no Merkle proof was returned).
            </p>
          )}
        </Card>

        {/* 5. RAW BYTES */}
        {state.signed_statement_b64 && (
          <Card index={5} title="Raw signed statement" tone="neutral" status="cose_sign1" testId="raw">
            <details>
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Show base64
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                {state.signed_statement_b64}
              </pre>
              <p className="mt-2 text-xs text-muted-foreground">
                CBOR-encoded COSE_Sign1 (RFC 9052 §4.2). Verify externally with{' '}
                <code>cose-cli</code> or the SCITT Reference Implementation.
              </p>
            </details>
          </Card>
        )}
      </div>

      <footer className="pt-6 text-xs text-muted-foreground border-t border-border">
        Powered by the AgentLair{' '}
        <a className="underline" href="/v1/scitt/corpus.atom">
          SCITT corpus feed
        </a>{' '}
        ·{' '}
        <a className="underline" href="/.well-known/jwks.json">
          published JWKS
        </a>{' '}
        ·{' '}
        <a className="underline" href="/specs/popa">
          PoPA spec
        </a>
        . Browser verification uses Web Crypto Ed25519 (Chrome 113+, Firefox 130+, Safari 17+).
      </footer>
    </div>
  );
}
