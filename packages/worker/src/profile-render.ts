/**
 * Agent profile HTML renderer and extras fetcher.
 *
 * Separated from index.ts to keep the router thin and enable unit testing
 * without spinning up the full Hono app.
 *
 * Exports:
 *   ProfileExtras       — 5-field nullable struct for behavioral attestation data
 *   fetchProfileExtras  — async D1+KV queries, per-field try/catch, never throws
 *   renderAgentProfileHTML — full HTML page generator
 */

import { b64urlDecode } from './jwt.js';
import { computeJwkThumbprint } from './routes/signing-keys.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProfileExtras {
  bccCount: number | null;          // null = fetch failed; render as "—"
  popaStreakDays: number | null;
  popaLastAttestedAt: string | null; // ISO date "YYYY-MM-DD" or null
  auditCount30d: number | null;
  signingKeyThumbprint: string | null; // 43-char base64url; null = not registered
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Compute current PoPA streak from rows ordered by sequence DESC.
 * Mirrors the second loop in routes/popa.ts:204-220 (corrected current-streak version).
 */
function computePopaStreak(rows: { window_date: string; attested_at: string }[]): {
  streakDays: number;
  lastAttestedAt: string | null;
} {
  if (rows.length === 0) return { streakDays: 0, lastAttestedAt: null };

  let streak = 0;
  let prevDate: string | null = null;

  for (const row of rows) {
    if (prevDate === null) {
      streak = 1;
    } else {
      const prev = new Date(prevDate + 'T00:00:00Z');
      const curr = new Date(row.window_date + 'T00:00:00Z');
      const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86_400_000);
      if (diffDays === 1) {
        streak++;
      } else {
        break; // gap — current streak ends
      }
    }
    prevDate = row.window_date;
  }

  const lastAttestedAt = rows[0]?.attested_at ? rows[0].attested_at.substring(0, 10) : null;
  return { streakDays: streak, lastAttestedAt };
}

// ─── Data fetcher ─────────────────────────────────────────────────────────────

