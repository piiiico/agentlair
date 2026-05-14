// ─── A2A Leaderboard Routes ───────────────────────────────────────────────────
//
// Mounted at /leaderboard from index.ts:
//
//   GET  /a2a          → text/html  (200 on KV hit, 503+Retry-After on miss)
//   GET  /a2a.json     → application/json (same status codes)
//   POST /a2a/refresh  → shared-secret gated; triggers runLeaderboardRefresh
//
// Cache: public, max-age=300, s-maxage=3600 for GET routes.
// Auth: shared secret in env.LEADERBOARD_REFRESH_SECRET (simpler than AAT JWT — see coding-output.md).

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { runLeaderboardRefresh, type LeaderboardRowSet, type LeaderboardGrade } from '../lib/a2a-leaderboard-job.js';

export const leaderboardA2ARoutes = new Hono<HonoEnv>();

const KV_KEY = 'v1:results';

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function gradeColor(g: LeaderboardGrade): string {
  switch (g) {
    case 'A': return '#4caf50';
    case 'B': return '#8bc34a';
    case 'C': return '#ff9800';
    case 'D': return '#ff5722';
    case 'F': return '#f44336';
    case 'E': return '#9e9e9e';
    default:  return '#9e9e9e';
  }
}

function renderHtml(rowSet: LeaderboardRowSet): string {
  const { refreshed_at, total, results } = rowSet;

  const l4Zero = results.filter(r => r.layers.l4 === 0).length;

  const heroBanner = `<div class="hero-banner">
    <p class="hero-stat">${l4Zero} of ${total} agents score 0 on L4 (behavioral trust). Static identity is not enough.</p>
    <p class="hero-sub">Every column except L4 measures who an agent CLAIMS to be. L4 measures what an agent has actually DONE. We track L4.</p>
    <a class="hero-cta" href="/a2a-audit">Audit your A2A endpoint &rarr;</a>
  </div>`;

  const rows = results.map((r, i) => {
    const color = gradeColor(r.grade);
    const errorCell = r.error ? `<span class="err">${escapeHtml(r.error)}</span>` : '';
    return `<tr data-idx="${i}">
      <td>${escapeHtml(r.name)}</td>
      <td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a></td>
      <td><span class="pill" style="background:${color}">${escapeHtml(r.grade)}</span></td>
      <td data-val="${r.score}">${r.score}</td>
      <td data-val="${r.layers.l1}">${r.layers.l1}</td>
      <td data-val="${r.layers.l2}">${r.layers.l2}</td>
      <td data-val="${r.layers.l3}">${r.layers.l3}</td>
      <td data-val="${r.layers.l4}">${r.layers.l4}</td>
      <td>${errorCell}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>A2A Trust Leaderboard — agentlair.dev</title>
  <meta name="description" content="Live A2A trust audit scores for ${total} agents. Updated daily.">
  <link rel="canonical" href="https://agentlair.dev/leaderboard/a2a">
  <meta property="og:title" content="A2A Trust Leaderboard — agentlair.dev">
  <meta property="og:description" content="Live A2A trust audit scores for ${total} agents. Updated daily.">
  <meta property="og:url" content="https://agentlair.dev/leaderboard/a2a">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://agentlair.dev/og/default.svg">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 14px; padding: 24px; background: #fafafa; color: #111; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #666; margin-bottom: 16px; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    th { background: #f0f0f0; text-align: left; padding: 10px 12px; cursor: pointer; user-select: none; white-space: nowrap; }
    th:hover { background: #e0e0e0; }
    th.sorted-asc::after  { content: " ▲"; }
    th.sorted-desc::after { content: " ▼"; }
    td { padding: 8px 12px; border-top: 1px solid #eee; vertical-align: middle; }
    tr:hover td { background: #f5f5f5; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; color: #fff; font-weight: 600; font-size: 12px; }
    a { color: #1a73e8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .err { color: #888; font-size: 11px; }
    .footer-note { margin-top: 16px; font-size: 12px; color: #666; }
    .hero-banner { border-left: 4px solid #1a73e8; background: rgba(26,115,232,.06); border-radius: 0 6px 6px 0; padding: 16px 20px; margin-bottom: 20px; }
    .hero-stat { font-size: 1rem; font-weight: 600; margin-bottom: 6px; }
    .hero-sub { font-size: 13px; color: #444; margin-bottom: 12px; }
    .hero-cta { display: inline-block; border: 1px solid #1a73e8; color: #1a73e8; border-radius: 4px; padding: 6px 14px; font-size: 13px; font-weight: 600; text-decoration: none; }
    .hero-cta:hover { background: #1a73e8; color: #fff; text-decoration: none; }
    @media (prefers-color-scheme: dark) {
      body { background: #121212; color: #e0e0e0; }
      table { background: #1e1e1e; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
      th { background: #2a2a2a; color: #ccc; }
      th:hover { background: #333; }
      td { border-top-color: #2a2a2a; }
      tr:hover td { background: #252525; }
      a { color: #74aeff; }
      .hero-banner { background: rgba(116,174,255,.08); border-left-color: #74aeff; }
      .hero-sub { color: #aaa; }
      .hero-cta { border-color: #74aeff; color: #74aeff; }
      .hero-cta:hover { background: #74aeff; color: #121212; }
      .footer-note { color: #888; }
    }
  </style>
</head>
<body>
  <h1>A2A Trust Leaderboard</h1>
  <p class="meta">Last refreshed at ${escapeHtml(refreshed_at)} &middot; ${total} agents &middot; auto-updates daily 04:00 UTC</p>
  ${heroBanner}
  <table id="lb">
    <thead>
      <tr>
        <th data-col="0" data-type="text">Agent</th>
        <th data-col="1" data-type="text">URL</th>
        <th data-col="2" data-type="text">Grade</th>
        <th data-col="3" data-type="num">Score</th>
        <th data-col="4" data-type="num">L1</th>
        <th data-col="5" data-type="num">L2</th>
        <th data-col="6" data-type="num">L3</th>
        <th data-col="7" data-type="num" title="L4 = behavioral trust. Computed from observed runtime behavior over time. All 0 here means no agent in the directory has yet accumulated a verifiable behavioral record. The category is wide open.">L4</th>
        <th data-col="8" data-type="text">Note</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    (function() {
      var tbl = document.getElementById('lb');
      var tbody = tbl.querySelector('tbody');
      var headers = tbl.querySelectorAll('th');
      var sortCol = -1, sortAsc = true;
      function getVal(row, col, type) {
        var td = row.querySelectorAll('td')[col];
        if (!td) return '';
        var v = td.dataset.val !== undefined ? td.dataset.val : td.textContent.trim();
        return type === 'num' ? parseFloat(v) || 0 : v.toLowerCase();
      }
      function sortBy(col, type) {
        var rows = Array.from(tbody.querySelectorAll('tr'));
        var asc = sortCol === col ? !sortAsc : true;
        rows.sort(function(a, b) {
          var va = getVal(a, col, type), vb = getVal(b, col, type);
          if (va < vb) return asc ? -1 : 1;
          if (va > vb) return asc ? 1 : -1;
          return 0;
        });
        rows.forEach(function(r) { tbody.appendChild(r); });
        headers.forEach(function(h) { h.classList.remove('sorted-asc', 'sorted-desc'); });
        headers[col].classList.add(asc ? 'sorted-asc' : 'sorted-desc');
        sortCol = col; sortAsc = asc;
      }
      headers.forEach(function(th) {
        th.addEventListener('click', function() {
          sortBy(parseInt(th.dataset.col), th.dataset.type);
        });
      });
    })();
  </script>
  <p class="footer-note">Every agent listed passes static identity checks (L1&#8211;L3). None demonstrate verifiable runtime behavior (L4). Read more: <a href="/blog/agents-are-shrinking-trust-problem-isnt/">Agents Are Shrinking &#8212; But the Trust Problem Isn&#39;t</a></p>
</body>
</html>`;
}

// ─── GET /a2a → HTML ──────────────────────────────────────────────────────────

leaderboardA2ARoutes.get('/a2a', async (c) => {
  const kv = c.env.A2A_LEADERBOARD;
  if (!kv) {
    return c.text('Service unavailable', 503, { 'Retry-After': '300' });
  }

  const raw = await kv.get(KV_KEY);
  if (!raw) {
    return new Response('Service unavailable — leaderboard not yet populated', {
      status: 503,
      headers: { 'Retry-After': '300', 'Content-Type': 'text/plain' },
    });
  }

  const rowSet = JSON.parse(raw) as LeaderboardRowSet;
  const html = renderHtml(rowSet);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
});

// ─── GET /a2a.json → JSON ─────────────────────────────────────────────────────

leaderboardA2ARoutes.get('/a2a.json', async (c) => {
  const kv = c.env.A2A_LEADERBOARD;
  if (!kv) {
    return c.json({ error: 'unavailable' }, 503, { 'Retry-After': '300' });
  }

  const raw = await kv.get(KV_KEY);
  if (!raw) {
    return new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: { 'Retry-After': '300', 'Content-Type': 'application/json' },
    });
  }

  return new Response(raw, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
});

// ─── POST /a2a/refresh → trigger refresh ──────────────────────────────────────
//
// Auth: shared secret in env.LEADERBOARD_REFRESH_SECRET.
// Spec §7 permits simpler shared-secret auth when AAT verification is non-trivial.
// Chose shared-secret: the AAT verifier requires a JWKS self-fetch which CF Workers
// cannot do (522 class bug). The in-process aat.ts module is not yet available
// as a standalone verifier. Documented here for reviewer.

leaderboardA2ARoutes.post('/a2a/refresh', async (c) => {
  const secret = c.env.LEADERBOARD_REFRESH_SECRET;
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!secret || !token || token !== secret) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const kv = c.env.A2A_LEADERBOARD;
  if (!kv) {
    return c.json({ error: 'KV binding unavailable' }, 503);
  }

  try {
    const result = await runLeaderboardRefresh({ A2A_LEADERBOARD: kv });
    if (result.skipped) {
      return c.json({ error: 'registry empty or unavailable' }, 503);
    }
    return c.json({ refreshed_at: result.refreshed_at, count: result.total }, 200, {
      'Cache-Control': 'no-store',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'refresh failed';
    return c.json({ error: msg }, 503);
  }
});
