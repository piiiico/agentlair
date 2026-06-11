// ─── Findings Routes ─────────────────────────────────────────────────────────
// Authenticated submit: POST /v1/agents/:agentId/findings
// Public lookup:        GET  /v1/findings/:jti
//
// Submission flow:
//   1. Auth middleware sets c.var.account (AAT-verified).
//   2. Validate :agentId === account.id (IDOR guard — agent can only submit own findings).
//   3. Validate body: title, severity, target, evidence_hash required.
//   4. Optionally fetch behavioral score via computeTrustScore() — wrap in try/catch,
//      score is nullable (cold-start agents pass without it).
//   5. Generate jti = `finding_${nanoid(21)}`.
//   6. INSERT into findings table.
//   7. Build claims object (fixed key order — see buildFindingClaims helper).
//   8. signJWS(claims, AUDIT_SIGNING_KEY, kid) → signed envelope.
//   9. Return { jti, signed_jwt, permalink: `https://agentlair.dev/v1/findings/${jti}` }.
//
// Lookup flow (public):
//   1. Validate :jti format (^finding_[A-Za-z0-9_-]{21}$).
//   2. SELECT from findings WHERE jti = ?.
//   3. Re-build claims (same order as submit).
//   4. Re-sign → return { jti, signed_jwt, claims }.
//
// Auth model: the submit endpoint is account-scoped (IDOR-guarded). The lookup
// endpoint is intentionally public — programs verify findings without onboarding
// each agent individually.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { nanoid, json, err } from '../utils.js';
import { signJWS, getPublicKey, computeKeyId } from '../jwt.js';
import { computeTrustScore } from '../trust-engine.js';

export const findingsRoutes = new Hono<HonoEnv>();      // /v1/agents/:agentId/findings (auth-gated)
export const findingsPublicRoutes = new Hono<HonoEnv>();// /v1/findings/:jti (public)

const VALID_SEVERITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
type Severity = (typeof VALID_SEVERITY)[number];

const JTI_PATTERN = /^finding_[A-Za-z0-9_-]{21}$/;
const TITLE_MAX = 200;
const TARGET_MAX = 500;
const EVIDENCE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CWE_PATTERN = /^CWE-\d{1,4}$/;
const DEFAULT_AUDIENCE = 'https://agentlair.dev';
const TOOLS_MAX = 20;
const TOOL_NAME_MAX = 64;

interface FindingSubmission {
  title: string;
  severity: Severity;
  cwe?: string;
  target: string;
  evidence_hash: string;
  evidence_url?: string;
  tools_used?: string[];
  time_to_find_ms?: number;
  audience?: string;        // optional override; default 'https://agentlair.dev'
}

interface FindingRow {
  jti: string;
  agent_id: string;
  audience: string;
  title: string;
  severity: string;
  cwe: string | null;
  target: string;
  evidence_hash: string;
  evidence_url: string | null;
  tools_used: string | null;
  time_to_find_ms: number | null;
  behavioral_score: number | null;
  trust_level: string | null;
  trust_confidence: number | null;
  submitted_at: string;
}

// Build claims deterministically (same key order in submit + lookup so re-sign matches).
function buildFindingClaims(row: FindingRow, account_name?: string): Record<string, unknown> {
  return {
    iss: 'https://agentlair.dev',
    sub: row.agent_id,
    aud: row.audience,
    iat: Math.floor(new Date(row.submitted_at).getTime() / 1000),
    jti: row.jti,
    type: 'security_finding',
    agent_name: account_name,
    finding: {
      title: row.title,
      severity: row.severity,
      cwe: row.cwe ?? undefined,
      target: row.target,
      evidence_hash: row.evidence_hash,
      evidence_url: row.evidence_url ?? undefined,
      tools_used: row.tools_used ? JSON.parse(row.tools_used) : undefined,
      time_to_find_ms: row.time_to_find_ms ?? undefined,
    },
    behavioral_score: row.behavioral_score ?? undefined,
    trust: row.trust_level ? {
      level: row.trust_level,
      confidence: row.trust_confidence,
    } : undefined,
  };
}

