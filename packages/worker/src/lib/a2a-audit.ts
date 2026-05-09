// ─── A2A Trust Audit — Worker-friendly core ─────────────────────────────────
//
// Ported from /workspace/a2a-trust-audit (the published @agentlair/a2a-trust-audit
// CLI) for use inside Cloudflare Workers. Removes node:fs / process / ANSI display
// and exposes a small async API:
//
//   - fetchAgentCard(target, fetchImpl?) → AgentCard
//   - runChecks(card, probe?) → Check[]
//   - score(checks) → ScoreBreakdown
//   - grade(overall) → "A" | "B" | "C" | "D" | "F"
//   - auditCardUrl(target, fetchImpl?) → AuditResult     ← convenience wrapper
//
// The check rubric is the same as the CLI (which is the authoritative test set
// at /workspace/a2a-trust-audit). When audit logic changes here, bump the npm
// package and port back. (TODO: extract into a shared package.)
//
// Identity is intentionally non-cryptographic: we trust the caller-provided URL.
// The endpoint that uses this should validate the target URL (HTTPS only,
// public hosts, no SSRF into private nets) before calling auditCardUrl().

export interface AgentCard {
  schema_version?: string;
  name?: string;
  description?: string;
  url?: string;
  iconUrl?: string;
  version?: string;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  capabilities?: Record<string, boolean>;
  skills?: Array<{
    id?: string;
    name?: string;
    description?: string;
    tags?: string[];
    examples?: string[];
  }>;
  authentication?: {
    schemes?: Array<string | { scheme: string; [key: string]: unknown }>;
    description?: string;
    credentials?: unknown;
    [key: string]: unknown;
  };
  securitySchemes?: Record<string, unknown>;
  security_schemes?: Record<string, unknown>;
  contact?: { email?: string; url?: string };
  provider?: { organization?: string; url?: string };
  did?: string;
  jwks_uri?: string;
  jwks_url?: string;
  jwksUri?: string;
  trust_attestation?: {
    score?: number;
    level?: string;
    confidence?: number;
    computed_at?: string;
    trend?: string;
    self_reported?: boolean;
    trust_endpoint_template?: string;
  };
  audit_trail_url?: string;
  audit_trail_url_template?: string;
  card_signature?: string;
  signatures?: Array<{ protected?: string; signature?: string; header?: unknown }>;
  behavioral_monitoring?: unknown;
  [key: string]: unknown;
}

export type Layer = 'L1' | 'L2' | 'L3' | 'L4';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Check {
  id: string;
  layer: Layer;
  name: string;
  pass: boolean;
  severity: Severity;
  detail: string;
}

export interface Probe {
  status?: number;
  flavor?: 'x402' | 'auth' | 'open' | 'unknown';
  x402_headers?: boolean;
}

