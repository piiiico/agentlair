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
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { buildSlugIndex } from '../lib/a2a-leaderboard-slug.js';
import type { LeaderboardGrade, LeaderboardRowSet } from '../lib/a2a-leaderboard-job.js';
import { computeLeaderboardStats, type LeaderboardStats } from '../lib/a2a-leaderboard-stats.js';

// @ts-expect-error — binary imports: WebAssembly.Module in CF Workers, file path string in Bun
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-expect-error — binary font import: ArrayBuffer in CF Workers, file path string in Bun
import interRegularWoff2 from '../assets/inter-regular.woff2';
// @ts-expect-error — binary font import: ArrayBuffer in CF Workers, file path string in Bun
import interBoldWoff2 from '../assets/inter-bold.woff2';
// @ts-expect-error — pre-rendered static PNG: ArrayBuffer in CF Workers, file path string in Bun
import staticOgPng from '../assets/og-a2a-stats.png';

export const ogA2aStatsRoutes = new Hono<HonoEnv>();

const KV_KEY = 'v1:results';

// ─── WASM + Font Initialization (lazy singleton) ─────────────────────────────
// NOTE: uses the same 'Already initialized' swallow as og-a2a.ts — this is
// intentional: both modules may run in the same isolate (tests, CF Workers).
// Do NOT call initWasm at module load level.

let wasmReady = false;
let wasmInitPromise: Promise<void> | null = null;
let fontBuffers: Uint8Array[] = [];

async function loadBinary(imported: unknown): Promise<Uint8Array> {
  if (imported instanceof ArrayBuffer) return new Uint8Array(imported);
  if (imported instanceof Uint8Array) return imported;
  if (typeof imported === 'string') {
    const { readFileSync } = await import('fs');
    return new Uint8Array(readFileSync(imported));
  }
  throw new Error('Unexpected binary import type: ' + typeof imported);
}

async function ensureWasm(): Promise<boolean> {
  if (wasmReady) return true;
  if (wasmInitPromise) {
    await wasmInitPromise;
    return wasmReady;
  }
  wasmInitPromise = (async () => {
    try {
      let wasmInput: any = resvgWasm;
      if (typeof wasmInput === 'string') {
        const { readFileSync } = await import('fs');
        wasmInput = readFileSync(wasmInput);
      }
      await initWasm(wasmInput);
    } catch (e: unknown) {
      // "Already initialized" means another module/test already called initWasm
      if (!(e instanceof Error && e.message.includes('Already initialized'))) {
        return; // genuine failure — WASM not available
      }
    }
    fontBuffers = [
      await loadBinary(interRegularWoff2),
      await loadBinary(interBoldWoff2),
    ];
    wasmReady = true;
  })();
  await wasmInitPromise;
  return wasmReady;
}

function svgToPng(svg: string): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontBuffers,
      defaultFontFamily: 'Inter',
      loadSystemFonts: false,
    },
  });
  return resvg.render().asPng();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Local gradeColor covers LeaderboardGrade (A/B/C/D/F/E) — a2a-audit gradeColor only covers Grade (A-F). */
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
// Pre-rendered at deploy time. Loaded lazily; avoids large buffer on 503 paths.

let staticPngBuffer: Uint8Array | null = null;

async function loadStaticPng(): Promise<Uint8Array | null> {
  if (staticPngBuffer) return staticPngBuffer;
  try {
    const imp: unknown = staticOgPng;
    if (imp instanceof ArrayBuffer) {
      staticPngBuffer = new Uint8Array(imp);
    } else if (imp instanceof Uint8Array) {
      staticPngBuffer = imp;
    } else if (typeof imp === 'string') {
      const { readFileSync } = await import('fs');
      staticPngBuffer = new Uint8Array(readFileSync(imp));
    }
  } catch {
    // static PNG not available — caller will handle
  }
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

  // Build PNG response: prefer WASM render, fall back to static pre-rendered PNG,
  // last resort SVG (browsers can show it, but Twitter/X link-preview needs PNG).
  let response: Response;
  if (canPng) {
    response = imageResponse(svgToPng(svg), true);
  } else {
    const staticPng = await loadStaticPng();
    response = staticPng
      ? imageResponse(staticPng, true)   // static PNG — Content-Type: image/png ✓
      : imageResponse(svg, false);       // SVG last resort
  }

  // Stash in CF edge cache
  if (cache) {
    const ctx = c.executionCtx;
    const cloned = response.clone();
    if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, cloned));
    else await cache.put(cacheKey, cloned);
  }

  return response;
});
