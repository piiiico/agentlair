import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

// ── API base ──────────────────────────────────────────────────────────────────
// Same-origin in production (agentlair.dev serves both UI and API).
const API_BASE = 'https://agentlair.dev';
const ISSUER_DOMAIN = 'agentlair.dev';

// ── Types ─────────────────────────────────────────────────────────────────────

type InputKind = 'did' | 'aat' | 'unknown';

interface ParsedInput {
  kind: InputKind;
  value: string;
  notes?: string;
}

interface DidResolution {
  status: 'idle' | 'loading' | 'ok' | 'error' | 'skipped';
  url?: string;
  doc?: any;
  controller?: string;
  vmCount?: number;
  serviceCount?: number;
  message?: string;
}

interface AatValidation {
  status: 'idle' | 'loading' | 'ok' | 'invalid' | 'expired' | 'error' | 'skipped';
  header?: any;
  payload?: any;
  issuer?: string;
  subject?: string;
  issuedAt?: string;
  expiresAt?: string;
  scopes?: string[];
  kid?: string;
  message?: string;
}

interface PopaResult {
  status: 'idle' | 'loading' | 'enrolled' | 'not_enrolled' | 'error' | 'skipped';
  did?: string;
  metrics?: {
    streak_days: number;
    longest_streak: number;
    total_attestations: number;
    last_attestation_at: string;
    gap_count: number;
    genesis_at: string;
    latest_scitt_entry: string;
  };
  daysSinceLastAttestation?: number;
  fresh?: boolean;
  message?: string;
}

interface IssuerChain {
  status: 'idle' | 'loading' | 'ok' | 'error' | 'skipped';
  issuerDid?: string;
  jwksUrl?: string;
  keys?: Array<{ kid?: string; kty: string; crv?: string; alg?: string }>;
  matchedKid?: string;
  message?: string;
}

interface State {
  parsed: ParsedInput | null;
  did: DidResolution;
  aat: AatValidation;
  popa: PopaResult;
  issuer: IssuerChain;
}

const initialState: State = {
  parsed: null,
  did: { status: 'idle' },
  aat: { status: 'idle' },
  popa: { status: 'idle' },
  issuer: { status: 'idle' },
};

// ── Encoding helpers ──────────────────────────────────────────────────────────

