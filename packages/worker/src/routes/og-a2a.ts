// ─── Per-A2A-card OG Image Route ──────────────────────────────────────────────
//
// Public endpoint: GET /og/a2a/:thumbprint[.png]
// Returns a 1200×630 PNG OG image for the A2A trust-report card.
// Used as og:image in /a2a/:thumbprint HTML pages.
//
// Uses @resvg/resvg-wasm to render SVG → PNG server-side. WASM is lazily
// initialized on first request. If WASM fails (unlikely in CF Workers),
// falls back to SVG. Fonts (Inter Regular + Bold) are bundled as WOFF2.
//
// Reuses the same base64url encoding, SSRF guard, and audit pipeline as
// /badge/a2a/:encoded and /a2a/:thumbprint.

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { decodeBase64UrlCardUrl, isSelfUrl } from './badge.js';
import { auditCardUrl, gradeColor, type Grade } from '../lib/a2a-audit.js';
import { buildSignedAgentCard } from '../a2a.js';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

// @ts-expect-error — binary imports: WebAssembly.Module in CF Workers, file path string in Bun
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-expect-error — binary font import: ArrayBuffer in CF Workers, file path string in Bun
import interRegularWoff2 from '../assets/inter-regular.woff2';
// @ts-expect-error — binary font import: ArrayBuffer in CF Workers, file path string in Bun
import interBoldWoff2 from '../assets/inter-bold.woff2';

export const ogA2aRoutes = new Hono<HonoEnv>();

// ─── WASM + Font Initialization (lazy singleton) ──────────────────────────

let wasmReady = false;
let wasmInitPromise: Promise<void> | null = null;
let fontBuffers: Uint8Array[] = [];

async function loadBinary(imported: unknown): Promise<Uint8Array> {
  if (imported instanceof ArrayBuffer) return new Uint8Array(imported);
  if (imported instanceof Uint8Array) return imported;
  if (typeof imported === 'string') {
    // Bun/Node: import resolves to file path
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
      // In CF Workers, WASM import is a WebAssembly.Module — pass directly.
      // In Bun, it's a file path string — read the file first.
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
    // Load fonts (needed regardless of whether we just initialized or it was already done)
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
// Exported for unit-testing the SVG template (tone words, XSS escaping) without
// needing to decode PNG binary output.

export function renderOgSvg(
  name: string,
  grade: string,
  overall: number,
  color: string,
): string {
  const safeName = escapeXml(truncateName(name));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <!-- Background -->
  <rect width="1200" height="630" fill="#fafafa"/>
  <!-- Right accent stripe -->
  <rect x="1188" y="0" width="12" height="630" fill="${color}"/>
  <!-- agentlair.dev wordmark -->
  <text x="64" y="90" font-size="28" font-weight="700" fill="#4361ee" font-family="Inter, sans-serif">agentlair.dev</text>
  <!-- Agent name -->
  <text x="64" y="190" font-size="48" font-weight="700" fill="#1a1a2e" font-family="Inter, sans-serif">${safeName}</text>
  <!-- Grade badge -->
  <rect x="64" y="340" width="120" height="120" rx="20" fill="${color}"/>
  <text x="124" y="420" font-size="72" font-weight="800" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="Inter, sans-serif">${escapeXml(grade)}</text>
  <!-- Score -->
  <text x="216" y="395" font-size="48" font-weight="700" fill="#333" font-family="Inter, sans-serif">${overall}/100</text>
  <text x="216" y="430" font-size="20" fill="#888" font-family="Inter, sans-serif">A2A Trust Score</text>
  <!-- Tagline -->
  <text x="64" y="580" font-size="18" fill="#888" font-family="Inter, sans-serif">Free A2A trust report — agentlair.dev</text>
</svg>`;
}

export function renderErrorOgSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fafafa"/>
  <text x="600" y="280" font-size="28" font-weight="700" fill="#4361ee" text-anchor="middle" font-family="Inter, sans-serif">agentlair.dev</text>
  <text x="600" y="340" font-size="36" fill="#888" text-anchor="middle" font-family="Inter, sans-serif">Unknown card</text>
  <text x="600" y="390" font-size="18" fill="#aaa" text-anchor="middle" font-family="Inter, sans-serif">Free A2A trust report — agentlair.dev</text>
</svg>`;
}

// ─── Response Helpers ──────────────────────────────────────────────────────

function imageResponse(
  body: Uint8Array | string,
  isPng: boolean,
  status: number,
  ttl: number,
): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': isPng ? 'image/png' : 'image/svg+xml',
      'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}`,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ─── Route Handler ──────────────────────────────────────────────────────────

ogA2aRoutes.get('/:thumbprintWithExt', async (c) => {
  // Strip optional .png suffix
  let thumbprint = c.req.param('thumbprintWithExt') || '';
  if (thumbprint.endsWith('.png')) {
    thumbprint = thumbprint.slice(0, -4);
  }

  // Initialize WASM (lazy, first-request only)
  const canPng = await ensureWasm();

  const cardUrl = decodeBase64UrlCardUrl(thumbprint);
  if (!cardUrl) {
    const errorSvg = renderErrorOgSvg();
    if (canPng) {
      return imageResponse(svgToPng(errorSvg), true, 400, 60);
    }
    return imageResponse(errorSvg, false, 400, 60);
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
    const response = canPng
      ? imageResponse(svgToPng(svg), true, 200, 86400)
      : imageResponse(svg, false, 200, 86400);

    // Stash in CF edge cache
    if (cache) {
      const ctx = c.executionCtx;
      const cloned = response.clone();
      if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, cloned));
      else await cache.put(cacheKey, cloned);
    }

    return response;
  } catch {
    const errorSvg = renderErrorOgSvg();
    if (canPng) {
      return imageResponse(svgToPng(errorSvg), true, 502, 60);
    }
    return imageResponse(errorSvg, false, 502, 60);
  }
});