export interface ScoreBreakdown {
  L1_identity: number;
  L2_authentication: number;
  L3_authorization: number;
  L4_behavioral: number;
  overall: number;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface AuditResult {
  target: string;
  fetched_from: string;
  card: AgentCard;
  probe?: Probe;
  checks: Check[];
  scores: ScoreBreakdown;
  grade: Grade;
}

// ── fetch agent card ─────────────────────────────────────────────────────────

export const WELL_KNOWN_PATHS = [
  '/.well-known/agent-card.json',
  '/.well-known/agent.json',
];

type FetchImpl = typeof fetch;

export async function fetchAgentCard(
  target: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ card: AgentCard; from: string }> {
  if (!/^https?:\/\//i.test(target)) {
    throw new Error('a2a-audit: target must be an absolute http(s) URL');
  }

  // Direct .json URL → fetch it.
  if (/\.json(\?.*)?$/.test(target)) {
    const res = await fetchImpl(target, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Failed to fetch ${target}: ${res.status}`);
    const card = (await res.json()) as AgentCard;
    return { card, from: target };
  }

  // Probe well-known paths.
  const base = target.replace(/\/+$/, '');
  for (const path of WELL_KNOWN_PATHS) {
    try {
      const url = base + path;
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
      });
      if (res.ok) {
        const card = (await res.json()) as AgentCard;
        return { card, from: url };
      }
    } catch {
      // try next
    }
  }
  throw new Error(`No agent card found at ${base}`);
}

// ── checks ───────────────────────────────────────────────────────────────────

export function runChecks(card: AgentCard, probe?: Probe): Check[] {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const securitySchemesObj =
    (card.securitySchemes as Record<string, unknown> | undefined) ||
    (card.security_schemes as Record<string, unknown> | undefined);
  const securitySchemesValues = Object.values(securitySchemesObj || {}) as Array<{
    type?: string;
    scheme?: string;
  }>;

  const hasSignaturesArray = Array.isArray(card.signatures) && card.signatures.length > 0;
  const hasLegacyCardSignature = !!card.card_signature;
  const hasCardSignature = hasSignaturesArray || hasLegacyCardSignature;
  const jwksRef = card.jwks_uri || card.jwks_url || card.jwksUri;

  // ── L1: Identity ──
  add({
    id: 'l1-name', layer: 'L1', name: 'Agent name declared',
    pass: !!card.name, severity: 'critical',
    detail: card.name ? `Name: "${card.name}"` : 'Missing agent name.',
  });
  add({
    id: 'l1-description', layer: 'L1', name: 'Description present',
    pass: !!card.description && card.description.length > 10, severity: 'high',
    detail: card.description ? `${card.description.length} chars` : 'No description.',
  });
  add({
    id: 'l1-url', layer: 'L1', name: 'Base URL declared',
    pass: !!card.url, severity: 'critical',
    detail: card.url || 'No URL.',
  });
  add({
    id: 'l1-https', layer: 'L1', name: 'HTTPS endpoint',
    pass: card.url?.startsWith('https://') ?? false, severity: 'critical',
    detail: card.url?.startsWith('https://') ? 'HTTPS' : 'Not HTTPS.',
  });
  add({
    id: 'l1-version', layer: 'L1', name: 'Version specified',
    pass: !!card.version, severity: 'medium',
    detail: card.version ? `v${card.version}` : 'No version.',
  });
  add({
    id: 'l1-contact', layer: 'L1', name: 'Contact information (vulnerability disclosure)',
    pass: !!(card.contact?.email || card.contact?.url), severity: 'low',
    detail: card.contact ? `Email: ${card.contact.email || '—'}` : 'No contact info.',
  });
  add({
    id: 'l1-provider', layer: 'L1', name: 'Provider/organization declared',
    pass: !!(card.provider?.organization || card.provider?.url), severity: 'medium',
    detail: card.provider ? `Org: ${card.provider.organization || '—'}` : 'No provider.',
  });
  const hasDid = !!card.did || Object.values(card).some(
    v => typeof v === 'string' && v.startsWith('did:')
  );
  add({
    id: 'l1-did', layer: 'L1', name: 'DID (Decentralized Identifier)',
    pass: hasDid, severity: 'high',
    detail: hasDid ? 'DID present.' : 'No DID.',
  });

  // ── L2: Authentication ──
  const rawSchemes = card.authentication?.schemes || [];
  const schemes: string[] = rawSchemes.map(s =>
    typeof s === 'string' ? s : (s?.scheme ?? '')
  ).filter(Boolean);
  const hasAuthDeclared = schemes.length > 0 || !!securitySchemesObj;
  add({
    id: 'l2-auth-declared', layer: 'L2', name: 'Authentication scheme declared',
    pass: hasAuthDeclared, severity: 'critical',
    detail: hasAuthDeclared ? 'Auth declared.' : 'No authentication.',
  });

  const hasOAuthInSecuritySchemes = securitySchemesValues.some(s => {
    const t = (s?.type || '').toLowerCase();
    return t === 'oauth2' || t === 'openidconnect' || t === 'openid';
  });
  const hasOAuth = schemes.some(s =>
    ['oauth2', 'openid', 'oidc'].includes(s.toLowerCase())
  ) || hasOAuthInSecuritySchemes;
  add({
    id: 'l2-oauth', layer: 'L2', name: 'OAuth 2.0 or OpenID Connect',
    pass: hasOAuth, severity: 'medium',
    detail: hasOAuth ? 'Supports OAuth/OIDC.' : 'No OAuth/OIDC.',
  });

  add({
    id: 'l2-jwks', layer: 'L2', name: 'JWKS endpoint referenced',
    pass: !!jwksRef, severity: 'high',
    detail: jwksRef ? `JWKS: ${jwksRef}` : 'No JWKS reference.',
  });

  add({
    id: 'l2-card-signed', layer: 'L2', name: 'Agent card is signed',
    pass: hasCardSignature, severity: 'critical',
    detail: hasSignaturesArray
      ? `${card.signatures!.length} JWS signature(s).`
      : hasLegacyCardSignature
        ? 'Legacy card_signature.'
        : 'UNSIGNED CARD.',
  });

  const hasX402Field = Object.keys(card).some(k =>
    k === 'x402' || k === 'payment_schemes' || k === 'payment_required' || k === 'pricing'
  );
  const probedX402 = probe?.flavor === 'x402';
  const hasX402 = hasX402Field || probedX402;
  add({
    id: 'l2-x402', layer: 'L2', name: 'x402 payment-gated (skin in the game)',
    pass: hasX402, severity: 'high',
    detail: probe?.status === 402 ? '402 confirmed.' : hasX402 ? 'x402 detected.' : 'No x402.',
  });

  const hasMtlsInSecuritySchemes = securitySchemesValues.some(s => {
    const t = (s?.type || '').toLowerCase();
    return t === 'mutualtls' || t === 'mtls';
  });
  const hasMtls = schemes.some(s => s.toLowerCase().includes('mtls') || s.toLowerCase().includes('mutual'))
    || hasMtlsInSecuritySchemes;
  add({
    id: 'l2-mtls', layer: 'L2', name: 'Mutual TLS support',
    pass: hasMtls, severity: 'low',
    detail: hasMtls ? 'mTLS available.' : 'No mTLS.',
  });

  // ── L3: Authorization ──
  const skills = card.skills || [];
  add({
    id: 'l3-skills', layer: 'L3', name: 'Skills/capabilities defined',
    pass: skills.length > 0, severity: 'high',
    detail: skills.length > 0 ? `${skills.length} skills.` : 'No skills.',
  });

  const skillsRequiredFields = (s: { id?: string; name?: string; description?: string; tags?: string[] }) =>
    !!s.id && !!s.name && !!s.description && Array.isArray(s.tags) && s.tags.length > 0;
  const allSkillsComplete = skills.every(skillsRequiredFields);
  add({
    id: 'l3-skill-ids', layer: 'L3',
    name: 'Skills have required fields (id, name, description, tags)',
    pass: skills.length === 0 || allSkillsComplete, severity: 'medium',
    detail: allSkillsComplete ? 'All skills complete.' : 'Some skills incomplete.',
  });

  add({
    id: 'l3-io-modes', layer: 'L3', name: 'Input/output modes specified',
    pass: !!(card.defaultInputModes?.length && card.defaultOutputModes?.length),
    severity: 'medium',
    detail: card.defaultInputModes ? 'I/O modes set.' : 'No I/O modes.',
  });

  add({
    id: 'l3-capabilities', layer: 'L3', name: 'Capabilities explicitly declared',
    pass: !!card.capabilities && Object.keys(card.capabilities).length > 0,
    severity: 'medium',
    detail: card.capabilities ? 'Capabilities set.' : 'No capabilities.',
  });

  // ── L4: Behavioral Trust ──
  add({
    id: 'l4-trust-attestation', layer: 'L4', name: 'Trust attestation present',
    pass: !!card.trust_attestation, severity: 'critical',
    detail: card.trust_attestation ? 'Trust attestation declared.' : 'NO TRUST ATTESTATION.',
  });

  const hasAuditTrail = !!card.audit_trail_url || !!card.audit_trail_url_template;
  add({
    id: 'l4-audit-trail', layer: 'L4', name: 'Audit trail URL',
    pass: hasAuditTrail, severity: 'high',
    detail: hasAuditTrail ? 'Audit trail set.' : 'No audit trail.',
  });

  const hasBehavioral = Object.keys(card).some(k =>
    k.includes('behavioral') || k.includes('telemetry') || k.includes('monitoring')
  );
  add({
    id: 'l4-behavioral-ref', layer: 'L4', name: 'Behavioral monitoring reference',
    pass: hasBehavioral, severity: 'high',
    detail: hasBehavioral ? 'Behavioral monitoring referenced.' : 'No behavioral monitoring.',
  });

  const hasDelegation = Object.keys(card).some(k =>
    k.includes('delegation') || k.includes('provenance') || k.includes('chain')
  );
  add({
    id: 'l4-delegation', layer: 'L4', name: 'Delegation/provenance chain',
    pass: hasDelegation, severity: 'medium',
    detail: hasDelegation ? 'Delegation chain present.' : 'No delegation chain.',
  });

  return checks;
}

// ── scoring ──────────────────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25, high: 15, medium: 8, low: 3, info: 1,
};

export function score(checks: Check[]): ScoreBreakdown {
  const byLayer = (layer: Layer) => {
    const layerChecks = checks.filter(c => c.layer === layer);
    if (layerChecks.length === 0) return 0;
    const max = layerChecks.reduce((s, c) => s + SEVERITY_WEIGHT[c.severity], 0);
    const earned = layerChecks
      .filter(c => c.pass)
      .reduce((s, c) => s + SEVERITY_WEIGHT[c.severity], 0);
    return Math.round((earned / max) * 100);
  };

  const l1 = byLayer('L1');
  const l2 = byLayer('L2');
  const l3 = byLayer('L3');
  const l4 = byLayer('L4');
  const overall = Math.round(l1 * 0.2 + l2 * 0.3 + l3 * 0.15 + l4 * 0.35);

  return {
    L1_identity: l1, L2_authentication: l2,
    L3_authorization: l3, L4_behavioral: l4, overall,
  };
}

export function grade(overall: number): Grade {
  if (overall >= 90) return 'A';
  if (overall >= 80) return 'B';
  if (overall >= 65) return 'C';
  if (overall >= 50) return 'D';
  return 'F';
}

// ── badge color helper ───────────────────────────────────────────────────────

export function gradeColor(g: Grade): string {
  switch (g) {
    case 'A': return '#4caf50'; // green
    case 'B': return '#8bc34a'; // light green
    case 'C': return '#ff9800'; // orange
    case 'D': return '#ff5722'; // deep orange
    case 'F': return '#f44336'; // red
  }
}

// ── convenience wrapper ──────────────────────────────────────────────────────

export async function auditCardUrl(
  target: string,
  fetchImpl: FetchImpl = fetch,
): Promise<AuditResult> {
  const { card, from } = await fetchAgentCard(target, fetchImpl);
  // Skip endpoint probe in worker context — adds latency; a free badge endpoint
  // shouldn't ping arbitrary third-party hosts. Card content is the most
  // badge-relevant signal.
  const checks = runChecks(card, undefined);
  const scores = score(checks);
  return {
    target,
    fetched_from: from,
    card,
    probe: undefined,
    checks,
    scores,
    grade: grade(scores.overall),
  };
}