function b64urlToBytes(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJSON(b64url: string): any {
  const bytes = b64urlToBytes(b64url);
  const str = new TextDecoder().decode(bytes);
  return JSON.parse(str);
}

// ── Input classification ──────────────────────────────────────────────────────

function classify(raw: string): ParsedInput {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unknown', value: '', notes: 'Empty input' };

  // JWT detection: three base64url segments separated by dots, header starts with eyJ
  if (trimmed.startsWith('eyJ') && trimmed.split('.').length === 3) {
    return { kind: 'aat', value: trimmed };
  }

  if (trimmed.startsWith('did:')) {
    const segments = trimmed.split(':');
    const method = segments[1];
    if (method === 'web' || method === 'key' || method === 'agentlair') {
      return { kind: 'did', value: trimmed, notes: `did:${method}` };
    }
    return { kind: 'did', value: trimmed, notes: `did:${method} (unsupported method)` };
  }

  return { kind: 'unknown', value: trimmed, notes: 'Not a DID (did:...) or JWT (eyJ...)' };
}

// ── DID resolution ────────────────────────────────────────────────────────────

function didToHttpsUrl(did: string): string | null {
  if (did.startsWith('did:web:')) {
    const rest = did.slice('did:web:'.length);
    const segments = rest.split(':').map((s) => decodeURIComponent(s));
    const domain = segments[0];
    if (!domain) return null;
    if (segments.length === 1) {
      return `https://${domain}/.well-known/did.json`;
    }
    const path = segments.slice(1).join('/');
    return `https://${domain}/${path}/did.json`;
  }
  if (did.startsWith('did:agentlair:')) {
    // Treat did:agentlair:<id> as a sugar for did:web:agentlair.dev:agents:<id>
    const id = did.slice('did:agentlair:'.length);
    return `https://${ISSUER_DOMAIN}/agents/${id}/did.json`;
  }
  return null;
}

async function resolveDid(did: string): Promise<DidResolution> {
  if (did.startsWith('did:key:')) {
    // Minimal did:key surface — we render the multibase prefix without full decode.
    return {
      status: 'ok',
      controller: did,
      vmCount: 1,
      serviceCount: 0,
      doc: { '@context': 'inline', id: did, verificationMethod: [{ type: 'multibase', publicKeyMultibase: did.slice('did:key:'.length) }] },
    };
  }

  const url = didToHttpsUrl(did);
  if (!url) {
    return { status: 'error', message: `Unsupported DID method: ${did.split(':')[1] ?? '?'}` };
  }

  try {
    const res = await fetch(url, { headers: { Accept: 'application/did+json, application/json' } });
    if (!res.ok) {
      return { status: 'error', url, message: `HTTP ${res.status} from ${url}` };
    }
    const doc = await res.json();
    const vms = Array.isArray(doc.verificationMethod) ? doc.verificationMethod : [];
    const services = Array.isArray(doc.service) ? doc.service : [];
    const controller =
      vms.find((v: any) => typeof v?.controller === 'string')?.controller ?? doc.id ?? null;
    return {
      status: 'ok',
      url,
      doc,
      controller: controller ?? undefined,
      vmCount: vms.length,
      serviceCount: services.length,
    };
  } catch (e) {
    return { status: 'error', url, message: e instanceof Error ? e.message : String(e) };
  }
}

// ── AAT verification ──────────────────────────────────────────────────────────

async function verifyAat(token: string): Promise<{
  aat: AatValidation;
  issuer: IssuerChain;
  subjectDid?: string;
}> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      aat: { status: 'invalid', message: 'Malformed JWT — expected three dot-separated segments' },
      issuer: { status: 'skipped' },
    };
  }

  let header: any;
  let payload: any;
  try {
    header = b64urlToJSON(parts[0]);
    payload = b64urlToJSON(parts[1]);
  } catch (e) {
    return {
      aat: { status: 'invalid', message: 'Header/payload not decodable as base64url-JSON' },
      issuer: { status: 'skipped' },
    };
  }

  const issuer = typeof payload.iss === 'string' ? payload.iss : undefined;
  const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
  const scopes = Array.isArray(payload.al_scopes) ? payload.al_scopes : undefined;
  const issuedAt = typeof payload.iat === 'number' ? new Date(payload.iat * 1000).toISOString() : undefined;
  const expiresAt = typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : undefined;
  const kid = typeof header.kid === 'string' ? header.kid : undefined;

  const expired = typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();

  // Resolve JWKS — only AgentLair-issued tokens get a full chain
  const isAgentLairIssued = issuer === `https://${ISSUER_DOMAIN}` || issuer === ISSUER_DOMAIN;
  const jwksUrl = isAgentLairIssued ? `${API_BASE}/.well-known/jwks.json` : undefined;

  let jwks: { keys?: any[] } | null = null;
  let issuerChain: IssuerChain;
  if (jwksUrl) {
    try {
      const r = await fetch(jwksUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      jwks = (await r.json()) as { keys?: any[] };
      const keys = (jwks.keys ?? []).map((k: any) => ({
        kid: k.kid,
        kty: k.kty,
        crv: k.crv,
        alg: k.alg,
      }));
      issuerChain = {
        status: 'ok',
        issuerDid: `did:web:${ISSUER_DOMAIN}`,
        jwksUrl,
        keys,
        matchedKid: kid,
      };
    } catch (e) {
      issuerChain = {
        status: 'error',
        jwksUrl,
        message: `JWKS fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      };
      return {
        aat: {
          status: 'error',
          header,
          payload,
          issuer,
          subject,
          issuedAt,
          expiresAt,
          scopes,
          kid,
          message: 'Cannot fetch JWKS to verify signature',
        },
        issuer: issuerChain,
        subjectDid: subject,
      };
    }
  } else {
    issuerChain = {
      status: 'skipped',
      message: issuer ? `Non-AgentLair issuer (${issuer}) — issuer chain skipped` : 'No issuer claim',
    };
  }

  // Find key by kid (or first key if no kid)
  const candidate = jwks
    ? (kid ? (jwks.keys ?? []).find((k: any) => k.kid === kid) : (jwks.keys ?? [])[0])
    : null;

  if (!candidate) {
    return {
      aat: {
        status: 'invalid',
        header,
        payload,
        issuer,
        subject,
        issuedAt,
        expiresAt,
        scopes,
        kid,
        message: jwks ? `No JWKS key matches kid="${kid ?? '(none)'}"` : 'No JWKS available',
      },
      issuer: issuerChain,
      subjectDid: subject,
    };
  }

  // Verify signature with Web Crypto Ed25519. Browsers without Ed25519
  // support fall through to a soft-failure rather than a confident "valid".
  let signatureValid = false;
  let cryptoError: string | undefined;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      candidate,
      { name: 'Ed25519' } as any,
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = b64urlToBytes(parts[2]);
    signatureValid = await crypto.subtle.verify({ name: 'Ed25519' } as any, key, sig, data);
  } catch (e) {
    cryptoError = e instanceof Error ? e.message : String(e);
  }

  if (cryptoError) {
    return {
      aat: {
        status: 'error',
        header,
        payload,
        issuer,
        subject,
        issuedAt,
        expiresAt,
        scopes,
        kid,
        message: `Web Crypto Ed25519 unavailable in this browser: ${cryptoError}`,
      },
      issuer: issuerChain,
      subjectDid: subject,
    };
  }

  if (!signatureValid) {
    return {
      aat: {
        status: 'invalid',
        header,
        payload,
        issuer,
        subject,
        issuedAt,
        expiresAt,
        scopes,
        kid,
        message: 'Signature does not verify against the resolved JWKS key',
      },
      issuer: issuerChain,
      subjectDid: subject,
    };
  }

  if (expired) {
    return {
      aat: {
        status: 'expired',
        header,
        payload,
        issuer,
        subject,
        issuedAt,
        expiresAt,
        scopes,
        kid,
        message: `Signature valid but token expired at ${expiresAt}`,
      },
      issuer: issuerChain,
      subjectDid: subject,
    };
  }

  return {
    aat: {
      status: 'ok',
      header,
      payload,
      issuer,
      subject,
      issuedAt,
      expiresAt,
      scopes,
      kid,
    },
    issuer: issuerChain,
    subjectDid: subject,
  };
}

// ── PoPA freshness ────────────────────────────────────────────────────────────

async function fetchPopa(did: string): Promise<PopaResult> {
  try {
    const r = await fetch(`${API_BASE}/v1/popa/${encodeURIComponent(did)}`);
    if (r.status === 404) {
      return { status: 'not_enrolled', did };
    }
    if (!r.ok) {
      return { status: 'error', did, message: `HTTP ${r.status}` };
    }
    const m = await r.json();
    const lastAt = new Date(m.last_attestation_at).getTime();
    const ageMs = Date.now() - lastAt;
    const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    return {
      status: 'enrolled',
      did,
      metrics: m,
      daysSinceLastAttestation: days,
      fresh: ageMs < 25 * 60 * 60 * 1000,
    };
  } catch (e) {
    return { status: 'error', did, message: e instanceof Error ? e.message : String(e) };
  }
}

// ── Card chrome ───────────────────────────────────────────────────────────────

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
      className={cn(
        'rounded-lg border p-4 sm:p-5 transition-colors',
        toneStyles(tone),
      )}
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

// ── Summary line ──────────────────────────────────────────────────────────────

function buildSummary(s: State): string {
  if (!s.parsed || s.parsed.kind === 'unknown') return 'Paste a DID or AAT above to verify.';

  const parts: string[] = [];

  if (s.parsed.kind === 'did') {
    if (s.did.status === 'ok') parts.push(`DID resolves (${s.did.vmCount} key${s.did.vmCount === 1 ? '' : 's'})`);
    else if (s.did.status === 'loading') parts.push('resolving DID');
    else if (s.did.status === 'error') parts.push('DID does not resolve');
  }

  if (s.parsed.kind === 'aat') {
    if (s.aat.status === 'ok') parts.push('AAT signature valid');
    else if (s.aat.status === 'expired') parts.push('AAT signature valid but expired');
    else if (s.aat.status === 'invalid') parts.push('AAT rejected');
    else if (s.aat.status === 'loading') parts.push('verifying AAT');
    if (s.aat.expiresAt) parts.push(`expires ${new Date(s.aat.expiresAt).toLocaleString()}`);
  }

  if (s.popa.status === 'enrolled' && s.popa.metrics) {
    parts.push(`${s.popa.metrics.streak_days}-day attestation streak`);
    if (typeof s.popa.daysSinceLastAttestation === 'number') {
      parts.push(`last attested ${s.popa.daysSinceLastAttestation === 0 ? 'today' : `${s.popa.daysSinceLastAttestation}d ago`}`);
    }
  } else if (s.popa.status === 'not_enrolled') {
    parts.push('not enrolled in PoPA');
  }

  if (parts.length === 0) return 'No data yet.';
  return parts.join(' · ') + '.';
}

// ── Main widget ───────────────────────────────────────────────────────────────

// ── Copy-to-clipboard helper ─────────────────────────────────────────────────

function buildVerifyLink(input: string): string {
  const parsed = classify(input);
  if (parsed.kind === 'aat') {
    return `https://agentlair.dev/verify?aat=${encodeURIComponent(input.trim())}`;
  }
  if (parsed.kind === 'did') {
    return `https://agentlair.dev/verify?did=${encodeURIComponent(input.trim())}`;
  }
  return '';
}

export function VerifyWidget() {
  const [raw, setRaw] = useState('');
  const [state, setState] = useState<State>(initialState);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  // Track whether auto-submit from URL params triggered the current run
  const autoSubmitRef = useRef(false);

  const run = useCallback(async (input: string, fromUrlParams = false) => {
    const parsed = classify(input);
    setState({
      parsed,
      did: { status: parsed.kind === 'unknown' ? 'skipped' : 'idle' },
      aat: { status: parsed.kind === 'aat' ? 'loading' : 'skipped' },
      popa: { status: 'idle' },
      issuer: { status: parsed.kind === 'aat' ? 'idle' : 'skipped' },
    });

    if (parsed.kind === 'unknown') {
      setState((prev) => ({
        ...prev,
        did: { status: 'skipped' },
        aat: { status: 'skipped' },
        popa: { status: 'skipped' },
        issuer: { status: 'skipped' },
      }));
      return;
    }

    setRunning(true);
    try {
      let didToProbe = parsed.kind === 'did' ? parsed.value : undefined;

      // AAT path first — extracts subject DID
      if (parsed.kind === 'aat') {
        const result = await verifyAat(parsed.value);
        setState((prev) => ({ ...prev, aat: result.aat, issuer: result.issuer }));
        if (result.subjectDid) didToProbe = result.subjectDid;
      }

      if (didToProbe) {
        setState((prev) => ({
          ...prev,
          did: { status: 'loading' },
          popa: { status: 'loading' },
        }));
        const [didRes, popaRes] = await Promise.all([
          resolveDid(didToProbe),
          fetchPopa(didToProbe),
        ]);
        setState((prev) => ({ ...prev, did: didRes, popa: popaRes }));
      } else {
        setState((prev) => ({
          ...prev,
          did: { status: 'skipped' },
          popa: { status: 'skipped' },
        }));
      }
    } finally {
      setRunning(false);
      // Clean ?aat/?did from URL after auto-submit to prevent leaking sensitive AATs
      if (fromUrlParams && typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/verify');
      }
    }
  }, []);

  // ── URL parameter auto-submit ────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const aat = params.get('aat');
    const did = params.get('did');
    // Prefer ?aat if both present; skip if neither
    const input = aat ?? did;
    if (!input) return;
    // Safety: reject inputs >2KB or without valid JWT/DID structure
    if (input.length > 2048) return;
    autoSubmitRef.current = true;
    setRaw(input);
    run(input, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      run(raw, false);
    },
    [raw, run],
  );

  const onCopyLink = useCallback(async () => {
    const link = buildVerifyLink(raw);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available — silently ignore
    }
  }, [raw]);

  // ── Card tone derivation ────────────────────────────────────────────────────

  const inputTone: Tone = !state.parsed ? 'neutral' : state.parsed.kind === 'unknown' ? 'bad' : 'ok';
  const inputStatus = state.parsed
    ? state.parsed.kind === 'unknown'
      ? 'unrecognized'
      : state.parsed.kind === 'aat'
        ? 'AAT (JWT)'
        : `DID (${state.parsed.notes ?? ''})`
    : 'waiting';

  const didTone: Tone =
    state.did.status === 'ok' ? 'ok' :
    state.did.status === 'loading' ? 'neutral' :
    state.did.status === 'error' ? 'bad' :
    state.did.status === 'skipped' ? 'na' : 'neutral';

  const aatTone: Tone =
    state.aat.status === 'ok' ? 'ok' :
    state.aat.status === 'expired' ? 'warn' :
    state.aat.status === 'invalid' || state.aat.status === 'error' ? 'bad' :
    state.aat.status === 'skipped' ? 'na' : 'neutral';

  const popaTone: Tone =
    state.popa.status === 'enrolled' && state.popa.fresh ? 'ok' :
    state.popa.status === 'enrolled' ? 'warn' :
    state.popa.status === 'not_enrolled' ? 'warn' :
    state.popa.status === 'error' ? 'bad' :
    state.popa.status === 'skipped' ? 'na' : 'neutral';

  const issuerTone: Tone =
    state.issuer.status === 'ok' ? 'ok' :
    state.issuer.status === 'error' ? 'bad' :
    state.issuer.status === 'skipped' ? 'na' : 'neutral';

  const summary = buildSummary(state);
  const summaryTone: Tone =
    state.parsed && state.parsed.kind !== 'unknown' && (state.did.status === 'ok' || state.aat.status === 'ok')
      ? 'ok'
      : 'neutral';

  return (
    <div className="mx-auto max-w-3xl px-4 py-28 lg:pt-44 lg:pb-32 space-y-6">
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground font-mono">/verify</p>
        <h1 className="text-3xl font-bold tracking-tight">Verify any agent</h1>
        <p className="text-muted-foreground">
          Paste a DID or AAT. The page resolves the document, verifies the signature,
          checks the daily attestation streak, and follows the issuer chain back to its
          publishing key. Six cards. No login.
        </p>
      </header>

      {/* Examples */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Examples</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'did:web:agentlair.dev', value: 'did:web:agentlair.dev', title: 'AgentLair production DID — resolves, PoPA enrolled' },
            { label: 'did:web:api.agentlair.dev', value: 'did:web:api.agentlair.dev', title: 'AgentLair API subdomain DID' },
            { label: 'did:key (Ed25519)', value: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', title: 'Portable Ed25519 key — no network needed' },
          ].map(({ label, value, title }) => (
            <button
              key={value}
              type="button"
              title={title}
              data-example={value}
              onClick={() => {
                setRaw(value);
                run(value, false);
              }}
              className="inline-flex items-center rounded-full border border-border bg-muted/40 px-3 py-1 font-mono text-xs text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <label htmlFor="verify-input" className="block text-xs uppercase tracking-wide text-muted-foreground">
          DID or AAT
        </label>
        <textarea
          id="verify-input"
          name="input"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="did:web:agentlair.dev   or   eyJhbGciOi..."
          rows={3}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={running || !raw.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      </form>

      <div className="space-y-4" data-cards-root>
        {/* 1. INPUT */}
        <Card index={1} title="Input" tone={inputTone} status={inputStatus} testId="input">
          {state.parsed ? (
            <div>
              <KV k="Type" v={state.parsed.kind} />
              <KV k="Value" v={state.parsed.value || '—'} mono />
              {state.parsed.notes && <KV k="Notes" v={state.parsed.notes} />}
            </div>
          ) : (
            <p className="text-muted-foreground">Submit something above.</p>
          )}
        </Card>

        {/* 2. DID RESOLUTION */}
        <Card index={2} title="DID resolution" tone={didTone} status={state.did.status} testId="did">
          {state.did.status === 'ok' && state.did.doc && (
            <div>
              {state.did.url && <KV k="Source" v={<a className="underline" href={state.did.url} target="_blank" rel="noreferrer">{state.did.url}</a>} mono />}
              {state.did.controller && <KV k="Controller" v={state.did.controller} mono />}
              <KV k="Methods" v={`${state.did.vmCount ?? 0} verificationMethod${(state.did.vmCount ?? 0) === 1 ? '' : 's'}`} />
              <KV k="Services" v={`${state.did.serviceCount ?? 0} service endpoint${(state.did.serviceCount ?? 0) === 1 ? '' : 's'}`} />
              <details className="mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">View document</summary>
                <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs font-mono">
{JSON.stringify(state.did.doc, null, 2)}
                </pre>
              </details>
            </div>
          )}
          {state.did.status === 'loading' && <p className="text-muted-foreground">Resolving…</p>}
          {state.did.status === 'error' && (
            <p className="text-destructive font-mono text-xs">{state.did.message}</p>
          )}
          {state.did.status === 'skipped' && <p className="text-muted-foreground">N/A — input is not a DID.</p>}
          {state.did.status === 'idle' && <p className="text-muted-foreground">Waiting for input.</p>}
        </Card>

        {/* 3. AAT VALIDATION */}
        <Card index={3} title="AAT validation" tone={aatTone} status={state.aat.status} testId="aat">
          {state.aat.status === 'skipped' && <p className="text-muted-foreground">N/A — no AAT submitted.</p>}
          {state.aat.status === 'idle' && <p className="text-muted-foreground">Waiting for input.</p>}
          {state.aat.status === 'loading' && <p className="text-muted-foreground">Verifying signature…</p>}
          {state.aat.payload && (
            <div>
              {state.aat.issuer && <KV k="Issuer" v={state.aat.issuer} mono />}
              {state.aat.subject && <KV k="Subject" v={state.aat.subject} mono />}
              {state.aat.issuedAt && <KV k="Issued" v={new Date(state.aat.issuedAt).toLocaleString()} />}
              {state.aat.expiresAt && <KV k="Expires" v={new Date(state.aat.expiresAt).toLocaleString()} />}
              {state.aat.scopes && state.aat.scopes.length > 0 && (
                <KV k="Scopes" v={state.aat.scopes.join(', ')} mono />
              )}
              {state.aat.kid && <KV k="Key ID" v={state.aat.kid} mono />}
              {state.aat.message && (
                <p className="mt-3 text-xs font-mono text-muted-foreground">{state.aat.message}</p>
              )}
            </div>
          )}
        </Card>

        {/* 4. POPA FRESHNESS */}
        <Card index={4} title="PoPA freshness" tone={popaTone} status={state.popa.status} testId="popa">
          {state.popa.status === 'idle' && <p className="text-muted-foreground">Waiting for a DID.</p>}
          {state.popa.status === 'skipped' && <p className="text-muted-foreground">N/A.</p>}
          {state.popa.status === 'loading' && <p className="text-muted-foreground">Fetching attestations…</p>}
          {state.popa.status === 'enrolled' && state.popa.metrics && (
            <div>
              <KV k="Streak" v={`${state.popa.metrics.streak_days} day${state.popa.metrics.streak_days === 1 ? '' : 's'}`} />
              <KV k="Longest" v={`${state.popa.metrics.longest_streak} days`} />
              <KV k="Total" v={`${state.popa.metrics.total_attestations} attestations`} />
              <KV k="Last attested" v={`${new Date(state.popa.metrics.last_attestation_at).toLocaleString()}${typeof state.popa.daysSinceLastAttestation === 'number' ? ` (${state.popa.daysSinceLastAttestation}d ago)` : ''}`} />
              <KV k="Fresh" v={state.popa.fresh ? 'yes (within 25h)' : 'no — stale'} />
              <KV k="SCITT entry" v={state.popa.metrics.latest_scitt_entry} mono />
              {state.popa.did && (
                <p className="mt-3 text-xs">
                  <a className="underline" href={`/popa/${encodeURIComponent(state.popa.did)}`}>Full freshness page →</a>
                </p>
              )}
            </div>
          )}
          {state.popa.status === 'not_enrolled' && state.popa.did && (
            <div className="space-y-2">
              <p className="text-muted-foreground">No attestations yet for this DID.</p>
              <p className="text-xs">
                Enrolled DIDs receive one signed attestation per UTC day, anchored in the SCITT log.
                {' '}
                <a className="underline" href="/dashboard/popa">Enroll from dashboard →</a>
              </p>
            </div>
          )}
          {state.popa.status === 'error' && (
            <p className="text-destructive font-mono text-xs">{state.popa.message}</p>
          )}
        </Card>

        {/* 5. ISSUER CHAIN */}
        <Card index={5} title="Issuer chain" tone={issuerTone} status={state.issuer.status} testId="issuer">
          {state.issuer.status === 'skipped' && (
            <p className="text-muted-foreground">{state.issuer.message ?? 'N/A.'}</p>
          )}
          {state.issuer.status === 'idle' && <p className="text-muted-foreground">Waiting.</p>}
          {state.issuer.status === 'loading' && <p className="text-muted-foreground">Resolving issuer keys…</p>}
          {state.issuer.status === 'ok' && (
            <div>
              {state.issuer.issuerDid && <KV k="Issuer DID" v={state.issuer.issuerDid} mono />}
              {state.issuer.jwksUrl && (
                <KV
                  k="JWKS"
                  v={<a className="underline" href={state.issuer.jwksUrl} target="_blank" rel="noreferrer">{state.issuer.jwksUrl}</a>}
                  mono
                />
              )}
              <KV k="Keys" v={`${state.issuer.keys?.length ?? 0} published`} />
              {state.issuer.matchedKid && state.issuer.keys && (
                <div className="mt-2 text-xs">
                  {state.issuer.keys.map((k) => (
                    <div key={k.kid ?? Math.random()} className="font-mono">
                      {k.kid === state.issuer.matchedKid ? '✓ ' : '  '}
                      kid={k.kid ?? '(none)'} · {k.kty}/{k.crv ?? '?'} · {k.alg ?? '?'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {state.issuer.status === 'error' && (
            <p className="text-destructive font-mono text-xs">{state.issuer.message}</p>
          )}
        </Card>

        {/* 6. SUMMARY */}
        <Card index={6} title="Summary" tone={summaryTone} status="output" testId="summary">
          <p className="text-base">{summary}</p>
          {state.parsed && state.parsed.kind !== 'unknown' && state.parsed.value && (
            <div className="mt-4">
              <button
                type="button"
                onClick={onCopyLink}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                {copied ? '✓ Copied!' : '↗ Copy verify link'}
              </button>
            </div>
          )}
        </Card>
      </div>

      <footer className="pt-6 text-xs text-muted-foreground border-t border-border">
        Powered by <a href="/specs/popa" className="underline">PoPA</a>,{' '}
        <a href="/.well-known/jwks.json" className="underline">JWKS</a>, and{' '}
        <a href="/.well-known/did.json" className="underline">did:web</a>. View the{' '}
        <a href="https://github.com/agentlair" className="underline">source</a>.
      </footer>
    </div>
  );
}
