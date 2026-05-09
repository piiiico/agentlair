// ─── Per-A2A-card OG Image Route ──────────────────────────────────────────────
//
// Public endpoint: GET /og/a2a/:thumbprint[.png]
// Returns a 1200×630 SVG OG image for the A2A trust-report card.
// Used as og:image in /a2a/:thumbprint HTML pages.
//
// Option B (SVG-only): workers-og (PNG via satori+resvg-wasm) initialises WASM
// eagerly at import time, breaking the Bun test runner. SVG avoids the WASM
// dependency entirely. Twitter won't preview SVG OG images — all other major
// platforms (LinkedIn, Slack, Discord, Mastodon, BlueSky, Facebook) do.
// Follow-up: add Twitter-compatible PNG via cdn-cgi/image proxy or KV cache.
//
// Reuses the same base64url encoding, SSRF guard, and audit pipeline as
// /badge/a2a/:encoded and /a2a/:thumbprint.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { decodeBase64UrlCardUrl, isSelfUrl } from './badge.js';
import { auditCardUrl, gradeColor, type Grade } from '../lib/a2a-audit.js';
import { buildSignedAgentCard } from '../a2a.js';

export const ogA2aRoutes = new Hono<HonoEnv>();

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateName(name: string, maxLen = 50): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '…';
}

// ─── SVG OG Image Template (1200×630) ───────────────────────────────────────

function renderOgSvg(
  name: string,
  grade: string,
  overall: number,
  color: string,
): string {
  const safeName = escapeXml(truncateName(name));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&amp;display=swap');
      text { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    </style>
  </defs>
  <!-- Background -->
  <rect width="1200" height="630" fill="#fafafa"/>
  <!-- Right accent stripe -->
  <rect x="1188" y="0" width="12" height="630" fill="${color}"/>
  <!-- agentlair.dev wordmark -->
  <text x="64" y="90" font-size="28" font-weight="700" fill="#4361ee">agentlair.dev</text>
  <!-- Agent name -->
  <text x="64" y="190" font-size="48" font-weight="700" fill="#1a1a2e">${safeName}</text>
  <!-- Grade badge -->
  <rect x="64" y="340" width="120" height="120" rx="20" fill="${color}"/>
  <text x="124" y="420" font-size="72" font-weight="800" fill="#fff" text-anchor="middle" dominant-baseline="middle">${escapeXml(grade)}</text>
  <!-- Score -->
  <text x="216" y="395" font-size="48" font-weight="700" fill="#333">${overall}/100</text>
  <text x="216" y="430" font-size="20" fill="#888">A2A Trust Score</text>
  <!-- Tagline -->
  <text x="64" y="580" font-size="18" fill="#888">Free A2A trust report — agentlair.dev</text>
</svg>`;
}

function renderErrorOgSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fafafa"/>
  <text x="600" y="280" font-size="28" font-weight="700" fill="#4361ee" text-anchor="middle" font-family="system-ui, sans-serif">agentlair.dev</text>
  <text x="600" y="340" font-size="36" fill="#888" text-anchor="middle" font-family="system-ui, sans-serif">Unknown card</text>
  <text x="600" y="390" font-size="18" fill="#aaa" text-anchor="middle" font-family="system-ui, sans-serif">Free A2A trust report — agentlair.dev</text>
</svg>`;
}

function svgImageResponse(svg: string, status: number, ttl: number): Response {
  return new Response(svg, {
    status,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}`,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ─── Route Handler ──────────────────────────────────────────────────────────

ogA2aRoutes.get('/:thumbprintWithExt', async (c) => {
  // Strip optional .png suffix (keep path compat even though we serve SVG)
  let thumbprint = c.req.param('thumbprintWithExt') || '';
  if (thumbprint.endsWith('.png')) {
    thumbprint = thumbprint.slice(0, -4);
  }

  const cardUrl = decodeBase64UrlCardUrl(thumbprint);
  if (!cardUrl) {
    return svgImageResponse(renderErrorOgSvg(), 400, 60);
  }

  // CF Cache API — cache the rendered image
  const cache: Cache | undefined =
    typeof caches !== 'undefined' ? (caches as any).default : undefined;
  const cacheKey = new Request(c.req.url, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  try {
    // Self-card bypass (same as a2a-cards.ts and badge.ts)
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
    const name = result.card.name ?? 'Unknown Agent';
    const grade = result.grade;
    const overall = result.scores.overall;
    const color = gradeColor(grade as Grade);

    const svg = renderOgSvg(name, grade, overall, color);
    const response = svgImageResponse(svg, 200, 86400);

    // Stash in CF edge cache
    if (cache) {
      const ctx = c.executionCtx;
      const cloned = response.clone();
      if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, cloned));
      else await cache.put(cacheKey, cloned);
    }

    return response;
  } catch {
    return svgImageResponse(renderErrorOgSvg(), 502, 60);
  }
});
