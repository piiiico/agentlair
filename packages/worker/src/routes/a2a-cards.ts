// ─── Per-A2A-card Landing Pages ──────────────────────────────────────────────
//
// Public endpoint: GET /a2a/:thumbprint
// Renders a server-side HTML trust report (or JSON if Accept prefers it)
// for the A2A agent card whose URL is base64url-encoded in :thumbprint.
//
// Reuses the same encoding, SSRF guard, and audit pipeline as /badge/a2a/:encoded.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import {
  decodeBase64UrlCardUrl,
  isSelfUrl,
} from './badge.js';
import { auditCardUrl, gradeColor, type Grade, type AuditResult, type Check, type Severity } from '../lib/a2a-audit.js';
import { buildSignedAgentCard } from '../a2a.js';

export const a2aCardRoutes = new Hono<HonoEnv>();

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function wantsJson(accept: string | null): boolean {
  if (!accept) return false;
  // Parse q-values for application/json vs text/html
  const parts = accept.split(',').map(p => {
    const [type, ...params] = p.trim().split(';');
    let q = 1;
    for (const param of params) {
      const m = param.trim().match(/^q=(\d+(\.\d+)?)$/);
      if (m) q = parseFloat(m[1]);
    }
    return { type: type.trim().toLowerCase(), q };
  });

  let jsonQ = -1;
  let htmlQ = -1;
  for (const { type, q } of parts) {
    if (type === 'application/json') jsonQ = q;
    if (type === 'text/html') htmlQ = q;
    if (type === '*/*' && htmlQ < 0) htmlQ = q; // */* defaults to HTML
  }
  // JSON wins only if its q is strictly higher
  return jsonQ > 0 && jsonQ > htmlQ;
}

function layerCounts(checks: Check[], layer: string): { pass: number; total: number } {
  const layerChecks = checks.filter(c => c.layer === layer);
  return {
    pass: layerChecks.filter(c => c.pass).length,
    total: layerChecks.length,
  };
}