export async function fetchProfileExtras(
  env: { AUDIT?: D1Database; KEYS?: KVNamespace },
  agent: { id: string; did: string },
): Promise<ProfileExtras> {
  let bccCount: number | null = null;
  let popaStreakDays: number | null = null;
  let popaLastAttestedAt: string | null = null;
  let auditCount30d: number | null = null;
  let signingKeyThumbprint: string | null = null;

  // BCC count — uses idx_bcc_subject
  try {
    if (env.AUDIT) {
      const row = await env.AUDIT
        .prepare('SELECT COUNT(*) AS cnt FROM bcc_credentials WHERE subject_did = ? AND revoked_at IS NULL')
        .bind(agent.did)
        .first<{ cnt: number }>();
      if (row !== null) bccCount = row.cnt;
    }
  } catch { /* leave null */ }

  // PoPA streak — uses idx_psa_did_seq
  try {
    if (env.AUDIT) {
      const result = await env.AUDIT
        .prepare(
          'SELECT window_date, attested_at FROM popa_self_attestations WHERE agent_did = ? ORDER BY sequence DESC LIMIT 365',
        )
        .bind(agent.did)
        .all<{ window_date: string; attested_at: string }>();
      const { streakDays, lastAttestedAt } = computePopaStreak(result.results);
      popaStreakDays = streakDays;
      popaLastAttestedAt = lastAttestedAt;
    }
  } catch { /* leave null */ }

  // Audit count 30d — uses idx_audit_account_ts
  try {
    if (env.AUDIT) {
      const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const row = await env.AUDIT
        .prepare('SELECT COUNT(*) AS cnt FROM audit_log WHERE account_id = ? AND timestamp >= ?')
        .bind(agent.id, cutoff)
        .first<{ cnt: number }>();
      if (row !== null) auditCount30d = row.cnt;
    }
  } catch { /* leave null */ }

  // Signing key thumbprint
  try {
    if (env.KEYS) {
      const keyIndex = await env.KEYS.get('signing-key-by-account:' + agent.id);
      if (keyIndex) {
        const { keyid } = JSON.parse(keyIndex) as { keyid: string };
        const keyRecord = await env.KEYS.get('signing-key:' + keyid);
        if (keyRecord) {
          const parsed = JSON.parse(keyRecord) as { public_key: string; status?: string };
          if (parsed.status === 'active') {
            signingKeyThumbprint = await computeJwkThumbprint(b64urlDecode(parsed.public_key));
          }
        }
      }
    }
  } catch { /* leave null */ }

  return { bccCount, popaStreakDays, popaLastAttestedAt, auditCount30d, signingKeyThumbprint };
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

export function renderAgentProfileHTML(
  agent: {
    id: string;
    name: string;
    email: string;
    did: string;
    jwks_url?: string;
    registered_at?: string;
    verified: boolean;
    trustScore?: number;
    trustLevel?: string;
  },
  extras: ProfileExtras,
): string {
  const { id, name, email, did, jwks_url, registered_at, verified, trustScore, trustLevel } = agent;
  const registeredDate = registered_at
    ? new Date(registered_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Unknown';
  const trustBadgeColor =
    trustScore !== undefined
      ? trustScore >= 75 ? '#2196f3' : trustScore >= 50 ? '#4caf50' : trustScore >= 25 ? '#ff9800' : '#f44336'
      : '#9e9e9e';
  const trustDisplay =
    trustScore !== undefined ? `${trustLevel || 'Unknown'} (${Math.round(trustScore)}/100)` : 'No data yet';
  const trustFillWidth = trustScore !== undefined ? Math.round(trustScore) : 0;
  const verifiedColor = verified ? '#22c55e' : '#64748b';
  const verifiedBg = verified ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)';
  const verifiedBorder = verified ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.3)';
  const verifiedText = verified ? '✓ Verified' : '○ Unverified';
  const avatarLetter = escapeHtml(name.charAt(0).toUpperCase());

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeId = escapeHtml(id);
  const safeDid = escapeHtml(did);
  const safeJwksUrl = jwks_url ? escapeHtml(encodeURI(jwks_url)) : '';
  const safeJwksDisplay = jwks_url ? escapeHtml(jwks_url) : '';
  const safeTrustDisplay = escapeHtml(trustDisplay);

  // Build optional JWKS field block
  const jwksField = jwks_url
    ? `<div class="field">
          <div class="field-label">JWKS Endpoint</div>
          <div class="field-value"><a href="${safeJwksUrl}" class="field-link">${safeJwksDisplay}</a></div>
        </div>`
    : '';

  // Build optional trust bar
  const trustBar = trustScore !== undefined
    ? `<div class="trust-bar"><div class="trust-fill" style="width:${trustFillWidth}%;background:${trustBadgeColor}"></div></div>`
    : '';

  // Build DID document URL: did:web:agentlair.dev:agents:acc_xxx → /agents/acc_xxx/did.json
  const didDocUrl = `/agents/${safeId}/did.json`;

  const jwksLink = jwks_url
    ? `<a href="${safeJwksUrl}" class="link">↗ JWKS</a>`
    : '';

  // ── Behavioral attestation fields ────────────────────────────────────────
  // BCC count: link if count > 0, plain "0" if zero, "—" if null
  let bccValue: string;
  if (extras.bccCount === null) {
    bccValue = '—';
  } else if (extras.bccCount === 0) {
    bccValue = '0';
  } else {
    bccValue = `<a href="${escapeHtml(encodeURI('/v1/bcc/list?subject_did=' + did))}" class="field-link">${String(extras.bccCount)}</a>`;
  }

  // PoPA streak: link if streak > 0, "—" if zero or null
  let popaValue: string;
  if (extras.popaStreakDays === null || extras.popaStreakDays === 0) {
    popaValue = '—';
  } else {
    const popaHref = escapeHtml(encodeURI('/v1/popa/agent/' + did));
    const popaText = `${String(extras.popaStreakDays)} days (last ${escapeHtml(extras.popaLastAttestedAt ?? '')})`;
    popaValue = `<a href="${popaHref}" class="field-link">${popaText}</a>`;
  }

  // Audit count: link to /api (auth-gated), "—" if null
  let auditValue: string;
  if (extras.auditCount30d === null) {
    auditValue = '—';
  } else {
    auditValue = `<a href="${escapeHtml(encodeURI('/api'))}" class="field-link">${String(extras.auditCount30d)}</a>`;
  }

  // Signing key: link to thumbprint page, or "Not registered"
  let signingKeyValue: string;
  if (extras.signingKeyThumbprint === null) {
    signingKeyValue = 'Not registered';
  } else {
    const prefix = extras.signingKeyThumbprint.substring(0, 8);
    signingKeyValue = `<a href="${escapeHtml(encodeURI('/agents/' + extras.signingKeyThumbprint))}" class="field-link">Registered (${escapeHtml(prefix)}…)</a>`;
  }

  const attestationFields = `
        <div class="field">
          <div class="field-label">BCCs Declared</div>
          <div class="field-value">${bccValue}</div>
        </div>
        <div class="field">
          <div class="field-label">PoPA Streak</div>
          <div class="field-value">${popaValue}</div>
        </div>
        <div class="field">
          <div class="field-label">Audit Attestations (30d)</div>
          <div class="field-value">${auditValue}</div>
        </div>
        <div class="field">
          <div class="field-label">Web Bot Auth Signing Key</div>
          <div class="field-value">${signingKeyValue}</div>
        </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeName} — AgentLair</title>
  <meta name="description" content="Agent profile for ${safeName} on AgentLair. Verified AI agent identity with behavioral trust scoring." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',-apple-system,sans-serif;background:#0a0a0f;color:#e2e8f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:2rem 1rem}
    .container{width:100%;max-width:640px}
    .brand{display:flex;align-items:center;gap:.5rem;margin-bottom:2.5rem;text-decoration:none;color:#e2e8f0}
    .brand-logo{width:28px;height:28px;background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:700;font-family:'DM Mono',monospace}
    .brand-name{font-family:'DM Mono',monospace;font-size:1rem;font-weight:500;color:#94a3b8}
    .profile-card{background:#13131a;border:1px solid #1e1e2e;border-radius:12px;padding:2rem}
    .profile-header{display:flex;align-items:flex-start;gap:1.25rem;margin-bottom:1.5rem;padding-bottom:1.5rem;border-bottom:1px solid #1e1e2e}
    .avatar{width:56px;height:56px;background:linear-gradient(135deg,#1e3a5f,#0d2137);border:2px solid #22c55e;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;font-size:1.25rem;color:#22c55e;flex-shrink:0;font-weight:500}
    .profile-info{flex:1;min-width:0}
    .profile-name{font-size:1.4rem;font-weight:600;color:#f1f5f9;margin-bottom:.25rem}
    .profile-email{font-family:'DM Mono',monospace;font-size:.875rem;color:#64748b}
    .verified-badge{display:inline-flex;align-items:center;gap:.3rem;background:${verifiedBg};border:1px solid ${verifiedBorder};color:${verifiedColor};font-size:.75rem;font-family:'DM Mono',monospace;padding:.2rem .6rem;border-radius:999px;margin-top:.5rem}
    .field-grid{display:grid;gap:1rem}
    .field{display:flex;flex-direction:column;gap:.25rem}
    .field-label{font-family:'DM Mono',monospace;font-size:.7rem;color:#475569;text-transform:uppercase;letter-spacing:.1em}
    .field-value{font-family:'DM Mono',monospace;font-size:.875rem;color:#94a3b8;word-break:break-all}
    .field-link{color:#64748b;text-decoration:none}.field-link:hover{color:#22c55e}
    .trust-value{font-family:'DM Mono',monospace;font-size:.875rem;color:${trustBadgeColor}}
    .trust-bar{height:6px;background:#1e1e2e;border-radius:3px;overflow:hidden;margin-top:.5rem}
    .trust-fill{height:100%;border-radius:3px;transition:width .3s ease}
    .links{margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid #1e1e2e;display:flex;gap:1rem;flex-wrap:wrap}
    .link{font-family:'DM Mono',monospace;font-size:.75rem;color:#475569;text-decoration:none}
    .link:hover{color:#22c55e}
    .footer{margin-top:1.5rem;text-align:center;font-size:.75rem;color:#334155;font-family:'DM Mono',monospace}
    .footer a{color:#475569;text-decoration:none}.footer a:hover{color:#22c55e}
  </style>
</head>
<body>
  <div class="container">
    <a href="https://agentlair.dev" class="brand">
      <div class="brand-logo">A</div>
      <span class="brand-name">agentlair.dev</span>
    </a>
    <div class="profile-card">
      <div class="profile-header">
        <div class="avatar">${avatarLetter}</div>
        <div class="profile-info">
          <div class="profile-name">${safeName}</div>
          <div class="profile-email">${safeEmail}</div>
          <div class="verified-badge">${verifiedText}</div>
        </div>
      </div>
      <div class="field-grid">
        <div class="field">
          <div class="field-label">Agent ID</div>
          <div class="field-value">${safeId}</div>
        </div>
        <div class="field">
          <div class="field-label">Registered</div>
          <div class="field-value">${registeredDate}</div>
        </div>
        <div class="field">
          <div class="field-label">Decentralized Identity (DID)</div>
          <div class="field-value">${safeDid}</div>
        </div>
        ${jwksField}
        <div class="field">
          <div class="field-label">Behavioral Trust Score</div>
          <div class="trust-value">${safeTrustDisplay}</div>
          ${trustBar}
        </div>
        ${attestationFields}
      </div>
      <div class="links">
        <a href="/api" class="link">↗ API Docs</a>
        <a href="/getting-started" class="link">↗ Getting Started</a>
        ${jwksLink}
        <a href="${didDocUrl}" class="link">↗ DID Document</a>
      </div>
    </div>
    <div class="footer">
      Powered by <a href="https://agentlair.dev">AgentLair</a> — Persistent identity for AI agents
    </div>
  </div>
</body>
</html>`;
}