// ─── POST /v1/agents/:agentId/findings ──────────────────────────────────────
findingsRoutes.post('/agents/:agentId/findings', async (c) => {
  const account = c.get('account');
  if (!account) {
    return err('Authentication required.', 401, 'unauthorized');
  }

  const agentId = c.req.param('agentId');
  // IDOR guard — agentId must match authenticated account.id
  if (agentId !== account.id) {
    return err('agentId does not match authenticated account.', 403, 'forbidden');
  }

  if (!c.env.AUDIT) {
    return err('Findings store not enabled for this instance.', 503, 'audit_unavailable');
  }
  if (!c.env.AUDIT_SIGNING_KEY) {
    return err('Audit signing key not configured.', 503, 'audit_unavailable');
  }

  // Parse + validate body
  let body: FindingSubmission;
  try {
    body = (await c.req.json()) as FindingSubmission;
  } catch {
    return err('Invalid JSON body.', 400, 'invalid_body');
  }

  if (!body || typeof body !== 'object') {
    return err('Body must be a JSON object.', 400, 'invalid_body');
  }

  const { title, severity, cwe, target, evidence_hash, evidence_url, tools_used, time_to_find_ms, audience } = body;

  // title — required, string, 1..200 chars
  if (!title) return err('Missing required field: title.', 400, 'missing_required_field');
  if (typeof title !== 'string' || title.length < 1) {
    return err('Missing required field: title.', 400, 'missing_required_field');
  }
  if (title.length > TITLE_MAX) {
    return err(`title exceeds ${TITLE_MAX} chars.`, 400, 'title_too_long');
  }

  // severity — required, must be in VALID_SEVERITY
  if (!severity) return err('Missing required field: severity.', 400, 'missing_required_field');
  if (typeof severity !== 'string' || !(VALID_SEVERITY as readonly string[]).includes(severity)) {
    return err(
      'Invalid severity.',
      400,
      'invalid_severity',
      `Allowed values: ${VALID_SEVERITY.join(', ')}`,
    );
  }

  // cwe — optional, must match CWE-\d{1,4}
  if (cwe !== undefined && cwe !== null) {
    if (typeof cwe !== 'string' || !CWE_PATTERN.test(cwe)) {
      return err('cwe must match format CWE-<digits>.', 400, 'invalid_cwe');
    }
  }

  // target — required, string, 1..500 chars
  if (!target) return err('Missing required field: target.', 400, 'missing_required_field');
  if (typeof target !== 'string' || target.length < 1) {
    return err('Missing required field: target.', 400, 'missing_required_field');
  }
  if (target.length > TARGET_MAX) {
    return err(`target exceeds ${TARGET_MAX} chars.`, 400, 'target_too_long');
  }

  // evidence_hash — required, must match sha256:[a-f0-9]{64}
  if (!evidence_hash) return err('Missing required field: evidence_hash.', 400, 'missing_required_field');
  if (typeof evidence_hash !== 'string' || !EVIDENCE_HASH_PATTERN.test(evidence_hash)) {
    return err('evidence_hash must match format sha256:[a-f0-9]{64}.', 400, 'invalid_evidence_hash');
  }

  // evidence_url — optional, must start with https:// or ipfs://
  if (evidence_url !== undefined && evidence_url !== null) {
    if (typeof evidence_url !== 'string' || !(evidence_url.startsWith('https://') || evidence_url.startsWith('ipfs://'))) {
      return err('evidence_url must start with https:// or ipfs://.', 400, 'invalid_url');
    }
  }

  // tools_used — optional, array of strings (≤20 entries, each ≤64 chars)
  let toolsUsedJson: string | null = null;
  if (tools_used !== undefined && tools_used !== null) {
    if (!Array.isArray(tools_used)) {
      return err('tools_used must be an array of strings.', 400, 'invalid_body');
    }
    if (tools_used.length > TOOLS_MAX) {
      return err(`tools_used exceeds ${TOOLS_MAX} entries.`, 400, 'tools_too_many');
    }
    for (const t of tools_used) {
      if (typeof t !== 'string' || t.length < 1 || t.length > TOOL_NAME_MAX) {
        return err('Each tools_used entry must be a string of 1..64 chars.', 400, 'invalid_body');
      }
    }
    toolsUsedJson = JSON.stringify(tools_used);
  }

  // time_to_find_ms — optional, non-negative integer
  if (time_to_find_ms !== undefined && time_to_find_ms !== null) {
    if (typeof time_to_find_ms !== 'number' || !Number.isFinite(time_to_find_ms) || !Number.isInteger(time_to_find_ms) || time_to_find_ms < 0) {
      return err('time_to_find_ms must be a non-negative integer.', 400, 'invalid_body');
    }
  }

  // audience — optional, must start with https://
  const resolvedAudience = audience ?? DEFAULT_AUDIENCE;
  if (typeof resolvedAudience !== 'string' || !resolvedAudience.startsWith('https://')) {
    return err('audience must start with https://.', 400, 'invalid_audience');
  }

  // Best-effort behavioral score snapshot — cold-start agents pass without it.
  let behavioralScore: number | null = null;
  let trustLevel: string | null = null;
  let trustConfidence: number | null = null;
  try {
    const profile = await computeTrustScore(c.env.AUDIT, account.id, (account.tier as never) ?? 'free');
    if (profile && typeof profile.observationCount === 'number' && profile.observationCount >= 10) {
      behavioralScore = Math.round(profile.score);
      trustLevel = profile.atfLevel;
      trustConfidence = profile.confidence;
    }
  } catch {
    // Cold-start path — leave snapshot fields null.
  }

  // Generate jti
  const jti = `finding_${nanoid(21)}`;
  const submittedAt = new Date().toISOString();

  // INSERT into findings (explicit columns)
  try {
    await c.env.AUDIT.prepare(
      `INSERT INTO findings (
        jti, agent_id, audience, title, severity, cwe, target,
        evidence_hash, evidence_url, tools_used, time_to_find_ms,
        behavioral_score, trust_level, trust_confidence, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      jti,
      account.id,
      resolvedAudience,
      title,
      severity,
      cwe ?? null,
      target,
      evidence_hash,
      evidence_url ?? null,
      toolsUsedJson,
      time_to_find_ms ?? null,
      behavioralScore,
      trustLevel,
      trustConfidence,
      submittedAt,
    ).run();
  } catch (e) {
    console.error('Findings insert failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to persist finding.', 500, 'findings_insert_error');
  }

  // Build row + claims (deterministic key order)
  const row: FindingRow = {
    jti,
    agent_id: account.id,
    audience: resolvedAudience,
    title,
    severity,
    cwe: cwe ?? null,
    target,
    evidence_hash,
    evidence_url: evidence_url ?? null,
    tools_used: toolsUsedJson,
    time_to_find_ms: time_to_find_ms ?? null,
    behavioral_score: behavioralScore,
    trust_level: trustLevel,
    trust_confidence: trustConfidence,
    submitted_at: submittedAt,
  };
  // account_name intentionally omitted so the submit-time JWT matches the
  // lookup-time re-derivation byte-for-byte (the row doesn't persist a name column).
  const claims = buildFindingClaims(row);

  // Sign with AUDIT_SIGNING_KEY (REUSE — never a separate key for findings)
  let signedJwt: string;
  try {
    const publicKey = getPublicKey(c.env.AUDIT_SIGNING_KEY);
    const kid = await computeKeyId(publicKey);
    signedJwt = signJWS(claims, c.env.AUDIT_SIGNING_KEY, kid, 'https://agentlair.dev/.well-known/jwks.json');
  } catch (e) {
    console.error('Finding signing failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to sign finding envelope.', 500, 'signing_error');
  }

  return json(
    {
      jti,
      signed_jwt: signedJwt,
      permalink: `https://agentlair.dev/v1/findings/${jti}`,
    },
    201,
  );
});