function renderHtml(
  thumbprint: string,
  cardUrl: string,
  result: AuditResult,
): string {
  const name = result.card.name ?? 'Unknown Agent';
  const grade = result.grade;
  const overall = result.scores.overall;
  const color = gradeColor(grade as Grade);

  const l1 = layerCounts(result.checks, 'L1');
  const l2 = layerCounts(result.checks, 'L2');
  const l3 = layerCounts(result.checks, 'L3');
  const l4 = layerCounts(result.checks, 'L4');

  // Top 3 failing checks by severity
  const topFindings = result.checks
    .filter(c => !c.pass)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 3);

  const findingsHtml = topFindings.length > 0
    ? topFindings.map(f =>
        `<li><strong>${escapeHtml(f.name)}</strong> <span class="severity severity-${f.severity}">${f.severity}</span> &mdash; ${escapeHtml(f.detail)}</li>`
      ).join('\n        ')
    : '<li>No failing checks found.</li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(name)} — A2A trust report — agentlair.dev</title>
  <meta name="description" content="Trust audit for ${escapeHtml(name)}: grade ${grade}, score ${overall}/100. Free per-card analysis from agentlair.dev.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://agentlair.dev/a2a/${encodeURIComponent(thumbprint)}">
  <meta property="og:title" content="${escapeHtml(name)} — A2A trust report">
  <meta property="og:description" content="Grade ${grade} (${overall}/100). Free per-card analysis.">
  <meta property="og:url" content="https://agentlair.dev/a2a/${encodeURIComponent(thumbprint)}">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#1a1a2e;background:#fafafa;max-width:720px;margin:0 auto;padding:1.5rem}
    header{display:flex;gap:0.5rem;font-size:0.875rem;color:#666;margin-bottom:2rem}
    header a{color:#4361ee;text-decoration:none}
    h1{font-size:1.75rem;margin-bottom:0.25rem}
    h2{font-size:1.125rem;margin:1.5rem 0 0.75rem;color:#333}
    .card-url{font-size:0.8rem;color:#888;margin-bottom:1.5rem;word-break:break-all}
    .grade{display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem}
    .grade-letter{font-size:3rem;font-weight:800;width:4rem;height:4rem;display:flex;align-items:center;justify-content:center;border-radius:12px;color:#fff}
    .grade-score{font-size:1.5rem;font-weight:600;color:#333}
    table{width:100%;border-collapse:collapse;margin-bottom:0.5rem}
    th,td{text-align:left;padding:0.5rem 0.75rem;border-bottom:1px solid #e5e5e5}
    th{font-weight:600;color:#555;width:60%}
    td{font-variant-numeric:tabular-nums}
    ol{padding-left:1.25rem}
    li{margin-bottom:0.5rem}
    .severity{font-size:0.7rem;text-transform:uppercase;padding:0.15rem 0.4rem;border-radius:3px;color:#fff;font-weight:600}
    .severity-critical{background:#e53935}
    .severity-high{background:#fb8c00}
    .severity-medium{background:#fdd835;color:#333}
    .severity-low{background:#90a4ae}
    .severity-info{background:#b0bec5}
    .badge-snippet pre{background:#f0f0f0;padding:0.75rem;border-radius:6px;overflow-x:auto;font-size:0.8rem}
    footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #e5e5e5;font-size:0.8rem;color:#888}
    footer a{color:#4361ee;text-decoration:none}
  </style>
</head>
<body>
  <header>
    <a href="/">agentlair.dev</a> &middot; <a href="/leaderboard/a2a">A2A leaderboard</a>
  </header>
  <main>
    <h1>${escapeHtml(name)}</h1>
    <p class="card-url"><code>${escapeHtml(cardUrl)}</code></p>
    <section class="grade">
      <span class="grade-letter" style="background:${color}">${grade}</span>
      <span class="grade-score">${overall} / 100</span>
    </section>
    <section class="layers">
      <h2>Layer breakdown</h2>
      <table>
        <tr><th>L1 — Provenance</th><td>${l1.pass}/${l1.total}</td></tr>
        <tr><th>L2 — Fitness</th><td>${l2.pass}/${l2.total}</td></tr>
        <tr><th>L3 — Behavior</th><td>${l3.pass}/${l3.total}</td></tr>
        <tr><th>L4 — Operational</th><td>${l4.pass}/${l4.total}</td></tr>
      </table>
    </section>
    <section class="remediation">
      <h2>Top 3 actions</h2>
      <ol>
        ${findingsHtml}
      </ol>
    </section>
    <section class="badge-snippet">
      <h2>Embed the badge</h2>
      <pre><code>![A2A Trust](https://agentlair.dev/badge/a2a/${escapeHtml(thumbprint)})</code></pre>
      <p>Drops into any README. <a href="/badges">More badge styles →</a></p>
    </section>
  </main>
  <footer>
    <a href="/leaderboard/a2a">All audited A2A cards →</a> &middot; <a href="/blog/a2a-trust-leaderboard-may-2026/">Methodology</a>
  </footer>
</body>
</html>`;
}

function errorHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} — agentlair.dev</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:1rem;color:#1a1a2e}
    a{color:#4361ee}
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p><a href="/">Back to agentlair.dev</a></p>
</body>
</html>`;
}

// ─── Route Handler ──────────────────────────────────────────────────────────

a2aCardRoutes.get('/:thumbprint', async (c) => {
  const thumbprint = c.req.param('thumbprint') || '';

  const cardUrl = decodeBase64UrlCardUrl(thumbprint);
  if (!cardUrl) {
    const isJson = wantsJson(c.req.header('Accept') ?? null);
    if (isJson) {
      return new Response(JSON.stringify({ error: 'invalid url' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    return new Response(errorHtml('Invalid URL', 'invalid url'), {
      status: 400,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  // Determine response format from Accept header
  const isJson = wantsJson(c.req.header('Accept') ?? null);

  // CF Cache API — include format in cache key so JSON doesn't poison HTML
  const cache: Cache | undefined =
    typeof caches !== 'undefined' ? (caches as any).default : undefined;
  const cacheKey = new Request(c.req.url + '#' + (isJson ? 'json' : 'html'), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  try {
    // Bypass CF Worker self-fetch by building card in-memory (same as badge route)
    let fetchImpl: typeof fetch | undefined;
    if (isSelfUrl(cardUrl) && c.env?.AUDIT_SIGNING_KEY) {
      const card = await buildSignedAgentCard(c.env.AUDIT_SIGNING_KEY);
      fetchImpl = (async () =>
        new Response(JSON.stringify(card), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as unknown as typeof fetch;
    }

    const result = await auditCardUrl(cardUrl, fetchImpl);

    let response: Response;
    if (isJson) {
      response = new Response(JSON.stringify({
        target: result.target,
        fetched_from: result.fetched_from,
        agent_name: result.card.name ?? null,
        scores: result.scores,
        grade: result.grade,
        checks: result.checks.map(ch => ({
          id: ch.id, layer: ch.layer, name: ch.name, pass: ch.pass, severity: ch.severity,
        })),
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } else {
      const html = renderHtml(thumbprint, cardUrl, result);
      response = new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    }

    // Stash in CF edge cache (non-blocking)
    if (cache) {
      const ctx = c.executionCtx;
      const cloned = response.clone();
      if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, cloned));
      else await cache.put(cacheKey, cloned);
    }

    return response;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'audit failed';
    if (isJson) {
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    return new Response(errorHtml('Audit Error', msg), {
      status: 502,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }
});
