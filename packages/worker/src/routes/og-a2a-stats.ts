// ─── Aggregate A2A Stats OG Image Route ───────────────────────────────────────
//
// Public endpoint: GET /og/a2a-stats.png
// Returns a 1200×630 PNG OG image for the aggregate A2A stats page.
// Used as og:image in /leaderboard/a2a/stats HTML pages.
//
// Rendering strategy:
//   Primary: @resvg/resvg-wasm renders SVG → PNG server-side.
//   Fallback: pre-rendered static PNG bundled at deploy time (src/assets/og-a2a-stats.png).
//             Ensures Content-Type: image/png is ALWAYS returned even when WASM fails
//             in CF Workers (WASM init observed to fail silently in production).
//   Static PNG is baked at pipeline deploy time from the current dataset snapshot.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { buildSlugIndex } from '../lib/a2a-leaderboard-slug.js';
import type { LeaderboardRowSet } from '../lib/a2a-leaderboard-job.js';
import { computeLeaderboardStats, type LeaderboardStats } from '../lib/a2a-leaderboard-stats.js';
import { ensureWasm, svgToPng, gradeColor } from '../lib/og-render.js';
// Pre-rendered static PNG bundled inline as base64 — guaranteed available in CF Workers
// regardless of wrangler Data rule behaviour. Regenerate with: bun tools/gen-og-stats-png.ts
import { OG_A2A_STATS_PNG_B64 } from '../assets/og-a2a-stats-b64.js';

export const ogA2aStatsRoutes = new Hono<HonoEnv>();

const KV_KEY = 'v1:results';

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── SVG OG Image Template (1200×630) ───────────────────────────────────────
// Exported for unit-testing the SVG template without needing to decode PNG binary.

export function renderStatsOgSvg(stats: LeaderboardStats): string {
  const { layerFailRates, total, gradeDistribution } = stats;
  const brandBlue = '#4361ee';

  // Grade pills: x positions for 6 pills (A B C D F E)
  const pillWidth = 120;
  const pillHeight = 36;
  const pillGap = 20;
  const pillsTotal = gradeDistribution.length * (pillWidth + pillGap) - pillGap;
  const pillsStartX = (1200 - pillsTotal) / 2;
  const pillY = 540;

  const gradePillsSvg = gradeDistribution.map((e, i) => {
    const x = pillsStartX + i * (pillWidth + pillGap);
    const color = gradeColor(e.grade as any);
    const safeGrade = escapeXml(e.grade);
    return `<rect x="${x}" y="${pillY}" width="${pillWidth}" height="${pillHeight}" rx="8" fill="${color}"/>
  <text x="${x + pillWidth / 2}" y="${pillY + pillHeight / 2 + 1}" font-size="18" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="Inter, sans-serif">${safeGrade} ${e.count}</text>`;
  }).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <!-- Background -->
  <rect width="1200" height="630" fill="#fafafa"/>
  <!-- Right accent stripe -->
  <rect x="1188" y="0" width="12" height="630" fill="${brandBlue}"/>
  <!-- agentlair.dev wordmark -->
  <text x="64" y="90" font-size="28" font-weight="700" fill="${brandBlue}" font-family="Inter, sans-serif">agentlair.dev</text>
  <!-- Headline -->
  <text x="64" y="220" font-size="64" font-weight="700" fill="#1a1a2e" font-family="Inter, sans-serif">${escapeXml(String(layerFailRates.l4))}% fail behavioral trust</text>
  <!-- Sub-line -->
  <text x="64" y="290" font-size="32" fill="#555" font-family="Inter, sans-serif">${total} A2A agents audited · agentlair.dev/leaderboard/a2a</text>
  <!-- Grade pills -->
  ${gradePillsSvg}
</svg>`;
}

// ─── Static PNG fallback ─────────────────────────────────────────────────────
// Pre-rendered PNG, inlined as base64 in og-a2a-stats-b64.ts at pipeline time.
// Inline base64 is reliable in CF Workers regardless of wrangler Data rule behaviour.

let staticPngBuffer: Uint8Array | null = null;

function loadStaticPng(): Uint8Array {
  if (staticPngBuffer) return staticPngBuffer;
  // atob is available in both CF Workers and modern Bun runtimes
  const binary = atob(OG_A2A_STATS_PNG_B64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  staticPngBuffer = buf;
  return staticPngBuffer;
}

// ─── Response Helper ────────────────────────────────────────────────────────

function imageResponse(body: Uint8Array | string, isPng: boolean): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': isPng ? 'image/png' : 'image/svg+xml',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ─── Route Handler ───────────────────────────────────────────────────────────

ogA2aStatsRoutes.get('/', async (c) => {
  const kv = c.env.A2A_LEADERBOARD;
  if (!kv) {
    return new Response('Service unavailable', {
      status: 503,
      headers: { 'Retry-After': '300', 'Content-Type': 'text/plain' },
    });
  }

  const raw = await kv.get(KV_KEY);
  if (!raw) {
    return new Response('Service unavailable — leaderboard not yet populated', {
      status: 503,
      headers: { 'Retry-After': '300', 'Content-Type': 'text/plain' },
    });
  }

  // CF Cache API — cache the rendered image
  const cache: Cache | undefined =
    typeof caches !== 'undefined' ? (caches as any).default : undefined;
  const cacheKey = new Request(c.req.url, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const rowSet = JSON.parse(raw) as LeaderboardRowSet;
  const slugIndex = await buildSlugIndex(rowSet.results);
  const stats = computeLeaderboardStats(rowSet, slugIndex);

  const canPng = await ensureWasm();
  const svg = renderStatsOgSvg(stats);

  // Build PNG response: prefer WASM render, fall back to static pre-rendered PNG.
  // Static PNG is always available (inlined as base64), so image/png is guaranteed.
  const response = canPng
    ? imageResponse(svgToPng(svg), true)
    : imageResponse(loadStaticPng(), true);   // static PNG — Content-Type: image/png ✓

  // Stash in CF edge cache
  if (cache) {
    const ctx = c.executionCtx;
    const cloned = response.clone();
    if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, cloned));
    else await cache.put(cacheKey, cloned);
  }

  return response;
});