// ─── GET /v1/findings/:jti (PUBLIC) ─────────────────────────────────────────
findingsPublicRoutes.get('/findings/:jti', async (c) => {
  const jti = c.req.param('jti');

  if (!JTI_PATTERN.test(jti)) {
    return err('Finding id must match format finding_[A-Za-z0-9_-]{21}', 400, 'invalid_jti');
  }

  if (!c.env.AUDIT) {
    return err('Findings store not enabled for this instance.', 503, 'audit_unavailable');
  }
  if (!c.env.AUDIT_SIGNING_KEY) {
    return err('Audit signing key not configured.', 503, 'audit_unavailable');
  }

  let row: FindingRow | null = null;
  try {
    const result = await c.env.AUDIT
      .prepare('SELECT * FROM findings WHERE jti = ? LIMIT 1')
      .bind(jti)
      .first<FindingRow>();
    row = result ?? null;
  } catch (e) {
    console.error('Findings lookup failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to look up finding.', 500, 'findings_lookup_error');
  }

  if (!row) {
    return err('Finding not found.', 404, 'finding_not_found');
  }

  // Re-derive claims with the same buildFindingClaims helper used at submit-time.
  // Account name is not re-fetched on lookup — kept undefined for byte-stable re-sign.
  const claims = buildFindingClaims(row);

  let signedJwt: string;
  try {
    const publicKey = getPublicKey(c.env.AUDIT_SIGNING_KEY);
    const kid = await computeKeyId(publicKey);
    signedJwt = signJWS(claims, c.env.AUDIT_SIGNING_KEY, kid, 'https://agentlair.dev/.well-known/jwks.json');
  } catch (e) {
    console.error('Finding re-signing failed:', e instanceof Error ? e.message : String(e));
    return err('Failed to sign finding envelope.', 500, 'signing_error');
  }

  return json({
    jti: row.jti,
    signed_jwt: signedJwt,
    claims,
  });
});
